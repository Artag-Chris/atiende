# Setup: Meta App + WhatsApp Business API

> Guía paso a paso para crear y configurar la Meta App que Atiende necesita.
> Tiempo estimado: 15-25 minutos.

---

## Prerequisitos 

- [ ] Cuenta personal de Facebook (la usas para login en developers.facebook.com).
- [ ] Acceso a un número de teléfono propio para recibir mensajes de prueba (no tiene que ser un número nuevo — Meta deja agregar hasta 5 testers).
- [ ] **ngrok** o **cloudflared** instalado para exponer `localhost:3000` durante desarrollo (instrucciones al final).
- [ ] El repo de Atiende clonado y con `.env` creado a partir de `.env.example`.

---

## Paso 1 — Crear la Meta App

1. Ve a **https://developers.facebook.com/apps**
2. Click **"Create App"** (botón verde arriba a la derecha).
3. **Use case:** selecciona **"Other"** → continue.
4. **App type:** selecciona **"Business"** → next.
5. **App details:**
   - **App name:** `Atiende Platform` (o el que prefieras — solo es para tu consola).
   - **App contact email:** tu email.
   - **Business account:** déjalo en blanco si no tienes Business Manager (después lo creas).
6. Click **Create app**.

✅ Ya tienes tu app. Toma nota del **App ID** (lo verás en la URL: `/apps/<APP_ID>/dashboard/`).

---

## Paso 2 — Obtener App Secret

1. En la app, en el menú izquierdo: **App settings → Basic**.
2. **App Secret:** click **Show** → autenticación con tu password de Facebook.
3. **Copia ese valor.** Lo necesitas para `META_APP_SECRET` en `.env`.

⚠️ **Importante:** este secret es como una contraseña. **Nunca** lo subas a Git ni lo pongas en código.

---

## Paso 3 — Agregar producto WhatsApp

1. En el dashboard de la app, scroll hasta **"Add products to your app"**.
2. Encuentra **WhatsApp** → click **"Set up"**.
3. Meta te pide vincular o crear una **Meta Business Account**:
   - Si ya tienes una (de otra empresa), selecciónala.
   - Si no, click **"Create a Meta Business Account"** y dale un nombre (ej: "Atiende SAS").
4. Acepta los términos.

Una vez configurado, te aparecerá la sección **WhatsApp** en el menú izquierdo.

---

## Paso 4 — Obtener Phone Number ID y Access Token de prueba

Meta te regala un **test number** gratis para desarrollo (no real, solo para probar). Y un token temporal de 24h.

1. Menú izquierdo: **WhatsApp → API Setup** (o "Getting Started").
2. En esa pantalla verás:
   - **Test number** (algo como `+1 555 123 4567`) — este es **From** cuando envías mensajes.
   - **Phone number ID** (un número largo, copia esto a `META_DEV_PHONE_NUMBER_ID`).
   - **WhatsApp Business Account ID** (opcional para v1, lo necesitarás en v2 para templates).
   - **Temporary access token** (válido 24h — copia a `META_DEV_ACCESS_TOKEN`).
3. **Agrega tu número personal como tester:**
   - Sección **"To"** → click el dropdown → **"Manage phone number list"** → agrega tu número con formato internacional (`+57 320 ...`).
   - Te llega un código a WhatsApp para verificar.

✅ Con esto puedes enviar mensajes desde tu app a TU número personal usando el test number como remitente.

---

## Paso 5 — Generar Verify Token (lo inventas tú)

Esto es un string arbitrario que Meta enviará en el webhook de verificación. **Genéralo y guárdalo en `.env`**:

```bash
# Genera un token aleatorio seguro:
openssl rand -hex 32
# Output: a1b2c3d4...  (64 chars hex)
```

Cópialo a `META_WEBHOOK_VERIFY_TOKEN` en `.env`.

⚠️ Tiene que coincidir **exactamente** entre lo que pongas en `.env` y lo que configures en la consola de Meta (Paso 7).

---

## Paso 6 — Exponer tu localhost a internet (ngrok o cloudflared)

Meta requiere webhook URL **HTTPS pública**. No acepta `http://localhost` ni IPs privadas.

### Opción A — ngrok (más simple)

```bash
# Instalar (Windows con choco, o descargar de ngrok.com)
choco install ngrok

# Registrarse en ngrok.com (gratis) y obtener un authtoken.
ngrok config add-authtoken <tu-authtoken>

# Levantar el túnel apuntando al puerto donde corre Atiende
ngrok http 3000
```

Te da una URL tipo: `https://abc123-xyz.ngrok-free.app`. **Esa es tu webhook URL.**

