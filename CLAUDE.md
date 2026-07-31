# CLAUDE.md

> Este archivo es leído automáticamente por Claude Code al abrir el repo. Documenta el contexto del proyecto, las convenciones, y los comandos para que cualquier sesión arranque productiva en segundos.

---

## ¿Qué es Atiende?

Atiende es un **agente conversacional de IA conectado a WhatsApp Business** para PYMEs latinoamericanas. Atiende clientes 24/7, consulta catálogo via RAG, crea órdenes, responde FAQs, y escala a humanos cuando hace falta. Construido sobre Claude API.

**Propósito doble:** producto comercial real + proyecto de portafolio para transición a AI Engineer.

---

## Documentos de fuente de verdad (LEER PRIMERO)

Si eres nuevo en el repo (humano o Claude Code), lee en este orden:

1. **[docs/00_SPEC.md](docs/00_SPEC.md)** — qué construimos, para quién, métricas de éxito.
2. **[docs/01_ARCHITECTURE.md](docs/01_ARCHITECTURE.md)** — diseño técnico, stack, patrones (especialmente §11 Adapter + Core/Módulos y §12 Caching multinivel y §13 Resiliencia).
3. **[docs/02_AI_CONCEPTS.md](docs/02_AI_CONCEPTS.md)** — conceptos de IA aplicados (RAG, tool use, prompt caching, evals).
4. **[docs/03_ROADMAP.md](docs/03_ROADMAP.md)** — plan semana a semana.
5. **[docs/SETUP_META.md](docs/SETUP_META.md)** — clickflow para crear la app de Meta WhatsApp Business (necesario para semana 1).

**La spec es la fuente de verdad.** Si vas a hacer un cambio que afecta requerimientos, el cambio empieza en la spec, no en el código.

---

## Filosofía del proyecto

1. **Spec-driven.** Cambios empiezan por la spec. Cada PR menciona el FR/NFR que implementa.
2. **AI-driven.** Claude Code es el entorno principal. Subagentes, hooks y MCPs configurados desde día 1.
3. **Arquitectura hexagonal (ports & adapters).** El `core/` no importa SDKs — habla con interfaces. Los `modules/` implementan esas interfaces. Ver `src/core/ports/`.
4. **Feature flags por módulo.** Lo que no es estable (proveedores, canales, herramientas) se prende/apaga por config. Ver `src/config/features.ts`.
5. **Métricas desde día 1.** Latencia, tokens, costo en cada turno. Lo que no se mide no existe.
6. **Honestidad sobre abstracciones.** No abstraemos lo que no es portable (ej: `cache_control` de Anthropic). El adapter lo aplica internamente. Ver Arquitectura §11.3.
7. **Evals antes de tocar prompts productivos.** Una vez que existe el eval set (semana 5), ningún cambio de prompt va a prod sin pasar evals.

---

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20+ / TypeScript 5+ |
| Framework | NestJS 11 |
| DB | PostgreSQL 16 + pgvector |
| ORM | Prisma 6 |
| Queue | BullMQ + Redis (paquete `@nestjs/bullmq`) |
| LLM primario | Anthropic Claude API (`claude-opus-4-7`) |
| Embeddings | OpenAI `text-embedding-3-small` |
| WhatsApp | Meta WhatsApp Business API (Cloud) |
| Tests | Vitest |
| Validación | Zod + class-validator |

---

## Estructura del repo

