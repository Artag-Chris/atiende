# 03 — Roadmap de 4-6 semanas

> Plan ejecutable para construir Atiende v1. Cada semana tiene **entregables verificables**. No pasamos de semana sin terminar lo crítico de la anterior.

**Fecha de inicio:** 2026-05-21
**Fecha objetivo v1 launch:** 2026-07-02 (6 semanas)

---

## Filosofía del plan

- **Cada semana entrega algo demostrable.** Si la semana 1 no tiene algo que mostrar, algo está mal.
- **Vertical slices.** No construimos toda la DB y luego toda la API y luego el frontend. Construimos un flujo end-to-end pequeño y lo ampliamos.
- **AI-driven desde día 1.** Claude Code es el entorno principal. Subagentes, hooks y MCPs configurados desde la semana 1.
- **Eval-first para features de IA.** Antes de tocar prompts productivos, hay eval set.
- **Métricas desde el primer turno real.** No esperamos a "estar listos" para instrumentar.

---

## Semana 1 — Foundation (2026-05-21 → 2026-05-27)

**Objetivo:** repo funcional, WhatsApp recibiendo mensajes, primer echo response.

### Entregables

- [ ] **Repo en GitHub público** con README profesional y badges (build, license).
- [ ] **CLAUDE.md** en la raíz con: estructura, comandos, convenciones, cómo correr en local.
- [ ] **NestJS skeleton** con módulos: `webhook`, `messages`, `businesses`, `agent`.
- [ ] **Prisma schema v1** (businesses, conversations, messages, agent_runs).
- [ ] **PostgreSQL local** corriendo (Docker compose), migraciones aplicadas.
- [ ] **Redis local** corriendo, BullMQ conectado.
- [ ] **Webhook receiver** que valida firma de Meta, persiste mensaje, encola job.
- [ ] **Echo response funcionando:** un mensaje entrante a WhatsApp dispara una respuesta "Recibí: {tu mensaje}". Sin IA aún.
- [ ] **Tests unitarios** del webhook receiver + ngrok configurado para testing local con Meta.
- [ ] **Claude Code configurado:** `.claude/` con MCPs útiles, hooks, subagentes.

### AI-driven dev en esta semana

- Usar Claude Code para generar el scaffolding inicial con `claude-init`.
- Subagent `db-migrations` para diseñar el schema inicial.
- Configurar hook `pre-commit` con tests.

### Riesgos / unknowns

- Acceso a WhatsApp Business API (cuenta de Meta dev, número de prueba). **Mitigación:** crear cuenta el día 1, hay que esperar verificación.
- Validación de webhook signature — siempre tricky. Tener tests con payloads reales de Meta.

---

## Semana 2 — Agente básico + Tool Use (2026-05-28 → 2026-06-03)

**Objetivo:** el agente responde a mensajes simples usando Claude + 2 tools básicas.

### Entregables

- [ ] **Integración Anthropic SDK** en NestJS.
- [ ] **Tool runner** funcionando con Claude Opus 4.7.
- [ ] **System prompt v0** con `cache_control` configurado.
- [ ] **Tools implementadas (mock data inicialmente):**
  - `get_business_info(topic)` — devuelve horarios, ubicación (hardcoded).
  - `escalate_to_human(reason)` — marca la conversación, no notifica aún.
- [ ] **Loop end-to-end funcionando:** cliente manda mensaje → agente responde con texto generado por Claude → respuesta llega a WhatsApp.
- [ ] **Persistencia de turnos:** cada `agent_run` se guarda con tokens, latencia, costo.
- [ ] **Tests:** unit tests de cada tool + tests de integración del flow completo (mock de Anthropic).
- [ ] **Métricas v0:** logs estructurados con `usage` de cada response.

### AI-driven dev

- Subagent `prompt-reviewer` configurado.
- Mientras escribimos las tools, validar con Claude Code que las descripciones son claras.

### Definición de "done"

- [ ] Yo (Christian) puedo mandar un mensaje al número de prueba y recibir respuesta natural.
- [ ] El costo por mensaje aparece en los logs.
- [ ] La conversación se guarda en DB.

---

## Semana 3 — RAG (2026-06-04 → 2026-06-10)

**Objetivo:** el agente conoce el catálogo del business via búsqueda semántica.

### Entregables

- [ ] **`pgvector` instalado** y extension habilitada en Postgres.
- [ ] **Tabla `product_embeddings`** con índice HNSW.
- [ ] **Servicio de embeddings** (OpenAI o Voyage AI) integrado.
- [ ] **Ingestión de catálogo:** comando CLI que toma CSV y lo carga + genera embeddings.
- [ ] **Catálogo seed:** un catálogo real de prueba (puede ser ficticio, ~50 productos).
- [ ] **Tools nuevas:**
  - `search_catalog(query)` — búsqueda semántica.
  - `get_product(product_id)` — detalle.
