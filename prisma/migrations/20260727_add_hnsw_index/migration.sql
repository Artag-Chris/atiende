-- HNSW index for product_embeddings vector similarity search
-- Uses cosine distance for text-embedding-3-small vectors

CREATE INDEX IF NOT EXISTS idx_product_embeddings_hnsw 
  ON product_embeddings 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