⚠️ Free tier de ngrok cambia la URL en cada reinicio. Si vas a parar/arrancar muchas veces, paga ngrok ($8/mes) o usa cloudflared.

### Opción B — cloudflared (gratis, URL persistente con cuenta de Cloudflare)

```bash
# Instalar
choco install cloudflared

# Login (te abre browser para autorizar)
cloudflared tunnel login

# Crear un túnel con nombre
cloudflared tunnel create atiende-dev

# Apuntar a localhost:3000
cloudflared tunnel --url http://localhost:3000
```

Te da una URL tipo: `https://atiende-dev.trycloudflare.com`. Más estable que ngrok.

---

## Paso 7 — Configurar webhook en Meta

1. En la consola de Meta: **WhatsApp → Configuration**.
2. Sección **"Webhook"** → click **Edit**.
3. **Callback URL:** `https://tu-url-ngrok-o-cloudflared/webhooks/whatsapp` (ajusta el path según tu router NestJS).
4. **Verify token:** el mismo string que pusiste en `META_WEBHOOK_VERIFY_TOKEN`.
5. Click **Verify and save**.

Meta hace un GET a tu URL con `?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`. Tu app debe responder con `hub.challenge` como text plain. **Si esto falla, revisar:**
- La URL es accesible públicamente (curl desde otra máquina).
- El verify token coincide exacto.
- Atiende está corriendo localmente.

6. Una vez verificado, **suscríbete a campos**:
   - Click **Manage** en "Webhook fields".
   - **Subscribe** a `messages` (incluye textos, imágenes, audios, status).

✅ Listo. Ahora cuando alguien mande un mensaje al test number, Meta hace POST a tu webhook.

---

## Paso 8 — Verificar end-to-end

Una vez que Atiende esté corriendo y el webhook configurado:

```bash
# Desde tu WhatsApp personal, envía "hola" al test number de Meta.
# En los logs de Atiende deberías ver:
#   [WebhookController] Received message from +57XXX...
#   [InboundMessage] Persisted msg_123
#   [Worker] Processing inbound-message job ...
```

Si llega el mensaje a la DB pero el agente no responde, revisa:
- BullMQ workers están corriendo (`npm run start:dev` los arranca).
- `META_DEV_ACCESS_TOKEN` no expiró (válido 24h en dev).

---

## Para producción (cuando llegue ese momento)

Lo de arriba es **solo desarrollo** con un test number. Para prod necesitas:

1. **Business Verification** — Meta verifica que tu empresa es real (puede tardar días).
2. **Display Name approval** — el nombre que ve el cliente final.
3. **System User Access Token** (permanente, no 24h) — generado desde Business Manager.
4. **Phone Number production** — tu propio número o el del business cliente, verificado por Meta.
5. **Webhook URL en dominio propio** — no ngrok/cloudflared sino tu deploy real (Railway, Fly, etc.).

En multi-tenant (Atiende v1), **cada business onboardea su propio token** vía un flujo OAuth de Meta (Embedded Signup) o subiéndolo manual desde el dashboard. Esos tokens se guardan encriptados en `businesses.whatsapp_token_encrypted`.

---

## Variables resultantes en `.env`

Después de este setup:

```bash
META_APP_ID=1234567890123456                          # Paso 1
META_APP_SECRET=abc123def456...                       # Paso 2
META_WEBHOOK_VERIFY_TOKEN=a1b2c3d4...                 # Paso 5
META_GRAPH_API_VERSION=v21.0                          # default OK
META_DEV_PHONE_NUMBER_ID=987654321987654              # Paso 4
META_DEV_ACCESS_TOKEN=EAABwzLix...                    # Paso 4 (regenerar cada 24h en dev)
```

---

## Troubleshooting

| Problema | Causa probable | Solución |
|---|---|---|
| "Webhook verification failed" | Verify token no coincide | Re-copiar exactamente en `.env` y en consola Meta |
| 401 al enviar mensaje | Token expiró (dev = 24h) | Regenerar en "API Setup" → copiar nuevo `META_DEV_ACCESS_TOKEN` |
| Mensaje no llega al webhook | URL no expuesta o número no agregado como tester | Verificar ngrok activo + tu número en "Manage phone number list" |
| 100 error: app no en modo dev | Modo de la app | Ir a App Mode → asegurar "Development" mientras pruebas |
| Firma HMAC inválida en logs | App secret incorrecto | Re-copiar app secret (cuidado con espacios/saltos al pegar) |

---

## Recursos oficiales

- WhatsApp Business Platform Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
- API Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference
- Webhook signatures: https://developers.facebook.com/docs/messenger-platform/webhooks#validate-payloads
