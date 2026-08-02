# Entrega: Variables de Instagram DM + Messenger para producción

> **Qué necesito que me entregues** para poner Instagram y Messenger en marcha,
> y **dónde** va cada valor (`.env` o `channel_accounts` en DB).
>
> Complementa a [SETUP_META_INSTAGRAM_MESSENGER.md](./SETUP_META_INSTAGRAM_MESSENGER.md)
> (cómo conectar la app) — este documento es el checklist de **valores** que
> necesito de ti, con los pasos para capturarlos.

---

## 1. Resumen rápido (si ya sabes dónde está todo)

Necesito estos **6 valores**:

| # | Variable | Dónde la usamos | ¿Obligatoria? |
|---|---|---|---|
| 1 | `META_APP_ID` | `.env` (ya existe para WhatsApp) | Sí |
| 2 | `META_APP_SECRET` | `.env` (ya existe) | Sí |
| 3 | `META_WEBHOOK_VERIFY_TOKEN` | `.env` (ya existe) | Sí |
| 4 | **Page ID** (`PAGE_ID`) | `channel_accounts` (seed) | Sí |
| 5 | **IG Business ID** (`IGID`) | `channel_accounts` (seed) | Sí (para IG) |
| 6 | **Page Access Token** (`PAT`) | `channel_accounts` (seed, cifrado) | Sí |

Los valores 1–3 **ya los tienes** del setup de WhatsApp (misma app de Meta).
Lo **nuevo** que necesito son: **Page ID**, **IGID** y el **Page Access Token**.

---

## 2. Cómo capturar cada valor (paso a paso)

### 2.1 `META_APP_ID` y `META_APP_SECRET`

Ya configurados en el `.env` del server (vienen del setup de WhatsApp).
Solo confirma que sigan vigentes: *App Dashboard → Settings → Basic*.

### 2.2 `META_WEBHOOK_VERIFY_TOKEN`

Ya configurado. Es el string que pusimos en los webhooks de WhatsApp.
**Los webhooks de Instagram y Messenger usarán el MISMO** verify token.

### 2.3 Page ID (para Messenger)

**Dónde:** *Meta Business Suite → Settings → Business assets → Pages* → click en la Página → **Page ID** (numérico, tipo `10987654321`).

Alternativa: Página en Facebook → *About → Page transparency → Page ID*.

### 2.4 IG Business ID — IGID (para Instagram)

> ⚠️ **No es el @usuario** — es el ID numérico del business en IG
> (formato `1784...`).

**Dónde:** *Graph API Explorer* (developers.facebook.com/tools/explorer) con un token de la Página:
```
GET /{page-id}?fields=instagram_business_account
```
→ en la respuesta, el campo `id` es el **IGID**.

### 2.5 Tokens (uno por canal — ¡no son el mismo!)

> ⚠️ **Importante:** Instagram y Messenger usan tokens DISTINTOS.
> - **Messenger** → Page Access Token (`EAAG...`/`EAA...`) de `graph.facebook.com`.
> - **Instagram** → IG Access Token (`IGAA...`) de `graph.instagram.com`
>   (se genera en la app de Instagram: *Instagram → API Setup → Generar token*,
>   junto a la cuenta de IG conectada).

**Para Messenger (Page Access Token):**
1. *Meta Business Settings → Users → System Users* → asígnale la Página con **Full control**.
2. *Generate New Token* → scopes: `pages_messaging`, `pages_show_list`, `pages_manage_metadata`.
3. Copia el token (`EAAG...`).

**Para Instagram (IG Access Token):**
1. En la app de Meta **LumenXlabs-IG** (la del secret `8c50a8...`): *Instagram → API Setup*.
2. En la fila de la cuenta `lumenxlabs` → **Generar token** (o el flujo de la API de Instagram).
3. Copia el token (`IGAA...`).

---

## 3. Checklist de entrega (lo que te pido)

