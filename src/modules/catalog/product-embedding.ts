/**
 * Texto que se vectoriza para un producto/servicio.
 *
 * Vive aquí (y no en cada script) para que la ingesta del catálogo y la
 * vectorización de respaldo generen SIEMPRE el mismo embedding: si una
 * cambiara el criterio, la búsqueda semántica quedaría inconsistente.
 *
 * Ver prisma/schema.prisma → ProductEmbedding ("nombre+descripción").
 */
export function productEmbeddingText(product: {
  name: string;
  description: string | null;
}): string {
  return product.description ? `${product.name}\n${product.description}` : product.name;
}
