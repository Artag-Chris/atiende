# 00 — Especificación de Atiende

> **Spec-driven dev:** este documento es la fuente de verdad. El código se deriva de aquí. Si la spec cambia, el código se ajusta — no al revés. Cualquier cambio se discute aquí primero.

**Versión:** 0.1 (draft)
**Fecha:** 2026-05-20
**Estado:** En revisión — Christian + Claude

---

## 1. Visión (1 párrafo)

Atiende es un agente conversacional de IA conectado a WhatsApp Business que atiende clientes 24/7 para PYMEs latinoamericanas. Entiende lenguaje natural, consulta el catálogo del negocio con búsqueda semántica, ayuda al cliente a elegir productos, crea órdenes, responde preguntas frecuentes, y escala a un humano cuando detecta quejas, intención compleja o casos fuera de su alcance. El objetivo es que el dueño de la PYME deje de perder ventas por no responder rápido y se enfoque en operar su negocio.

---

## 2. Problema

Las PYMEs latinoamericanas reciben la mayoría de sus pedidos y consultas por WhatsApp. **Pierden ventas todos los días** por tres razones:

1. **Tiempo de respuesta lento** — el dueño está atendiendo otros temas; los clientes se van a la competencia que responde más rápido.
2. **Fuera de horario** — pedidos llegan de noche, fines de semana, festivos. Nadie responde.
3. **Repetición** — el 70%+ de los mensajes son las mismas 20 preguntas: precios, disponibilidad, horarios, dirección, métodos de pago.

Las soluciones actuales fallan:

- **Chatbots de respuestas fijas** — frustran al cliente, no entienden variaciones del lenguaje.
- **Contratar a alguien** — caro, no escalable, no 24/7.
- **Soluciones genéricas con IA** — no conocen el catálogo del negocio, alucinan precios y productos.

Atiende ataca este vacío con un agente que **sí conoce el negocio**, **sí entiende lenguaje natural**, y **sí sabe cuándo callarse y pasarle al humano**.

---

## 3. Personas

### Persona 1: Dueño/a de la PYME (el cliente que paga)

- **Quién es:** dueño/a de una tienda de ropa, bodega, restaurante, papelería, servicios de belleza, etc. en LatAm.
- **Tamaño:** entre 1 y 10 empleados. Factura entre USD $2k–$50k/mes.
- **Dolor:** pierde 30–50% de los mensajes de WhatsApp por no responder a tiempo.
- **Capacidad técnica:** baja-media. Maneja WhatsApp, Instagram, tal vez un punto de venta. No sabe programar.
- **Decisión de compra:** prueba primero, paga si ve resultado. Sensible a precio (mercado LatAm).

### Persona 2: Cliente final (el que escribe al WhatsApp)

- **Quién es:** consumidor que llega al WhatsApp del negocio por una publicación, anuncio, o recomendación.
- **Expectativa:** respuesta rápida, lenguaje natural, sin fricciones. Si la conversación se siente robótica, se va.
- **Comportamiento:** mensajes cortos, con typos, abreviaciones, audio (a futuro), imágenes (foto de un producto que vio).

### Persona 3 (futuro): Operador humano del negocio

- **Quién es:** empleado/a del negocio que toma las conversaciones cuando Atiende escala.
- **Necesita:** interfaz web simple para ver conversaciones, retomar el control, marcar como resuelto.

---

## 4. User Stories

### Como dueño/a de la PYME, quiero...

- US-1: ...conectar mi WhatsApp Business a Atiende en menos de 10 minutos para empezar a usarlo el mismo día.
- US-2: ...subir mi catálogo (Excel, CSV, o link a mi tienda online) para que Atiende sepa qué productos vendo.
- US-3: ...ver un dashboard con cuántas conversaciones tuvo, cuántas terminó en orden, y cuánto me cuesta al mes.
- US-4: ...editar las respuestas a preguntas frecuentes (horarios, ubicación, métodos de pago) sin tocar código.
- US-5: ...recibir notificación cuando Atiende escale una conversación a humano, para retomarla yo.
- US-6: ...ver el historial de conversaciones de cada cliente para entender el contexto cuando retomo.

### Como cliente final, quiero...

- US-7: ...preguntar por un producto en lenguaje natural y recibir información correcta (precio, disponibilidad, foto).
- US-8: ...que el agente recuerde lo que hablamos antes en la misma conversación (no preguntar mi nombre 3 veces).
- US-9: ...poder pedir hablar con una persona real cuando lo necesite, sin pelear con el bot.
- US-10: ...crear una orden conversacionalmente ("quiero 2 unidades del rojo en talla M, envío a [dirección]").

### Como operador humano, quiero...

