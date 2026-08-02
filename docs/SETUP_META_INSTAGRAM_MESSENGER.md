# Setup: Instagram DM + Facebook Messenger (Meta Messenger Platform)

> Guía de "dónde y cómo" configurar **Instagram DM** y **Facebook Messenger** en
> tu app de Meta, y cómo conectarlos a Atiende.
>
> Asume que ya seguiste [SETUP_META.md](./SETUP_META.md) (la Meta App base con
> WhatsApp ya existe y tienes `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` y
> un túnel ngrok/cloudflared). Estos dos canales **reutilizan esa misma app**:
> mismo app secret, mismo verify token, mismo host `graph.facebook.com`.

---

## 1. Requisitos

- [ ] **Instagram Profesional** (Business/Creator) vinculado a una **Página de Facebook**.
      (Meta exige la Página: el tráfico de IG pasa por los permisos de la Página.)
      - Si no tienes Página: créala en `facebook.com/pages/creation`.
      - Vincula: **Meta Business Suite** → *Settings → Business assets → Instagram accounts* → **Add** → conectar tu cuenta de IG → elegir la Página.
- [ ] Tu cuenta de Facebook con rol **MODERATE** o superior en esa Página (para tokens y webhooks).
- [ ] Tu app de Meta creada y en modo **Development** (mientras pruebas).
- [ ] El túnel público activo (ngrok/cloudflared) apuntando a `localhost:3000`.
- [ ] Atiende corriendo (`npm run start:dev`) con `.env` completo.

---

## 2. Agregar los productos a la app de Meta

**Dónde:** https://developers.facebook.com/apps → tu app (`Atiende Platform`) →
**Add Products** (o menú izquierdo).

1. **Instagram** → **Set up** (agrega el producto *Instagram*).
2. **Messenger** → **Set up** (agrega el producto *Messenger*).

Ambos productos quedan en el menú izquierdo del App Dashboard. **No crees una
app nueva**: usa la misma de WhatsApp.

---

## 3. Activar el mensajeo de IG (toggle "Connected tools")

**Dónde:** en la app de Instagram (móvil o web), sección de **mensajes**.
Instagram exige que la cuenta permita "herramientas conectadas".

- Ajustes de mensajes → activa **"Connected tools"** (Herramientas conectadas).
- Sin este toggle, Meta no entrega webhooks de IG y el envío por API falla.

Para Messenger no hay toggle extra: la Página ya acepta mensajes de la bandeja.

---

## 4. Conseguir los IDs y el token (los 4 valores)

| Valor | Qué es | Dónde conseguirlo |
|---|---|---|
| **Page ID** | ID numérico de la Página de Facebook | *Meta Business Suite* → *Settings → Business assets → Pages* → click en la Página → ID numérico. O: Página en FB → *About → Page transparency* → *Page ID*. |
| **IG Business ID (IGID)** | ID del negocio en IG (formato `1784...`), **distinto** del @usuario | *Graph API Explorer* (developers.facebook.com/tools/explorer) con token de la Página: `GET /{page-id}?fields=instagram_business_account` → campo `id`. |
| **Customer IGSID / PSID** | ID del cliente que te escribe (IGSID en IG, PSID en Messenger). **No lo configuras**: llega en cada webhook como `sender.id`. | Aparece en el payload del webhook (ver §8). |
| **Page Access Token (PAT)** | Token de la Página con scopes de mensajería | Ver abajo (§4.1). **Mismo token sirve para IG y Messenger** (ambos son de la Página). |

> Para Atiende necesitas guardar: `accountId` = **IGID** (Instagram) o
> **Page ID** (Messenger), y el **PAT** (token). El `recipient.id` de los
> webhooks de IG coincide con el IGID, así que la resolución del business
> funciona sin mapeos extra.

### 4.1 Generar el Page Access Token (2 opciones)

