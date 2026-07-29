-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('ACTIVE', 'ESCALATED', 'RESOLVED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('WHATSAPP', 'WEB_CHAT', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "cache_hit_layer" AS ENUM ('EXACT', 'SEMANTIC');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "knowledge_kind" AS ENUM ('FAQ', 'POLICY', 'PDF_CATALOG', 'MANUAL', 'NOTES', 'OTHER');

-- CreateEnum
CREATE TYPE "knowledge_status" AS ENUM ('PENDING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXED', 'FAILED');

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp_phone_id" TEXT NOT NULL,
    "whatsapp_token_encrypted" TEXT NOT NULL,
    "system_prompt_extras" TEXT,
    "settings_jsonb" JSONB NOT NULL DEFAULT '{}',
    "feature_overrides_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "image_url" TEXT,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_embeddings" (
    "product_id" UUID NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "channel" "channel" NOT NULL DEFAULT 'WHATSAPP',
    "customer_identifier" TEXT NOT NULL,
    "status" "conversation_status" NOT NULL DEFAULT 'ACTIVE',
    "summary_text" TEXT,
    "last_message_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "escalation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "message_role" NOT NULL,
    "content_jsonb" JSONB NOT NULL,
    "token_usage_jsonb" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "raw_payload_jsonb" JSONB NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "llm_provider" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_creation_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6) NOT NULL,
    "tool_calls_jsonb" JSONB NOT NULL DEFAULT '[]',
    "stop_reason" TEXT,
    "cache_hit_layer_enum" "cache_hit_layer",
    "cache_hit_similarity" DECIMAL(5,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "customer_info_jsonb" JSONB NOT NULL,
    "items_jsonb" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_cache" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "query_text" TEXT NOT NULL,
    "query_embedding" vector(1536) NOT NULL,
    "response_text" TEXT NOT NULL,
    "tool_calls_jsonb" JSONB NOT NULL DEFAULT '[]',
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "knowledge_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "status" "knowledge_status" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "indexed_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "knowledge_kind" NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "page_number" INTEGER,
    "embedding_model" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_cases" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "conversation_setup_jsonb" JSONB NOT NULL,
    "expected_outcome_jsonb" JSONB NOT NULL,
    "tags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_runs" (
    "id" UUID NOT NULL,
    "eval_case_id" UUID NOT NULL,
    "agent_version" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "output_jsonb" JSONB NOT NULL,
    "notes" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "cost_usd" DECIMAL(10,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_whatsapp_phone_id_key" ON "businesses"("whatsapp_phone_id");

-- CreateIndex
CREATE INDEX "businesses_archived_at_idx" ON "businesses"("archived_at");

-- CreateIndex
CREATE INDEX "products_business_id_active_idx" ON "products"("business_id", "active");

-- CreateIndex
CREATE INDEX "products_business_id_category_idx" ON "products"("business_id", "category");

-- CreateIndex
CREATE INDEX "conversations_business_id_status_last_message_at_idx" ON "conversations"("business_id", "status", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_business_id_channel_customer_identifier_key" ON "conversations"("business_id", "channel", "customer_identifier");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "inbound_messages_processed_at_idx" ON "inbound_messages"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_business_id_external_message_id_key" ON "inbound_messages"("business_id", "external_message_id");

-- CreateIndex
CREATE INDEX "agent_runs_business_id_created_at_idx" ON "agent_runs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_conversation_id_created_at_idx" ON "agent_runs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_created_at_idx" ON "agent_runs"("created_at");

-- CreateIndex
CREATE INDEX "orders_business_id_status_created_at_idx" ON "orders"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "orders_conversation_id_idx" ON "orders"("conversation_id");

-- CreateIndex
CREATE INDEX "response_cache_business_id_embedding_model_expires_at_idx" ON "response_cache"("business_id", "embedding_model", "expires_at");

-- CreateIndex
CREATE INDEX "response_cache_expires_at_idx" ON "response_cache"("expires_at");

-- CreateIndex
CREATE INDEX "knowledge_documents_business_id_kind_active_idx" ON "knowledge_documents"("business_id", "kind", "active");

-- CreateIndex
CREATE INDEX "knowledge_documents_business_id_status_idx" ON "knowledge_documents"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_business_id_source_key" ON "knowledge_documents"("business_id", "source");

-- CreateIndex
CREATE INDEX "knowledge_chunks_business_id_kind_embedding_model_idx" ON "knowledge_chunks"("business_id", "kind", "embedding_model");

-- CreateIndex
CREATE INDEX "knowledge_chunks_document_id_position_idx" ON "knowledge_chunks"("document_id", "position");

-- CreateIndex
CREATE INDEX "eval_cases_category_idx" ON "eval_cases"("category");

-- CreateIndex
CREATE INDEX "eval_runs_eval_case_id_agent_version_idx" ON "eval_runs"("eval_case_id", "agent_version");

-- CreateIndex
CREATE INDEX "eval_runs_agent_version_created_at_idx" ON "eval_runs"("agent_version", "created_at");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_cache" ADD CONSTRAINT "response_cache_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_eval_case_id_fkey" FOREIGN KEY ("eval_case_id") REFERENCES "eval_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
