# HARNESS.md — El harness de Atiende

> Qué es, cómo se adapta, qué necesidades cumple, cómo garantiza un buen servicio y cómo conectar distintos proveedores de IA.

Este documento describe el **backend de Atiende como harness**: una capa de orquestación que convierte mensajes de WhatsApp en conversaciones atendidas por IA, sin estar casada con ningún proveedor de modelos.

---

## 1. Qué hace este harness

Atiende es un **agente conversacional autónomo** para WhatsApp Business. Como harness:

1. **Recibe** un webhook de Meta (firma HMAC verificada) y responde `200` en < 200 ms.
2. **Persiste** el mensaje antes de cualquier procesamiento (pérdida cero, ver §4).
3. **Encola** el trabajo en BullMQ (Redis) — el webhook jamás espera al LLM.
4. **Orquesta un turno del agente** (`AgentService`): construye el prompt, llama al LLM, ejecuta tools (catálogo, órdenes, escalación, conocimiento) en loop con límite de iteraciones, valida la respuesta y la guarda.
5. **Envía** la respuesta de vuelta a Meta.
6. **Mide y registra** cada turno (tokens, costo USD, latencia, tool calls).

```
WhatsApp ──▶ Webhook ──▶ persistir ──▶ BullMQ ──▶ AgentService ──▶ LLM (port)
                 │                                 │   │
                 │                                 │   └─▶ tools (RAG, órdenes, escalar)
                 └──────── 200 inmediato           │
                                                   ▼
                                            validar + cachear + enviar + guardar
```

El "harness" es exactamente lo que está **entre** el canal y el modelo: la interfaz común (`LLMProviderPort`), el loop de agente, el caching multinivel, la validación de respuestas y la resiliencia. El core del sistema **no conoce a ningún proveedor** — solo habla con interfaces (ports).

---

## 2. Cómo se adapta

### 2.1 La interfaz común (el port)

Todo LLM entra por un único contrato en `src/core/ports/llm-provider.port.ts`:

```typescript
export interface LLMProviderPort {
  readonly name: string;                                    // 'groq' | 'openai' | ...
  chat(req: ChatRequest): Promise<ChatResponse>;            // un turno con tool use opcional
  isHealthy(): Promise<boolean>;                            // para health checks y fallback
}
```

El core envía **hints portables**, no mecanismos de un proveedor:

| Hint del request | Qué significa | Qué hace cada adapter |
|---|---|---|
| `cacheable` | "este turno es buen candidato a caching" | Claude → `cache_control`; OpenAI → lo ignora (su cache es automático); local → lo ignora |
| `effort` | nivel de razonamiento `low…max` | Claude → `output_config.effort`; OpenAI → `reasoning_effort` (o-series) o ignora; degrada en silencio si no soporta |
| `forceTool` | "usa esta tool sí o sí" | quien la soporta la fuerza; quien no, la ignora |
| `signal` | cancelación (timeout) | todos lo respetan con `AbortController` |

Regla del repo: **se abstrae lo conceptualmente portable**. Lo que es provider-specific (prompt caching de Anthropic, adaptive thinking, compaction) vive dentro del adapter, no se filtra al core.

### 2.2 Adaptadores implementados

| Provider | Archivo | Estado |
|---|---|---|
| Groq | `src/modules/llm/groq/groq.adapter.ts` | ✅ En uso (primario en dev) |
| OpenAI | `src/modules/llm/openai/openai.adapter.ts` | ✅ Implementado |
| Gemini | `src/modules/llm/gemini/gemini.adapter.ts` | ✅ Implementado |
| Mock | `src/modules/llm/mock/mock-llm.adapter.ts` | ✅ Para tests determinísticos |
| Claude | `src/modules/llm/claude/` | ⏳ Pendiente (solo placeholder) |

Cada adapter traduce el `ChatRequest` genérico a su formato nativo: el de OpenAI/Groq convierte `tool_use` ↔ `tool_calls`, y Groq además **parsea tool calls en texto plano** (`<function.NAME{json}></function>`, ver `src/modules/llm/raw-function-calls.ts`) porque su API de función-calling nativa falla con `llama-3.3-70b`. Ese parser también se aplica a OpenAI como defensa en profundidad.

### 2.3 Selección por configuración (feature flags)

El adapter que se carga se decide **al boot** con variables de entorno (Zod-validadas, fail-fast):

```bash
FEATURE_LLM_PRIMARY=groq        # claude | openai | gemini | groq | mock
FEATURE_LLM_FALLBACK=           # opcional; '' = sin fallback
FEATURE_EMBEDDINGS_PROVIDER=openai   # openai | voyage
```

