# Audit Report — Initial Scaffold

> Auditoría completa del scaffold post-push. Documenta issues encontrados,
> los que se arreglaron, y el tech debt aceptado para iteraciones futuras.
>
> **Fecha:** 2026-05-20
> **Estado verificado:** `npm run check` (typecheck + lint + format + test) y `npm run build` pasan.

---

## Resumen

| Severidad | Total | Resueltos | Aceptados como tech debt |
|---|---|---|---|
| **Bloqueantes** (rompen install/build/lint) | 4 | 4 | 0 |
| **Altos** (silent bugs, inconsistencias arquitectónicas) | 11 | 11 | 0 |
| **Medios** (best practices) | 11 | 6 | 5 |
| **Bajos** (nice to have) | 4 | 0 | 4 |

---

## ✅ Bloqueantes resueltos

### 1. `typescript-eslint` y `@eslint/js` faltaban en deps

**Antes:** `eslint.config.mjs` los importaba pero `package.json` no los listaba → `npm run lint` fallaba con `MODULE_NOT_FOUND`.

**Fix:** Agregados a `devDependencies`. Verificado con `npm install --dry-run` que ahora resuelven.

### 2. `vitest.e2e.config.ts` referenciado pero no existía

**Antes:** Script `test:e2e` en `package.json` apuntaba a un archivo que nunca creé → `npm run test:e2e` rompía.

**Fix:** Removido el script `test:e2e`. Cuando lleguemos a e2e tests (semana 5+), agregamos el config y el script juntos.

### 3. `unplugin-swc` requería `@swc/core` no instalado

**Antes:** `vitest.config.ts` cargaba `unplugin-swc` que necesitaba `@swc/core` como peer → `npm test` fallaba con `MODULE_NOT_FOUND`.

**Fix:** Removida la dependencia de `unplugin-swc`. Vitest usa esbuild (built-in) para transpilar TypeScript — suficiente para nuestro caso.

### 4. `npm test` fallaba con código 1 cuando no había tests

**Antes:** Greenfield project sin tests → `vitest run` retornaba exit code 1 → CI fail.

**Fix:** Agregado `--passWithNoTests` a los scripts. Cuando lleguen tests reales, fallará si fallan.

---

## ✅ Altos resueltos

### 5. Env vars validados pero nunca usados

