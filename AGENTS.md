# AGENTS.md — Atiende

> Compact reference for OpenCode agents working in this repo. Complements [CLAUDE.md](CLAUDE.md).

## Architecture invariants

- **`src/core/` must never import `src/modules/`.** If it does, there's an architectural bug. Core speaks to adapters only through ports (interfaces) injected via NestJS DI tokens.
- **DI tokens** use `UPPER_SNAKE_CASE_TOKEN` convention in `src/core/tokens.ts`. There are deprecated aliases without `_TOKEN` suffix — prefer the suffixed versions.
- **Feature flags** control which modules load at boot. See `src/config/features.ts` for the full schema; flags are hydrated from env vars in `src/config/module-registry.ts`.
- **Path aliases** (tsconfig): `@core/*` → `src/core/*`, `@modules/*` → `src/modules/*`, `@config/*` → `src/config/*`.

## Current state

The project is in **scaffold phase** (week 1 of 6-week roadmap). All adapter directories under `src/modules/` contain only `.gitkeep` files. `CoreModule` and `module-registry.ts` are empty shells. No concrete adapters, no tests, no migrations applied yet.

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
