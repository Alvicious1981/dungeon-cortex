-- Reconcile db push drift: capture schema objects that were applied via
-- `prisma db push` and never recorded in the migration history.
-- This migration is already applied on the live database; it exists so the
-- shadow database (used by `migrate dev` validation) can build the correct
-- schema from migration history alone.

-- AddColumn: Combatant.ac (added to schema after add_combat_models)
ALTER TABLE "Combatant" ADD COLUMN "ac" INTEGER NOT NULL DEFAULT 10;

-- CreateTable: Quest
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable: NPC
CREATE TABLE "NPC" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "hp" INTEGER NOT NULL,
    "ac" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NPC_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SrdMonster
CREATE TABLE "SrdMonster" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    CONSTRAINT "SrdMonster_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SrdSpell
CREATE TABLE "SrdSpell" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    CONSTRAINT "SrdSpell_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SrdItem
CREATE TABLE "SrdItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    CONSTRAINT "SrdItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: Quest → Campaign
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: NPC → Campaign
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex: NPC unique constraint (campaignId, seed)
CREATE UNIQUE INDEX "NPC_campaignId_seed_key" ON "NPC"("campaignId", "seed");

-- CreateIndex: NPC campaignId lookup
CREATE INDEX "NPC_campaignId_idx" ON "NPC"("campaignId");