```
atiende/
├── docs/                           # spec, arquitectura, conceptos, roadmap
├── prisma/
│   ├── schema.prisma               # modelos de DB
│   ├── migrations/                 # generadas por prisma migrate
│   └── init/                       # SQL de inicialización (extensions)
├── src/
│   ├── core/                       # núcleo estable, NO importa SDKs
│   │   ├── domain/                 # entidades: Conversation, Message, Order
│   │   ├── ports/                  # interfaces: LLMProvider, ChannelProvider, ...
│   │   ├── services/               # orquestación: AgentService, etc.
│   │   ├── tokens.ts               # InjectionToken constants
│   │   └── core.module.ts
│   ├── modules/                    # implementaciones pluggables
│   │   ├── llm/{claude,mock}/      # adapters de LLM
│   │   ├── channels/whatsapp/      # WhatsApp adapter
│   │   ├── tools/{catalog,orders,info,escalation}/
│   │   ├── embeddings/openai/
│   │   ├── persistence/postgres/
│   │   ├── cache/{semantic,exact}/
│   │   └── queue/bullmq/
│   ├── config/
│   │   ├── env.ts                  # validación de env vars con Zod (fuente de verdad)
│   │   ├── features.ts             # feature flags consolidadas
│   │   ├── ai.config.ts            # estrategia LLM (modelos, prompt caching, fallback, costos)
│   │   ├── queue.config.ts         # BullMQ: nombres de colas, concurrencia, retención, backoff
│   │   └── module-registry.ts      # decide qué módulos cargar según features
│   ├── app.module.ts
│   └── main.ts
├── test/                           # tests end-to-end
├── evals/                          # casos de eval (jsonl) + runner
├── .claude/                        # config de Claude Code (subagents, settings)
├── docker-compose.yml              # Postgres + pgvector + Redis local
├── CLAUDE.md                       # este archivo
└── README.md
```

**Regla de oro:** `src/core/` nunca debe importar de `src/modules/`. Si lo hace, hay un bug arquitectónico.

---

## Comandos comunes

### Setup inicial (primera vez)

```bash
npm install
cp .env.example .env                  # editar con valores reales
npm run docker:up                     # arranca Postgres + Redis
npm run prisma:generate
npm run prisma:migrate:dev            # crea schema en DB
```

### Desarrollo diario

```bash
npm run docker:up                     # asegura infra arriba
npm run start:dev                     # NestJS en watch mode
```

### Testing

```bash
npm test                              # corre vitest una vez
npm run test:watch                    # watch mode
npm run test:cov                      # con coverage
```

### Calidad

```bash
npm run typecheck                     # tsc --noEmit
npm run lint                          # eslint con --fix
npm run format                        # prettier write
```

### Prisma

```bash
npm run prisma:studio                 # GUI para inspeccionar DB
npm run prisma:migrate:dev            # crear migración nueva
```

---

## Convenciones

### Branching

- `main` — protegida, solo merges via PR con evals pasando.
- `feat/<descripción-corta>` — features nuevas.
- `fix/<descripción-corta>` — bugs.
- `refactor/<descripción-corta>` — refactor sin cambio funcional.
- `docs/<descripción-corta>` — solo cambios a docs.

### Commits

Estilo **Conventional Commits**. Cada commit referencia el FR/NFR si aplica:

```
feat(webhook): valida firma HMAC de Meta y persiste mensaje entrante

Implementa FR-1, FR-2 de la spec.
```