- US-11: ...ver una conversación que Atiende me escaló con el contexto completo y poder seguir desde donde quedó.

---

## 5. Requerimientos Funcionales (FR)

Numerados. Testeables. Cualquier feature nueva tiene que tener su FR.

### Mensajería

- **FR-1:** El sistema recibe mensajes entrantes de WhatsApp Business API vía webhook.
- **FR-2:** El sistema envía mensajes salientes vía Meta WhatsApp Business API.
- **FR-3:** El sistema procesa mensajes de texto. (Imágenes y audio: out-of-scope v1).
- **FR-4:** El sistema responde dentro de los 5 segundos del mensaje del cliente (p95).
- **FR-5:** El sistema agrupa mensajes consecutivos del mismo cliente dentro de una ventana de 30 segundos antes de responder (evita respuestas fragmentadas).

### Catálogo & RAG

- **FR-6:** El sistema permite cargar catálogo en CSV/Excel con campos: nombre, descripción, precio, disponibilidad, categoría, imagen URL.
- **FR-7:** El sistema indexa el catálogo en una base vectorial (embeddings de nombre+descripción).
- **FR-8:** El sistema permite búsqueda semántica del catálogo: el cliente pregunta "tienes algo para una fiesta?" y encuentra productos relacionados aunque no use las palabras exactas.
- **FR-9:** El sistema responde con precio y disponibilidad **reales** del catálogo, nunca inventados.

### Agente (Tool Use)

- **FR-10:** El agente tiene acceso a las siguientes herramientas (tools):
  - `search_catalog(query)` — búsqueda semántica del catálogo de productos
  - `get_product(product_id)` — detalles de un producto específico
  - `search_knowledge(query, kind?)` — búsqueda semántica en documentos del business (FAQs, políticas, PDFs, manuales) — ver §FR-22+
  - `create_order(items, customer_info, delivery_address)` — crea una orden en estado pendiente
  - `get_business_info(topic)` — horarios, ubicación, métodos de pago, políticas básicas configuradas en settings
  - `escalate_to_human(reason)` — marca la conversación como pendiente de humano y notifica
- **FR-11:** El agente decide cuándo escalar basado en: (a) queja explícita, (b) solicitud directa de hablar con humano, (c) tarea fuera de su alcance, (d) más de 3 turnos sin progreso.

### Memoria & contexto

- **FR-12:** El sistema mantiene historial de conversación por cliente (`phone_number`) por business.
- **FR-13:** El sistema usa **prompt caching** (Anthropic nativo) sobre el system prompt y catálogo recuperado.
- **FR-14:** Cuando una conversación supera los ~50K tokens, el sistema usa **compaction** para resumir el historial antiguo.

### Caching para ahorro de costos (estrategia multinivel)