**Antes:** `WEBHOOK_BODY_SIZE_LIMIT_KB`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_MS`, `TRUST_PROXY` validados en `env.ts` pero `main.ts` no los consumía — falsa sensación de configurabilidad.

**Fix:** `main.ts` ahora:
- Usa `LOG_LEVEL` para configurar el `Logger` de NestJS (mapping pino → nest).
- Usa `WEBHOOK_BODY_SIZE_LIMIT_KB` con `app.useBodyParser()` para json y urlencoded.
- Wirea SIGTERM/SIGINT handler con `SHUTDOWN_TIMEOUT_MS` (NestJS no lo expone nativo).
- Aplica `TRUST_PROXY` cuando > 0 (para deploy detrás de Nginx/Cloudflare/Railway).
- Captura raw body con `rawBody: true` (necesario para HMAC de Meta sin doble parseo).
- Aplica `helmet()` para security headers.
- Warning si `NODE_ENV=production` y `REDIS_PREFIX` tiene 'dev' (config error casi seguro).
- Warning si `CORS_ALLOWED_ORIGINS` está vacío.

### 6. `calculateCost()` silenciosamente retornaba 0 para modelos desconocidos

**Antes:** Si llegaba un modelo no en `MODEL_PRICING`, devolvía costo 0 sin avisar — métricas de costo silenciosamente serían 0.

**Fix:** Loguea warning **una vez por modelo** (evita spam) cuando detecta un modelo desconocido, incluyendo los tokens consumidos para que el operador sepa qué pricing agregar.

### 7. DI tokens dispersos entre `core/tokens.ts` y `app.module.ts`

**Antes:** `FEATURES` y `LLM_PROVIDER` en `tokens.ts`, pero `ENV_TOKEN` y `AI_CONFIG` definidos en `app.module.ts`. Naming inconsistente (`AI_CONFIG` colisiona visualmente con el tipo `AIConfig`).

**Fix:** Todos los tokens centralizados en `core/tokens.ts` con convención `<NOMBRE>_TOKEN`:
- `ENV_TOKEN`, `FEATURES_TOKEN`, `AI_CONFIG_TOKEN`, `CIRCUIT_BREAKER_CONFIG_TOKEN`
- `LLM_PROVIDER_TOKEN`, `LLM_PROVIDER_FALLBACK_TOKEN`
- `EMBEDDING_PROVIDER_TOKEN`
- `CHANNEL_PROVIDERS_TOKEN` (renombrado a plural — multi-binding)
- `EXACT_CACHE_TOKEN`, `SEMANTIC_CACHE_TOKEN` (separados — capas distintas)
- `TOOL_MODULES_TOKEN` (plural — multi-binding)

Aliases `@deprecated` mantenidos temporalmente para no romper imports futuros.

### 8. `CHANNEL_PROVIDER` y `RESPONSE_CACHE` eran tokens únicos

**Antes:** No soportaban multi-binding. No podías tener WhatsApp + WebChat habilitados a la vez, ni capa exact + capa semantic del cache.

**Fix:** Renombrados a `CHANNEL_PROVIDERS_TOKEN` (plural, multi-binding) y separados `EXACT_CACHE_TOKEN` / `SEMANTIC_CACHE_TOKEN`.

### 9. `ChatRequest` sin `AbortSignal`

**Antes:** No había forma de cancelar un request al LLM (importante para timeouts custom o cuando el cliente cancela).

**Fix:** `ChatRequest.signal?: AbortSignal` agregado. Cada adapter debe respetarlo y abortar el HTTP.

### 10. `ToolCall` duplicado con `ContentBlock['tool_use']`

**Antes:** Dos definiciones de los mismos campos (`id`, `name`, `input`). Riesgo de divergencia.

**Fix:** `ToolCall` es la definición única. `ContentBlock['tool_use']` extiende vía intersection: `({ type: 'tool_use' } & ToolCall)`.

### 11. `ChannelProviderPort.parseInboundWebhook()` mezclaba parseo con lookup de DB

**Antes:** `InboundMessage.businessId` venía del parser, pero el parser sólo tiene el `phone_number_id` (externo). Esto forzaba al parser a tocar DB o devolver data incompleta con cast.

**Fix:** Renombrado a `ParsedInboundMessage` con `externalAccountId` en vez de `businessId`. El service consumer (WebhookController) hace el lookup. Parser sigue siendo puro y sync.

### 12-14. Schema Prisma — gaps fundamentales

**Antes:**
- `AgentRun` sin `businessId` → queries de dashboard requerían JOIN.
- `Conversation` sin `channel` → schema implícitamente WhatsApp-only.
- `ResponseCache` sin `embeddingModel` → silent bug al cambiar de modelo de embeddings.
- `Order` sin índice por `conversationId`.
- `Business` sin índice por `archivedAt`.
- `cacheHitLayer` como string libre en vez de enum.

**Fix:**
- `AgentRun.businessId` agregado con `@@index([businessId, createdAt])`.
- `Conversation.channel: Channel` enum agregado (`WHATSAPP | WEB_CHAT | TELEGRAM`).
- `Conversation.customerIdentifier` renombrado de `customerPhone` (más genérico, multi-canal).
- `Conversation` unique constraint cambiado a `(businessId, channel, customerIdentifier)`.
- `ResponseCache.embeddingModel` agregado con índice compuesto para invalidación.
- `Order` ahora tiene `@@index([conversationId])` y `onDelete: Restrict` explícito.
- `Business` tiene `@@index([archivedAt])`.
- `cacheHitLayer` ahora es enum `CacheHitLayer { EXACT, SEMANTIC }`.

⚠️ **Migración requerida** — los cambios al schema rompen compatibilidad. Como no hemos generado la primera migración aún, esto es gratis. Cuando llegue Semana 1 corremos `prisma migrate dev --name init` con el schema correcto.

### 15. `forTest()` en `app.module.ts` leía `process.env`

**Antes:** Llamaba `loadEnv()` que requiere todas las env vars en `process.env` para tests, haciendo brittle el setup de tests.

**Fix:** Ahora acepta `env` y `features` opcionales explícitos. Si no se pasan, intenta `loadEnv()` (útil cuando hay `.env.test`).

---

## ✅ Medios resueltos

### 16. Sin security headers (Helmet)
**Fix:** `helmet()` agregado en `main.ts`. `helmet` agregado a deps.

### 17. Sin estructura para logger estructurado
**Fix:** Agregados `pino`, `pino-http`, `pino-pretty`, `nestjs-pino` a deps (no wireados aún — se hace cuando implementemos los módulos reales). `LOG_FORMAT=json` ya validado en env.

### 18. Sin rate limiting
**Fix:** `@nestjs/throttler` agregado a deps. Se wirea cuando implementemos el webhook controller (Semana 1).

### 19. Sin `postinstall` para Prisma generate
**Fix:** Agregado `postinstall: prisma generate || echo '...'` — no falla si `DATABASE_URL` no está aún configurada.

### 20. Sin `npm run check` para validación todo-en-uno
**Fix:** Agregados `lint:check`, `format:check`, y `check` que corre los 4 (typecheck + lint + format + test). Útil para CI y para verificar localmente.

### 21. Emoji 🚀 en log
**Fix:** Removido. Tu guía es no usar emojis sin pedirlo.

---

## ⚠️ Tech debt aceptado (no bloqueante, documentado)

Estos los dejamos para iteraciones futuras. **Ninguno bloquea el siguiente paso (implementar webhook receiver)**.

### TD-1: `DB_CONNECTION_POOL_SIZE` no se propaga a Prisma

**Problema:** Prisma lee el pool size del query string de `DATABASE_URL` (`?connection_limit=10`), no de una env var separada. Hoy la variable existe pero es decorativa.

**Solución pendiente:** En `PrismaService` (Semana 1), construir `DATABASE_URL` con el query param agregado, o documentar que el usuario lo ponga manualmente en la URL.

### TD-2: Hardcoded concurrencies para `CACHE_INVALIDATION` y `NOTIFICATION` queues

**Problema:** En `queue.config.ts` esas dos colas tienen concurrencia `4` hardcoded en vez de venir de env.

**Solución pendiente:** Agregar `BULLMQ_CACHE_INVALIDATION_CONCURRENCY` y `BULLMQ_NOTIFICATION_CONCURRENCY` al schema cuando estas colas tengan tráfico medible.

### TD-3: No hay validaciones condicionales en `env.ts`

**Problema:** `OPENAI_API_KEY` es opcional pero si `FEATURE_EMBEDDINGS_PROVIDER=openai` se requiere. Same con `RESEND_API_KEY` si `NOTIFICATIONS_PROVIDER=resend`. Hoy se valida silenciosamente al usar (fallaría runtime).

**Solución pendiente:** Usar `.superRefine()` de Zod para validaciones cross-field. Hacer cuando agreguemos los módulos correspondientes (Semana 3+).

### TD-4: `forceTool` en `ChatRequest` es leaky abstraction

**Problema:** No todos los providers soportan forzar una tool específica. Documentado en el comentario.

**Solución pendiente:** Aceptar como leaky — vive en el port. Documentar en arch §11.3 cuando lo usemos.

### TD-5: `Order.items` es JSON sin tabla `OrderItem`

**Problema:** Analytics "qué producto se vende más" requiere unnest del JSON. Workaround viable para v1.

**Solución pendiente:** Refactor en v2 con tabla separada. Marcado en el schema con comentario.

### TD-6: `MODEL_PRICING` puede quedar stale

**Problema:** Hardcoded mayo 2026. Si Anthropic baja precios y no actualizamos, calculamos high.

**Solución pendiente:** Documentar en `02_AI_CONCEPTS.md` que se revise trimestralmente. Considerar un fetch de pricing endpoint si Anthropic expone uno.

### TD-7: Doc `01_ARCHITECTURE.md` §11.4 muestra `FeaturesSchema.parse(loadFeaturesFromEnv())` que ya no existe

**Problema:** Los ejemplos de código en la doc son conceptuales pero usan nombres que difieren del código real (`buildFeatures(env)`).

**Solución pendiente:** Actualizar los snippets cuando rescribamos la sección post-Week 1 (ya con código real para citar).

### TD-8: `ResponseCache.queryText` plaintext

**Problema:** Si el cache se enabilara para queries con PII, almacenamos plaintext. Hoy mitigado por safety rail `hasPersonalInfo` que bypasea el cache.

**Solución pendiente:** Si se necesita cachear queries personalizadas en el futuro, hash en lookup + storage encriptado.

### TD-9: Sin BullBoard / dashboard de jobs

**Solución pendiente:** Agregar `@bull-board/api` + `@bull-board/express` cuando tengamos jobs corriendo (Semana 2+).

### TD-10: `CORS_ALLOWED_ORIGINS=*` en producción

**Problema:** El backend corre con `CORS_ALLOWED_ORIGINS=*` en el server remoto. Con el dashboard en modo rewrites (proxy de Vercel) no bloquea nada, pero es una mala práctica y el bootstrap lo advierte en `NODE_ENV=production`.

**Solución pendiente:** Cuando el dashboard tenga un dominio estable, setear `CORS_ALLOWED_ORIGINS=https://<dominio-dashboard>` en el `.env` del server remoto y reiniciar. No bloquea el avance actual.

---

## Verificación final

Confirmado con `npm run check`:
```
✓ typecheck      → tsc --noEmit (0 errors)
✓ lint:check     → eslint (0 warnings)
✓ format:check   → prettier (all matched files pass)
✓ test           → vitest --passWithNoTests (exit 0)
```

Y `npm run build` (`nest build`) compila sin errores.

---

## Próximo paso

Todo lo del scaffold está limpio y verificado. Ya podemos arrancar la **Semana 1 propiamente dicha**:

1. `PrismaService` + primera migración (`prisma migrate dev --name init`).
2. `WhatsAppChannelAdapter` con verificación HMAC.
3. `WebhookController` con validación + persistencia + encolado.
4. BullMQ setup con `@nestjs/bullmq` y `InboundMessageProcessor`.
5. Echo response funcional end-to-end.
6. Tests unitarios del webhook.

Una vez tengas las credenciales de Meta en tu `.env`, podemos probar el flujo completo con un mensaje real.
