# 01 — Arquitectura de Atiende

> Lee primero la [Spec (00_SPEC.md)](00_SPEC.md). Este documento traduce los requerimientos a sistema, tecnologías y workflow de desarrollo.

**Versión:** 0.1
**Fecha:** 2026-05-20

---

## 1. Vista general

```
                       ┌──────────────────────────────┐
                       │  Meta WhatsApp Business API  │
                       └──────────┬───────────────────┘
                                  │ webhook (POST)
                                  ▼
        ┌────────────────────────────────────────────────┐
        │  Atiende API (NestJS, stateless)               │
        │  ┌──────────────┐  ┌───────────────────────┐   │
        │  │  Webhook     │─▶│  Message Queue        │   │
        │  │  Receiver    │  │  (BullMQ + Redis)     │   │
        │  └──────────────┘  └───────────┬───────────┘   │
        │                                ▼               │
        │                    ┌───────────────────────┐   │
        │                    │  Agent Worker          │  │
        │                    │  - Build context       │  │
        │                    │  - Call Claude         │  │
        │                    │  - Execute tools       │  │
        │                    │  - Send response       │  │
        │                    └─────┬────────┬────────┘   │
        │                          │        │            │
        │            ┌─────────────┘        └─────────┐  │
        │            ▼                                ▼  │
        │  ┌──────────────────┐         ┌───────────────┐│
        │  │  PostgreSQL +    │         │  Anthropic    ││
        │  │  pgvector        │         │  Claude API   ││
        │  │  (data + RAG)    │         │  (Opus 4.7)   ││
        │  └──────────────────┘         └───────────────┘│
        └────────────────────────────────────────────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │  Dashboard (Next.js) │
                       │  (WebSocket + REST)  │
                       └──────────────────────┘
```

**Principios:**

