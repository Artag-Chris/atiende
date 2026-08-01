# MEMORY — Estado del Proyecto Atiende

> Archivo de memoria para sesiones de desarrollo. Actualizado: 2026-08-01.

---

## Infraestructura actual

### Server remoto (producción/dev)
- **PostgreSQL 16 + pgvector** — container `atiende-postgres`, puerto mapeado `5433:5432`
  - User: `atiende`, Password: `atiende_dev`, DB: `atiende`
  - Extension `vector` habilitada via `prisma/init/01-extensions.sql`
- **Redis** — ya existe en el server remoto, compartido vía `microservices-network`
  - Host: `redis`, Port: `6379`, Prefix: `atiende:dev`
- **Network** — `microservices-network` (Docker network externa, ya creada)

### .env (local)
- `DATABASE_URL=postgresql://atiende:atiende_dev@localhost:5432/atiende?schema=public`
- `REDIS_HOST=localhost`, `REDIS_PORT=6379`
- NOTA: en el server remoto, Docker compose sobreescribe con `atiende-postgres:5432` y `redis`

---

## Lo que funciona end-to-end (2026-07-27)

1. **WhatsApp webhook → LLM → respuesta** — flujo completo funcionando
2. **Groq adapter** — `llama-3.3-70b-versatile` (gratis, ~500ms latencia)
3. **OpenAI adapter** — listo (necesita API key con saldo)
4. **Gemini adapter** — listo (cuota free tier agotada temporalmente)
5. **Meta Graph API send** — envía respuestas vía WhatsApp con timeout 5s
6. **HMAC signature verification** — `timingSafeEqual` contra `x-hub-signature-256`
7. **AgentService** — orquesta turn: system prompt + history → LLM → respuesta
8. **Feature flags** — `FEATURE_LLM_PRIMARY=groq` controla qué adapter se carga
9. **Config validada con Zod** — fail-fast al arrancar si falta algo
10. **DI correctamente configurado** — `ConfigProviderModule` + `@Global()` modules
11. **Persistencia de turnos** — cada agent_run se guarda en DB (tokens, latencia, costo)
12. **Business resolution** — resuelve business desde phone_id del webhook
13. **Conversation management** — get-or-create por business+channel+customer
14. **Message persistence** — guarda mensajes user y assistant con content blocks
15. **Idempotency check** — inbound messages verifican externalMessageId antes de insertar
16. **Kimi K3 adapter** — implementado y testeado, **no activo** (prod sigue en Groq; el switch es solo config: `KIMI_API_KEY` + `FEATURE_LLM_PRIMARY=kimi`)

---

## Lo que falta (próximos pasos)

### Prioridad ALTA
- [ ] **Prisma migrate** — schema existe (437 líneas), pero nunca se aplicó a la DB
- [ ] **Seed de datos** — business de prueba, catálogo de productos
- [ ] **Tool runner** — loop tool_use → tool_result en AgentService
- [ ] **Tools básicas** — `get_business_info`, `escalate_to_human`

### Prioridad MEDIA
- [ ] **BullMQ queue** — desacoplar webhook→procesamiento
- [ ] **Tests** — unit + integración
- [ ] **Conversation history** — leer mensajes previos de DB para contexto del LLM

### Prioridad BAJA (semanas 3-6)
- [ ] RAG (pgvector + embeddings + search_catalog)
- [ ] Multi-tenant (ya soportado en schema)
- [ ] Dashboard Next.js
- [ ] Knowledge ingestion
- [ ] Semantic cache
- [ ] Evals

## Pendientes registrados (2026-07-31) — Dashboard / human takeover

Ambos temas pedidos explícitamente ya están **implementados en código** (faltan migración de schema y deploy):

