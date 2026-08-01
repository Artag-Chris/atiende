-- ============================================================================
-- Multi-canal: tabla channel_accounts + extensión del enum channel
-- D1: credenciales per-business en ChannelAccount (channel, accountId,
-- tokenEncrypted, isPrimary). Los campos legacy businesses.whatsapp_phone_id
-- / whatsapp_token_encrypted quedan como fallback transitorio.
-- Backfill: copia las credenciales WhatsApp legacy a channel_accounts.
-- ============================================================================

ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'MESSENGER';

CREATE TABLE "channel_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "account_id" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_accounts_channel_account_id_key" ON "channel_accounts"("channel", "account_id");
CREATE INDEX "channel_accounts_business_id_channel_idx" ON "channel_accounts"("business_id", "channel");

ALTER TABLE "channel_accounts"
    ADD CONSTRAINT "channel_accounts_business_id_fkey" FOREIGN KEY ("business_id")
    REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "channel_accounts" ("id", "business_id", "channel", "account_id", "token_encrypted", "is_primary", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 'WHATSAPP', "whatsapp_phone_id", "whatsapp_token_encrypted", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "businesses"
WHERE "whatsapp_phone_id" IS NOT NULL AND "whatsapp_token_encrypted" IS NOT NULL
ON CONFLICT ("channel", "account_id") DO NOTHING;