1. **Stateless API.** Toda la lógica de estado vive en Postgres o Redis. Los servicios HTTP son reemplazables sin sesión sticky.
2. **Queue everywhere.** El webhook responde 200 inmediato a Meta y encola el procesamiento. Si el agente falla, retry sin perder mensaje.
3. **Una sola fuente de verdad por dato.** Catálogo en Postgres + sus embeddings en pgvector. Conversaciones en Postgres. Métricas agregadas calculadas, no duplicadas.
4. **Cost first.** Cada llamada a Claude incluye prompt caching. Cada turno mide tokens y costo.
5. **Arquitectura hexagonal (ports & adapters).** El núcleo del sistema (lógica del agente, dominio de negocio) no conoce a Anthropic, ni a Meta, ni a Postgres. Habla con interfaces (ports). Las implementaciones concretas (adapters) viven en módulos separados, intercambiables y enable/disable-ables por configuración. Ver [§11 Patrones arquitectónicos](#11-patrones-arquitectónicos-adapter--coremódulos) para el detalle completo.

---

## 2. Componentes

### 2.1 Webhook Receiver

- **Responsabilidad:** recibir POST de Meta, validar firma, persistir el mensaje crudo en la tabla `inbound_messages`, encolar job y responder 200 a Meta en < 200ms.
- **Por qué inmediato:** Meta reintenta si tarda más de 5s. Pérdida de mensajes = pérdida de ventas = pérdida del cliente.
- **No hace:** llamar al LLM, llamar a la DB de catálogo, nada que pueda fallar.

### 2.2 Message Queue (BullMQ + Redis)

- **Responsabilidad:** orquestar el procesamiento asíncrono. Jobs:
  - `process_inbound_message` — agrupa mensajes consecutivos (30s window) y dispara `agent_run`.
  - `agent_run` — el agente procesa una conversación.
  - `send_message` — envía a Meta.
  - `escalation_notification` — envía notificación al business.
- **Por qué BullMQ:** Christian ya conoce Node/Redis. BullMQ es battle-tested, soporta retries con backoff, dead-letter queues.
- **Nota de estado (2026-08-01):** hoy en runtime solo existen `inbound_message` y `maintenance` (ver §2.2.1). `agent_run`/`send_message` son diseño futuro; el turno LLM corre síncrono en el worker `inbound_message` (concurrency `BULLMQ_INBOUND_CONCURRENCY`). Ver `docs/05 §4b D2`.

### 2.2.1 Colas registradas en runtime (2026-08-01)

| Cola | Módulo | Worker | Concurrency |
|---|---|---|---|
| `inbound-message` | `QueueModule` | `InboundProcessor` | `BULLMQ_INBOUND_CONCURRENCY` (10) |
| `maintenance` | `MaintenanceModule` | repeatable (escalaciones) | 1 |

`AGENT_RUN`, `OUTBOUND_MESSAGE`, `CATALOG_INDEXING`, `KNOWLEDGE_INDEXING`, `CACHE_INVALIDATION`, `NOTIFICATION` están definidos en `queue.config.ts` pero **no registrados** (deuda de diseño, ver `docs/05 §4b`).

### 2.3 Agent Worker

El corazón del sistema. Ver §3 para el detalle.

### 2.4 PostgreSQL + pgvector

**Una sola DB.** Postgres con la extensión `pgvector` evita el costo operativo de una vector DB separada (Pinecone, Weaviate). pgvector escala bien hasta varios millones de embeddings; para Atiende v1 (catálogos < 10K productos × 100 businesses) sobra.

Schemas principales:

```sql
-- Tenant
businesses (id, name, whatsapp_phone_id, whatsapp_token_encrypted,
            system_prompt_extras, settings_jsonb, created_at)

-- Catálogo
products (id, business_id, name, description, price, stock,
          category, image_url, metadata_jsonb)
product_embeddings (product_id, embedding vector(1024))

-- Conversación
conversations (id, business_id, customer_phone, status,
               last_message_at, escalated_at, summary_text)
messages (id, conversation_id, role, content_jsonb,
          token_usage_jsonb, created_at)

-- Telemetría
agent_runs (id, conversation_id, model, latency_ms,
            cache_read_tokens, cache_create_tokens,
            input_tokens, output_tokens, cost_usd,
            tool_calls_count, created_at)

-- Operaciones
orders (id, business_id, conversation_id, customer_info_jsonb,
        items_jsonb, total, status, created_at)

-- Eval
eval_cases (id, conversation_setup_jsonb, expected_outcome_jsonb,
            tags_text_array)
eval_runs (id, eval_case_id, agent_version, passed, output_jsonb)
```

### 2.5 Anthropic Claude API

- **Modelo default:** `claude-opus-4-7` (más capaz, mejor para agentes).
- **Por qué Opus 4.7:** la spec del producto exige razonamiento sobre catálogo + decisiones de escalamiento + manejo de conversación multi-turno. Sonnet 4.6 es candidato para v2 cuando el sistema esté maduro y queramos optimizar costo.
- **Configuración base:**
  - `thinking: {type: "adaptive"}` — el modelo decide cuándo pensar.
  - `output_config: {effort: "high"}` — calidad sobre costo para conversaciones de venta.
  - **Prompt caching habilitado** sobre el system prompt + catálogo recuperado.
  - **Compaction** habilitado para conversaciones largas.

Ver [02_AI_CONCEPTS.md](02_AI_CONCEPTS.md) para el detalle de cada parámetro.

### 2.6 Dashboard (Next.js)

- App separada, autenticada (Google/Email magic link).
- Talks to backend via REST + WebSocket para updates en tiempo real (mensajes entrantes, métricas).

---

## 3. Arquitectura del Agente

### 3.1 El loop del agente

Cada turno del agente sigue este flujo:

```
1. Recibe mensaje(s) del cliente.
2. Carga conversación previa + system prompt + tools.
3. Llama a Claude con: system + history + nuevo mensaje + tools.
4. Si Claude responde con tool_use:
     - Ejecuta la tool (consulta DB, crea orden, etc.).
     - Devuelve resultado a Claude.
     - Vuelve a 4 (hasta que Claude decida responder al cliente).
5. Si Claude responde con texto:
     - Persiste el turno completo (mensajes + token usage).
     - Encola job de envío a Meta.
6. Actualiza métricas: latencia, tokens, costo.
```

Usamos el **tool runner del SDK de Anthropic** (TypeScript) que maneja el loop automáticamente — ahorra código y bugs.

### 3.2 Tools que expone el agente

Definidas en la spec ([00_SPEC.md FR-10](00_SPEC.md#fr-10)). Implementación:

```typescript
// Pseudo-código — el real va con betaZodTool del SDK
const searchCatalog = betaZodTool({
  name: 'search_catalog',
  description: 'Busca productos en el catálogo del negocio usando búsqueda semántica. Usa esta tool cuando el cliente pregunta por un producto, una categoría, o describe lo que busca con sus propias palabras.',
  inputSchema: z.object({
    query: z.string().describe('La consulta en lenguaje natural del cliente, o palabras clave'),
    max_results: z.number().int().min(1).max(10).default(5),
  }),
  run: async ({ query, max_results }, ctx) => {
    const embedding = await embed(query);
    const products = await db.query.findRelevantProducts({
      business_id: ctx.business_id,
      embedding,
      limit: max_results,
    });
    return JSON.stringify(products);
  },
});
```

Cada tool tiene:
- **Descripción clara** — Claude decide cuándo llamarla basado en esto. Mala descripción = malas decisiones.
- **Schema validado** — Zod en TypeScript. Inputs malformados se rechazan antes de ejecutar.
- **Contexto del business** — pasado vía `ctx`, nunca confiamos en que el modelo pase el `business_id` correcto.

### 3.3 System prompt (estructura)

```
[Bloque cacheable — frozen system prompt]
Eres Atiende, el asistente conversacional de {{business.name}}.
Tu trabajo es atender clientes por WhatsApp con calidez y eficiencia.

PERSONALIDAD:
- {{business.personality_config}}
- Respuestas cortas, conversacionales. Sin emojis a menos que el cliente los use.
- Nunca inventes precios o productos: SIEMPRE usa la tool search_catalog.

REGLAS DE ESCALAMIENTO:
Escala a humano (escalate_to_human) cuando:
- El cliente expresa una queja o frustración.
- El cliente pide explícitamente hablar con una persona.
- Llevas 3 turnos sin avanzar hacia una orden o respuesta.
- La pregunta está fuera del catálogo o de tu alcance.

INFORMACIÓN DEL NEGOCIO:
{{business.faq_config}} -- horarios, ubicación, métodos de pago

[Fin bloque cacheable]

[Bloque dinámico — historial reciente, contexto del turno actual]
```

**Decisión clave:** el system prompt arriba (con datos del business) es **estable por conversación**. Lo cacheamos con `cache_control: {type: "ephemeral"}`. Solo el historial cambia turno a turno → solo eso paga precio completo.

### 3.4 RAG sobre catálogo

```
1. Cliente: "tienes algo para regalo de cumpleaños de niña de 8 años?"
2. Agent_worker decide llamar search_catalog.
3. search_catalog:
     - Genera embedding del query con un modelo de embeddings (Voyage AI o text-embedding-3-small de OpenAI).
     - Busca top-5 productos en pgvector con cosine similarity.
     - Devuelve array de productos a Claude.
4. Claude usa esos productos para responder al cliente con recomendaciones reales.
```

**Por qué embeddings y no full-text search:**
- "regalo de cumpleaños para niña" no matchea con "muñeca de princesa" por palabras, pero sí por significado.
- Maneja typos, sinónimos, lenguaje informal típico de WhatsApp.

**Modelo de embeddings v1:** OpenAI `text-embedding-3-small` (dimensión 1536, $0.02 por 1M tokens — barato). Alternativa: Voyage `voyage-3-lite`. Definir en semana 3 cuando indexemos el primer catálogo real.

### 3.5 Memoria & compaction

- Cada conversación se reconstruye desde la DB en cada turno (el API de Claude es stateless).
- Si el historial supera ~50K tokens, activamos **compaction beta** de Anthropic — el API resume automáticamente el contexto antiguo y devuelve un `compaction` block que hay que persistir y devolver en el siguiente turno.
- En la práctica para WhatsApp esto rara vez se activa (conversaciones cortas), pero queremos el patrón listo desde día 1.

---

## 4. Stack tecnológico — decisiones y porqués

| Capa | Tecnología | Por qué |
|---|---|---|
| Runtime backend | **Node.js 20+ / TypeScript** | Christian lo domina. SDK oficial de Anthropic muy maduro en TS. |
| Framework backend | **NestJS** | Christian lo domina. Estructura modular, DI, decoradores, bueno para multi-tenant. |
| Base de datos | **PostgreSQL 16** | Christian lo conoce. Transacciones ACID que son críticas para órdenes. |
| Vector search | **pgvector** (extensión de Postgres) | Una sola DB. Para v1 sobra. Evita el costo operativo de Pinecone/Weaviate. |
| ORM | **Prisma** | Christian lo conoce. Type-safe, migraciones, buena DX. |
| Queue | **BullMQ + Redis** (paquete `@nestjs/bullmq`) | Standard en ecosistema Node. Integración oficial con NestJS (decoradores `@Processor`, `@OnWorkerEvent`). Christian conoce Redis. |
| LLM | **Anthropic Claude API** (`claude-opus-4-7`) | Mejor para agentes con tool use complejo. SDK oficial sólido. |
| Embeddings | **OpenAI text-embedding-3-small** | Barato ($0.02/1M tokens), buena calidad, modelo estándar. |
| WhatsApp | **Meta WhatsApp Business API** (Cloud API directa) | Christian ya integró esto antes. Sin intermediarios = mejor margen. |
| Frontend dashboard | **Next.js 15 + Tailwind + shadcn/ui** | Christian conoce Next.js. shadcn da componentes profesionales rápido. |
| WebSocket | **Socket.IO** | Christian lo conoce. |
| Autenticación dashboard | **Better Auth** (o NextAuth) | Magic links + OAuth Google. |
| Deploy v1 | **Railway o Fly.io** | Para v1 con tráfico bajo, K8s es overkill. Railway/Fly tienen Postgres + Redis gestionados. |
| Deploy v2 (cuando crezca) | **Kubernetes en AWS/GCP** | Aprovecha la experiencia de Christian. |
| Observabilidad | **OpenTelemetry + Grafana Cloud** (free tier) | Tracing, métricas, logs. Crítico para optimizar costo de tokens. |
| Tests | **Vitest** | Más rápido que Jest, mejor DX, compatibilidad casi total. |
| Evals | **Promptfoo** o suite propia | Empezar con suite propia (más simple), migrar a Promptfoo si crece. |

### Trade-offs explícitos (no escondemos las decisiones difíciles)

- **Opus 4.7 vs Sonnet 4.6:** Opus es ~4× más caro por token, pero el costo absoluto por conversación queda dentro del budget (NFR-3). Sonnet 4.6 es el upgrade obvio en v2 cuando tengamos eval data que demuestre que mantiene calidad.
- **pgvector vs Pinecone:** pgvector es suficiente hasta ~10M embeddings. Si crecemos más, migrar a Pinecone es una historia conocida (no es vendor lock).
- **Railway/Fly vs K8s desde día 1:** K8s da experiencia "para el CV" pero ralentiza la iteración. v1 vive sin K8s; v2 con tráfico real lo justifica.
- **Tool runner del SDK vs loop manual:** el tool runner es beta. Vale el riesgo porque ahorra ~200 líneas de glue code. Si encontramos un bug bloqueante, caemos al loop manual.

---

## 5. Data flow de un mensaje (end-to-end)

```
T+0ms:   Cliente envía "tienes vestido rojo talla M?" por WhatsApp
T+50ms:  Meta hace POST /webhook/whatsapp a Atiende
T+80ms:  Webhook Receiver valida firma, persiste mensaje, encola job, responde 200 OK a Meta
         [El cliente NO espera nada todavía]

T+100ms: Worker toma job process_inbound_message
T+100ms: Worker aplica ventana de 30s — espera si llegan más mensajes consecutivos
         [En este caso solo uno; pasa al siguiente paso]

T+30s:   Worker dispara agent_run
T+30s:   Agent worker:
           - Carga conversación + business + system prompt
           - Construye request con prompt caching
           - Llama a Claude API (con tools)
T+31.2s: Claude responde con tool_use: search_catalog("vestido rojo talla M")
T+31.2s: Agent worker ejecuta search_catalog → embedding + query pgvector
T+31.4s: Devuelve resultados a Claude
T+32.8s: Claude responde con texto: "Sí, tengo el vestido X en talla M..."
T+32.8s: Agent worker:
           - Persiste turno (messages + token usage)
           - Encola send_message
           - Actualiza métricas

T+33.0s: send_message worker llama Meta API → mensaje enviado
T+33.5s: Cliente recibe respuesta en WhatsApp

LATENCIA PERCIBIDA POR EL CLIENTE: ~3.5 segundos
(de los cuales 30s son la ventana de agrupación, ajustable)
```

Si reducimos la ventana de agrupación a 5s, latencia percibida baja a ~8s. Decisión en testing real.

---

## 6. Costos & budget de latencia

### 6.1 Budget de latencia por turno

| Etapa | Budget | Notas |
|---|---|---|
| Webhook → queue | < 200ms | Responder rápido a Meta |
| Agrupación de mensajes | 5–30s | Ajustable; trade-off UX vs eficiencia |
| Build de contexto + DB queries | < 200ms | Postgres con índices |
| Embedding del query (si RAG) | < 300ms | OpenAI embeddings API |
| Vector search en pgvector | < 50ms | Con índice HNSW |
| Llamada a Claude (con caching) | 1500–3500ms | Adaptive thinking, p95 |
| Tool execution (DB queries) | < 200ms | Indexado |
| Send a Meta | < 500ms | API call |
| **Total p95** | **< 5s** | Cumple NFR-1 |

### 6.2 Budget de costo por conversación (10 turnos promedio)

**Asumiendo Opus 4.7 ($5/M input, $25/M output) con prompt caching:**

| Componente | Tokens por turno | Costo por turno |
|---|---|---|
| System prompt + business config (cacheado, read) | 2000 | 2000 × $0.50/M = $0.001 |
| System prompt write (turno 1 de la sesión) | 2000 | 2000 × $6.25/M = $0.0125 (solo 1 vez por 5 min) |
| Historial + nuevo mensaje (no cacheado) | ~500 | 500 × $5/M = $0.0025 |
| Output (respuesta) | ~150 | 150 × $25/M = $0.00375 |
| Tool calls (search_catalog, ~200 tokens result) | ~200 | 200 × $5/M = $0.001 |
| Embedding (cuando hay RAG) | ~50 chars | $0.000001 (negligible) |
| **Total por turno (steady state, no write)** | | **~$0.008** |
| **Total por conversación (10 turnos)** | | **~$0.08** |

Esto está sobre el budget de NFR-3 ($0.05). Mitigaciones:
1. **Sonnet 4.6 para turnos simples** (routing) — recorta a ~$0.025/conv.
2. **Más caching del historial** entre turnos consecutivos del mismo cliente.
3. **Prompt caching de 1h** para businesses con tráfico constante.

Decisión: empezar con Opus 4.7 puro, medir, optimizar en semana 4–5 con data real. Ver [02_AI_CONCEPTS.md](02_AI_CONCEPTS.md) §Cost para los cálculos detallados.

---

## 7. Seguridad

- **Secrets:** todas las API keys en variables de entorno gestionadas por Railway/Fly secrets (no en código, no en .env commiteado).
- **Tokens de Meta:** encriptados en DB con clave maestra rotable (AES-256-GCM).
- **Validación de webhooks:** firma HMAC de Meta verificada en el receiver.
- **PII:** logs no incluyen contenido de mensajes a nivel info/warn. Solo en debug, y solo con consentimiento del business.
- **Rate limiting:** por business y por número de teléfono cliente. Previene loops de mensajes maliciosos.
- **Defensa contra prompt injection:** todo input del cliente va por message content, nunca interpolado en el system prompt. Los tools validan inputs antes de ejecutar.

---

## 8. Workflow AI-driven con Claude Code

> Esta sección documenta **cómo vamos a construir** el sistema, no qué construimos. Aprovechamos al máximo Claude Code como entorno de desarrollo.

### 8.1 Setup base

- Proyecto con `CLAUDE.md` en la raíz que documenta:
  - Estructura del repo
  - Comandos comunes (build, test, lint, deploy)
  - Convenciones de código
  - Cómo correr migraciones y evals
- Esto permite a Claude Code y a cualquier desarrollador entrar al contexto en segundos.

### 8.2 Subagentes que usaremos

Claude Code soporta subagentes especializados. Configuraremos:

- **`explore`** — para búsquedas amplias en el repo cuando no sabemos dónde está algo.
- **`db-migrations`** — agente especializado en crear/revisar migraciones de Prisma con cuidado de no romper data en prod.
- **`eval-runner`** — corre la suite de evals y reporta diffs vs la baseline.
- **`prompt-reviewer`** — revisa cambios a system prompts contra principios definidos.

### 8.3 Hooks útiles

- `pre-commit` — corre `vitest run` + `tsc --noEmit` antes de cualquier commit.
- `post-edit` — cuando se edita un archivo de prompt productivo, dispara automáticamente la suite de eval correspondiente.
- `pre-deploy` — bloquea deploy si los evals fallan.

### 8.4 MCP servers que valen la pena

- **MCP de WhatsApp Business** — abstrae la API de Meta. Permite a Claude probar envíos en dev sin curl manual.
- **MCP de Postgres** — para queries de exploración sin escribir Prisma queries en el script (solo en dev).
- **MCP de Linear/GitHub Issues** — para que Claude pueda leer tickets y proponer implementaciones.

(No construimos los MCPs nosotros en v1; usamos los que ya existen open-source y los configuramos en `.claude/mcp.json`.)

### 8.5 Spec-driven en la práctica

- **Cambio en spec → cambio en código**, en ese orden. Nunca al revés.
- Cada PR menciona el FR/NFR que implementa.
- El eval set vive en el repo (`/evals/cases/*.jsonl`) y es la traducción ejecutable de la spec.

---

## 9. Versiones de modelos y migración futura

- **v1:** Opus 4.7 fijo (`claude-opus-4-7`).
- **v2:** Routing por complejidad detectada. Heurística inicial:
  - Saludos, preguntas simples (horarios, ubicación) → Haiku 4.5.
  - Búsqueda de productos, recomendaciones → Sonnet 4.6.
  - Creación de orden, escalamiento, casos complejos → Opus 4.7.
- Modelo IDs en una sola constante del repo (`src/lib/ai/models.ts`) para que la migración futura sea cambio mínimo.

---

## 10. Observabilidad

Cosas que **siempre** medimos por turno y por conversación:

- Latencia total (webhook → respuesta enviada).
- Tokens: input, output, cache_read, cache_create.
- Costo en USD (calculado en tiempo real).
- Tool calls (cuáles, cuántas, latencia de cada una).
- Stop reason de Claude (end_turn, tool_use, refusal, etc.).
- Si hubo escalamiento (sí/no, motivo).
- Si terminó en orden (sí/no, valor).

Estas métricas:
- Se persisten en la tabla `agent_runs`.
- Se exportan a Grafana Cloud vía OpenTelemetry.
- Alimentan el dashboard del business.
- Son la base de los evals (sin métricas no se puede mejorar lo que no se mide).

---

## 11. Patrones arquitectónicos: Adapter + Core/Módulos

> Esta sección define **cómo está estructurado el código** para mantener flexibilidad, testabilidad, y la capacidad de prender/apagar piezas sin reescribir el sistema.

### 11.1 Por qué

Tres riesgos reales en un sistema con LLMs en producción:

1. **Vendor lock-in.** Hoy usamos Anthropic. Mañana puede convenir OpenAI, Bedrock, o un modelo local (Llama, Mistral). Si el código de negocio importa `Anthropic` directamente, migrar = reescribir.
2. **Provider outage.** Anthropic puede tener una caída de 4 horas. Sin fallback, Atiende cae con ellos.
3. **Necesidades cambiantes por business.** Un negocio quiere WhatsApp + web chat. Otro solo WhatsApp. Otro quiere desactivar `create_order` porque no vende online. No queremos forks de código por feature — queremos config.

La solución es **arquitectura hexagonal (ports & adapters)** + **feature flags por módulo**.

### 11.2 Diagrama

```
                         ┌─────────────────────────────┐
                         │      CORE (estable)         │
                         │                             │
                         │   ┌───────────────────┐     │
                         │   │  Agent Service    │     │
                         │   │  (orquesta turno) │     │
                         │   └───────────────────┘     │
                         │           │                 │
                         │   habla solo con ports:     │
                         │   ┌───────────────────┐     │
                         │   │  LLMProvider      │ ← interfaz
                         │   │  ChannelProvider  │ ← interfaz
                         │   │  EmbeddingProvider│ ← interfaz
                         │   │  ToolModule       │ ← interfaz
                         │   └───────────────────┘     │
                         └────────────┬────────────────┘
                                      │ implementan
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
       ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
       │  Adapters   │         │  Adapters   │         │   Tools     │
       │  LLM        │         │  Channels   │         │  (módulos)  │
       │             │         │             │         │             │
       │  Claude     │         │  WhatsApp   │         │  Catalog    │
       │  OpenAI     │         │  WebChat    │         │  Orders     │
       │  Bedrock    │         │  Telegram   │         │  Info       │
       │  Mock       │         │  Mock       │         │  Escalation │
       └─────────────┘         └─────────────┘         └─────────────┘
              ↑                       ↑                       ↑
              └───── seleccionados por config + feature flags ─┘
```

El **core nunca importa de los adapters**. Los adapters implementan los ports definidos en el core. La inyección la maneja NestJS (DI nativa).

### 11.3 Adapter pattern para LLM providers

#### El port (interfaz)

```typescript
// src/core/ports/llm-provider.port.ts

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  cacheable?: boolean;          // hint, no garantía cross-provider
  effort?: 'low' | 'medium' | 'high';  // hint genérico
  maxTokens: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage: TokenUsage;            // input, output, cached (cuando aplique)
  costUsd: number;
}

export interface LLMProvider {
  readonly name: string;        // 'claude' | 'openai' | 'mock'
  chat(req: ChatRequest): Promise<ChatResponse>;
  isHealthy(): Promise<boolean>;  // para health checks y fallback
}
```

#### Los adapters

```typescript
// src/modules/llm/claude/claude.adapter.ts
@Injectable()
export class ClaudeAdapter implements LLMProvider {
  readonly name = 'claude';
  constructor(private readonly client: Anthropic, private readonly config: ClaudeConfig) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: this.config.model,                    // 'claude-opus-4-7'
      max_tokens: req.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: req.effort ?? 'high' },
      system: req.cacheable
        ? [{ type: 'text', text: req.systemPrompt, cache_control: { type: 'ephemeral' } }]
        : req.systemPrompt,
      tools: this.translateTools(req.tools),
      messages: this.translateMessages(req.messages),
    });
    return this.translateResponse(response);
  }

  async isHealthy(): Promise<boolean> { /* ping ligero */ }
}
```

```typescript
// src/modules/llm/openai/openai.adapter.ts (v2 o nunca, pero la interfaz está lista)
@Injectable()
export class OpenAIAdapter implements LLMProvider {
  readonly name = 'openai';
  // implementa la misma interfaz con la SDK de OpenAI
}
```

```typescript
// src/modules/llm/mock/mock.adapter.ts (para tests)
@Injectable()
export class MockLLMAdapter implements LLMProvider {
  readonly name = 'mock';
  // Permite tests determinísticos sin tocar la API real
}
```

#### El uso desde el core

```typescript
// src/core/services/agent.service.ts
@Injectable()
export class AgentService {
  constructor(
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LLMProvider,
    // ... otros ports
  ) {}

  async runTurn(input: AgentInput): Promise<AgentOutput> {
    // El core NO sabe que es Claude. Solo sabe que es LLMProvider.
    const response = await this.llm.chat({
      systemPrompt: input.systemPrompt,
      messages: input.history,
      tools: input.tools,
      cacheable: true,
      maxTokens: 4096,
    });
    return this.processResponse(response);
  }
}
```

#### Honestidad sobre "leaky abstractions"

**Atajos que NO tomamos:** abstraer al 100%. Hay features que son legítimamente provider-specific:

**Caso paradigmático: prompt caching.** Cada provider lo hace radicalmente distinto:

| Provider | Mecanismo nativo | Quién controla |
|---|---|---|
| **Anthropic** | `cache_control: {type: "ephemeral"}` explícito en bloques. Prefix-match exacto. TTL 5min o 1h. | Nosotros — qué cachear, dónde poner el breakpoint |
| **OpenAI** | Automático para prompts > 1024 tokens (desde late-2024) | Nadie — pasa solo, sin código |
| **Google Gemini** | API separada `createCachedContent` con lifecycle propio | Nosotros — pero con shape totalmente distinto |
| **AWS Bedrock** | Depende del modelo subyacente | Variable |
| **Llama / Mistral local (vLLM, Ollama)** | KV-cache interno, invisible al API | Nadie |

**¿Cómo lo abstraemos sin filtrar Anthropic?** Con un **hint en el request**, no con un mecanismo. El port expone `cacheable: boolean` como una pista, y cada adapter decide qué hacer con ella:

```typescript
// Claude adapter — aprovecha el hint
async chat(req: ChatRequest): Promise<ChatResponse> {
  return this.client.messages.create({
    model: 'claude-opus-4-7',
    system: req.cacheable
      ? [{ type: 'text', text: req.systemPrompt, cache_control: { type: 'ephemeral' } }]
      : req.systemPrompt,
    // ...
  });
}

// OpenAI adapter — ignora el hint (su cache es automático)
async chat(req: ChatRequest): Promise<ChatResponse> {
  // OpenAI cachea automáticamente prompts > 1024 tokens. req.cacheable no se usa.
  return this.client.chat.completions.create({ /* sin cache_control */ });
}

// Local Llama adapter — ignora el hint (no hay caching nativo controlable)
async chat(req: ChatRequest): Promise<ChatResponse> {
  return this.ollama.generate(/* req.cacheable se ignora */);
}
```

**El core nunca sabe que Anthropic existe.** Solo da pistas portables. Cada adapter las honra o las ignora según su realidad.

**Tabla resumen de portabilidad por feature:**

| Feature | Portabilidad real | Cómo lo manejamos |
|---|---|---|
| Chat básico (mensajes + respuesta) | ✅ Total | Port genérico |
| Tool use / function calling | ✅ Alta — la mayoría de providers tiene equivalente | Port traduce; cada adapter mapea a su formato |
| Streaming | ✅ Alta | Port con `AsyncIterable<Chunk>` |
| **Prompt caching** | ⚠️ Mecanismo distinto en cada provider | **Hint `cacheable: true`; cada adapter decide. La protección real contra fallos de provider está en Capas 2 y 3 del response cache (§12)** — esas son provider-agnostic. |
| Adaptive thinking | ❌ Específico de Anthropic | NO abstraemos. El adapter de Claude lo aplica internamente. Si migramos a OpenAI, el sistema funciona pero pierde esa capacidad. |
| Structured outputs (`output_config.format`) | ⚠️ Diferente en cada provider | Port para casos de uso *internos* (clasificación); cada adapter implementa con su API. |
| Compaction | ❌ Específico de Anthropic | Implementación en el adapter de Claude. Si cambiamos a OpenAI haríamos summarization manual. |

**Regla:** abstraemos lo que es **conceptualmente portable**. No abstraemos lo que solo aplica a un proveedor — esos features los implementa el adapter directamente. **La resiliencia contra fallos de provider se construye en capas SUPERIORES al port (response cache), no abstrayendo la API del provider.** Ver §13.

### 11.4 Core + Módulos con feature flags

#### Estructura del repo

```
src/
├── core/                          ← núcleo estable. Lógica de negocio pura.
│   ├── domain/                    ← entidades: Conversation, Message, Order, Business
│   ├── ports/                     ← interfaces: LLMProvider, ChannelProvider, ...
│   ├── services/                  ← orquestación: AgentService, OrderService
│   └── core.module.ts             ← NestJS module
│
├── modules/                       ← implementaciones pluggables
│   ├── llm/
│   │   ├── claude/                ← ClaudeAdapter + ClaudeModule
│   │   ├── openai/                ← (futuro)
│   │   └── mock/                  ← MockLLMAdapter para tests
│   │
│   ├── channels/
│   │   ├── whatsapp/              ← WhatsAppAdapter + WhatsAppModule
│   │   ├── web-chat/              ← (futuro)
│   │   └── telegram/              ← (futuro)
│   │
│   ├── embeddings/
│   │   ├── openai-embeddings/
│   │   └── voyage/                ← (alternativa)
│   │
│   ├── tools/                     ← cada tool es un módulo independiente
│   │   ├── catalog/               ← SearchCatalogTool + GetProductTool
│   │   ├── orders/                ← CreateOrderTool
│   │   ├── info/                  ← GetBusinessInfoTool
│   │   └── escalation/            ← EscalateToHumanTool
│   │
│   ├── persistence/
│   │   ├── postgres/              ← PostgresAdapter (Prisma)
│   │   └── ...
│   │
│   └── queue/
│       ├── bullmq/                ← BullMQAdapter
│       └── ...
│
├── config/
│   ├── features.ts                ← feature flags (ver abajo)
│   ├── env.schema.ts              ← validación de env vars con Zod
│   └── module-registry.ts         ← qué módulos cargar según config
│
└── main.ts                        ← bootstrap dinámico según config
```

#### Feature flags

```typescript
// src/config/features.ts
import { z } from 'zod';

export const FeaturesSchema = z.object({
  llm: z.object({
    primary: z.enum(['claude', 'openai', 'mock']).default('claude'),
    fallback: z.enum(['claude', 'openai', 'mock']).nullable().default(null),
  }),
  channels: z.object({
    whatsapp: z.boolean().default(true),
    webChat: z.boolean().default(false),
    telegram: z.boolean().default(false),
  }),
  tools: z.object({
    catalog: z.boolean().default(true),
    orders: z.boolean().default(true),
    info: z.boolean().default(true),
    escalation: z.boolean().default(true),
  }),
  embeddings: z.object({
    provider: z.enum(['openai', 'voyage']).default('openai'),
  }),
  ai: z.object({
    promptCaching: z.boolean().default(true),
    compaction: z.boolean().default(true),
    adaptiveThinking: z.boolean().default(true),
  }),
  observability: z.object({
    otel: z.boolean().default(true),
    grafanaCloud: z.boolean().default(false),  // off en dev
  }),
});

export type Features = z.infer<typeof FeaturesSchema>;
```

Las flags se cargan desde env vars / config file en `bootstrap`. Inválido = el sistema no arranca (fail-fast).

#### Niveles de feature flag

Tenemos **dos niveles**:

1. **Global (a nivel sistema):** "qué proveedor de LLM uso", "qué canales habilito". Se setean en deploy/config.
2. **Por business (a nivel tenant):** "este business tiene `create_order` deshabilitado porque no vende online". Se guardan en la tabla `businesses.feature_overrides_jsonb`.

```typescript
// src/core/services/feature.service.ts
@Injectable()
export class FeatureService {
  isToolEnabled(toolName: string, businessId: string): boolean {
    // 1) flag global
    if (!this.globalFeatures.tools[toolName]) return false;
    // 2) override del business (si existe)
    const businessOverride = this.businessService.getFeatureOverrides(businessId);
    return businessOverride.tools?.[toolName] ?? true;
  }
}
```

#### Registración dinámica de módulos

NestJS soporta carga condicional de módulos:

```typescript
// src/app.module.ts
@Module({})
export class AppModule {
  static forRoot(features: Features): DynamicModule {
    const imports: any[] = [CoreModule];

    // LLM provider primario
    if (features.llm.primary === 'claude') imports.push(ClaudeModule);
    if (features.llm.primary === 'openai') imports.push(OpenAIModule);

    // Canales habilitados
    if (features.channels.whatsapp) imports.push(WhatsAppModule);
    if (features.channels.webChat) imports.push(WebChatModule);

    // Tools habilitadas
    if (features.tools.catalog) imports.push(CatalogToolModule);
    if (features.tools.orders) imports.push(OrdersToolModule);
    if (features.tools.info) imports.push(InfoToolModule);
    if (features.tools.escalation) imports.push(EscalationToolModule);

    return { module: AppModule, imports };
  }
}

// src/main.ts
const features = FeaturesSchema.parse(loadFeaturesFromEnv());
const app = await NestFactory.create(AppModule.forRoot(features));
```

### 11.5 Beneficios concretos

| Escenario | Cómo nos salva esta arquitectura |
|---|---|
| Anthropic se cae 2 horas | `features.llm.fallback = 'openai'` + circuit breaker → el sistema degrada en vez de morir |
| Probar Sonnet 4.6 sin afectar prod | Crear `claude-sonnet` adapter (mismo Anthropic, modelo diferente) y rotear por business o por tipo de turno |
| Tests unitarios del agente sin tocar Anthropic | `features.llm.primary = 'mock'` → MockLLMAdapter responde determinísticamente |
| Business nuevo quiere solo info, sin órdenes | `business.feature_overrides = { tools: { orders: false } }` — el tool no se le expone al modelo |
| Agregar Telegram como canal | Crear `TelegramAdapter` implementando `ChannelProvider`, habilitar flag. Cero cambios en el core. |
| Audit/compliance pide poder desactivar IA | `features.llm.primary = 'human-only'` adapter que solo escala todo a humano |

### 11.6 Costo de este patrón (honestidad)

- **Más código upfront.** Definir ports, adapters, módulos es más trabajo que `import { Anthropic } from '@anthropic-ai/sdk'` en cualquier lugar.
- **Indirección.** Para entender qué hace un turno hay que seguir interfaces → implementaciones.
- **Tentación de over-abstraer.** Si abstraemos features que son específicos de Claude, terminamos con un denominador común mediocre que no aprovecha nada bien.

**Mitigaciones:**
- Empezamos con **un solo adapter real** (Claude) + un mock. No construimos `OpenAIAdapter` hasta que haya razón real.
- Las features provider-specific viven en el adapter, no se filtran al port.
- Las interfaces se diseñan **desde el caso de uso del core**, no anticipando proveedores futuros.

### 11.7 Resumen ejecutivo

- El **core** (lógica de negocio) habla con interfaces (`ports`), nunca con SDKs.
- Los **adapters** implementan las interfaces para proveedores reales (Claude, WhatsApp, Postgres, etc.).
- Los **módulos** se cargan dinámicamente según **feature flags** (globales + por business).
- **Lo realmente portable se abstrae; lo específico de un proveedor vive en su adapter.** Honestidad sobre dónde la abstracción cede.
- **Beneficio principal:** podemos prender/apagar piezas, cambiar proveedores, hacer tests sin APIs reales, y degradar elegantemente cuando algo falla.

---

## 12. Caching multinivel para ahorro de costos

> **Esta es una de las propuestas de valor más fuertes de Atiende.** Demostrable, cuantificable, y diferencia un AI Engineer con criterio de uno que solo "llama a la API".

### 12.1 Por qué multinivel

Un solo mecanismo de cache no es suficiente. Cada capa ataca un tipo de redundancia distinto:

```
                       Mensaje entrante
                              │
                              ▼
              ┌─────────────────────────────────┐
              │  ¿Es cacheable este turno?      │  ← gate de seguridad
              │  (no orders, no escalations,    │
              │   no contexto multi-turno)      │
              └─────────────┬───────────────────┘
                            │ sí
                            ▼
              ┌──────────────────────────────────┐
              │ CAPA 3: Exact response cache     │
              │ Redis: key = sha256(query+biz)   │ ← hit ratio bajo, latencia ~5ms
              │ TTL: 30 min                      │
              └─────────────┬────────────────────┘
                            │ miss
                            ▼
              ┌──────────────────────────────────┐
              │ CAPA 2: Semantic response cache  │
              │ pgvector: similarity > 0.95      │ ← hit ratio alto, latencia ~50ms
              │ TTL: 30 min                      │ ← lo que tú pediste ("fuzzy")
              └─────────────┬────────────────────┘
                            │ miss
                            ▼
              ┌──────────────────────────────────┐
              │ CAPA 1: Anthropic prompt caching │
              │ (cache_control: ephemeral)       │ ← siempre activo, ~90% off prefijo
              │ TTL: 5 min (o 1h en hot bus)     │
              └─────────────┬────────────────────┘
                            │
                            ▼
                     Claude API call
```

### 12.2 Capa 1: Anthropic prompt caching (ya documentada)

Ver [§9 AI_CONCEPTS — Prompt caching](02_AI_CONCEPTS.md#9-prompt-caching). Es la capa base y siempre está activa.

### 12.3 Capa 2: Semantic response cache (el "fuzzy")

#### El concepto

Cuando dos clientes preguntan **algo distinto pero semánticamente equivalente** ("cuál es el horario?", "a qué hora abren?", "están abiertos ahora?"), no queremos llamar al LLM 3 veces. Queremos:

1. Generar embedding de la primera pregunta → guardar respuesta.
2. Cuando llega la segunda pregunta, calcular su embedding y compararlo con los del cache.
3. Si la similitud coseno > 0.95 → devolver la respuesta cacheada.

#### Cómo se implementa

**Storage:** pgvector (ya lo tenemos para RAG; reusamos la infra).

```sql
CREATE TABLE response_cache (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  query_text TEXT NOT NULL,
  query_embedding vector(1536) NOT NULL,
  response_text TEXT NOT NULL,
  tool_calls_jsonb JSONB,        -- si la respuesta original involucró tools, guardamos cuáles
  hit_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_response_cache_embedding ON response_cache
  USING hnsw (query_embedding vector_cosine_ops);
CREATE INDEX idx_response_cache_business ON response_cache(business_id, expires_at);
```

**Port (interface):**

```typescript
// src/core/ports/response-cache.port.ts
export interface ResponseCachePort {
  lookup(query: string, ctx: TurnContext): Promise<CacheHit | null>;
  store(query: string, response: AgentResponse, ctx: TurnContext): Promise<void>;
  invalidate(businessId: string, pattern?: string): Promise<void>;
}
```

**Lógica del adapter:**

```typescript
@Injectable()
export class PgvectorSemanticCacheAdapter implements ResponseCachePort {
  constructor(
    private readonly db: PrismaService,
    private readonly embedder: EmbeddingProvider,
    private readonly config: SemanticCacheConfig,
  ) {}

  async lookup(query: string, ctx: TurnContext): Promise<CacheHit | null> {
    // Gate de seguridad ANTES de cualquier compute
    if (!this.isCacheable(ctx)) return null;

    // Embedding del query
    const embedding = await this.embedder.embed(query);

    // Búsqueda en pgvector con threshold de similitud
    const result = await this.db.$queryRaw<CacheRow[]>`
      SELECT *, 1 - (query_embedding <=> ${embedding}::vector) AS similarity
      FROM response_cache
      WHERE business_id = ${ctx.businessId}
        AND expires_at > NOW()
        AND 1 - (query_embedding <=> ${embedding}::vector) > ${this.config.minSimilarity}
      ORDER BY query_embedding <=> ${embedding}::vector
      LIMIT 1
    `;

    if (result.length === 0) return null;

    // Bump hit counter (async, no esperamos)
    this.bumpHit(result[0].id);

    return {
      response: result[0].response_text,
      similarity: result[0].similarity,
      cachedAt: result[0].created_at,
    };
  }

  private isCacheable(ctx: TurnContext): boolean {
    // SAFETY RAILS — críticos para no causar bugs
    return (
      ctx.historyLength <= 1 &&                    // solo primer turno o muy temprano
      !ctx.involvesStatefulTool &&                 // no orders, no escalation
      !ctx.hasPersonalInfo &&                      // no si tiene dirección, nombre, etc.
      ctx.businessConfig.semanticCache !== false   // opt-out por business
    );
  }
}
```

### 12.4 Safety rails (críticos)

Una caché semántica mal implementada es peor que no tenerla — devuelve respuestas equivocadas con confianza. **Reglas no negociables:**

| Regla | Por qué |
|---|---|
| Threshold conservador (≥ 0.95) | Por debajo, "vestido rojo" y "vestido azul" pueden matchear |
| Scope por `business_id` | Catálogos diferentes → respuestas diferentes. Nunca cross-tenant. |
| Bypass total para tools de estado (`create_order`, `escalate_to_human`) | Cachear "creé tu orden" es desastre |
| Bypass si hay historial > 1 mensaje | El mismo query con diferente contexto significa cosas distintas |
| Bypass si query tiene PII (nombre, teléfono, dirección detectado por regex/NER) | Privacidad + respuestas personalizadas |
| TTL corto (30 min default) | Precios y disponibilidad cambian — no servir respuestas viejas con datos viejos |
| Invalidación por evento | Cuando se actualiza catálogo: `invalidate(businessId)`. Cuando cambia FAQ: igual. |
| Cache **respuestas de Claude**, NO outputs de tools | Si la respuesta dependió de un `search_catalog` con stock variable, cacheamos solo la frase generada, no los datos crudos |
| Feature flag por business | Algunos negocios (legal, médico, financiero) pueden requerir respuestas siempre frescas |
| Eval set específico de cache | Casos que verifican que el cache NO devuelve respuestas para queries que parecen similares pero requieren respuestas distintas |

### 12.5 Capa 3: Exact response cache

Más simple que la semántica, hit rate más bajo pero latencia mínima (~5ms vs 50ms):

```typescript
// Redis con BullMQ ya está en la infra
const key = `cache:exact:${businessId}:${sha256(normalizedQuery)}`;
const cached = await redis.get(key);
if (cached) return JSON.parse(cached);
```

Útil para queries idénticas (typos comunes que muchos clientes hacen igual). Lo tenemos como capa 3 porque es prácticamente gratis agregar.

### 12.6 ¿Por qué pgvector y no Redis Stack para la capa semántica?

**Opciones:**

- **A: pgvector** (lo que elegimos) — ya está en la infra, una sola tecnología, gestión transaccional. Latencia ~50ms.
- **B: Redis Stack** (Redis + RediSearch + RedisJSON) — más rápido (~10ms) pero suma otra dependencia.
- **C: Hybrid** — pgvector como source of truth + Redis como cache de keys calientes.

**Decisión v1:** A. Si vemos que la búsqueda en pgvector se vuelve cuello de botella (> 100 lookups/seg), migramos a C.

Sí usamos **Redis + BullMQ** para:
- Cola de mensajes (BullMQ).
- Cache exacto capa 3 (Redis directo).
- Rate limiting (Redis).
- Sesiones del dashboard (Redis).

### 12.7 Costo proyectado con caching multinivel

Asumiendo distribución típica de mensajes (estimada, calibrar con data real en semana 5):

| Tipo de turno | % del tráfico | Cache hit esperado | Costo por turno |
|---|---|---|---|
| FAQ (horarios, ubicación, métodos de pago) | 35% | 90% (semantic) | ~$0.0008 (mayoría hits) |
| Búsqueda simple de producto | 30% | 60% (semantic) | ~$0.004 |
| Consulta compleja con RAG | 20% | 0% (bypass) | ~$0.012 |
| Crear orden | 10% | 0% (bypass siempre) | ~$0.015 |
| Escalamiento | 5% | 0% (bypass siempre) | ~$0.008 |
| **Promedio ponderado** | 100% | | **~$0.0055/turno** |
| **Conversación 10 turnos** | | | **~$0.055** |

**Comparado con sin caching semántico:** ~$0.08/conv → ~$0.055/conv. **Ahorro ~31%.**

Cumple NFR-3 ($0.05) con margen razonable.

### 12.8 Cómo lo demostramos (pitch comercial)

El dashboard expone una métrica visible para el dueño del business:

```
Atiende — Estadísticas del mes
─────────────────────────────────
Conversaciones:           1,247
Llamadas a IA evitadas:     584  ← 47% gracias al cache inteligente
Costo total IA:           $32.10
Costo si no cacheáramos:  $47.80
─────────────────────────────────
Ahorro Atiende este mes:  $15.70
```

Esta métrica **vende sola**. Cualquier dueño de negocio entiende "te ahorré $X". Y para roles de AI Engineer, este es exactamente el tipo de feature que demuestra criterio de producción, no solo "sé llamar a una API".

### 12.9 Implementación en el roadmap

- **Semana 2:** capa 1 (Anthropic prompt caching) — ya estaba en el plan.
- **Semana 4:** capa 3 (exact cache en Redis) — barato de agregar.
- **Semana 5:** capa 2 (semantic cache en pgvector) — junto con evals para verificar safety rails.
- **Semana 6:** métrica "Ahorro Atiende" en el dashboard.

Se actualiza [03_ROADMAP.md](03_ROADMAP.md) acordemente.

---

## 13. Resiliencia y failover de proveedor

> "¿Qué pasa si Anthropic se cae?" — pregunta legítima y diseñamos el sistema para responderla bien.

### 13.1 Los tres niveles de protección

Cuando Anthropic devuelve 5xx o agota retries:

```
              Mensaje del cliente
                      │
                      ▼
        ┌─────────────────────────────────┐
        │  Nivel 1: Response cache        │  ← provider-agnostic
        │  Capas 2+3 (semantic + exact)   │     30-60% del tráfico nunca
        │                                 │     llega al LLM
        └─────────────────┬───────────────┘
                          │ miss
                          ▼
        ┌─────────────────────────────────┐
        │  Nivel 2: Primary LLM           │
        │  ClaudeAdapter                  │
        │  con circuit breaker            │
        └─────────────────┬───────────────┘
                          │ falla / circuit open
                          ▼
        ┌─────────────────────────────────┐
        │  Nivel 3: Fallback LLM          │  ← provider-agnostic
        │  OpenAIAdapter / LocalAdapter   │
        │  (degradación documentada)      │
        └─────────────────┬───────────────┘
                          │ también falla
                          ▼
        ┌─────────────────────────────────┐
        │  Nivel 4: Degradación graceful  │
        │  Respuesta fallback estática:   │
        │  "Estamos teniendo problemas    │
        │  técnicos, un asesor te         │
        │  responderá pronto."            │
        │  + escalamiento automático      │
        └─────────────────────────────────┘
```

### 13.2 Lo que protege cada capa

| Componente | Provider-agnostic | Qué cubre cuando Anthropic se cae |
|---|---|---|
| **Capa 3** (exact cache, Redis) | ✅ Sí | Responde queries idénticas SIN tocar LLM. Sigue funcionando intacta. |
| **Capa 2** (semantic cache, pgvector) | ✅ Sí | Responde queries semánticamente similares. Sigue funcionando intacta. |
| **Capa 1** (Anthropic prompt cache) | ❌ No | Irrelevante — depende de que Anthropic responda. Si OpenAI es el fallback, su cache automático toma este rol. |
| **Fallback LLM** (OpenAI / Llama) | ✅ Sí | Procesa lo que no cachean Capas 2+3. |
| **Static fallback response** | ✅ Sí | Última línea de defensa. El sistema NUNCA deja de responder al cliente. |

**Por eso la pregunta no es "¿qué pasa si Anthropic se cae?" — es "¿qué porcentaje del tráfico se degrada y cuánto?"** Estimado:
- 30-60% del tráfico: sin impacto (sale de Capa 2+3).
- 35-65%: degradación leve — atendido por fallback LLM, posible diferencia sutil en calidad de respuesta.
- < 5%: degradación fuerte — fallback estático + escalamiento.

### 13.3 Circuit breaker

Patrón clásico: si el provider primario falla N veces en una ventana de tiempo, el circuit se "abre" y todas las requests siguientes se rutean al fallback durante un timeout. Después de eso, intenta una request de prueba para ver si se recuperó.

**Implementación (2026-08-01)** — capa en `src/modules/llm/router/`:

- `LLMRouterService` (`llm-router.service.ts`) implementa `LLMProviderPort` y se registra como `LLM_PROVIDER_TOKEN`, así el core (AgentService) habla con la misma interfaz sin cambios. `chat()`: si el breaker está abierto → fallback (`circuit_open`); si el primario responde → registra éxito; si falla → registra fallo y delega al fallback (`primary_failure`). Sin fallback y primario no disponible → lanza `LLMProviderUnavailableError`. `isHealthy()` consulta primario y luego fallback.
- `CircuitBreakerService` (`circuit-breaker.service.ts`) — estados `closed | open | half_open`; config vía `CIRCUIT_BREAKER_CONFIG_TOKEN` (failureThreshold, errorRateThreshold, windowMs, openTimeoutMs, halfOpenProbes) con roll de ventana por tiempo.
- `LLMRouterModule.forRoot(primary, fallback)` (`llm-router.module.ts`) ata los adapters concretos a `LLM_PRIMARY_PROVIDER_TOKEN` / `LLM_PROVIDER_FALLBACK_TOKEN` (`useExisting`) y expone `LLMRouterService` como `LLM_PROVIDER_TOKEN`. `claude`/`mock` (sin adapter implementado) caen a `MockLLMAdapter`. Se carga en `module-registry.ts` tras los módulos provider.
- Los provider modules (`GroqModule`, `KimiModule`, ...) ya no registran tokens de rol: solo exponen su adapter con el bloque de config correcto (`src/modules/llm/provider-config.ts` → `providerBlockFor(features, aiConfig, provider)` elige `aiConfig.primary` o `aiConfig.fallback`).

**Configuración del circuit breaker:**
- Threshold: 5 fallos consecutivos o > 50% error rate en ventana de 60s.
- Open timeout: 30 segundos.
- Half-open probe: 1 request de prueba antes de cerrar el circuit.

### 13.4 Cuándo activar fallback (configuración de features)

```typescript
// src/config/features.ts
llm: {
  primary: 'groq',                  // claude | openai | gemini | groq | kimi | mock
  fallback: 'kimi',                 // null = sin fallback (lanza LLMProviderUnavailableError)
},
```

- **`on_error`** (única estrategia implementada, 2026-08-01): el fallback se llama solo si el primario falla o el breaker está abierto. `parallel_race` y `cost_optimized` siguen siendo diseño futuro (no hay `fallbackStrategy` en `Features` aún).
- `module-registry.ts` carga el módulo del fallback solo si es distinto del primario y expone el router como `LLM_PROVIDER_TOKEN`.

### 13.5 Calidad degradada vs caída total

**Trade-off explícito:** cuando estamos en fallback (OpenAI sin tener Claude calibrado), la calidad **puede bajar**:
- Adaptive thinking se pierde (Claude-only).
- Compaction se pierde (Claude-only) — historiales largos pueden saturar contexto.
- Tool calling puede tener semánticas ligeramente distintas.

**Decisión consciente:** preferimos **calidad degradada con sistema arriba** a **calidad perfecta con sistema caído**. Documentamos el trade-off; el dashboard puede mostrar un banner "Operando en modo fallback" cuando esté activo.

### 13.6 Failover en otros componentes (no solo LLM)

El mismo patrón se aplica a:

| Componente | Failover |
|---|---|
| Meta WhatsApp API caído | Mensajes salientes se reintentan con backoff exponencial via BullMQ. Si > 5 min sin éxito, dashboard alerta al business. |
| Postgres caído | Sin failover automático v1 (single primary). v2: réplica de lectura para queries no-críticas. |
| Redis caído | Cache invalidado pero sistema sigue funcionando (degradación de performance, no de correctness). |
| Embeddings provider caído | Cache de embeddings recientes (Redis) + fallback a búsqueda full-text de Postgres como degradación graceful. |
| OpenAI (embeddings) caído | Adapter alternativo (Voyage AI) en standby si la flag lo activa. |

### 13.7 Observabilidad de failover

Métricas críticas:
- `llm_fallback_count` (label: reason) — cuántas veces se cayó al fallback y por qué.
- `circuit_breaker_state` (label: provider) — open / half_open / closed.
- `static_fallback_count` — cuántas veces respondimos con la respuesta estática (esto NO debería pasar prácticamente nunca).
- `provider_latency_p95` (label: provider) — para detectar degradación parcial antes del circuit.

Alertas:
- Circuit breaker abierto > 5 min → alerta al equipo.
- Static fallback rate > 0.1% del tráfico → alerta crítica.
- Provider latency p95 > 2× baseline → warning.

### 13.8 Resumen

- **Capas 2 y 3** del response cache son **provider-agnostic** — siguen funcionando si Anthropic se cae.
- **Circuit breaker + fallback LLM** rutea automáticamente al backup cuando el primario falla.
- **Fallback estático + escalamiento** como última línea de defensa para casos extremos.
- **Decisión consciente:** preferimos calidad degradada con sistema arriba a calidad perfecta con sistema caído.
- **Estimado:** menos del 5% del tráfico llegaría a degradación fuerte en una caída total de Anthropic. La mayoría sigue funcionando.

---

## 14. Ingesta de conocimiento (PDFs, FAQs, políticas)

> Esta sección documenta cómo se cargan datos no-estructurados al sistema para que el agente pueda consultarlos. Complementa el catálogo (`Product`/`ProductEmbedding`) con `KnowledgeDocument`/`KnowledgeChunk`.

### 14.1 Por qué un sistema separado del catálogo

El catálogo es **estructurado**: cada producto tiene precio, stock, foto, categoría — atributos discretos. Una fila = una unidad de retrieval.

Los documentos del business son **no-estructurados**: una política de devolución de 5 páginas, un manual de uso, un FAQ libre. No tienen "filas", tienen párrafos, secciones, páginas. Hay que **partir** el texto en chunks digeribles antes de embedding (un PDF de 30K tokens no cabe en un solo vector).

Diferencias clave:

| | Catálogo (`products`) | Conocimiento (`knowledge_documents`) |
|---|---|---|
| Unidad | Producto (estructurado) | Chunk (texto libre) |
| Tabla embedding | `product_embeddings` (1:1 con producto) | `knowledge_chunks` (N por documento) |
| Tool del agente | `search_catalog` → devuelve productos con precio/stock | `search_knowledge` → devuelve chunks de texto con cita (pág, sección) |
| Update | Producto se edita item-por-item | Documento se re-sube entero (re-extract + re-chunk + re-embed) |
| Fuentes | CSV/Excel/form/API tienda | PDF, Word, Markdown, form FAQ, URL |

### 14.2 Pipeline de ingesta

```
Business sube archivo en dashboard
        │
        ▼
POST /api/businesses/:id/knowledge (multipart upload)
        │
        ▼
┌─ Controller ────────────────────────────────────────┐
│  1. Valida MIME type y tamaño (KNOWLEDGE_MAX_FILE_SIZE_MB)
│  2. Hash sha256 del buffer
│  3. Upsert KnowledgeDocument(business_id, source)
│     - Si mismo hash → 200 (no-op)
│     - Si nuevo o cambió → status=PENDING, enqueue job
└─────────────────────────────────────────────────────┘
        │
        ▼ (BullMQ KNOWLEDGE_INDEXING queue)
┌─ KnowledgeIndexer worker ───────────────────────────┐
│  1. status=EXTRACTING                                 │
│     DocumentExtractorRegistry selecciona extractor    │
│     por MIME → DocumentExtractorPort.extract(buffer)  │
│     → ExtractedDocument { fullText, segments }        │
│                                                       │
│  2. status=CHUNKING                                   │
│     ChunkerPort.chunk(segments) → Chunk[]             │
│     (FixedSizeChunker default: 500 tokens, 50 overlap)│
│                                                       │
│  3. status=EMBEDDING                                  │
│     EmbeddingProviderPort.embedBatch(texts)           │
│     en lotes de EMBEDDING_BATCH_SIZE (100)            │
│                                                       │
│  4. Persistencia transaccional:                       │
│     - Soft-delete chunks viejos del mismo documento   │
│       (active=false en knowledge_chunks via cascade)  │
│     - INSERT chunks nuevos                            │
│     - UPDATE KnowledgeDocument status=INDEXED,        │
│       indexed_at=now(), chunk_count=N                 │
│                                                       │
│  5. Enqueue cache invalidation:                       │
│     CACHE_INVALIDATION { businessId, scope: 'faq' }   │
│     (limpia response cache que pudo haber respondido  │
│     con info vieja)                                   │
│                                                       │
│  6. Notifica al dashboard (websocket / poll)          │
└─────────────────────────────────────────────────────┘
        │
        ▼
Agente puede consultar desde el siguiente turno
```

### 14.3 Schema (ya en `prisma/schema.prisma`)

- **`KnowledgeDocument`** — un archivo / fuente cargada por el business. Unique por `(businessId, source)`.
- **`KnowledgeChunk`** — fragmento individual con embedding `vector(1536)`. `businessId` y `kind` denormalizados para queries multi-tenant sin JOIN.
- **`KnowledgeKind` enum** — `FAQ | POLICY | PDF_CATALOG | MANUAL | NOTES | OTHER`.
- **`KnowledgeStatus` enum** — `PENDING | EXTRACTING | CHUNKING | EMBEDDING | INDEXED | FAILED`.

### 14.4 Ports (en `src/core/ports/`)

```typescript
// DocumentExtractorPort — convierte file binario en texto estructurado
interface DocumentExtractorPort {
  readonly name: string;
  readonly supportedMimeTypes: readonly string[];
  canHandle(mimeType: string, filename: string): boolean;
  extract(buffer: Buffer, filename: string): Promise<ExtractedDocument>;
}

// ChunkerPort — toma segmentos del extractor y los parte/junta en chunks
interface ChunkerPort {
  readonly name: string;
  readonly maxTokensPerChunk: number;
  readonly overlapTokens: number;
  chunk(segments: DocumentSegment[]): Chunk[];
}
```

`EmbeddingProviderPort` ya existe — se reusa el de catálogo (mismo OpenAI text-embedding-3-small).

### 14.5 Adapters previstos (Semana 4)

| Adapter | MIME types | Librería | Notas |
|---|---|---|---|
| `pdf-text` | `application/pdf` | `pdf-parse` (ya en deps) | PDFs con texto seleccionable (90% de casos) |
| `csv` | `text/csv` | `csv-parse` | Catálogo en CSV, 1 fila por chunk |
| `excel` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `exceljs` | Catálogo en Excel |
| `markdown` | `text/markdown`, `text/plain` | nativo | Trivial: text-as-is |
| `form` | (sintético) | — | FAQs/políticas escritas en el dashboard |

**Out of scope v1 (defer a v2):**

- `pdf-ocr` con tesseract.js → PDFs escaneados (imágenes). Detección en v1: si `pdf-parse` devuelve < 100 chars en un PDF de N páginas, status=`FAILED` con mensaje "PDF escaneado, OCR llega en v2".
- `claude-vision` → PDFs complejos con tablas/imágenes. Premium feature.
- Connectors `notion` / `google-docs` / `shopify` → ingesta automática desde apps SaaS.

### 14.6 La tool `search_knowledge` (Semana 4)

```typescript
// Pseudocódigo — implementación real en src/modules/tools/knowledge/
const searchKnowledge = betaZodTool({
  name: 'search_knowledge',
  description: `Busca en los documentos del negocio (políticas, FAQs, manuales, PDFs).
    Usa esta tool cuando el cliente pregunte sobre políticas, horarios extendidos,
    términos y condiciones, garantías, devoluciones, o información detallada del
    negocio que NO sea un producto del catálogo.
    Para preguntas sobre productos específicos usa search_catalog.`,
  inputSchema: z.object({
    query: z.string().describe('La pregunta del cliente, en lenguaje natural'),
    kind: z.enum(['FAQ', 'POLICY', 'MANUAL', 'PDF_CATALOG', 'NOTES']).optional()
      .describe('Filtrar por tipo de documento si se sabe (opcional)'),
  }),
  run: async ({ query, kind }, ctx) => {
    const embedding = await embedder.embed(query);
    const chunks = await db.$queryRaw`
      SELECT kc.text, kc.page_number, kd.title, kd.kind,
             1 - (kc.embedding <=> ${embedding}::vector) AS similarity
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      WHERE kc.business_id = ${ctx.businessId}
        AND kd.active = true
        AND kc.embedding_model = ${currentEmbeddingModel}
        ${kind ? db.$queryRaw`AND kc.kind = ${kind}::knowledge_kind` : db.$queryRaw``}
        AND 1 - (kc.embedding <=> ${embedding}::vector) > ${RAG_MIN_SIMILARITY}
      ORDER BY kc.embedding <=> ${embedding}::vector
      LIMIT ${RAG_TOP_K}
    `;
    return JSON.stringify(chunks.map(c => ({
      text: c.text,
      source: `${c.title}${c.page_number ? ` (pág. ${c.page_number})` : ''}`,
      similarity: c.similarity,
    })));
  },
});
```

### 14.7 Costos

| Operación | Tokens / unidad | Costo |
|---|---|---|
| Extract PDF texto (50 págs) | — | gratis (CPU local) |
| Extract PDF OCR (50 págs) | — | gratis (CPU local, lento ~5min) |
| Embedding (1 chunk de 500 tokens) | 500 | $0.00001 con OpenAI small |
| Indexar PDF de 50 págs (~60 chunks) | 30K | **$0.0006** |
| Indexar catálogo de 1000 productos | 200K | **$0.004** |
| Búsqueda (`search_knowledge` por turno) | ~30 tokens (query embedding) | $0.0000006 |

**Conclusión:** ingesta es virtualmente gratis. La cuenta de embeddings de un business típico sería < $0.10/mes incluso re-indexando todo el catálogo a diario.

### 14.8 Implementación en el roadmap

- **Semana 1-3:** schema ya creado (este commit). Tool `search_knowledge` definida en spec. No se implementa código aún.
- **Semana 4:** implementar adapters (`pdf-text`, `csv`, `excel`, `markdown`, `form`), `FixedSizeChunker`, `KnowledgeIndexer` worker, UI dashboard de upload, tool `search_knowledge`.
- **Semana 5:** evals que cubran queries que deben usar `search_knowledge` vs `search_catalog` vs ambos.
- **v2:** OCR (tesseract.js), Claude vision para PDFs complejos, connectors Notion/Shopify.