- [x] **Mostrar nombre de la persona en el front** — `whatsapp.adapter.ts` extrae `contacts[].profile.name` por mensaje (`customerName` en `ParsedInboundMessage`), se persiste en `Conversation.customerName` y se muestra en el chat, en `/pendientes` y en escalaciones. Si no hay nombre, se usa `customerIdentifier`.
- [x] **Notificación "X persona escribió" + lista de pendientes** — semántica acordada (2026-07-31): `unreadCount` sube solo en el primer persist del USER (el `save` de mensajes devuelve `created`; retries de job no duplican el badge) y se resetea a 0 cuando la IA responde (inclusive cache-hit) o al llamar `POST .../read`. Un mensaje nuevo en conversación `RESOLVED` la reabre a `ACTIVE` (vuelve a pendientes y notifica). `GET /api/dashboard/pending` lista conversaciones con no-leídos; el front (`PendingMonitor`) sondea `GET /api/dashboard/inbound-activity?since=<cursor>` (primer poll = snapshot silencioso, luego notifica por item: popup "X escribió" + un ping por batch) y muestra badge en el sidebar; sonido/popup solo si el navegador tiene permiso de notificación. `/pendientes` es la landing. Abrir una conversación la marca leída (`POST .../read`); si la pestaña está visible, el poll la re-marca en cada tick.

> Estado: backend + frontend verificados localmente (backend `npm run check` 217 tests/28 archivos; dashboard lint + `next build` OK) tras la auditoría pre-deploy (fix idempotencia del badge, reset al responder la IA, reapertura de `RESOLVED`, sonido solo con permiso). **Pendiente de deploy**: `npx prisma db push` (columnas `Conversation.customerName` + `Conversation.unreadCount`), rebuild del container backend y redeploy de Vercel.

> Relacionado (ya desplegado): human takeover end-to-end funcional — escalaciones llegan al dashboard, la IA queda muda en `ESCALATED`, el humano responde y ve los mensajes entrantes (fix del truncamiento de `findRecent` + render optimista + auto-scroll).

---

## Pendientes registrados (2026-07-31) — Módulo Kimi K3

Módulo de IA **listo para activar** pero **NO activo** (decisión del dueño: mantener Groq como primario hasta que decida el switch):

- [x] **KimiAdapter** — `src/modules/llm/kimi/kimi.adapter.ts` (API OpenAI-compatible `https://api.moonshot.ai/v1`, modelo `kimi-k3`, `max_completion_tokens`, función-calling nativo, `reasoning_effort` solo `max` con degradación silenciosa, caching automático con `prompt_tokens_details.cached_tokens` descontado del input).
- [x] **Auditoría post-implementación (severa)** — 14 hallazgos; fixes aplicados: (1) guard de `KIMI_API_KEY` en el adapter + fail-fast `superRefine` en `env.ts` (evita que el OpenAI SDK use `OPENAI_API_KEY` como fallback silencioso), (2) `signal` cableado al SDK en los 3 adapters OpenAI-compatibles (kimi/openai/groq), (3) `effort`+`cacheable` wireados desde `config.primary` en `AgentService`, (4) `KIMI_MAX_TOKENS` + `maxTokens` desacoplado por provider, (5) retry-once 400 + truncado de `reasoning_content` (últimos 2000 chars) en Kimi.
- [x] **Dominio** — `ChatMessage.reasoning` + `ChatResponse.reasoningContent`; `AgentService` propaga el razonamiento al siguiente turno del tool loop; los demás adapters ignoran el campo.
- [x] **Config** — `KIMI_API_KEY`/`KIMI_MODEL`/`KIMI_MAX_TOKENS`/`KIMI_TIMEOUT_MS`/`KIMI_MAX_RETRIES` en `env.ts`, union `'kimi'` en flags, `MODEL_PRICING['kimi-k3']` (input $3 / output $15 / cache read $0.30 / cache write conservador $3), `case 'kimi'` en `module-registry.ts`, sección 5d en `.env.example`.
- [x] **Tests** — `kimi.adapter.spec.ts` (9 casos: tools nativos, max_completion_tokens, degradación de effort, extracción y reenvío de `reasoning_content`, cached tokens, guard de key, signal, retry-400, truncado) + `env.spec.ts` (validación cruzada KIMI_API_KEY) + `ai.config.spec.ts` (maxTokens por provider). Con el router+CB (2026-08-01): **248 tests / 33 archivos**.
- [ ] **Activar (solo cuando el dueño lo ordene)**: `KIMI_API_KEY` + `FEATURE_LLM_PRIMARY=kimi` en el entorno. NO tocar `FEATURE_LLM_PRIMARY` por defecto.
- [x] **LLM Router + Circuit Breaker (2026-08-01)**: `LLMRouterModule.forRoot(primary, fallback)` ata los adapters a `LLM_PRIMARY_PROVIDER_TOKEN`/`LLM_PROVIDER_FALLBACK_TOKEN` y expone `LLMRouterService` como `LLM_PROVIDER_TOKEN` (el core no cambia). Los provider modules ya NO registran tokens de rol; cargan su adapter con el bloque de config correcto vía `providerBlockFor()` (`src/modules/llm/provider-config.ts`, elige `aiConfig.primary`/`fallback` según `features.llm.*`). `CircuitBreakerService` (closed/open/half_open; `CIRCUIT_BREAKER_CONFIG_TOKEN`) + `LLMRouterService` (primario → CB → fallback → `LLMProviderUnavailableError`). Wireado en `module-registry.ts` (`providerModuleFor`; evita módulo duplicado si fallback === primary; `claude`/`mock` caen al mock). Tests: 18 nuevos (7 CB + 8 service + 3 DI wiring).
- [ ] **Pendientes del router/futuro (auditoría, v2)**: persistir `reasoning` entre turnos (v2), spec de `OpenAIAdapter`, fixture real de respuesta K3, alinear docs §11/§13 restantes y default `claude`/`mock` (el default ya cae a mock vía `providerModuleFor`).

