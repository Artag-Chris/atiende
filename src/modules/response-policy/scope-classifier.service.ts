import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import { BUSINESS_REPOSITORY_TOKEN } from '@core/tokens';

export interface ScopeResult {
  inScope: boolean;
  reason?: string;
  confidence: number;
}

const OUT_OF_SCOPE_PATTERNS: { pattern: RegExp; category: string }[] = [
  // Política
  { pattern: /\b( presidente|presidenta|presidential|elección|elecciones|vot[oa]r|partido\s+político|congreso|senado|diputado|alcald[eiía]|gobernador|ministr[oa]|polític[ao]|política|gobierno|constitución|democracia|dictadura|comunismo|capitalismo|socialismo)\b/i, category: 'politics' },
  { pattern: /\b(trump|biden|petro|uribe|farc|eln|maduro|lula|milei|bolsonaro|fernández|kirchner|bukele|lópez|obrador|amlo|sheinbaum|duque|sanchez|macron|scholz|putin|zelensky|xi\s*jinping|modi)\b/i, category: 'politics' },

  // Religión
  { pattern: /\b( dios|jesús|cristo|bud[aá]|al[áa]|mahoma|profeta|biblia|corán|iglesia|pastor|sacerdote|religión|religioso|ateo|católico|cristian[ao]|musulm[áa]n|jud[ií]o|hindú|espiritual|fe\s+|oraci[óo]n|rezar|milagro)\b/i, category: 'religion' },

  // Celebridades / farándula
  { pattern: /\b( famos[oa]|celebridad|actor|actriz|cantante|far[áa]ndula|reality\s*show|instagramer|influencer|tiktoker|youtuber|modelo|presentador)\b/i, category: 'celebrities' },
  { pattern: /\b(shakira|karol\s*g|jbalvin|maluma|bad\s*bunny|daddy\s*yankee|rosal[íi]a|taylor\s*swift|beyoncé|rihanna|justin\s*bieber|the\s*weeknd|anuel|ozuna|rauw|alejandro\s*sanz|ricardo\s*arjona|luis\s*mi|messi|ronaldo|neymar|james\s*rodríguez|falcao)\b/i, category: 'celebrities' },

  // Deportes
  { pattern: /\b( f[úu]tbol|b[eé]isbol|baloncesto|tenis|boxeo|ciclismo|f[óo]rmula\s*1|nba|nfl|uefa|copa\s*mundo|mundial|ol[ií]mpic[oa]s|gol|goles|cancha|estadio|deporte|deportiv[oa]|partido\s+de|jugador|equipo\s+de|liga|campeonato|torneo)\b/i, category: 'sports' },

  // Historia / geografía
  { pattern: /\b( historia\s+de|históric[oa]|siglo\s+xix|siglo\s+xx|imperio|colonia|revolución|independencia|descubrimiento|guerra\s+mundial|capital\s+de|pa[íi]ses\s+del|océano|continente|r[íi]o|montaña|volc[áa]n|isla\s+de|cordillera)\b/i, category: 'history_geography' },

  // Ciencia general / educación (no relacionada al negocio)
  { pattern: /\b( física\s+(cuántica|nuclear)|qu[íi]mica|biolog[íi]a|matem[áa]ticas|teorema|f[óo]rmula\s+(matemática|química)|gen[é]tica|evolución|dinosaurio|planeta|galaxia|agujero\s+negro|cambio\s+clim[áa]tico|calentamiento\s+global|energ[íi]a\s+(solar|nuclear|renovable)|átomo|mole[ée]cula|c[é]lula|ecosistema|biodiversidad)\b/i, category: 'general_science' },

  // Tecnología general (no negocio)
  { pattern: /\b( inteligencia\s+artificial\s+(general|fuerte|débil)|singularidad\s+tecnológica|robot\s+(humanoide|aspiradora)?|c[oó]mo\s+programar|qu[ée]\s+es\s+(python|javascript|rust|typescript|java|c\+\+|html|sql)|mejor\s+(lenguaje|laptop|celular|teléfono)\s+(para\s+)?(programar|estudiar)|diferencia\s+entre\s+\w+\s+y\s+\w+)\b/i, category: 'general_tech' },
];

@Injectable()
export class ScopeClassifier {
  private readonly logger = new Logger(ScopeClassifier.name);

  constructor(
    @Inject(BUSINESS_REPOSITORY_TOKEN) private readonly businessRepo: BusinessRepositoryPort,
  ) {}

  async classify(businessId: string, message: string): Promise<ScopeResult> {
    if (!message || message.trim().length === 0) {
      return { inScope: false, reason: 'Mensaje vacío', confidence: 0 };
    }

    const outOfScope = this.matchOutOfScopePatterns(message);
    if (outOfScope) {
      this.logger.log(`Out-of-scope (${outOfScope.category}): "${message.slice(0, 60)}..."`);
      return {
        inScope: false,
        reason: `El mensaje trata sobre ${this.categoryLabel(outOfScope.category)}, no sobre el negocio.`,
        confidence: 0.9,
      };
    }

    return { inScope: true, confidence: 0.6 };
  }

  private matchOutOfScopePatterns(message: string): { category: string } | null {
    for (const entry of OUT_OF_SCOPE_PATTERNS) {
      if (entry.pattern.test(message)) {
        return { category: entry.category };
      }
    }
    return null;
  }

  private categoryLabel(category: string): string {
    const labels: Record<string, string> = {
      politics: 'política',
      religion: 'religión',
      celebrities: 'farándula o celebridades',
      sports: 'deportes',
      history_geography: 'historia o geografía',
      general_science: 'ciencia general',
      general_tech: 'tecnología general',
    };
    return labels[category] ?? category;
  }
}