- [ ] **Page ID** (número de la Página)
- [ ] **IGID** (IG Business ID, `1784...`)
- [ ] **IG Access Token** (`IGAA...`) para Instagram (graph.instagram.com)
- [ ] **Page Access Token** (`EAAG...`) para Messenger
- [ ] Confirmación de que **`META_APP_SECRET`** sigue siendo el mismo del `.env`
- [ ] Confirmación de que **`META_WEBHOOK_VERIFY_TOKEN`** es el mismo
- [ ] (Opcional) **IG_ID y Page ID de prueba** si quieres dev single-tenant

---

## 4. Dónde va cada valor

### 4.1 En `.env` (server remoto) — variables nuevas

```bash
# Feature flags (los canales se apagan con false)
FEATURE_CHANNEL_INSTAGRAM=true
FEATURE_CHANNEL_MESSENGER=true

# En producción multi-tenant NO se usan (quedan vacíos)
META_DEV_IG_ID=
META_DEV_IG_TOKEN=
META_DEV_PAGE_ID=
META_DEV_PAGE_TOKEN=
```

Los valores 1–3 (`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`)
ya están en el `.env`.

### 4.2 En la DB (`channel_accounts`) — credenciales por business

El **Page Access Token** NO va en `.env` (producción): va **cifrado** en la tabla
`channel_accounts` por business. Se carga con el seed:

```bash
# Cargar env del .env (PowerShell en Windows)
Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#].*?)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) } }

# Instagram (business ya existente en la DB)
npx tsx prisma/seed-channel-accounts.ts instagram <IGID> <PAT> --primary

# Messenger
npx tsx prisma/seed-channel-accounts.ts messenger <PAGE_ID> <PAT>
```

- `--primary` marca la cuenta principal del canal para ese business.
- Si omites `businessId`, usa el **primer business** de la tabla.
- Requiere `ENCRYPTION_MASTER_KEY` (32 bytes base64) y `DATABASE_URL` en el entorno.

> ⚠️ **Seguridad:** el PAT se guarda cifrado con AES-256-GCM
> (`ENCRYPTION_MASTER_KEY`). Nunca lo pegues en `.env`, logs ni Git.

---

## 5. Verificación end-to-end (después de cargar)

1. App de Meta en **modo Live** (para recibir webhooks de producción).
2. Túnel/dev: `npm run start:dev`; prod: el deploy con webhooks configurados.
3. En el App Dashboard: **Instagram → Webhooks** y **Messenger → Webhooks**,
   con la **misma Callback URL** base y el verify token.
4. Envía un DM al IG profesional / a la Página. En logs de Atiende:
   ```
   Inbound webhook received (instagram|messenger)
   Parsed 1 message(s) from webhook
   Webhook processed 1 message(s): persisted=1 enqueued=1
   ... Agent responded: "..."
   Response sent to <IGSID|PSID> via instagram|messenger
   ```

---

## 6. Para producción (lo que te asegura el setup)

- **Business Verification** de Meta (obligatoria para Advanced Access).
- **App Review** con scopes: `instagram_basic`, `instagram_manage_messages`,
  `pages_messaging`, `pages_read_engagement`, `pages_show_list`,
  `pages_manage_metadata`.
- **Token permanente** de System User (sección 2.5), guardado cifrado por business.
- El **onboarding multi-tenant** a futuro será OAuth de Meta (Business Login for
  Instagram / Facebook Login for Business) — el seed de §4.2 es el puente dev
  hasta que exista.

---

## 7. Troubleshooting rápido

| Síntoma | Causa probable | Solución |
|---|---|---|
| Webhook verification failed | Verify token no coincide | Re-copiar exacto en consola y `.env` |
| No llega ningún webhook | App en Development / toggle "Connected tools" OFF / sin tester | App en Live; activar Connected tools en IG; agregar cuenta como tester |
| 400 "invalid token" al enviar | PAT expirado o sin scope de mensajería | Regenerar PAT con `instagram_manage_messages` + `pages_messaging` |
| 10/not authorized | Falta rol en la Página o permisos no aprobados | Rol MODERATE+ en la Página; App Review en prod |
| Envío cae al token dev ("Failed to decrypt token") | Token en DB corrupto o key distinta | Re-seed del account con el PAT correcto (§4.2) |
| "No business found" | `recipient.id` del webhook ≠ `account_id` guardado | Para IG asegurar `accountId` = IGID (`1784...`), para Messenger = Page ID |
