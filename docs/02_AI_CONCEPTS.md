# 02 — Conceptos de IA aplicados a Atiende

> Este documento explica cada concepto técnico que vamos a usar. Pensado para que cualquier desarrollador del equipo (o tú mismo en 6 meses) entienda **qué es**, **por qué importa para Atiende**, y **cómo lo implementamos**.

**Fecha de los precios y datos de modelos:** mayo 2026. Verifica en `platform.claude.com/pricing` antes de cualquier decisión basada en precio.

---

## Tabla de contenidos

1. [Conceptos base: LLMs, tokens, contexto](#1-conceptos-base)
2. [Prompt engineering: system prompts, structured prompts](#2-prompt-engineering)
3. [Tool use / function calling](#3-tool-use--function-calling)
4. [Structured outputs](#4-structured-outputs)
5. [RAG (Retrieval-Augmented Generation)](#5-rag)
6. [Embeddings](#6-embeddings)
7. [Vector databases & pgvector](#7-vector-databases--pgvector)
8. [Chunking strategies](#8-chunking-strategies)
9. [Prompt caching](#9-prompt-caching)
10. [Cost per prompt — cómo se calcula](#10-cost-per-prompt)
11. [Streaming](#11-streaming)
12. [Memory & compaction](#12-memory--compaction)
13. [Evals](#13-evals)
14. [Observabilidad para LLMs](#14-observabilidad)
15. [Alucinaciones y mitigaciones](#15-alucinaciones)
16. [Adaptive thinking & effort](#16-adaptive-thinking--effort)
17. [Multi-agent loops](#17-multi-agent-loops)

---

## 1. Conceptos base

### Qué es un LLM

Un **Large Language Model** (LLM) es un modelo de IA entrenado para predecir el siguiente token dado un texto. Claude, GPT, Gemini son LLMs. No "saben" cosas en el sentido humano — están haciendo predicciones estadísticas muy sofisticadas sobre qué viene después.

**Implicación práctica:** un LLM puede inventarse información (alucinar). Por eso para Atiende **siempre** consultamos el catálogo real con tool use; nunca le pedimos a Claude "el precio de X" sin pasarle el dato.

### Token

Un **token** es la unidad básica que procesa un LLM. No es ni una palabra ni un carácter — es algo en el medio.

- "hola" → 1 token
- "WhatsApp" → 2-3 tokens
- Texto en español tiende a usar más tokens que inglés (~1.3× más para el mismo contenido).
- 1 token ≈ ~3-4 caracteres en español, ~4 en inglés.

**Implicación práctica:** todo lo que entra al modelo (system prompt, historial, mensaje del cliente) y todo lo que sale (respuesta, llamadas a tools) cuesta tokens, y los tokens cuestan dinero (ver §10).

### Context window (ventana de contexto)

El máximo de tokens que un modelo puede procesar en una sola request (input + output).

| Modelo | Context window | Max output |
|---|---|---|
| Claude Opus 4.7 | 1M tokens | 128K |
| Claude Sonnet 4.6 | 1M tokens | 64K |
| Claude Haiku 4.5 | 200K tokens | 64K |

Para Atiende esto es generoso — una conversación de 100 turnos rara vez supera 50K tokens.

---

## 2. Prompt engineering

### System prompt

Texto que define el comportamiento del asistente. En Anthropic API se manda en el campo `system` (separado del `messages`).

**Estructura recomendada:**
1. **Identidad** — quién eres ("Eres Atiende, asistente de {{business.name}}").
2. **Tarea** — qué debes hacer.
3. **Reglas** — qué nunca hacer (no inventar precios, etc.) y qué siempre hacer.
4. **Formato** — cómo responder (corto, sin emojis a menos que el cliente los use).
5. **Tools available** — los tools se mandan por separado en el campo `tools`, pero el system prompt puede dar guidance sobre cuándo usarlas.

**Anti-patterns a evitar (Claude 4.6+):**
- ❌ "CRITICAL: YOU MUST..." — Claude 4.6/4.7 son muy obedientes. Lenguaje agresivo causa over-triggering.
- ❌ "If in doubt, use the tool" — el modelo es lo suficientemente bueno para decidir.
- ✅ "Use [tool] cuando..." — descriptivo.

### Few-shot prompting

Mostrar ejemplos en el prompt: "Aquí hay 3 ejemplos de buena respuesta, sigue ese estilo". Útil cuando una instrucción abstracta no captura el matiz.

Para Atiende usaremos few-shot en escalamiento — mostrar 2-3 ejemplos de cuándo escalar y cuándo no.

---

## 3. Tool use / function calling

### El concepto

El LLM no ejecuta código por sí mismo. **Tool use** es el patrón donde:

1. Le decimos al modelo qué tools tiene disponibles (nombre, descripción, schema de inputs).
2. El modelo, en lugar de responder con texto, puede responder con "quiero llamar a esta tool con estos argumentos".
3. **Nosotros** ejecutamos esa función (DB query, API call, lo que sea).
4. Le pasamos el resultado de vuelta al modelo.
5. El modelo continúa, posiblemente llamando más tools, o finalmente respondiendo al usuario.

Es la base de cualquier agente útil. **Sin tool use no hay agente** — solo hay un chatbot que parlotea.

### Aplicado a Atiende

Tools que expone Atiende:

```typescript
search_catalog(query: string, max_results?: number)
  → busca productos relevantes en pgvector

get_product(product_id: string)
  → detalle completo de un producto

create_order(items, customer, address)
  → crea orden en estado pendiente

get_business_info(topic: "hours" | "location" | "payment_methods" | "policies")
  → respuestas a FAQs configurables

escalate_to_human(reason: string)
  → marca conversación como pendiente de humano, notifica
```

### Cómo se implementa (TypeScript + SDK Anthropic)

```typescript
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const searchCatalog = betaZodTool({
  name: "search_catalog",
  description: "Busca productos en el catálogo. Usa esta tool cuando el cliente pregunte por un producto, categoría o describa lo que busca.",
  inputSchema: z.object({
    query: z.string(),
    max_results: z.number().int().min(1).max(10).default(5),
  }),
  run: async ({ query, max_results }) => {
    // Tu lógica aquí
    return JSON.stringify(results);
  },
});

const runner = client.beta.messages.toolRunner({
  model: "claude-opus-4-7",
  max_tokens: 4096,
  tools: [searchCatalog, getProduct, createOrder, /* ... */],
  system: SYSTEM_PROMPT,
  messages: conversationHistory,
});

const finalMessage = await runner; // SDK maneja el loop
```

**Por qué el tool runner del SDK y no loop manual:**
- Ahorra ~200 líneas de glue code.
- Maneja `stop_reason: tool_use` y `pause_turn` correctamente.
- Type-safe con Zod.
- Riesgo: está en beta. Si encontramos bug bloqueante, caemos al loop manual (documentado en SDK docs).

### Reglas de oro para diseñar tools

1. **Descripción es lo más importante.** El modelo decide cuándo llamar la tool basado en la descripción. Mala descripción = malas decisiones.
2. **Una tool = una acción atómica.** No hagas `do_everything()`. Hace difícil para el modelo razonar.
3. **Schemas estrictos.** Usa Zod/JSON Schema con validación. Inputs malformados se rechazan antes de ejecutar.
4. **No expongas tools de superusuario.** El modelo no debe poder `DELETE FROM products`. Pasa por una capa de servicio que valida permisos.
5. **Outputs serializables y compactos.** Devuelve JSON o texto estructurado, no objetos grandes con campos irrelevantes — cada token cuesta.

---

## 4. Structured outputs

### El concepto

A veces no quieres que el modelo te conteste en lenguaje natural — quieres un JSON con campos específicos.

**Antes (era frágil):** instruir al modelo "responde en JSON con campos X, Y, Z" y rezar.

**Ahora (Claude 4.6+):** `output_config.format` te garantiza que la respuesta cumple un JSON Schema. El modelo no puede salirse del schema.

```typescript
output_config: {
  format: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: {
        intent: { type: "string", enum: ["greeting", "product_query", "complaint", "checkout"] },
        confidence: { type: "number" },
      },
      required: ["intent", "confidence"],
      additionalProperties: false,
    },
  },
}
```

### Aplicación a Atiende

Aunque la respuesta al cliente es texto libre, **sí usamos structured outputs internamente** para:
- Clasificación de intención (turno de saludo vs queja vs producto).
- Extracción de entidades de la orden (productos, dirección, método de pago) cuando el cliente describe en lenguaje natural.
- Outputs de eval (¿pasó la prueba sí/no + razón).

---

## 5. RAG (Retrieval-Augmented Generation)

### El concepto

Un LLM solo sabe lo que estaba en su data de entrenamiento. **No sabe** tu catálogo, tus precios actuales, tus políticas. Si le preguntas algo del business, se lo va a inventar.

**RAG** soluciona esto:

```
1. Indexa tu data (catálogo, FAQ, políticas) como embeddings en una vector DB.
2. Cuando llega un query del cliente:
   a. Genera un embedding del query.
   b. Busca en la vector DB los K documentos más similares (semánticamente).
   c. Pasa esos documentos al modelo como contexto: "Aquí están los productos relevantes, responde basándote en esto".
3. El modelo responde citando data real.
```

### Aplicación a Atiende

Específicamente para el catálogo de productos:

```
Cliente: "tienes algo para regalo de boda?"
   ↓
Embedding del query (vector de 1536 dimensiones con OpenAI text-embedding-3-small)
   ↓
pgvector: SELECT * FROM products WHERE business_id = X
          ORDER BY embedding <=> :query_embedding LIMIT 5;
   ↓
Top 5 productos relevantes → pasados a Claude como contexto en el tool result
   ↓
Claude responde al cliente con esos productos específicos
```

**Resultado:** Atiende **nunca** inventa productos o precios. Solo recomienda lo que existe.

### Trade-offs de RAG

- ✅ Reduce alucinaciones a casi cero.
- ✅ El catálogo puede ser enorme — solo cargas en contexto lo relevante.
- ✅ Actualizar catálogo es indexar de nuevo (no re-entrenar el modelo).
- ❌ La calidad depende de qué tan bien hagas chunking + embedding + retrieval.
- ❌ Si el cliente pregunta algo que no está en el catálogo, RAG no ayuda — para eso está el escalamiento.

---

## 6. Embeddings

### El concepto

Un **embedding** es una representación numérica (vector) de un texto que captura su significado semántico. Textos parecidos → vectores cercanos en el espacio.

```
embedding("vestido rojo") = [0.12, -0.45, 0.78, ..., 0.03]  ← vector de 1536 floats
embedding("falda escarlata") = [0.14, -0.43, 0.77, ..., 0.05]  ← muy cercano
embedding("teléfono celular") = [-0.62, 0.81, -0.23, ..., 0.41]  ← lejano
```

**Métrica de cercanía:** generalmente **cosine similarity** (qué tan paralelos son los vectores). Va de -1 a 1; más cerca de 1 = más similares.

### Modelo de embeddings que usaremos

- **OpenAI `text-embedding-3-small`** (dimension 1536, $0.02/M tokens — extremadamente barato).
- Alternativa probada: **Voyage AI `voyage-3-lite`** (recomendado por Anthropic para usar con Claude).

**Decisión inicial:** OpenAI por simplicidad y precio. Re-evaluar en semana 5 si la calidad de retrieval no es buena.

**Importante:** debes usar el **mismo modelo** para indexar y para hacer queries. Si cambias de modelo, re-indexar todo el catálogo.

### Cómo se generan

```typescript
import OpenAI from "openai";
const openai = new OpenAI();

const response = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: "vestido rojo talla M",
});

const embedding = response.data[0].embedding;  // array de 1536 floats
```

---

## 7. Vector databases & pgvector

### El concepto

Una **vector database** es una DB optimizada para buscar embeddings cercanos rápido. Sin un índice especial, buscar el top-K en N vectores es O(N) — lento con catálogos grandes.

**Vector DBs populares:**
- **Pinecone** — managed, fácil, caro a escala.
- **Weaviate** — open source, self-hosted o managed.
- **Qdrant** — open source, rápido, en Rust.
- **pgvector** — extensión de Postgres. **Esto usamos.**

### Por qué pgvector para Atiende

- Una sola DB (Postgres). Menos infra para manejar.
- Soporta hasta varios millones de embeddings sin problema.
- Christian ya conoce Postgres.
- Si crecemos a 10M+ embeddings → migración a Pinecone es directa (no vendor lock).

### Cómo se usa

```sql
-- Habilitar extensión
CREATE EXTENSION vector;

-- Tabla
CREATE TABLE product_embeddings (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  embedding vector(1536)
);

-- Índice HNSW (Hierarchical Navigable Small World) — algoritmo para búsqueda aproximada rápida
CREATE INDEX ON product_embeddings USING hnsw (embedding vector_cosine_ops);

-- Query: top 5 más cercanos a un embedding
SELECT p.*
FROM product_embeddings pe
JOIN products p ON p.id = pe.product_id
WHERE p.business_id = $1
ORDER BY pe.embedding <=> $2  -- operador <=> = cosine distance
LIMIT 5;
```

**Operadores de pgvector:**
- `<->` distancia euclidiana
- `<#>` producto interno negativo
- `<=>` distancia coseno (1 - cosine similarity) — **el que usaremos**

---

## 8. Chunking strategies

### El concepto

¿Indexas todo el documento como un solo embedding, o lo cortas en pedazos? La respuesta es: depende.

**Para Atiende v1 simple:** cada producto = 1 chunk con embedding de `name + description`. Listo, no es complicado para catálogos.

**Para documentos largos (políticas, manuales, FAQ extensa):**
- **Fixed-size chunks:** cortar cada N tokens (típico 500–1000). Simple, pero puede cortar ideas a la mitad.
- **Semantic chunks:** cortar en límites naturales (párrafos, secciones). Mejor calidad.
- **Sliding window:** chunks con overlap para no perder contexto en los bordes.

Para Atiende v1, el chunking del catálogo es trivial. Lo más sofisticado vendrá cuando indexemos FAQs largas (semana 4–5).

---

## 9. Prompt caching

### El concepto

**El más importante para el costo de Atiende.**

Anthropic cachea prefijos de prompts. Si la primera mitad de tu prompt es idéntica entre requests, el modelo no la procesa de nuevo — la lee de cache, ~90% más barato.

**Costos efectivos:**

| Tipo de token | Costo (relativo al input normal) |
|---|---|
| Input normal | 1.0× |
| Cache write (5 min TTL) | 1.25× |
| Cache write (1 hora TTL) | 2.0× |
| **Cache read** | **0.1×** ← aquí está el ahorro |

### Cómo funciona

El cache es **prefix match**: si **cualquier byte** cambia en la primera parte, todo el cache se invalida. Por eso el orden importa:

```
[Parte estable — system prompt + tools + config del business]   ← CACHEABLE
[Parte volátil — historial de conversación + mensaje nuevo]     ← cambia cada turno
```

Marca el `cache_control: {type: "ephemeral"}` al final de la parte estable.

### Aplicación a Atiende

```typescript
client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 4096,
  system: [
    {
      type: "text",
      text: SYSTEM_PROMPT_TEMPLATE.replace("{{business}}", business.config),
      cache_control: { type: "ephemeral" }  // ← cachea system prompt
    }
  ],
  tools: TOOLS,  // tools también van en el prefijo cacheado
  messages: conversationHistory,  // ← parte volátil, cambia cada turno
});
```

### Errores comunes (que **no** queremos cometer)

| Error | Por qué rompe el cache |
|---|---|
| `datetime.now()` en el system prompt | Cambia cada milisegundo → 0% cache hit |
| Interpolar el `user_id` del cliente en el system | Cada cliente paga write, ningún read |
| Reordenar tools en cada request | El array de tools cambia → cache invalido |
| Cambiar de modelo a mitad de conversación | Caches están atados al modelo |

### Métricas para verificar

Cada response trae:

```typescript
response.usage.cache_read_input_tokens   // ← queremos que esto sea alto
response.usage.cache_creation_input_tokens
response.usage.input_tokens              // tokens no cacheados (full price)
response.usage.output_tokens
```

**Meta NFR:** > 80% cache hit rate después del primer turno de cada conversación.

---

### 9.bis Semantic response caching (cache "fuzzy" sobre respuestas)

> **Esto es complementario al prompt caching de Anthropic, no sustituto.** Atacan dos cosas distintas.

#### El problema que resuelve

100 clientes preguntan algo distinto pero equivalente:

- "cuál es el horario?"
- "a qué hora abren hoy?"
- "están atendiendo ahora?"
- "tienen abierto los domingos?"

Cada uno gatilla una llamada al LLM con prompt caching de Anthropic activo. **Buenísimo, pero aún paga input/output tokens cada vez**. Si la respuesta es la misma o muy parecida, ¿por qué pagar 100 veces?

#### El concepto: cache por similitud semántica

```
Cliente 1: "cuál es el horario?"
   ↓ embedding(query) → [0.12, -0.34, ...]
   ↓ buscar en cache → MISS
   ↓ llamar a Claude → "Abrimos lunes a viernes 9am-7pm"
   ↓ GUARDAR (embedding, response) en cache

Cliente 2: "a qué hora abren?"
   ↓ embedding(query) → [0.14, -0.31, ...]
   ↓ buscar en cache → HIT (similitud 0.96 > threshold 0.95)
   ↓ devolver response cacheada en ~50ms, SIN llamar al LLM
   ↓ costo: $0 al LLM (solo embedding: ~$0.000001)
```

#### Diferencia con el prompt caching de Anthropic

| Aspecto | Prompt caching (Anthropic) | Semantic response caching (nosotros) |
|---|---|---|
| **Qué cachea** | El **prompt** (input al modelo) | La **respuesta final** del agente |
| **Mecanismo** | Prefix match exacto, byte por byte | Embeddings + similitud coseno |
| **Dónde vive** | Servidores de Anthropic | Nuestra DB (pgvector) |
| **Ahorro** | ~90% del costo del prefijo cacheado | 100% (no se llama al LLM) |
| **Hit rate típico** | > 80% turnos > 1 de la misma conv | 30–60% en queries tipo FAQ |
| **Cuándo aplica** | Siempre que el prefijo no cambie | Solo turnos cacheables (con safety rails) |

**Son aditivos:** un turno puede ser hit del cache semántico (no llamar al LLM en absoluto), y si llega al LLM, el prompt caching de Anthropic reduce el costo de esa llamada.

#### "Fuzzy hashing" en este contexto

En seguridad/forensics, "fuzzy hashing" (ssdeep, TLM hashes) genera hashes que son similares para inputs similares. Para LLMs **no usamos fuzzy hashing en el sentido literal** — usamos **embeddings**, que cumplen la misma función conceptual de "encontrar cosas parecidas vía una representación numérica".

El término correcto en el ecosistema LLM es **semantic caching** o **semantic similarity caching**.

#### Implementación (resumen)

- **Storage:** pgvector con índice HNSW. Reusamos la infra del RAG.
- **Embeddings:** mismo modelo que para el catálogo (OpenAI `text-embedding-3-small`).
- **Threshold conservador:** ≥ 0.95 cosine similarity. Por debajo, riesgo de matchear queries que parecen similares pero requieren respuestas distintas.
- **Scope:** SIEMPRE por `business_id`. Nunca cross-tenant.
- **TTL:** 30 minutos default. Configurable por business.
- **Bypass automático:** turnos con `create_order`, `escalate_to_human`, conversaciones con historial > 1 mensaje, queries con PII detectada.
- **Invalidación:** cuando se actualiza catálogo o FAQ del business.

Detalle completo en [01_ARCHITECTURE.md §12](01_ARCHITECTURE.md#12-caching-multinivel-para-ahorro-de-costos).

#### Casos donde NO usar semantic cache

- Cualquier turno donde la respuesta dependa de **estado en tiempo real** (stock, precio que cambia, disponibilidad de hora).
  - Solución: el cache guarda la **frase generada** por Claude, no los datos crudos. Si la frase fue "tenemos 3 unidades", invalida agresivamente cuando cambie stock.
- Conversaciones personalizadas ("María, tu pedido anterior fue...").
- Sistemas regulados (legal, médico) donde la consistencia exacta importa.

#### Pitfalls comunes (a evitar)

1. **Threshold bajo (< 0.90).** "Vestido rojo talla M" y "vestido azul talla S" pueden tener similitud 0.92 y son productos totalmente distintos. Empezar conservador (0.95+) y bajar solo con evidencia.
2. **Olvidar invalidación.** Si el negocio cambia precios y no invalidamos, servimos precios viejos por 30 min — terrible UX.
3. **No medir.** Sin métricas de hit rate y precisión del cache, no sabemos si está ayudando o haciendo daño.
4. **Cross-tenant leakage.** Si el query "tienen envío?" se cachea sin scope por business, devolvemos la respuesta del business A al business B. Bug crítico.

---

## 10. Cost per prompt

### Fórmula básica

```
costo_request = (input_tokens × precio_input)
              + (output_tokens × precio_output)
              + (cache_create_tokens × precio_cache_write)
              + (cache_read_tokens × precio_cache_read)
```

### Precios actuales (mayo 2026)

| Modelo | Input ($/M) | Output ($/M) | Cache write 5m ($/M) | Cache read ($/M) |
|---|---|---|---|---|
| Opus 4.7 | $5.00 | $25.00 | $6.25 | $0.50 |
| Sonnet 4.6 | $3.00 | $15.00 | $3.75 | $0.30 |
| Haiku 4.5 | $1.00 | $5.00 | $1.25 | $0.10 |

### Ejemplo real — un turno de Atiende con Opus 4.7

Imagina turno 3 de una conversación, ya con cache caliente:

| Bloque | Tokens | Tipo | Costo |
|---|---|---|---|
| System prompt + business config (cacheado) | 2000 | cache_read | 2000 × $0.50/M = **$0.001** |
| Tools schema (cacheado) | 800 | cache_read | 800 × $0.50/M = $0.0004 |
| Historial conv anterior (no cacheado) | 600 | input | 600 × $5/M = **$0.003** |
| Mensaje nuevo del cliente | 30 | input | 30 × $5/M = $0.00015 |
| Tool result (search_catalog) | 200 | input | 200 × $5/M = $0.001 |
| Respuesta de Claude | 150 | output | 150 × $25/M = **$0.00375** |
| **Total turno 3** | | | **~$0.0093** |

### Conversación promedio (10 turnos) — proyección

- Turno 1: paga cache write ($2000 × $6.25/M = $0.0125 extra)
- Turnos 2–10: cache read steady state ~$0.009 cada uno
- **Total ~10 turnos: $0.08** — por encima del NFR-3 ($0.05).

**Optimizaciones de costo en orden de prioridad:**

1. **Modelo más barato para turnos simples (routing).** Saludos y FAQs en Haiku 4.5 → recortar a $0.025/conv.
2. **Caching más agresivo entre turnos consecutivos** del mismo cliente (usar TTL 1h en horario activo).
3. **Reducir output tokens** con prompting más conciso ("respuestas cortas, sin preámbulo").
4. **Compaction** para conversaciones largas — evita que historial crezca lineal.

---

## 11. Streaming

### El concepto

En lugar de esperar a que el modelo genere toda la respuesta, recibes tokens según se generan.

**Casos donde sirve:**
- UI de chat (mostrar texto mientras llega).
- Outputs largos (no timeout HTTP).
- Mejor latencia percibida.

**Casos donde no aporta:**
- Cuando la respuesta es para una API que va a otro sistema (como WhatsApp).
- Cuando el output es structured (JSON) y necesitas todo antes de procesarlo.

### Aplicación a Atiende

**v1:** **no usamos streaming** para mandar a WhatsApp (Meta no soporta streaming nativo).

**v2 / dashboard:** sí streaming para:
- Dashboard de operador humano viendo respuestas del agente en vivo.
- Cuando expandamos a web chat embebido.

### Cómo se usa (cuando llegue el momento)

```typescript
const stream = client.messages.stream({
  model: "claude-opus-4-7",
  max_tokens: 4096,
  messages: [...]
});

stream.on("text", (delta) => {
  process.stdout.write(delta);
});

const finalMessage = await stream.finalMessage();  // espera completo
```

---

## 12. Memory & compaction

### El concepto

LLMs son stateless — cada request se manda con todo el historial. En conversaciones largas, eso se vuelve caro y el contexto puede saturarse.

**Estrategias:**

1. **Truncado simple:** mantén los últimos N mensajes. Pierdes contexto antiguo.
2. **Summarización manual:** cuando el historial pasa de N tokens, resume los más viejos con otra llamada al modelo. Conserva info pero pierde precisión.
3. **Compaction (Anthropic beta):** el API hace summary automático server-side. Devuelve un `compaction` block que persistes y reusas en el siguiente request. **Esto usamos.**

### Aplicación a Atiende

```typescript
const response = await client.beta.messages.create({
  betas: ["compact-2026-01-12"],
  model: "claude-opus-4-7",
  max_tokens: 4096,
  messages: conversationHistory,
  context_management: {
    edits: [{ type: "compact_20260112" }]
  },
});

// IMPORTANTE: persiste response.content COMPLETO (no solo el text).
// El compaction block tiene que volver en el siguiente request.
conversationHistory.push({ role: "assistant", content: response.content });
```

En la práctica, una conversación de WhatsApp rara vez supera 30 turnos — compaction se activará poco. Pero queremos el patrón listo desde día 1 para no tener que retrofittear.

---

## 13. Evals

### El concepto

**Sin evals no hay LLM en producción.** Es como hacer deploy sin tests, multiplicado por 100.

Un **eval** es un test automatizado de calidad del modelo. Patrón:

1. Tienes un set de casos: input → output esperado.
2. Corres el modelo sobre cada caso.
3. Comparas el output real vs el esperado (puede ser exact match, semantic match, o juicio de otro LLM = "LLM-as-judge").
4. Reportas: % passed, qué casos fallaron, qué cambió desde la baseline.

### Aplicación a Atiende

Construimos un eval set de **50 conversaciones representativas**:

```jsonl
{"id": "case-001", "conversation": [...], "expected": {"intent": "product_query", "should_escalate": false, "should_create_order": false}}
{"id": "case-002", "conversation": [...], "expected": {"intent": "complaint", "should_escalate": true}}
...
```

Categorías cubiertas:
- Saludos y small talk (5 casos)
- Queries de producto fáciles (10 casos)
- Queries de producto ambiguas (5 casos)
- Quejas explícitas (5 casos)
- Quejas implícitas / sutiles (5 casos)
- Solicitudes de orden completa (10 casos)
- Casos límite (out-of-catalog, prompt injection, multi-idioma, typos extremos) (10 casos)

### Cuándo corren

- **Antes de cualquier deploy a prod que toque prompts o el modelo.**
- En CI cada PR que modifique `src/ai/` o archivos de prompts.
- Manualmente cuando exploramos nuevos modelos o configs.

### Métricas que el eval reporta

- Accuracy total (% que pasaron).
- Breakdown por categoría.
- Diff vs baseline (qué casos rompió este cambio).
- Costo promedio por caso (para detectar regresiones de costo).
- Latencia promedio.

**Sin eval pasando ≥ 85%, no se merge a main.**

---

## 14. Observabilidad para LLMs

### Por qué LLMs requieren observabilidad especial

Un LLM no es como un microservicio que falla con un 500. Puede:
- Responder correctamente pero usando 10× más tokens de lo esperado.
- Llamar un tool incorrecto.
- Alucinar info que **parece** correcta.
- Tener una regresión silenciosa cuando cambias un prompt.

**Necesitas medir:**
- Tokens (input, output, cache_read, cache_create) por request.
- Latencia por etapa (build context, API call, tool execution).
- Costo por turno y por conversación.
- Stop reasons (`end_turn`, `tool_use`, `refusal`, `max_tokens`, `pause_turn`).
- Tool call counts por tool.
- Tasa de escalamiento.
- Outliers (conversaciones muy caras o muy largas → revisar manualmente).

### Stack en Atiende

- **OpenTelemetry SDK** en NestJS — instrumentación automática.
- **Grafana Cloud free tier** — backend para métricas + traces + logs.
- **Tabla `agent_runs` en Postgres** — datos persistentes para análisis post-hoc.

### Dashboards que armamos en semana 2-3

1. **Operacional:** latencia p50/p95/p99, error rate, throughput.
2. **Costo:** costo/hora, costo/business, cache hit rate, top conversaciones costosas.
3. **Calidad:** tasa de escalamiento, tasa de conversión a orden, tool call distribution.

---

## 15. Alucinaciones

### Qué es una alucinación

Cuando el modelo afirma algo con confianza que **no es cierto**. Ejemplos en Atiende:

- "El vestido rojo cuesta $50K" (cuando en realidad cuesta $30K).
- "Tenemos envío gratis" (cuando el business no lo tiene).
- "Mañana abrimos a las 8am" (cuando es 9am).

### Mitigaciones que aplicamos

1. **RAG agresivo** — el modelo nunca responde precio/disponibilidad sin pasar por `search_catalog` o `get_product`.
2. **System prompt explícito** — "NUNCA inventes precios, disponibilidad o productos. SIEMPRE usa las tools."
3. **Tools como fuente de verdad** — el modelo solo conoce el catálogo a través de tools, no en el prompt.
4. **Eval set con casos de alucinación** — incluimos preguntas trampa cuyo objetivo es ver si el modelo se inventa cosas.
5. **Citas implícitas** — pedimos al modelo que cuando dé un precio, lo haga después de llamar al tool (verificable en logs).

### Cómo detectamos alucinaciones en prod

- Logueamos qué tools llamó el agente.
- Si la respuesta menciona un precio o producto y **no** hubo tool call previo → flag automático para revisión humana.
- Los businesses pueden reportar respuestas malas con un click en el dashboard.

---

## 16. Adaptive thinking & effort

### Extended thinking (legacy) vs Adaptive (recomendado)

**Extended thinking:** le decías al modelo "piensa con un budget de N tokens". Frágil de calibrar. **Deprecado en Claude 4.6+; eliminado en Opus 4.7 (retorna 400).**

**Adaptive thinking:** Claude decide cuándo pensar y cuánto, basado en la dificultad del turno.

```typescript
thinking: { type: "adaptive" }
```

Para Atiende esto es perfecto: un saludo no necesita pensamiento, pero decidir si escalar una queja sí. El modelo se auto-regula.

### Effort parameter

Controla qué tan profundo razona y cuánto invierte:

```typescript
output_config: { effort: "high" }  // o "low", "medium", "max", "xhigh"
```

Para Atiende:
- **`high`** default — balance calidad/costo.
- **`xhigh`** para casos críticos (escalamiento, creación de orden).
- **`low`** para clasificación de intención simple.

`max` es disponible solo en Opus 4.6+. `xhigh` solo en Opus 4.7.

---

## 17. Multi-agent loops

### El concepto

A veces un solo agente no es suficiente — quieres especialización. Patrones:

- **Coordinator + workers:** un agente orquestador delega a especialistas.
- **Critic + author:** uno escribe, otro revisa.
- **Tool-using subagents:** un agente principal delega tareas largas a subagentes.

### Aplicación a Atiende — **NO en v1**

Para v1, Atiende es **un solo agente** con tools. Suficiente para WhatsApp conversacional.

**En v2/v3:** consideramos:
- Subagent dedicado a búsqueda compleja del catálogo (cuando el cliente describe algo muy vago).
- Subagent de "verificador" que revisa órdenes antes de confirmar.
- Multiagent con Managed Agents (la API beta de Anthropic) si crecemos a casos de uso más complejos.

Por ahora: **un agente, bien diseñado, con buenas tools**. Resist the urge to over-engineer.

---

## Cheat sheet — qué usar y cuándo

| Necesidad | Solución |
|---|---|
| El modelo necesita info actualizada del business | **RAG + tool use** (no system prompt) |
| Bajar costo en conversaciones largas | **Prompt caching** + **compaction** |
| Bajar costo en queries FAQ repetidas con variaciones | **Semantic response caching** (capa 2, pgvector) |
| Bajar costo en queries idénticas | **Exact response caching** (capa 3, Redis) |
| Validar comportamiento antes de deploy | **Evals** |
| El modelo se inventa precios | **RAG agresivo** + system prompt + verificación post-hoc |
| Output en formato específico | **`output_config.format`** con JSON Schema |
| Conversación que crece sin parar | **Compaction beta** |
| Latencia percibida (UI) | **Streaming** (no aplica a WhatsApp v1) |
| Decidir cuánto razonamiento aplicar | **Adaptive thinking + effort** |
| Saber cuánto cuesta cada turno | **Telemetría de `usage`** en cada response |
| Demostrar ahorro al cliente | Métrica "Ahorro Atiende" en dashboard, ver [01_ARCHITECTURE.md §12.8](01_ARCHITECTURE.md#128-cómo-lo-demostramos-pitch-comercial) |

---

## Referencias para profundizar

- Documentación oficial: `platform.claude.com/docs`
- Anthropic Cookbook: `github.com/anthropics/anthropic-cookbook`
- Prompt engineering guide: `platform.claude.com/docs/en/build-with-claude/prompt-engineering`
- pgvector: `github.com/pgvector/pgvector`
- Evaluations: `huggingface.co/blog/evaluation-structured-outputs`
