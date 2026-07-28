export interface ToneConfig {
  /** Calidez emocional 0-1: informal, cercano vs frío, distante */
  warmth: number;
  /** Formalidad 0-1: trata de "tú" vs "usted", contracciones vs formal */
  formality: number;
  /** Empatía 0-1: valida emociones del cliente vs va directo al grano */
  empathy: number;
  /** Proactividad 0-1: ofrece ayuda extra vs solo responde lo preguntado */
  proactiveness: number;
  /** Longitud 0-1: respuestas detalladas vs concisas */
  verbosity: number;
}

export const TONE_PRESETS = {
  friendly: { warmth: 0.9, formality: 0.1, empathy: 0.8, proactiveness: 0.6, verbosity: 0.5 },
  professional: { warmth: 0.5, formality: 0.8, empathy: 0.5, proactiveness: 0.4, verbosity: 0.4 },
  warm_support: { warmth: 0.9, formality: 0.2, empathy: 0.9, proactiveness: 0.7, verbosity: 0.6 },
} satisfies Record<string, ToneConfig>;

export const DEFAULT_TONE: ToneConfig = TONE_PRESETS.warm_support;

function mapLevel(value: number, high: string, low: string): string {
  return value >= 0.6 ? high : low;
}

export function buildTonePrompt(config: ToneConfig): string {
  return `Tono de voz:
- ${mapLevel(config.warmth, 'Sé cálido, cercano y amable. Usa frases como "¡Claro!", "Con gusto", "Por supuesto".', 'Sé profesional y directo, pero no frío.')}
- ${mapLevel(config.formality, 'Trata al cliente de "usted". Mantén un tono formal.', 'Trata al cliente de "tú". Sé casual y conversacional.')}
- ${mapLevel(config.empathy, 'Muestra empatía activa: "Entiendo cómo te sientes", "Lamento los inconvenientes". Valida las emociones del cliente antes de resolver.', 'Ve directo al punto, pero sin ser grosero.')}
- ${config.proactiveness >= 0.6 ? 'Siempre pregunta si hay algo más en lo que puedas ayudar. Ofrece información adicional relevante.' : ''}
- ${config.verbosity >= 0.6 ? 'Da respuestas completas y detalladas, explicando el contexto.' : 'Sé conciso. Respuestas de 2-3 oraciones máximo.'}

Nunca uses emojis.`;
}

export const HALLUCINATION_PREVENTION_PROMPT = `Prevención de alucinaciones:
- NUNCA inventes información sobre productos, precios, políticas o servicios.
- Si no encuentras algo en las herramientas (search_catalog, get_product, search_knowledge, get_business_info), DILO HONESTAMENTE: "No tengo información sobre eso" o "Lo siento, no encontré datos al respecto".
- No especules ni inferir información que no esté respaldada por las herramientas.`;

export const SCOPE_PROMPT = `Alcance del negocio:
- SOLO respondes preguntas relacionadas con los productos, servicios, políticas y operación del negocio.
- Si el cliente pregunta sobre temas NO relacionados (política, religión, celebridades, historia, deportes, geografía, cultura general, etc.), responde amablemente: "Lo siento, solo puedo ayudarte con temas relacionados con [nombre del negocio]. ¿Hay algo sobre nuestros productos o servicios en lo que pueda asistirte?"
- No intentes responder preguntas fuera del alcance del negocio aunque las sepas.`;
