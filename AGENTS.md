# AGENTS.md — Atiende

> Compact reference for OpenCode agents working in this repo. Complements [CLAUDE.md](CLAUDE.md).

## Architecture invariants

- **`src/core/` must never import `src/modules/`.** If it does, there's an architectural bug. Core speaks to adapters only through ports (interfaces) injected via NestJS DI tokens.
- **DI tokens** use `UPPER_SNAKE_CASE_TOKEN` convention in `src/core/tokens.ts`. There are deprecated aliases without `_TOKEN` suffix — prefer the suffixed versions.
- **Feature flags** control which modules load at boot. See `src/config/features.ts` for the full schema; flags are hydrated from env vars in `src/config/module-registry.ts`.
- **Path aliases** (tsconfig): `@core/*` → `src/core/*`, `@modules/*` → `src/modules/*`, `@config/*` → `src/config/*`.

## Current state

The project is **active development** with all core adapters implemented:

- **Auth**: JWT login with refresh token rotation, role-based guards (RolesGuard), Zod validation, rate limiting, audit trail (LoginAttempt).
- **Observability**: Global exception filter (consistent error envelope, no stack leaks) + JSON logging via `LOG_FORMAT=json` (JsonLogger). LLM calls have AbortController timeouts in AgentService.
- **Dashboard**: Next.js app at `dashboard/` (sibling directory) with auth integration, pending conversations list + escalations list (both polling), conversation detail view. All endpoints enforce `businessId` tenant scoping from JWT (SUPER_ADMIN can override). Dashboard shows the customer's WhatsApp `profile.name` when available (`Conversation.customerName`) and counts unread messages (`Conversation.unreadCount`): `GET /api/dashboard/pending` (unread > 0, ordenado por `lastMessageAt` desc, con `lastMessageText`) y `POST /api/dashboard/conversations/:id/read` (resetea `unreadCount`) alimentan la bandera del sidebar. `unreadCount` se incrementa solo en el primer persist del USER (el `save` devuelve `created`; retries de job no inflan el badge) y se resetea cuando la IA responde (incluido cache-hit). Un mensaje nuevo en conversación `RESOLVED` la reabre a `ACTIVE` (vuelve a pendientes). Notificaciones de escritura vía `GET /api/dashboard/inbound-activity?since=<cursor>&limit=20` (mensajes USER desde el cursor, tenant-scoped, responde `latest` para avanzar el cursor): `PendingMonitor` sondea, el primer poll es un snapshot silencioso, y popup "X escribió" + ping solo si el navegador otorgó permiso de notificación. Human takeover: `POST /api/dashboard/conversations/:id/send` (solo si `ESCALATED`, guarda rol `HUMAN` y envía por WhatsApp) y `POST /api/dashboard/conversations/:id/resolve`. Mientras una conversación está `ESCALATED`, el pipeline entrante persiste el USER pero NO responde (skip de IA). Exploradora de chats (solo lectura): `GET /api/dashboard/conversations` lista TODAS las conversaciones del tenant en cualquier estado, con filtros `status` (CSV)/`channel`/`q` (nombre o identificador) y paginación `limit`/`offset` (devuelve `total`); `GET /api/dashboard/conversations/:id` acepta `before=<ISO>` + `limit` para paginar el historial y responde `hasMore` (default 50, tope 200). No expone envío: responder sigue siendo exclusivo de `ESCALATED`. `MaintenanceModule` (cola BullMQ `MAINTENANCE`, repeatable cada `ESCALATION_EXPIRY_INTERVAL_HOURS`) auto-expira escalaciones inactivas (> `ESCALATION_EXPIRY_HOURS` desde `lastMessageAt`) a `ACTIVE`.
- **WhatsApp channel**: Webhook receiver with HMAC signature verification (skipped in dev mode), BullMQ queue. Each text message in a payload is processed (NFR-8: no truncation to first). The InboundMessage row is persisted **before** enqueueing (zero-loss); Redis SET-NX dedup is best-effort (if Redis is down, the DB unique constraint `(businessId, externalMessageId)` + use-case dedup protect). The initial pipeline persistence (conversation getOrCreate + dedup + inbound + USER message) runs inside a single `$transaction` via `UNIT_OF_WORK_TOKEN` (PostgresUnitOfWork); the USER save is idempotent via `Message.inboundMessageId` (unique). Dedup only skips messages already marked `processedAt`; `processedAt` is set only after a successful Meta send (in `InboundProcessor`), so failed jobs are retried and re-sent instead of silently dropped.
- **LLM providers**: Claude (primary), OpenAI (fallback + embeddings), Gemini, Groq, Kimi K3 — routed by **`LLMRouterModule.forRoot(primary, fallback)`** (`src/modules/llm/router/`): the provider modules expose their adapter (config block via `providerBlockFor`), the router binds them to `LLM_PRIMARY_PROVIDER_TOKEN`/`LLM_PROVIDER_FALLBACK_TOKEN` and exposes `LLMRouterService` as `LLM_PROVIDER_TOKEN` (core unchanged). `CircuitBreakerService` (closed/open/half_open, `CIRCUIT_BREAKER_CONFIG_TOKEN`) guards the primary; no fallback + primary down → `LLMProviderUnavailableError`. `claude`/`mock` fall back to the mock adapter. All adapters have retry logic. Groq runs in **prompt-completion mode** (no `tools` param): llama-3.3-70b-versatile emits `<function.NAME{json}></function>` in text and Groq's server-side tool validation rejects/mangles it (400 "tool call validation failed" broke `escalate_to_human` in prod). The adapter describes the format in the system prompt and parses the output via `src/modules/llm/raw-function-calls.ts` (also applied to OpenAI as defense-in-depth), so tool-call syntax never leaks to the customer. **Kimi K3** (`src/modules/llm/kimi/`) is implemented and tested but **NOT active** — prod stays on Groq; activation is config only (`KIMI_API_KEY` + `FEATURE_LLM_PRIMARY=kimi`). K3 always reasons (`max_completion_tokens`, `reasoning_effort` only `max`), requires re-sending `reasoning_content` (truncated to the last 2000 chars) + full `tool_calls` on assistant messages in the tool loop (core propagates it via `ChatMessage.reasoning` / `ChatResponse.reasoningContent`; other adapters ignore those fields), and Moonshot's automatic caching is billed via `prompt_tokens_details.cached_tokens` (discounted from input in `MODEL_PRICING['kimi-k3']`). `KIMI_API_KEY` guard in the adapter + fail-fast in `env.ts` when kimi is active; retry-once on HTTP 400; per-provider `maxTokens` (`KIMI_MAX_TOKENS` vs `ANTHROPIC_MAX_TOKENS`).
- **Caching**: Exact cache (Redis sha256) and semantic cache (pgvector cosine similarity) with in-memory fallback when Redis unavailable. Ambas exponen `invalidate(businessId)` y `KnowledgeService` las invoca al re-indexar (FR-25).
- **Knowledge (RAG)**: documentos no-estructurados → `knowledge_documents`/`knowledge_chunks` (pgvector 1536d, coseno, umbral 0.6, top-5, tenant-scoped y `active=true`). Extractores: PDF (`pdf-parse`), CSV, **Markdown/TXT** y **Excel `.xlsx`** — este último con `exceljs`, NO con `xlsx`/SheetJS (la versión publicada en npm está congelada en 0.18.5 con CVE-2023-30533). El tipo subido se resuelve **por extensión** (`src/modules/knowledge/file-type.ts`) porque los navegadores reportan MIME inconsistente para `.md` (a veces `application/octet-stream`); `.xls` (BIFF) se rechaza con un mensaje que pide guardarlo como `.xlsx`. Ingesta por dashboard (`POST /api/knowledge/upload`, `POST /api/knowledge/text`) **y por CLI**: `npm run knowledge:ingest -- <archivo...>`, que reusa la misma `KnowledgeService` sin levantar el contexto de Nest (solo Postgres + OpenAI embeddings, sin Redis) e inyecta la caché semántica para invalidarla. Catálogo: `npm run catalog:embed` vectoriza `products` → `product_embeddings` (sin esto `search_catalog` devuelve 0 resultados siempre) y `npm run catalog:import -- <csv>` hace upsert por nombre y re-vectoriza todo el catálogo activo. El texto vectorizado de un producto se define una sola vez en `src/modules/catalog/product-embedding.ts`.
- **Health**: `GET /health` (DB check) used by the Dockerfile HEALTHCHECK (respects `PORT`).
- **Tests**: 478 unit tests across 59 test files passing (auth, agent, cache, tools, webhook, response policy, inbound use case + processor (incl. unread idempotency, RESOLVED reopen, reset on reply/cache-hit), escalation expiry, maintenance, unit-of-work, postgres module DI wiring + message (save `created` flag + `findInboundActivity`)/inbound/conversation repositories, whatsapp adapter (name extraction), dashboard/knowledge controllers (incl. inbound-activity, resolución de tipo por extensión y rechazo de formatos), `test/knowledge-upload.spec.ts` (multipart HTTP real), extractores de knowledge (PDF/CSV/Markdown/Excel) + `file-type` + `KnowledgeService` (idempotencia por hash e invalidación de caché), parseo del CSV de catálogo + texto de embedding de productos, raw function-call parsing, groq adapter manifest, kimi adapter (native tools, max_completion_tokens, effort degradation, reasoning_content round-trip, cached tokens, key guard, signal forwarding, retry-on-400, reasoning truncation), env cross-field validation (KIMI_API_KEY required when kimi active), ai.config maxTokens decoupling, **LLM router** (circuit breaker states/half-open/window roll, service fallback + `LLMProviderUnavailableError`, DI wiring of primary/fallback/no-fallback)).
- **Prisma**: Full schema with all models, seed script for admin users. Uses `db push` (shadow DB has encoding issues). `Conversation.customerName`, `Conversation.unreadCount` and `Message.inboundMessageId` are new — apply `npx prisma db push` when the DB is up.