- [ ] **System prompt v1** ajustado para usar las tools de catálogo.
- [ ] **End-to-end:** "tienes algo rojo?" → search_catalog → respuesta con productos reales.
- [ ] **Tests:** retrieval calidad — input → expected top-K.
- [ ] **Decisión documentada de modelo de embeddings** (OpenAI vs Voyage) basada en pruebas reales.

### AI-driven dev

- Pedir a Claude Code que genere variaciones de queries para testing del catálogo.
- Subagent `eval-runner` configurado (aunque eval set llega semana 4).

### Definición de "done"

- [ ] El agente NUNCA devuelve un precio que no exista en la DB.
- [ ] Retrieval funciona con typos, sinónimos y queries vagas.

---

## Semana 4 — Multi-tenant + Orders + Dashboard + Knowledge ingestion + Exact cache (2026-06-11 → 2026-06-17)

**Objetivo:** sistema soporta múltiples businesses; agente crea órdenes; dashboard web mínimo; cache exacto operativo; **knowledge ingestion funcional (FAQs, PDFs, políticas)**.

### Entregables

- [ ] **Multi-tenant:** todas las queries scoped por `business_id`, system prompt parametrizable por business.
- [ ] **Tool `create_order`** funcional — crea orden en estado pendiente, devuelve ID.
- [ ] **Onboarding manual de business:** seeder/CLI para crear un business nuevo con su catálogo.
- [ ] **Exact response cache (capa 3)** en Redis con BullMQ ya integrado — barato de agregar (key = `sha256(query+businessId)`, TTL 30min).
- [ ] **Knowledge ingestion (FR-22..26, arch §14):**
  - `DocumentExtractorPort` + adapters: `pdf-text` (pdf-parse), `csv`, `excel`, `markdown`, `form`.
  - `ChunkerPort` + `FixedSizeChunker` (500 tokens, 50 overlap).
  - `KnowledgeIndexer` worker en queue `KNOWLEDGE_INDEXING`.
  - Tool `search_knowledge(query, kind?)` en `src/modules/tools/knowledge/`.
  - Endpoint `POST /api/businesses/:id/knowledge` para upload desde dashboard.
- [x] **Dashboard Next.js v0:**
  - Login con magic link.
  - Lista de conversaciones del business.
  - Detalle de conversación.
  - Métricas básicas (mensajes hoy, costo hoy).
  - **Sección "Conocimiento"** — upload de PDFs / FAQs / políticas con status visible (`PENDING → INDEXED | FAILED`).
- [x] **Human takeover:** responder al cliente desde el dashboard (`POST /api/dashboard/conversations/:id/send`, rol `HUMAN`, solo `ESCALATED`) + resolver (`POST .../resolve`). La IA queda muda mientras la conversación está escalada y retoma al resolver o al expirar la escalación.
- [x] **Expiración automática de escalaciones:** `MaintenanceModule` (BullMQ repeatable cada `ESCALATION_EXPIRY_INTERVAL_HOURS`) pasa a `ACTIVE` las escalaciones inactivas > `ESCALATION_EXPIRY_HOURS` desde `lastMessageAt`.
- [ ] **Notificación de escalamiento:** cuando `escalate_to_human` se llama, dashboard muestra alerta + opcionalmente email.

### AI-driven dev

- Frontend con shadcn/ui — pedir a Claude Code que genere componentes a partir de prompts.

### Definición de "done"

- [ ] Yo creo un business de prueba, cargo catálogo, conecto WhatsApp, y un cliente puede ordenar conversacionalmente.
- [ ] El dashboard muestra esa orden en tiempo real.

---

## Semana 5 — Evals + Hardening + Caching multinivel (2026-06-18 → 2026-06-24)

**Objetivo:** suite de evals corriendo, calidad medida, costos optimizados, **semantic cache live**.

### Entregables