**Opción A — Token permanente de System User (recomendado para dev y prod):**
1. *Meta Business Settings* (business.facebook.com) → **Users → System Users**.
2. Crea un system user (o usa uno existente) y asígnale la **Página** con *Full control* (Assigned Assets).
3. **Generate New Token** → elige tu app de Meta → *Expiration: Never*.
4. Marca estos scopes:
   - `pages_show_list`
   - `pages_messaging`
   - `pages_manage_metadata`
   - `instagram_basic`
   - `instagram_manage_messages`
5. **Generate Token** → cópialo YA (Meta no lo muestra de nuevo).

**Opción B — Token de Página vía Graph API Explorer (rápido, expira):**
1. *Graph API Explorer* → tu app → **Get Token** → permisos: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `instagram_basic`, `instagram_manage_messages`.
2. `GET /me/accounts` → copia el `access_token` de tu Página (token de Página, válido ~60 días si tu user token es long-lived, o 1 hora si es short-lived).

---

## 5. Configurar los webhooks en el App Dashboard

**Dónde:** App Dashboard → producto **Instagram** → *Webhooks* → **Configure**
(por defecto suscribes los topics de Instagram). Para Messenger:
producto **Messenger** → *Settings* → *Webhooks* (o la sección "Messenger →
Instagram Settings" / "Webhooks" del dashboard, según versión de la consola).

| Canal | Callback URL (con túnel) | Verify Token | Suscribir a |
|---|---|---|---|
| Instagram | `https://<tu-url-ngrok-o-cloudflared>/webhook/instagram` | el mismo `META_WEBHOOK_VERIFY_TOKEN` | **`messages`** (obligatorio) + opcionales `messaging_postbacks`, `message_reactions`, `messaging_seen` |
| Messenger | `https://<tu-url-ngrok-o-cloudflared>/webhook/messenger` | el mismo `META_WEBHOOK_VERIFY_TOKEN` | **`messages`** (obligatorio) |

Pasos (para cada canal):
1. **Configure / Edit subscription** → pega la Callback URL y el Verify Token.
2. Meta hace un `GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`; Atiende responde con el challenge. Si da error, revisa que el túnel esté activo y el token coincida **exacto**.
3. **Manage** → suscríbete a `messages`.
4. La app debe estar **Live** (modo Live en el App Dashboard) para recibir webhooks en general; en **Development** solo recibes eventos de cuentas con rol en la app (para pruebas agrega a tu IG/Página como tester en *App Roles → Roles*).

---

## 6. Variables en `.env`

```bash
# Flags (sección canales)
FEATURE_CHANNEL_INSTAGRAM=true
FEATURE_CHANNEL_MESSENGER=true

# Dev single-tenant (solo para probar sin seed de DB)
META_DEV_IG_ID=178414...            # IGID de la cuenta de prueba
META_DEV_IG_TOKEN=IGAA...           # IG Access Token (graph.instagram.com, NO EAAG)
META_DEV_PAGE_ID=10987654321        # Page ID de la Página de prueba
META_DEV_PAGE_TOKEN=EAAG...         # PAT de la Página (para Messenger)
```

En **producción multi-tenant**, las credenciales por business se guardan en
`channel_accounts` cifradas (sección 7); las `META_DEV_*` no se usan (si están
ausentes, el envío con cuenta provisionada funciona normal).

---

## 7. Provisionar la cuenta del business (cifrada en DB)

El token se guarda **cifrado** (AES-256-GCM con `ENCRYPTION_MASTER_KEY`,
formato `iv:tag:ciphertext`). Usa el seed:

```bash
# Cargar env del .env (PowerShell)
Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#].*?)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) } }

npx tsx prisma/seed-channel-accounts.ts instagram <IGID> <PAT> --primary
npx tsx prisma/seed-channel-accounts.ts messenger <PAGE_ID> <PAT>
```

- `--primary` marca la cuenta primaria del canal de ese business (el envío
  usa la primaria; si un business tiene varias, el router usa la primera).
- Si omites `businessId` usa el primer business de la tabla.
- Requiere `ENCRYPTION_MASTER_KEY` y `DATABASE_URL` en el entorno.

---

## 8. Probar de punta a punta

1. Atiende corriendo + túnel activo + flags en `true`.
2. Desde otra cuenta (o la que hayas agregado como tester) envía **un DM** al IG profesional / a la Página.
3. En logs de Atiende deberías ver:
   ```
   Inbound webhook received (instagram|messenger)
   Parsed 1 message(s) from webhook
   Webhook processed 1 message(s): persisted=1 enqueued=1
   ... Agent responded: "..."
   Response sent to <IGSID|PSID> via instagram|messenger
   ```
4. El cliente recibe la respuesta dentro de la ventana de 24h (IG/Messenger
   responden gratis en ventana).

---

## 9. Para producción

- **Business Verification** de tu empresa en Meta (obligatoria para Advanced Access).
- **App Review**: solicita aprobación para `instagram_basic` y `instagram_manage_messages` (y `pages_messaging`, `pages_read_engagement`, `pages_show_list`, `pages_manage_metadata`).
- App en modo **Live**.
- **Token permanente** de System User (sección 4.1) guardado cifrado por business — nunca en `.env` ni en código.
- Onboarding multi-tenant a futuro: implementar **Business Login for Instagram** / **Facebook Login for Business** para que cada business conecte su IG/Página y Atiende capture el token sin pegado manual (el seed de §7 es el puente dev).

---

## 10. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| Webhook verification failed | Verify token no coincide | Re-copiar exacto en consola y `.env` |
| No llega ningún webhook | App en Development sin tester / toggle Connected tools OFF / app no Live | Agregar cuenta en App Roles; activar Connected tools (§3); poner app en Live |
| 400 al enviar ("invalid token" / error 190) | Token expirado o sin scope de mensajería | Regenerar PAT con `instagram_manage_messages` y `pages_messaging` |
| 10/not authorized | Falta rol en la Página o permisos no aprobados | Rol MODERATE+ en la Página; App Review en prod |
| Envío cae al token dev (warn "Failed to decrypt token") | Token en DB corrupto o key distinta | Re-seed del account con el PAT correcto (§7) |
| Business no resuelto ("No business found") | `recipient.id` del webhook ≠ `account_id` guardado | Para IG asegurar que `accountId` = IGID (`1784...`), para Messenger = Page ID |
| Respuesta no sale | Vencida la ventana de 24h o conversación escalada | Responder dentro de ventana; ver estado de la conversación en el dashboard |

---

## 11. Mapa del código (dónde vive cada pieza)

| Pieza | Ruta |
|---|---|
| Webhook IG | `POST /webhook/instagram` → `src/modules/channels/instagram/instagram.controller.ts` |
| Webhook Messenger | `POST /webhook/messenger` → `src/modules/channels/messenger/messenger.controller.ts` |
| Base de webhook (verify + firma + pipeline) | `src/modules/channels/meta/meta-webhook.controller.ts` |
| Parser compartido `entry[].messaging[]` | `src/modules/channels/meta/meta-webhook.parser.ts` |
| Envío IG/Messenger | `src/modules/channels/meta/meta-messaging.adapter.ts` (+ subclases `instagram.adapter.ts`, `messenger.adapter.ts`) |
| Persist + dedup + enqueue compartido | `src/modules/channels/webhook/channel-webhook.service.ts` |
| Resolución de cuenta por business (D1) | `src/modules/channels/router/channel-router.service.ts` |
| Modelo `channel_accounts` | `prisma/schema.prisma` (`ChannelAccount`) |
| Seed de cuentas | `prisma/seed-channel-accounts.ts` (`npm run prisma:seed:channels`) |
| Flags / env | `src/config/env.ts`, `src/config/features.ts`, `src/config/module-registry.ts` |

---

## Recursos oficiales

- Instagram Messaging (Messenger Platform) — Getting Started: https://developers.facebook.com/docs/messenger-platform/instagram/get-started/
- Webhooks de IG Messaging (shape `entry[].messaging[]`): https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/
- Envío de mensaje (recipient + message): https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message/
- Messenger Platform Overview: https://developers.facebook.com/docs/messenger-platform/