## Commands

- `npm run check` — runs `typecheck → lint:check → format:check → test` in sequence. Run before any PR.
- `npm run knowledge:ingest -- <archivo...> [--kind NOTES] [--source id] [--title txt] [--business id] [--dry-run]` — indexa `.md`/`.txt`/`.pdf`/`.csv`/`.xlsx` en la base vectorial sin pasar por el seed. Reusar el mismo `--source` actualiza el documento.
- `npm run catalog:embed [--missing]` / `npm run catalog:import -- <csv>` — vectoriza y/o importa el catálogo (precios) e invalida la caché semántica.
- `npm test` — vitest once; `npm run test:watch` / `npm run test:cov` for variants.
- `npm run start:dev` — NestJS watch mode.
- `npm run prisma:generate` / `npm run prisma:migrate:dev` — Prisma client + migrations.
- `npm run docker:up` / `down` / `:logs` — Postgres 16 + pgvector + Redis 7 via compose.
- `postinstall` silently skips `prisma generate` if `DATABASE_URL` is unset — run manually if needed.

## Env & config quirks

- `src/config/env.ts` is the **source of truth** for env vars — validated via Zod at boot (fail-fast). Never add env vars without adding them here.
- `src/config/ai.config.ts` contains hardcoded model pricing (USD per 1M tokens). **Keep synchronized** with `docs/02_AI_CONCEPTS.md §10` and verify trimestrally against vendor pricing pages.
- `@anthropic-ai/sdk` `cache_control` is Anthropic-specific — it lives in the adapter, never abstracted into core ports.
- `ENCRYPTION_MASTER_KEY` must be 32 bytes base64. Generate with `crypto.randomBytes(32).toString('base64')`.

## Adding new external integrations

1. Define port in `src/core/ports/` (interface).
2. Implement adapter in `src/modules/<category>/<provider>/`.
3. Register in `src/config/module-registry.ts` behind a feature flag.
4. Create a mock adapter in `src/modules/<category>/mock/` for tests.
5. Note any "leaky abstractions" in `docs/01_ARCHITECTURE.md` §11.

## Repo resources

- **Spec is truth:** `docs/00_SPEC.md` — changes to requirements start here, not in code.
- **Subagents:** `db-migrations` (review schema changes) and `prompt-reviewer` (review system prompts) in `.claude/agents/`.
- **No CI/CD** exists yet (no `.github/` workflows).

## Style

- Tests co-located as `*.spec.ts` next to source files.
- Errors use custom classes (e.g., `BusinessNotFoundError`), never bare `Error`.
- No explanatory comments on obvious code.
- `kebab-case` files, `PascalCase` classes, `camelCase` functions/vars, `UPPER_SNAKE_CASE` constants.
- Conventional Commits referencing FR/NFR from the spec.