- **FR-14b:** El sistema implementa **caching multinivel** con 3 capas independientes (ver [01_ARCHITECTURE.md §12](../docs/01_ARCHITECTURE.md#12-caching-multinivel-para-ahorro-de-costos)):
  - **Capa 1:** Anthropic prompt caching nativo (siempre activo).
  - **Capa 2:** Semantic response cache en pgvector — devuelve respuesta cacheada cuando la similitud coseno del query con uno previo es ≥ 0.95.
  - **Capa 3:** Exact response cache en Redis — match exacto por hash del query normalizado.
- **FR-14c:** El cache semántico (capa 2) tiene safety rails no negociables: scope por `business_id`, bypass total para tools de estado (`create_order`, `escalate_to_human`), bypass si hay historial > 1 mensaje, bypass si el query contiene PII, TTL ≤ 30min, feature flag por business.
- **FR-14d:** El sistema invalida el cache semántico de un business cuando se actualiza su catálogo o FAQ.
- **FR-14e:** El sistema expone una métrica "Ahorro Atiende" en el dashboard mostrando costo evitado por las capas de cache vs un sistema sin cache.

### Knowledge ingestion (documentos no-estructurados del business)

Complementa el catálogo (que es estructurado: productos con precio/stock) con documentos no-estructurados (FAQs, políticas, PDFs, manuales). Diseño completo en [01_ARCHITECTURE.md §14](../docs/01_ARCHITECTURE.md#14-ingesta-de-conocimiento-pdfs-faqs-políticas).

- **FR-22:** El sistema permite al business cargar documentos de conocimiento desde el dashboard. Tipos soportados v1: CSV, Excel (`.xlsx`/`.xls`), PDF con texto seleccionable, formularios web (FAQs).
- **FR-23:** La ingesta es asíncrona (BullMQ `KNOWLEDGE_INDEXING`). Pipeline: extract → chunk → embed → store. Status visible en dashboard: `PENDING → EXTRACTING → CHUNKING → EMBEDDING → INDEXED | FAILED`.
- **FR-24:** El agente tiene la tool `search_knowledge(query, kind?)` que retorna los top-K chunks más similares al query (cosine > `RAG_MIN_SIMILARITY`), filtrables por `KnowledgeKind` (`FAQ` / `POLICY` / `PDF_CATALOG` / `MANUAL` / `NOTES`).
- **FR-25:** Re-subir un documento con el mismo `source` actualiza la entrada existente. Si el `sourceHash` no cambió, no se re-indexa (idempotente). Si cambió, los chunks viejos quedan `active=false` y se generan los nuevos. La response cache del business se invalida automáticamente tras re-indexar.
- **FR-26:** Tamaño máximo de archivo: `KNOWLEDGE_MAX_FILE_SIZE_MB` (default 20 MB). PDFs escaneados (imágenes sin texto) son **out-of-scope v1** — se detectan y se marcan `FAILED` con mensaje claro. OCR llega en v2.

### Multi-tenancy

- **FR-15:** Una instancia del sistema soporta múltiples negocios (businesses) con catálogos, configs y números de WhatsApp separados.
- **FR-16:** Cada business tiene su propio system prompt configurable (tono, idioma, personalidad).

### Dashboard (web)

- **FR-17:** Dashboard web muestra por business: conversaciones activas, mensajes/día, costo/día (tokens × precio modelo), tasa de escalamiento.
- **FR-18:** Dashboard permite ver el detalle de cualquier conversación.
- **FR-19:** Dashboard permite tomar el control de una conversación escalada y enviar mensajes manualmente.

### Configuración

- **FR-20:** UI para cargar/actualizar catálogo (CSV, Excel).
- **FR-21:** UI para editar respuestas a FAQ (horarios, ubicación, etc.).

---

## 6. Requerimientos No Funcionales (NFR)

### Latencia

- **NFR-1:** p95 de respuesta del agente < 5 segundos (medido desde recepción del webhook hasta envío del mensaje).
- **NFR-2:** p99 < 10 segundos.

### Costo

- **NFR-3:** Costo objetivo por conversación promedio (10 turnos): **< USD $0.05**. Estrategia: caching multinivel (FR-14b) + prompt caching nativo + selección de modelo según complejidad (v2).
- **NFR-3b:** Hit rate del semantic response cache (capa 2) en estado estable: **> 30%** medido sobre tráfico real. Si está por debajo, ajustar threshold o políticas de bypass.
- **NFR-3c:** El sistema demuestra ahorro cuantificable vs baseline sin cache: meta **≥ 25% menos costo** por conversación promedio.
- **NFR-4:** El dashboard debe mostrar costo en tiempo real **y ahorro acumulado por caching** para que el dueño del business pueda verificar que el modelo de negocio cierra.

### Escalabilidad

- **NFR-5:** Soportar 100 businesses concurrentes y 10,000 mensajes/día por instancia v1.
- **NFR-6:** Arquitectura permite escalar horizontalmente (stateless services + queue).

### Disponibilidad

- **NFR-7:** Uptime objetivo: 99.5% (descarta primer mes de hardening).
- **NFR-8:** Pérdida cero de mensajes: todo webhook entrante se persiste **antes** de procesarse.

### Seguridad

- **NFR-9:** Tokens de WhatsApp Business API encriptados en reposo.
- **NFR-10:** API key de Anthropic nunca expuesta al cliente; solo en el backend.
- **NFR-11:** PII (números de teléfono, direcciones, nombres) cumple con la ley de protección de datos colombiana (Ley 1581/2012) y, eventualmente, GDPR/CCPA si expandimos.

### Mantenibilidad

- **NFR-12:** Cobertura de tests unitarios > 70% en lógica de negocio.
- **NFR-13:** Eval suite con al menos 50 conversaciones representativas; corre en CI antes de cualquier deploy a prod que toque prompts o modelo.

---

## 7. Métricas de Éxito

### Métricas de producto (lo que importa al negocio)

| Métrica | Meta v1 | Cómo se mide |
|---|---|---|
| Tasa de resolución sin escalamiento | > 70% | conversaciones cerradas por el agente / total |
| Tasa de conversión a orden | > 15% | conversaciones que crean orden / total |
| NPS de clientes finales (vía encuesta post-conversación) | > 40 | encuesta opcional al final |
| Costo promedio por conversación | < USD $0.05 | suma tokens × precio / conversaciones |
| Latencia p95 | < 5s | medición backend |

### Métricas de IA (lo que importa al motor)

| Métrica | Meta | Cómo se mide |
|---|---|---|
| Eval set accuracy (50 convs anotadas) | > 85% | corrida automática vs ground truth |
| Hit rate de prompt caching | > 80% | `cache_read_input_tokens / total_input_tokens` |
| Tasa de alucinación de precios/productos | < 1% | revisión manual + flag de outputs sin RAG match |
| Tasa de escalamiento correcto (cuando debería escalar y lo hace) | > 90% | revisión manual de muestra |

---

## 8. Scope (lo que SÍ y lo que NO en v1)

### IN scope (v1, primeras 6 semanas)

- WhatsApp Business API integración (texto solamente).
- Agente con tool use (5 tools definidas en FR-10).
- RAG sobre catálogo con pgvector.
- Multi-tenant básico (varios businesses, cada uno con su número y catálogo).
- Dashboard con métricas básicas (no UI bonita aún).
- Eval suite con 50 conversaciones.
- Deploy en Railway o Fly.io (no Kubernetes en v1 — overkill).
- Soporte para español (idioma único v1).

### OUT of scope (no en v1, evaluar para v2)

- ❌ Mensajes de imagen (vision con Claude llegará en v2).
- ❌ Mensajes de audio (transcripción → texto, luego v2).
- ❌ Mensajes de video.
- ❌ Pagos integrados (la orden se crea en estado pendiente; el pago lo gestiona el negocio).
- ❌ Integraciones con sistemas de inventario (Shopify, Vtex, etc.).
- ❌ Multi-idioma (solo español v1).
- ❌ App móvil nativa (dashboard web es suficiente v1).
- ❌ Marketplace de plantillas de prompts entre negocios.
- ❌ Agente proactivo (que envíe mensajes sin que el cliente escriba primero).

---

## 9. Preguntas Abiertas

Cosas que faltan definir antes de empezar a construir, o durante el build. Cualquier respuesta cambia la spec.

- **OQ-1:** ¿Modelo único (Opus 4.7) o routing? — Decisión inicial: **Opus 4.7 para todos los turnos** (defecto de Anthropic). Routing a Sonnet 4.6/Haiku 4.5 por complejidad detectada se evalúa en semana 5 si el costo lo justifica. (Ver [02_AI_CONCEPTS.md](02_AI_CONCEPTS.md) §Cost.)
- **OQ-2:** ¿Cómo se cobra al business? Por mensaje, por conversación, o flat mensual? Sugerencia: **flat mensual** (USD $30–80/mes) hasta tener señal del costo real, luego pricing dinámico.
- **OQ-3:** ¿Confiamos en que Claude detecte cuándo escalar, o usamos también reglas explícitas (keywords como "queja", "demanda", "abogado")? Decisión inicial: **ambas** — keywords como red de seguridad + el juicio del modelo.
- **OQ-4:** Para evals: ¿anotamos manualmente las 50 conversaciones o usamos Claude para generar ground truth y revisamos? Decisión inicial: **híbrido** — Claude genera, Christian revisa y corrige.
- **OQ-5:** ¿Storage de imágenes de productos? Cloudinary (Christian ya conoce) o S3? Decisión inicial: **Cloudinary**.
- **OQ-6:** ¿Streaming de respuestas al cliente de WhatsApp? — WhatsApp no soporta streaming nativo, pero podemos enviar mensajes parciales ("dame un momento, busco eso..."). Out of scope v1.

---

## 10. Glosario

- **Business / Tenant:** una PYME que usa Atiende. Cada business tiene su propio número de WhatsApp, catálogo, configuración.
- **Conversation:** una sesión de mensajes entre un cliente final y un business, identificada por `(business_id, phone_number)`.
- **Turn:** un par (mensaje cliente, respuesta agente) dentro de una conversación.
- **Tool:** función que el agente puede llamar (ver FR-10).
- **RAG (Retrieval-Augmented Generation):** patrón donde antes de responder, recuperamos información relevante del catálogo y la pasamos al modelo. Ver [02_AI_CONCEPTS.md](02_AI_CONCEPTS.md) §RAG.
- **Escalation:** acción de marcar una conversación como pendiente de humano y notificar al business.
- **Eval set:** conjunto de conversaciones anotadas con la respuesta esperada, usadas para medir calidad antes de cualquier cambio.
- **Prompt caching:** mecanismo de Anthropic para no recobrar tokens repetidos entre requests. Ver [02_AI_CONCEPTS.md](02_AI_CONCEPTS.md) §Prompt Caching.

---

## 11. Cómo evoluciona esta spec

- Cualquier cambio se propone aquí primero (PR a este archivo).
- Si un cambio agrega un FR, también va al test/eval correspondiente.
- Los OQ se resuelven y se mueven al cuerpo de la spec.
- Versionamos con `0.x` durante desarrollo, `1.0` al primer release público.