Tipos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`.

### Naming

- Archivos: `kebab-case.ts` (`agent.service.ts`, `claude.adapter.ts`).
- Clases: `PascalCase` (`AgentService`, `ClaudeAdapter`).
- Interfaces (ports): sufijo `.port.ts` y `Port` en el nombre (`LLMProviderPort`).
- Variables y funciones: `camelCase`.
- Constants exportadas: `UPPER_SNAKE_CASE` (para tokens de DI).
- Archivos de tests: `<algo>.spec.ts` colocado al lado del archivo testeado.

### Code style

- Sin comentarios redundantes ("// asigna x"). Comentarios solo cuando el *por qué* no es obvio.
- Funciones pequeñas, una responsabilidad cada una.
- Inyección de dependencias siempre por constructor (NestJS DI).
- Sin `any` salvo último recurso (lint warning activo).
- Errores con clases custom (`BusinessNotFoundError`), nunca `throw new Error("foo")` en boundaries.

---

## Patrones arquitectónicos clave

### Cuando agregues una integración externa nueva

1. Define el **port** en `src/core/ports/<nombre>.port.ts` (interfaz).
2. Crea el **adapter** en `src/modules/<categoria>/<provider>/`.
3. Registra en `src/config/module-registry.ts` (carga condicional según flag).
4. Crea un **mock adapter** en `src/modules/<categoria>/mock/` para tests.
5. Documenta en `docs/01_ARCHITECTURE.md` cualquier "leaky abstraction" honesta (features que no se abstraen).

### Cuando agregues una tool del agente

1. Implementa `ToolModulePort` en `src/modules/tools/<nombre>/`.
2. Define schema de input con Zod.
3. La descripción de la tool es lo más crítico — el modelo decide cuándo llamarla basado en eso.
4. NUNCA dejes que la tool acceda a `business_id` desde el modelo. Pásalo por contexto del request.
5. Si la tool muta estado (crea órdenes, escala), debe estar en la lista de bypass del semantic cache.

### Cuando trabajes con prompts productivos

1. NO los edites sin tener evals listos.
2. Cualquier cambio en `src/core/services/agent.service.ts` o archivos `*.prompt.ts` debe pasar la eval suite antes de PR.
3. Documenta el cambio de prompt en el commit message (qué cambió y por qué).

---

## Estado actual del proyecto

**Fase:** desarrollo activo.

**Lo que YA está:**
- Auth completa (JWT, refresh token rotation, roles, rate limiting, audit trail).
- Dashboard en Next.js (login, escalations, conversaciones, polling).
- Canal WhatsApp (webhook con verificación HMAC, BullMQ). Cada mensaje de texto del payload se procesa (NFR-8: sin truncar al primero); el InboundMessage se persiste ANTES de encolar (zero-loss); el dedup de Redis es best-effort (si cae, protege la constraint única de DB + el dedup del use case). La persistencia inicial del pipeline (conversation + inbound + USER message) es atómica vía `UNIT_OF_WORK_TOKEN` (PostgresUnitOfWork, `$transaction`), con USER save idempotente por `Message.inboundMessageId` (único). El dedup solo ignora mensajes YA procesados (`processedAt`); `processedAt` se marca DESPUÉS del envío exitoso a Meta, así un job fallido se reintenta y re-envía en vez de perder el mensaje.
- Proveedores LLM: Claude (primario), OpenAI (fallback + embeddings), Gemini, Groq — todos con circuit breaker.
- Caching multinivel: exacto (Redis) + semántico (pgvector) con fallback in-memory.
- Endpoint `/health` (liveness/readiness con check de DB) usado por el HEALTHCHECK del Dockerfile.
- 149 tests unitarios pasando en 20 archivos.
- Seed script para usuarios admin.

**Lo que NO está aún:**
- Telemetría y monitoreo (OpenTelemetry, Sentry).
- Canal Web Chat.
- Canal Telegram.
- Evaluaciones (evals) y pipeline CI/CD.

Ver `docs/03_ROADMAP.md` para el roadmap completo.

---

## Subagentes disponibles (Claude Code)

Configurados en `.claude/agents/`:

- **`db-migrations`** — revisa cambios a `schema.prisma` y migraciones con cuidado de no romper data. Úsalo antes de cualquier `prisma migrate dev`.
- **`prompt-reviewer`** — revisa cambios a system prompts contra principios de prompt engineering. Úsalo cuando edites archivos `*.prompt.ts`.

Subagentes built-in útiles para este repo:

- **`Explore`** — para búsqueda amplia en el repo cuando no sabes dónde está algo.
- **`Plan`** — para diseñar implementación de features no triviales (>1 archivo).

---

## Notas para Claude Code

- **Antes de tocar prompts o agente:** lee `docs/02_AI_CONCEPTS.md` para entender el contexto de tool use, prompt caching, RAG.
- **Antes de tocar arquitectura:** lee `docs/01_ARCHITECTURE.md` §11 (Adapter pattern) — viola las reglas ahí y rompemos la portabilidad.
- **Antes de tocar la DB:** lee `prisma/schema.prisma` — los modelos están comentados explicando relaciones y constraints.
- **Antes de cualquier commit que toque IA:** corre `npm run test` (eventualmente `npm run eval` cuando exista).
- **Si encuentras código sin comentarios:** está bien. La convención es no comentar lo obvio. Si necesitas saber el "por qué", consulta los docs.

---

## Contacto / Mantenedores

- **Christian Henao** — autor principal, Team Lead. <scristxyz@gmail.com>