- [ ] **Eval set v1:** 50 conversaciones cubriendo todas las categorías (ver [02_AI_CONCEPTS.md §13](02_AI_CONCEPTS.md#13-evals)).
- [ ] **Eval runner:** corre la suite, reporta accuracy por categoría, costo, latencia.
- [ ] **CI integration:** evals corren en cada PR a main.
- [ ] **Baseline metrics establecidas:** accuracy actual, costo/conv, latencia p95.
- [ ] **Semantic cache (capa 2) implementado** — `ResponseCachePort` + `PgvectorSemanticCacheAdapter` con safety rails (ver [01_ARCHITECTURE.md §12](01_ARCHITECTURE.md#12-caching-multinivel-para-ahorro-de-costos)).
  - Threshold 0.95, TTL 30min, bypass para tools de estado.
  - Eval set específico que verifica que el cache NO falla en queries trampa (parecidas pero distintas).
  - Métrica de hit rate del cache semántico expuesta.
- [ ] **Optimizaciones aplicadas basadas en data:**
  - ¿Vale Sonnet 4.6 para algunos turnos? Routing si sí.
  - ¿Cache hit rate semántico < 30%? Ajustar threshold o políticas de bypass.
  - ¿Tools devuelven demasiado JSON? Reducir.
- [ ] **Hardening:**
  - Rate limiting por business y por número (Redis).
  - Idempotencia en webhooks (mismo mensaje 2 veces = procesar 1 vez).
  - Manejo de errores de Anthropic (retries con backoff exponencial).
- [ ] **Observabilidad completa:** dashboards en Grafana Cloud (operacional + costo + calidad + cache hit rates por capa).

### AI-driven dev

- Generar variaciones de casos de eval con Claude.
- Subagent `eval-runner` corre y reporta automáticamente.

### Definición de "done"

- [ ] Eval set ≥ 85% accuracy.
- [ ] Costo por conversación medido y dentro del budget (o documentado por qué no).
- [ ] Dashboards muestran métricas reales de varios businesses de prueba.

---

## Semana 6 — Launch prep + Portfolio polish (2026-06-25 → 2026-07-02)

**Objetivo:** sistema en producción con un business real (Christian o un cliente piloto); repo público listo para portafolio.

### Entregables

- [ ] **Deploy a producción** (Railway/Fly.io) con:
  - Backend NestJS
  - Postgres + pgvector managed
  - Redis managed
  - Dashboard Next.js
  - Variables de entorno seguras
  - Backups configurados
- [ ] **Primer business real** onboarded — puede ser uno propio de Christian o un piloto.
- [ ] **Operación monitoreada por 1 semana** completa con conversaciones reales.
- [ ] **Métrica "Ahorro Atiende" visible en el dashboard** — ver [01_ARCHITECTURE.md §12.8](01_ARCHITECTURE.md#128-cómo-lo-demostramos-pitch-comercial). Muestra al dueño del business cuánto se ahorró este mes gracias a las 3 capas de cache vs un sistema sin cache.
- [ ] **README del repo público:**
  - Descripción clara del producto.
  - Diagrama de arquitectura.
  - Stack tecnológico.
  - Cómo correr local.
  - Métricas en producción (latencia p95, costo/conv, accuracy, **% ahorro por caching multinivel**).
  - Captura del dashboard.
  - Video de 60s mostrando una conversación end-to-end.
- [ ] **CV actualizado** con bullets reales del proyecto:
  - "Construí Atiende, un agente conversacional en WhatsApp basado en Claude que..."
  - Números concretos: latencia p95, costo/conv, accuracy del eval set, hit rate del cache.
- [ ] **Post en LinkedIn** anunciando el proyecto.

### Definición de "done"

- [ ] Hay un business real con conversaciones reales operando con Atiende.
- [ ] El repo público se ve profesional y demuestra dominio de IA + ingeniería.
- [ ] Christian puede demostrar el sistema funcionando en una entrevista.

---

## Resumen visual

| Sem | Objetivo | "Lo más impresionante" para mostrar |
|---|---|---|
| 1 | Foundation | Mensaje de WhatsApp → respuesta automática (sin IA aún) |
| 2 | Agente básico | Conversación natural con Claude vía WhatsApp |
| 3 | RAG | Agente que conoce un catálogo y nunca inventa precios |
| 4 | Multi-tenant + orders + dashboard | Cliente crea orden conversacionalmente; dashboard muestra todo |
| 5 | Evals + costos | Métricas de calidad reales, costo optimizado |
| 6 | Launch + portafolio | Sistema en producción con métricas, repo público listo |

---

## Qué hacer si te atrasas

**Si la semana 1 tarda más:** acortar el dashboard de la semana 4 — empezar solo con `npx prisma studio` y JSON queries hasta que haya tiempo.

**Si la semana 3 (RAG) se complica:** simplificar — full-text search de Postgres como fallback. RAG con embeddings se prioriza pero no bloquea las semanas siguientes.

**Si la semana 5 (evals) revela problemas grandes:** la semana 6 se convierte en "fix calidad" en vez de "launch". Es mejor lanzar tarde que lanzar roto.

**Si nada se atrasa:** semana 7 opcional con features de v2 (vision con Claude, audio transcripción, multi-idioma).

---

## Checklist pre-launch

Antes de mostrar el proyecto al mundo:

- [ ] Eval set ≥ 85%
- [ ] Latencia p95 < 5s con conversaciones reales
- [ ] Costo por conversación dentro del budget o documentado
- [ ] Sin alucinaciones de precio o producto en 100 conversaciones de prueba
- [ ] Dashboard funcional
- [ ] Repo público con README profesional, diagrama, video, métricas
- [ ] CV actualizado con bullets cuantitativos
- [ ] Post en LinkedIn redactado
- [ ] Demo en local replicable en < 10 minutos para entrevistas
