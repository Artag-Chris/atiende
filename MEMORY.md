# MEMORY — Estado del Proyecto Atiende

> Archivo de memoria para sesiones de desarrollo. Actualizado: 2026-07-27.

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

---

## Arquitectura — decisiones clave

### LLM Providers
- **Groq** es el primario actual (gratis, OpenAI-compatible)
- `baseURL: https://api.groq.com/openai/v1` con SDK de OpenAI
- Gemini y OpenAI disponibles como fallbacks
- Claude es el ideal del roadmap pero requiere API key de pago

### DI Tokens (UPPER_SNAKE_CASE_TOKEN)
- `LLM_PROVIDER_TOKEN` — adaptador LLM primario
- `LLM_PROVIDER_FALLBACK_TOKEN` — adaptador LLM fallback
- `AI_CONFIG_TOKEN` — configuración centralizada de IA
- `CHANNEL_PROVIDERS_TOKEN` — array de canales (multi-provider)
- `AGENT_RUN_REPOSITORY_TOKEN` — repositorio de telemetría del agente
- `ENV_TOKEN` — env vars validadas
- `FEATURES_TOKEN` — feature flags consolidados

### Módulos @Global()
- `ConfigProviderModule` — provee todos los tokens de config
- `PrismaModule` — provee PrismaService (conexión a DB)
- `OpenAIModule`, `GeminiModule`, `GroqModule`, `MockLLMModule` — proveen LLM_PROVIDER_TOKEN
- `PostgresPersistenceModule` — provee repositorios + AGENT_RUN_REPOSITORY_TOKEN

### Convenciones
- `useFactory` con `multi: true` para arrays (NO `useExisting` con multi)
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
