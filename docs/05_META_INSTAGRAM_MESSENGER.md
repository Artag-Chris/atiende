# 05 — Expansión a Instagram + Messenger (Meta Multi-Canal)

> Estado: **PLAN aprobado** (2026-08-01). Decisiones tomadas con el dueño: integración **directa a Meta Graph API** (sin BSP) y alcance **DMs en Instagram y Facebook Messenger**. Nada de esto está implementado todavía.

---

## 1. Contexto y decisiones

- El harness de WhatsApp ya está en prod (webhook → BullMQ → agente LLM → send).
- La arquitectura es **multi-channel desde el diseño**: `ChannelProviderPort` (`src/core/ports/channel-provider.port.ts`) y el union type `Channel = 'whatsapp' | 'web_chat' | 'telegram'` (`src/core/domain/types.ts:13`).
- **Decisión 1 — Vía: Directo a Meta Graph API.** Coherente con el WhatsApp actual (misma app de Meta, sin markup de BSP). Único costo = tarifas Meta. Se descartó BSP (Wati/360dialog/Twilio/ManyChat) por markup + suscripción + dependencia de tercero. Se descartó scraping (instagrapi/puppeteer): viola ToS, riesgo de baneo, sin webhooks, frágil.
- **Decisión 2 — Alcance: DMs de Instagram + Messenger.** Ambos comparten la **misma API** (Messenger Platform) con el mismo shape de webhook y el mismo endpoint de envío; solo cambia el `object` del webhook (`instagram` vs `page`) y el ID del remitente (IGSID vs PSID). Un parser compartido + dos adapters delgados.

## 2. Por qué se amplía (no se rehace)

Reutilización ≈ 75% del harness de WhatsApp:

| Aspecto | WhatsApp | Instagram / Messenger |
|---|---|---|
| Firma del webhook | `X-Hub-Signature-256` (HMAC `META_APP_SECRET`) | **Idéntico** |
| Envío | `POST graph.facebook.com/{v}/{phone_id}/messages` | `POST graph.facebook.com/{v}/<IG_ID o PAGE_ID>/messages` |
| Body de envío | `messaging_product: 'whatsapp'`, `to` = teléfono | `messaging_product: 'instagram'`/`'messenger'`, `to` = IGSID/PSID (o `recipient.id` + `message.text` en Messenger Platform) |
| Webhook entrante | `object: 'whatsapp_business_account'`, `entry[].changes[]` | `object: 'instagram'` | `object: 'page'`, `entry[].messaging[]` |
| Cola / pipeline | BullMQ `inbound-message` → agente → send | **Mismo** pipeline |
| Identidad de cliente | `customerIdentifier` = teléfono | IGSID / PSID (campo genérico ya existe) |
| Dedup / zero-loss | `(businessId, externalMessageId)` | **Mismo** (el `mid` de IG/Messenger es único por mensaje) |

## 3. Datos técnicos de Meta (para implementación)

### Webhook entrante

```jsonc
// Instagram
{ "object": "instagram", "entry": [ { "id": "<IG_ID>", "messaging": [
  { "sender": { "id": "<IGSID>" }, "recipient": { "id": "<IG_ID>" },
    "timestamp": 1569262485349,
    "message": { "mid": "<MESSAGE-ID>", "text": "Hola" } } ] } ] }

// Messenger
{ "object": "page", "entry": [ { "id": "<PAGE_ID>", "messaging": [
  { "sender": { "id": "<PSID>" }, "recipient": { "id": "<PAGE_ID>" },
    "timestamp": 1518479195594,
    "message": { "mid": "<MESSAGE-ID>", "text": "Hola" } } ] } ] }
```