`src/config/module-registry.ts` lee la flag y registra el módulo correcto; `src/config/ai.config.ts` arma `AIConfig` (modelo, effort, timeout, retries) por proveedor; y `MODEL_PRICING` traduce tokens → USD por modelo.

> ⚠️ Estado honesto: el fallback de proveedor está **diseñado** (ver §13 de `docs/01_ARCHITECTURE.md`) y su configuración (circuit breaker) ya está tipada en `ai.config.ts`, pero el router que alterna primario/fallback (`LLMRouterService`) **aún no está cableado**. Hoy el harness usa un solo proveedor por instancia.

### 2.4 Otros planos de adaptación

- **Canales** (`ChannelProviderPort`): WhatsApp hoy; el port deja espacio para web chat y Telegram (flags `FEATURE_CHANNEL_*`).
- **Tools** (`ToolModulePort`): catálogo (RAG), `get_business_info`, `search_knowledge`, `create_order`, `escalate_to_human` — activables por flag.
- **Caché** (`ResponseCachePort`): exacta (Redis) y semántica (pgvector), con fallback in-memory si Redis cae.
- **Embeddings** (`EmbeddingProviderPort`): OpenAI hoy; Voyage como alternativa planificada.

---

## 3. Qué necesidades cumple

### Necesidad de negocio (para quién)

PYMEs latinoamericanas que pierden ventas por no responder WhatsApp a tiempo:

- **Atención 24/7** en lenguaje natural (no chatbot de respuestas fijas).
- **Respuestas reales sobre el negocio**: RAG sobre catálogo y documentos (precios, horarios, políticas) — nunca inventa datos (FR-9).
- **Órdenes conversacionales** y **escalación a humano** cuando la conversación lo amerita.
- **Dashboard** para que el negocio vea pendientes, tome el control y resuelva.
- **Multi-tenant**: una instancia, N negocios, cada uno con su número y su prompt.

### Necesidades no funcionales (garantías técnicas de la spec)

| Necesidad | Objetivo |
|---|---|
| Latencia | p95 < 5 s por turno (NFR-1) |
| Costo | < $0.05 por conversación promedio (NFR-3), con caching multinivel |
| Escalabilidad | 100 negocios / 10k mensajes-día por instancia; stateless + cola (NFR-5/6) |
| Disponibilidad | 99.5% uptime; pérdida cero de mensajes (NFR-7/8) |
| Seguridad | tokens de WhatsApp encriptados en reposo; API keys solo en backend; PII protegida (NFR-9/10/11) |
| Mantenibilidad | hexagonal: cambiar un proveedor o canal no toca el core |

---

## 4. Cómo garantiza un buen servicio

### 4.1 Pérdida cero de mensajes (NFR-8)

- El webhook **persiste el mensaje antes de encolar** (persist-before-enqueue), y responde 200 a Meta en seguida.
- La persistencia inicial (conversación + dedup + inbound + USER message) es una **única transacción** (`UnitOfWork`).
- Entrega **at-least-once**: el inbound se marca `processedAt` solo después del envío exitoso a Meta; un job fallido se reintenta con backoff, no se pierde.
- **Idempotencia**: `Message.inboundMessageId` es único; el save devuelve `created` para que los reintentos no dupliquen efectos (p. ej. no inflan el contador de no-leídos).

### 4.2 Resiliencia

- **Cola con reintentos** (BullMQ, backoff exponencial) para webhook, agente y envío.
- **Caching multinivel provider-agnostic**: capa exacta (Redis, ~5 ms) + semántica (pgvector, ~50 ms) responden buena parte del tráfico **sin llamar al LLM**; si un proveedor cae, lo que sale de cache sigue funcionando. Capa 1 (prompt caching de Anthropic) es la base de ahorro en el primario.
- **Fallback en otros componentes**: Redis caído → cache in-memory (degrada performance, no correctness); embeddings caídos → el pipeline sigue, sin cache semántica.
- **Circuit breaker** (configurado): umbral de fallos, error rate, ventana, half-open probe. Diseñado para abrir el circuito y rutear al fallback cuando el primario falla.

### 4.3 Seguridad de la IA (que el bot no haga daño)

- **Scope guard**: un clasificador decide si el mensaje está dentro del alcance del negocio; si no, se bloquea con un rechazo amable.
- **Validación de respuestas**: un validador detecta señales de alucinación ("no tengo info… pero") y el prompt incluye prevención explícita de alucinación.
- **Safety rails del cache semántico**: umbral conservador de similitud (0.95), scope por `business_id`, bypass si hay PII o si el turno involucra tools de estado (órdenes, escalación), TTL corto (30 min) e invalidación por evento.
- **Presupuesto por conversación** (`AGENT_BUDGET_USD_PER_CONVERSATION`): al superarlo, el agente deja de gastar y pide contactar al negocio.
- **Límites estrictos**: máximo de iteraciones de tool use (evita loops) y timeouts con abort para LLM y tools.

