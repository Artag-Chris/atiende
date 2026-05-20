# Atiende

> Agente conversacional de IA para WhatsApp Business — atiende clientes 24/7, consulta catálogo con RAG, crea órdenes y escala a humanos cuando hace falta. Construido sobre Claude API con arquitectura hexagonal y caching multinivel para ahorro de costos.

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/nestjs-11-red.svg)](https://nestjs.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

**Estado:** scaffold inicial (mayo 2026) — ver [docs/03_ROADMAP.md](docs/03_ROADMAP.md) para el plan.

---

## ¿Qué hace?

Las PYMEs latinoamericanas pierden ventas todos los días porque no responden WhatsApp a tiempo. Atiende es un agente conversacional que:

- Atiende clientes 24/7 con lenguaje natural (no chatbot de respuestas fijas).
- Consulta el catálogo del negocio con **búsqueda semántica (RAG)** — nunca inventa precios.
- Crea órdenes conversacionalmente ("quiero 2 unidades del rojo en talla M, envío a [dirección]").
- Detecta quejas y escala automáticamente a un humano del negocio.
- Mantiene memoria de la conversación.
- **Demuestra ahorro:** caching multinivel (Anthropic prompt cache + semantic cache + exact cache) reduce el costo por conversación ~30% vs llamar al LLM cada vez.

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20+ / TypeScript 5 |
| Framework | NestJS 11 |
| DB | PostgreSQL 16 + pgvector |
| ORM | Prisma 6 |
| Queue | BullMQ + Redis (`@nestjs/bullmq`) |
| LLM | Anthropic Claude (`claude-opus-4-7`) |
| Embeddings | OpenAI `text-embedding-3-small` |
| WhatsApp | Meta WhatsApp Business API (Cloud) |
| Tests | Vitest |

## Arquitectura

Hexagonal (ports & adapters) con feature flags por módulo:

```
core/         <- lógica de negocio pura, NO importa SDKs
  ports/       <- interfaces: LLMProvider, ChannelProvider, ResponseCachePort, ...

modules/      <- adapters intercambiables
  llm/{claude,mock}
  channels/whatsapp
  tools/{catalog,orders,info,escalation}
  embeddings/openai
  cache/{semantic,exact}
  ...

config/features.ts  <- prende/apaga módulos por env vars
```

Detalles en [docs/01_ARCHITECTURE.md](docs/01_ARCHITECTURE.md).

## Cómo correr local

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env
# editar .env con ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.

# 3. Infraestructura (Postgres con pgvector + Redis)
npm run docker:up

# 4. Generar cliente Prisma y aplicar migraciones
npm run prisma:generate
npm run prisma:migrate:dev

# 5. Dev server
npm run start:dev
```

### Otros comandos útiles

```bash
npm test                # vitest
npm run test:watch
npm run test:cov        # con coverage
npm run typecheck       # tsc --noEmit
npm run lint
npm run format
npm run prisma:studio   # GUI de la DB
npm run docker:logs     # tail de Postgres + Redis
```

## Documentación

| Doc | Para qué |
|---|---|
| [docs/00_SPEC.md](docs/00_SPEC.md) | Qué construimos, para quién, métricas de éxito |
| [docs/01_ARCHITECTURE.md](docs/01_ARCHITECTURE.md) | Diseño del sistema, stack con justificación, patrones (Adapter §11, Cache §12, Resiliencia §13) |
| [docs/02_AI_CONCEPTS.md](docs/02_AI_CONCEPTS.md) | Conceptos: tokens, tool use, RAG, embeddings, prompt caching, semantic caching, evals |
| [docs/03_ROADMAP.md](docs/03_ROADMAP.md) | Plan de 6 semanas con entregables verificables |
| [CLAUDE.md](CLAUDE.md) | Contexto para sesiones de Claude Code |

## Filosofía

- **Spec-driven** — cambios empiezan por la spec, no por el código.
- **AI-driven dev** — Claude Code como entorno principal. Subagentes, hooks, MCPs configurados desde día 1.
- **Honestidad sobre abstracciones** — abstraemos lo conceptualmente portable; los features provider-specific viven en sus adapters. Ver [arq §11.3](docs/01_ARCHITECTURE.md#113-adapter-pattern-para-llm-providers).
- **Ahorro como feature** — la métrica "Ahorro Atiende" es visible al business. Ver [arq §12.8](docs/01_ARCHITECTURE.md#128-cómo-lo-demostramos-pitch-comercial).
- **Resiliencia anti-vendor-lockin** — si Anthropic se cae, las capas 2+3 del cache (provider-agnostic) protegen el 30-60% del tráfico; el resto pasa por fallback LLM. Ver [arq §13](docs/01_ARCHITECTURE.md#13-resiliencia-y-failover-de-proveedor).

## Estado del roadmap

- [x] Semana 0 — Spec, arquitectura, conceptos, roadmap
- [ ] Semana 1 — Foundation: webhook + echo
- [ ] Semana 2 — Agente básico + tool use
- [ ] Semana 3 — RAG sobre catálogo
- [ ] Semana 4 — Multi-tenant + orders + dashboard + exact cache
- [ ] Semana 5 — Evals + semantic cache + hardening
- [ ] Semana 6 — Launch + métrica "Ahorro Atiende"

## Licencia

MIT — ver [LICENSE](LICENSE).

## Autor

**Christian Henao** — Team Lead & Full Stack Developer transicionando a AI Engineering.
[scristxyz@gmail.com](mailto:scristxyz@gmail.com)