- `message.mid` → `externalMessageId` (idempotencia).
- `sender.id` → `from`; `recipient.id` (IG_ID/PAGE_ID) → `externalAccountId` (resolución de business).
- Filtros: ignorar `message.is_echo` / `is_self` (mensajes que envío el propio negocio). `messaging_postbacks`, `messaging_seen`, `standby` → ignorar v1.
- Permisos del app: `instagram_manage_messages`, `instagram_basic`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`. Requiere App Review + Business Verification + app publicada.

### Envío (respuesta)

- Instagram: `POST /<IG_ID>/messages` con `recipient.id` = IGSID + `message.text` (o `messaging_product: 'instagram'`).
- Messenger: `POST /<PAGE_ID>/messages` con `recipient.id` = PSID + `message.text` (o `messaging_product: 'messenger'`).
- Tokens **page-scoped** (no reutilizar el token de WhatsApp).
- Ventana de respuesta: misma lógica reactiva que WhatsApp (responder dentro de la ventana de servicio).

## 4. Inventario de puntos que bloquean multi-channel (estado actual)

Estos son los "hardcodes" que hay que eliminar antes/para sumar canales:

1. `src/core/use-cases/process-inbound-message.ts:229,279,301` — `channel: 'whatsapp'` hardcodeado en los `TurnContext`.
2. `src/modules/queue/inbound.processor.ts:14` — inyecta `WhatsAppAdapter` **concreto** para responder.
3. `src/modules/dashboard/dashboard.controller.ts:53,176-189` — `sendHumanReply` inyecta `WhatsAppAdapter` concreto.
4. `src/config/queue.config.ts:194` (`InboundMessageJobData`) — sin campo `channel`.
5. `src/modules/channels/whatsapp/whatsapp.controller.ts` — persist+enqueue embebidos en el controller (a triplicar si no se extrae).
6. `src/modules/persistence/postgres/business.repository.ts` — `findByPhoneId` específico de WhatsApp.
7. `prisma/schema.prisma:157` (`enum Channel`) + `src/core/domain/types.ts:13` — falta `INSTAGRAM` / `MESSENGER`.
8. `src/config/env.ts` + `src/config/features.ts` + `src/config/module-registry.ts` — faltan flags y módulos.

**Patrón a seguir:** el mismo del LLM router (2026-08-01): un `ChannelRouterService` + `CHANNEL_PROVIDERS_TOKEN` (map `channel → ChannelProviderPort`), inyectado donde hoy hay adapters concretos. El core no se entera del canal.

## 4b. Refinamiento por auditoría pre-Fase 0 (2026-08-01)

Auditoría de arquitectura (senior/architect) sobre el código real antes de arrancar Fase 0. Veredicto: **la base está lista**, con 4 hallazgos que el plan no contemplaba y 2 decisiones del dueño que cambian el alcance de Fase 0/1.

### Hallazgos nuevos

1. **`send()` es single-tenant de facto** — `whatsapp.adapter.ts:99-122` usa `META_DEV_PHONE_NUMBER_ID` + `META_DEV_ACCESS_TOKEN` (env) e **ignora `businessId`**; la columna `Business.whatsappTokenEncrypted` (schema:26) nunca se lee. El comentario del port ("resuelve credenciales del business internamente") es aspiracional.
2. **`InboundMessageJobData.businessId` es una mentira** — el controller encola `businessId: m.externalAccountId` (el `phone_number_id`, no el UUID del business) (`whatsapp.controller.ts:157`); el processor lo reusa como `externalAccountId` del use case y funciona por accidente.
3. **La cola `agent-run` no existe en runtime** — `QUEUE_NAMES.AGENT_RUN`, `agentRunJobOptions` y `BULLMQ_AGENT_CONCURRENCY` están definidos pero ningún módulo registra la cola; el turno LLM corre síncrono en el worker `inbound-message` (concurrency 10).
4. **FR-5 (agrupación por ventana) no está implementada** — `WEBHOOK_GROUPING_WINDOW_MS` y `inboundMessageJobOptions` existen, pero el controller encola sin `delay` (`whatsapp.controller.ts:153-165`).
5. **Menores** — dos fuentes del tipo `Channel` (union `'whatsapp'` en `core/domain/types.ts:13` vs enum Prisma `WHATSAPP` en `conversation-repository.port.ts:1`); dedup key y `jobId` sin namespace de canal (`idempotency:${externalAccountId}:${externalMessageId}`, colisión IG vs Page teórica); Throttler global 600/min vive en el módulo WhatsApp y el webhook lo salta con `@SkipThrottle()` (no protege nada webhook hoy); el frontend no lee `channel` (badge = 3 páginas + `PendingMonitor`).

### Decisiones del dueño

- **D1 — Credenciales de send: per-business.** Implementar resolución real de credenciales por business (token cifrado AES-GCM por cuenta), en lugar de replicar el patrón env de dev. El router resuelve adapter+cuenta desde `businessId`.
- **D2 — Cola `agent-run`: no extraer.** El turno LLM sigue en el worker `inbound-message`. Corregir docs y config para reflejar la realidad (`BULLMQ_INBOUND_CONCURRENCY`, no `BULLMQ_AGENT_CONCURRENCY`).

### Diseño de cuentas por business (D1)

Modelo normalizado en Prisma, reemplaza a las columnas de WhatsApp embebidas en `Business`:

```prisma
model ChannelAccount {
  id             String   @id @default(uuid()) @db.Uuid
  businessId     String   @map("business_id") @db.Uuid
  channel        Channel
  accountId      String   @map("account_id")          // phone_number_id | IG_ID | PAGE_ID
  tokenEncrypted String   @map("token_encrypted")     // AES-256-GCM con ENCRYPTION_MASTER_KEY
  isPrimary      Boolean  @default(false) @map("is_primary")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  business       Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@unique([channel, accountId])
  @@index([businessId, channel])
  @@map("channel_accounts")
}
```

- Migración: crear tabla → backfill desde `Business.whatsappPhoneId`/`whatsappTokenEncrypted` → deprecar esas columnas (o dejarlas como atajo de lectura para no romper el seed) → `findByChannelAccount(channel, accountId)` en el port, eliminando `findByPhoneId`.
- `send()` del adapter recibe la cuenta (token+accountId) resuelta por el router desde `businessId`, o el adapter hace el lookup vía un `ChannelAccountRepository` — a decidir en Fase 0 (preferido: el router entrega la cuenta al adapter, el adapter sigue sin tocar DB).
- Alternativa más ligera (si el churn de migración pesa): columnas nullable `instagramAccountId`/`messengerPageId` + tokens cifrados en `Business`, espejando el patrón actual. Documentado como opción B.

### Deltas a Fase 0

- Renombrar `InboundMessageJobData.businessId` → `externalAccountId` + añadir `businessId` real (o `businessId?`).
- Namespace de canal en dedup key y `jobId`: `${channel}:${externalAccountId}:${externalMessageId}`.
- Una sola fuente del tipo `Channel` (union de core + mapper a enum Prisma en el repo; quitar `import type { Channel } from '@prisma/client'` del port).
- Nota FR-5: la agrupación por ventana sigue pendiente (deuda preexistente, no bloquea Fase 0).
- Corregir `queue.config.ts` y este doc donde digan que la concurrencia del LLM la gobierna `BULLMQ_AGENT_CONCURRENCY` (es `BULLMQ_INBOUND_CONCURRENCY`).
- **Item 5 acotado (decisión de implementación, 2026-08-01):** Fase 0 entrega el modelo `ChannelAccount` (migración + backfill) y el lookup genérico `findByChannelAccount`, pero la resolución de credenciales en `send()` (token+accountId por `businessId`, D1) **queda diferida a Fase 1**. Motivo: Fase 0 es "sin cambio de comportamiento"; hacer que `send()` deje de usar `META_DEV_*` y lea `ChannelAccount` sí cambia comportamiento. El adapter sigue single-tenant de facto (`whatsapp.adapter.ts:98-140`, hallazgo §4b #1) y `ChannelAccountRepository.findForBusiness` queda como scaffolding sin callers hasta Fase 1.
- **Deuda preexistente anotada (no se toca en Fase 0):** webhook válido sin business mapeado → el use case igual corre el LLM y el processor lanza "no businessId to send", reintentando el job hasta agotar intentos (quema tokens). Fix futuro: short-circuit con `responded:false` cuando `business` es null.
- `InboundMessageJobData.inboundMessageId` ahora es `string | undefined` (era una mentira: el controller mandaba el ID externo cuando no persistía inbound). El processor nunca lo lee (usa `result.inboundMessageId` del use case).

## 5. Plan por fases

### Fase 0 — Refactor multi-channel del core (prerequisito, sin cambio de comportamiento)
1. `Channel` union type: `+ 'instagram' | 'messenger'` (única fuente de verdad; mapper a enum Prisma en el repo).
2. `ChannelRouterService` + `CHANNEL_PROVIDERS_TOKEN` (receta de `LLMRouterService`/`LLMRouterModule`).
3. `channel` en `InboundMessageJobData` y en el input/`TurnContext` de `process-inbound-message`; quitar hardcodes (ver §4).
4. `InboundProcessor` y `DashboardController.sendHumanReply` → dependen del router.
5. Business lookup genérico `findByChannelAccount(channel, accountId)` + modelo `ChannelAccount` (ver §4b D1): migración, backfill y deprecación de `whatsappPhoneId`/`whatsappTokenEncrypted`; `send()` resuelve cuenta+token por business.
6. Renombrar `InboundMessageJobData.businessId` → `externalAccountId` + `businessId` real; namespace de canal en dedup key y `jobId`.
7. Quitar el acoplamiento `@prisma/client` del port `conversation-repository` (una fuente de `Channel`).
8. Mover el Throttler global fuera de `WhatsAppModule` (infra compartida) y corregir `queue.config.ts`/docs sobre `BULLMQ_AGENT_CONCURRENCY` (D2).
9. Specs del router + specs actualizados (`npm run check`).

### Fase 1 — Adapters Instagram + Messenger
7. Parser compartido `meta-webhook.parser.ts` (shape `entry[].messaging[]`) + `InstagramAdapter` y `MessengerAdapter` (mirror del `WhatsAppAdapter`, con HMAC y `send()`).
8. Controllers `webhook/instagram` y `webhook/messenger`; extraer la persist+enqueue a un `ChannelWebhookService` compartido (controllers delgados).
9. `env.ts`: `FEATURE_CHANNEL_INSTAGRAM`, `FEATURE_CHANNEL_MESSENGER` (+ tokens de dev `META_DEV_*` para test, como WhatsApp). Las credenciales de prod (IG_ID/PAGE_ID + token page-scoped) viven en filas `ChannelAccount` por business (D1) — provisión inicial vía seed/endpoint admin.
10. `features.ts` + `module-registry.ts`: flags + módulos + registro en el router.
11. Prisma `enum Channel { INSTAGRAM, MESSENGER }` + migración.
12. Specs + `npm run check`.

### Fase 2 — Frontend (dashboard)
13. Badge de canal en lista/detalle (los DTOs ya exponen `channel`; el send humano ya queda multicanal).
14. Inbox unificado (la estructura actual ya lo soporta).

### Fase 3 — Costo
15. Actualizar `docs/02_AI_CONCEPTS.md §10` con el modelo de costo de IG/Messenger y el cambio de pricing de Meta 2026 (ver §7).

## 6. Desempeño

- **Sin costo extra de desempeño**: el pipeline es idéntico (webhook → BullMQ → agente → send). Lo caro es el turno del LLM y no cambia con el canal.
- Cola `inbound-message` compartida alcanza; concurrencia gobernada por `BULLMQ_INBOUND_CONCURRENCY` (el turno LLM corre en ese worker — ver §4b D2).
- Rate limits de IG/Messenger los absorbe el retry/backoff existente (BullMQ).
- **Prohibido**: scraping / acceso no oficial (baneo de cuenta, ToS, sin webhooks).

## 7. Costo (Meta, 2026)

- **DMs reactivos de Instagram y Messenger son gratis** (responder dentro de la ventana de servicio; sin tope), a diferencia de WhatsApp que cobra templates fuera de ventana. Instagram aún **no** tiene opción pagada para reactivar conversaciones fuera de ventana; Messenger lanzó canal de marketing pagado opt-in en 2026.
- **No hay costo LLM nuevo**: el agente genera una sola respuesta; el canal solo cambia la entrega.
- ⚠️ **Cambios de pricing Meta 2026 que vigilar** (afectan sobre todo a WhatsApp; posible extensión a IG):
  - **2026-10-01**: los "service messages" (respuestas hoy gratis dentro de la ventana) empiezan a cobrarse. Tarifas aún no publicadas (prometen anunciarlas el 2026-09-01).
  - **2026-08-01**: `Meta Business Agent` (IA de Meta) cobra por token ($2/M tokens) — solo aplica si se usa la IA de Meta, no la nuestra.
  - Revisar `MODEL_PRICING`/`docs/02_AI_CONCEPTS.md §10` cuando haya números.

## 8. Ficheros clave

- `src/core/ports/channel-provider.port.ts` — interfaz a implementar por cada canal.
- `src/core/domain/types.ts:13` — union type `Channel`.
- `src/modules/channels/whatsapp/` — plantilla para los nuevos adapters/controllers/modules.
- `src/modules/llm/router/` — patrón a replicar para el channel router.
- `src/config/env.ts` — source of truth de env (agregar flags/tokens aquí).
- `prisma/schema.prisma:157` — enum de canales.

## 9. Verificación

- `npm run check` (typecheck → lint → format → test) antes de cada fase.
- Testear con `META_*` de dev (como WhatsApp: `META_DEV_ACCESS_TOKEN`) contra cuentas de prueba del App Dashboard de Meta.