### 4.4 Observabilidad (lo que no se mide no existe)

- Cada turno loguea JSON: modelo, proveedor, tokens, costo USD, latencia, tool calls, business y conversación.
- Los `agent_runs` se persisten en DB para auditoría y métricas.
- Logs de hit/miss del cache (exact y semántico) con similitud y business.
- Endpoint `/health` (check de DB) para orquestación.
- El circuito de costo (tokens × `MODEL_PRICING`) está centralizado: un modelo nuevo sin pricing loguea warning (no reporta 0 en silencio).

### 4.5 Buen servicio humano (human-in-the-loop)

- Escalación automática a humano con motivo y urgencia; la IA queda muda mientras la conversación está `ESCALATED`.
- Dashboard: lista de pendientes, notificaciones "X escribió", toma de control y resolución.
- Las escalaciones inactivas expiran solas (vuelven a `ACTIVE` y la IA retoma).
- Un mensaje nuevo en una conversación `RESOLVED` la reabre automáticamente.

---

## 5. Cómo usar distintos proveedores de IA

### 5.1 Cambiar de proveedor = cambiar variables, no código

En `.env` (o env del contenedor):

```bash
# --- Proveedor primario ---
FEATURE_LLM_PRIMARY=groq            # claude | openai | gemini | groq | mock
GROQ_API_KEY=gsk_...                # la key del proveedor elegido
GROQ_MODEL=llama-3.3-70b-versatile

# Fallback opcional (hoy: diseño — el router aún no está cableado)
FEATURE_LLM_FALLBACK=openai
OPENAI_API_KEY=sk-...

# Embeddings
FEATURE_EMBEDDINGS_PROVIDER=openai
OPENAI_API_KEY=sk-...               # si no está ya
```

Alternativas:

```bash
# OpenAI como primario
FEATURE_LLM_PRIMARY=openai
OPENAI_API_KEY=sk-...
OPENAI_FALLBACK_CHAT_MODEL=gpt-4o-mini

# Gemini (free tier)
FEATURE_LLM_PRIMARY=gemini
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash

# Mock (sin llamadas reales, para tests)
FEATURE_LLM_PRIMARY=mock
```

Notas de comportamiento al cambiar:

- **Modelo**: `src/config/ai.config.ts` elige el modelo por proveedor (o el env `*_MODEL`/`OPENAI_FALLBACK_CHAT_MODEL`).
- **Costo**: si el modelo no está en `MODEL_PRICING`, el tracking reporta 0 y loguea warning — hay que agregarlo ahí.
- **Tool calling**: OpenAI/Gemini usan function-calling nativo; Groq usa el formato texto + `raw-function-calls.ts`. El core no cambia.
- **Capacidades que se ganan/pierden**: p. ej. el prompt caching explícito y el adaptive thinking son de Anthropic; con otro proveedor esos mecanismos no existen, pero las capas 2 y 3 del response cache (provider-agnostic) siguen protegiendo costo y latencia.

### 5.2 Añadir un proveedor nuevo (pasos)

1. Implementar `LLMProviderPort` en `src/modules/llm/<provider>/` (`name`, `chat`, `isHealthy`).
2. Crear el módulo NestJS que registre el adapter bajo `LLM_PROVIDER_TOKEN`.
3. Agregar el `case` en `resolveModules()` (`src/config/module-registry.ts`) con su flag.
4. Agregar el modelo a `MODEL_PRICING` en `ai.config.ts` para tracking de costo.
5. Crear (si hace falta) un mock para tests.
6. Documentar cualquier "leaky abstraction" (features del proveedor que no se abstraen) en `docs/01_ARCHITECTURE.md` §11.

### 5.3 Embeddings

La capa semántica usa `EmbeddingProviderPort`. Hoy solo hay adapter de OpenAI (`text-embedding-3-small`); la flag `FEATURE_EMBEDDINGS_PROVIDER=voyage` está tipada pero sin adapter implementado. El mismo patrón aplica: implementar el port y registrarlo.

---

## Referencias

- `src/core/ports/llm-provider.port.ts` — el contrato del harness con los LLMs.
- `src/core/services/agent.service.ts` — el loop del agente (tools, budget, timeouts, telemetría).
- `src/core/use-cases/process-inbound-message.ts` — el pipeline completo (dedup, cache, escalación, unread).
- `src/config/ai.config.ts` — pricing y configuración por proveedor.
- `src/config/features.ts` / `src/config/module-registry.ts` — feature flags y carga de adapters.
- `docs/01_ARCHITECTURE.md` — §11 (adapter pattern), §12 (caching), §13 (resiliencia).
- `docs/00_SPEC.md` — FR/NFR y user stories.
