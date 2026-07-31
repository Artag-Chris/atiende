import type { ConversationRepositoryPort } from './conversation-repository.port';
import type { InboundMessageRepositoryPort } from './inbound-message-repository.port';
import type { MessageRepositoryPort } from './message-repository.port';

/**
 * Repositorios de la transacción en curso.
 * Los implementadores DEBEN instanciarlos bound al client aislado de la
 * $transaction — las escrituras se commitean/rollbackean juntas.
 */
export interface UnitOfWorkContext {
  conversationRepo: ConversationRepositoryPort;
  inboundMessageRepo: InboundMessageRepositoryPort;
  messageRepo: MessageRepositoryPort;
}

/**
 * Port para escribir varias entidades de forma atómica.
 *
 * Regla de uso: el callback NO debe hacer llamadas externas largas
 * (LLM, HTTP) — la transacción se mantiene abierta mientras corre.
 * Se usa para el "esqueleto" del pipeline: inbound + conversation +
 * USER message se persisten en un solo commit (zero-loss NFR-8).
 */
export interface UnitOfWorkPort {
  withTransaction<T>(fn: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T>;
}
