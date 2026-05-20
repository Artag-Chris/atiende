-- Habilita la extensión pgvector la primera vez que arranca Postgres.
-- Este archivo lo ejecuta automáticamente la imagen oficial al inicializar la DB.
CREATE EXTENSION IF NOT EXISTS vector;
