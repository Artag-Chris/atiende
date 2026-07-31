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
- **Dashboard**: Next.js app at `dashboard/` (sibling directory) with auth integration, escalations list (polling), conversation detail view. All endpoints enforce `businessId` tenant scoping from JWT (SUPER_ADMIN can override).
- **WhatsApp channel**: Webhook receiver with HMAC signature verification (skipped in dev mode), BullMQ queue. Each text message in a payload is processed (NFR-8: no truncation to first). The InboundMessage row is persisted **before** enqueueing (zero-loss); Redis SET-NX dedup is best-effort (if Redis is down, the DB unique constraint `(businessId, externalMessageId)` + use-case dedup protect). The initial pipeline persistence (conversation getOrCreate + dedup + inbound + USER message) runs inside a single `$transaction` via `UNIT_OF_WORK_TOKEN` (PostgresUnitOfWork); the USER save is idempotent via `Message.inboundMessageId` (unique). Dedup only skips messages already marked `processedAt`; `processedAt` is set only after a successful Meta send (in `InboundProcessor`), so failed jobs are retried and re-sent instead of silently dropped.
- **LLM providers**: Claude (primary), OpenAI (fallback + embeddings), Gemini, Groq — all with circuit breaker and retry logic.
- **Caching**: Exact cache (Redis sha256) and semantic cache (pgvector cosine similarity) with in-memory fallback when Redis unavailable.
- **Health**: `GET /health` (DB check) used by the Dockerfile HEALTHCHECK (respects `PORT`).
- **Tests**: 149 unit tests across 20 test files passing (auth, agent, cache, tools, webhook, response policy, inbound use case + processor, unit-of-work, postgres module DI wiring, dashboard/knowledge controllers).
- **Prisma**: Full schema with all models, seed script for admin users. Uses `db push` (shadow DB has encoding issues). The `Message.inboundMessageId` column is new — apply `npx prisma db push` when the DB is up.

## Commands

- `npm run check` — runs `typecheck → lint:check → format:check → test` in sequence. Run before any PR.
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