> Estado: backend `npm run check` en verde. **El deploy del dashboard sigue pendiente del dueño** (db push `customerName`/`unreadCount`, rebuild backend, redeploy Vercel).

---

## Pendientes registrados (2026-08-01) — Multi-canal Meta (Instagram + Messenger)

**PLAN aprobado, nada implementado.** Vía: directo a Meta Graph API (sin BSP). Alcance: DMs de Instagram + Messenger (comparten la Messenger Platform: mismo webhook shape, misma firma HMAC, mismo endpoint de envío). Detalle completo en `docs/05_META_INSTAGRAM_MESSENGER.md`. **Auditoría pre-Fase 0 completada (2026-08-01): base lista.** Ver `docs/05 §4b`.

**Decisiones de la auditoría (2026-08-01):**
- **D1 — Credenciales de send: per-business.** El `WhatsAppAdapter.send()` hoy usa solo env de dev (`META_DEV_*`) e ignora `businessId`/`whatsappTokenEncrypted` (nunca se leen). Se implementará modelo normalizado `ChannelAccount` (channel, accountId, tokenEncrypted AES-GCM, isPrimary) en Prisma + `findByChannelAccount(channel, accountId)`; backfill desde las columnas de WhatsApp y deprecación.
- **D2 — Cola `agent-run`: no extraer.** El turno LLM corre síncrono en el worker `inbound-message` (AGENT_RUN está en config pero no registrada). Se corrige `queue.config.ts` + docs (`BULLMQ_INBOUND_CONCURRENCY`, no `AGENT_CONCURRENCY`).
- Deltas a Fase 0: renombrar `InboundMessageJobData.businessId` → `externalAccountId` (+ `businessId` real); namespace de canal en dedup key/jobId; una sola fuente del tipo `Channel` (quitar import `@prisma/client` del port); mover Throttler global fuera de `WhatsAppModule`; nota FR-5 (agrupación por ventana NO implementada, deuda preexistente).

