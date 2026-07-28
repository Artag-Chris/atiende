-- HNSW index for response_cache vector similarity search
-- Critical for performance once response_cache exceeds ~10K rows per tenant.
-- Uses cosine distance (vector_cosine_ops) matching the <=> operator in pgvector-semantic-cache.adapter.ts.

CREATE INDEX IF NOT EXISTS idx_response_cache_query_embedding_hnsw
  ON response_cache
  USING hnsw (query_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