- [ ] **Fase 0 — Refactor multi-channel**: `channel` en `Channel` union type + `InboundMessageJobData` + use case; `ChannelRouterService` + `CHANNEL_PROVIDERS_TOKEN` (receta del LLM router); `InboundProcessor`/`DashboardController.sendHumanReply` → router; business lookup genérico `findByChannelAccount` + modelo `ChannelAccount` (D1); renombre `businessId`→`externalAccountId` + namespace de canal en dedup/jobId; quitar acoplamiento `@prisma/client` del port; Throttler a infra compartida.
- [ ] **Fase 1 — Adapters**: parser `meta-webhook.parser.ts` + `InstagramAdapter`/`MessengerAdapter`; controllers `webhook/instagram` y `webhook/messenger`; extraer persist+enqueue a `ChannelWebhookService`; env/flags/módulos/Prisma (`INSTAGRAM`, `MESSENGER`); tokens page-scoped.
- [ ] **Fase 2 — Frontend**: badge de canal + inbox unificado (DTOs ya exponen `channel`).
- [ ] **Fase 3 — Costo**: actualizar `docs/02_AI_CONCEPTS.md §10` (DMs reactivos gratis; vigilar pricing Meta 2026: service messages pagos desde 2026-10-01).

---

## Arquitectura — decisiones clave

### LLM Providers
- **Groq** es el primario actual (gratis, OpenAI-compatible)
- `baseURL: https://api.groq.com/openai/v1` con SDK de OpenAI
- Gemini y OpenAI disponibles como fallbacks
- Claude es el ideal del roadmap pero requiere API key de pago

### DI Tokens (UPPER_SNAKE_CASE_TOKEN)
- `LLM_PROVIDER_TOKEN` — service LLM activo (hoy: `LLMRouterService`)
- `LLM_PRIMARY_PROVIDER_TOKEN` — adapter del provider primario
- `LLM_PROVIDER_FALLBACK_TOKEN` — adapter del provider fallback (si aplica)
- `CIRCUIT_BREAKER_CONFIG_TOKEN` — config del circuit breaker
- `AI_CONFIG_TOKEN` — configuración centralizada de IA
- `CHANNEL_PROVIDERS_TOKEN` — array de canales (multi-provider)
- `AGENT_RUN_REPOSITORY_TOKEN` — repositorio de telemetría del agente
- `ENV_TOKEN` — env vars validadas
- `FEATURES_TOKEN` — feature flags consolidados

### Módulos @Global()
- `ConfigProviderModule` — provee todos los tokens de config
- `PrismaModule` — provee PrismaService (conexión a DB)
- `OpenAIModule`, `GeminiModule`, `GroqModule`, `KimiModule`, `MockLLMModule` — registran su adapter con el bloque de config correcto (`providerBlockFor`); **ya no** registran `LLM_PROVIDER_TOKEN`
- `LLMRouterModule` — ata los adapters a los tokens de rol y **expone `LLMRouterService` como `LLM_PROVIDER_TOKEN`**
- `PostgresPersistenceModule` — provee repositorios + AGENT_RUN_REPOSITORY_TOKEN

### Convenciones
- `useFactory` con `multi: true` para arrays (NO `useExisting` con multi)
- Para tokens de rol únicos (primario/fallback), `useExisting` sin `multi` es válido: `LLMRouterModule` ata los adapters así.
- `process.env` para API keys en adapters (aceptable prototype)
- `calculateCost()` del pricing central en `ai.config.ts`
- Logging: `[Provider] model | ms | tokens | $cost`

---

## Errores conocidos y fixes

1. **DI resolution failed** — `ConfigProviderModule` era necesario porque los tokens de config estaban en `AppModule` y los child modules no podían acceder. Fix: mover tokens a módulo `@Global()`.
2. **`channelProviders.find is not a function`** — `useExisting` con `multi: true` no crea array. Fix: usar `useFactory: (w) => [w]`.
3. **Gemini quota exceeded** — free tier agotado (`limit: 0`). Fix: cambiar a Groq.
4. **Historial duplicado en Gemini** — `translateMessages` incluía último msg + `sendMessage` lo reenviaba. Fix: `slice(0, -1)`.

---

## Comandos útiles

```bash
npm run check                    # typecheck + lint + format + test
npm run start:dev                # NestJS watch mode
npx prisma generate              # regenerar Prisma client
npx prisma migrate dev --name X  # crear migración
npx prisma migrate status        # verificar estado de migraciones
npx prisma studio                # GUI de DB
docker compose up -d postgres    # levantar PostgreSQL local
```

---

## Contacto

- **Christian Henao** — autor principal
- Email: scristxyz@gmail.com
