-- Editable character profiles with optimistic concurrency, proposals, and immutable audit.
-- This migration is intentionally additive. It must be reviewed and applied separately.

CREATE TYPE "CharacterProfileField" AS ENUM (
  'NAME',
  'APPEARANCE',
  'BACKSTORY',
  'PERSONALITY_TRAITS',
  'IDEALS',
  'BONDS',
  'FLAWS'
);

CREATE TYPE "CharacterChangeSource" AS ENUM ('PLAYER', 'AI_PROPOSAL', 'PDF_IMPORT', 'UNDO');
CREATE TYPE "CharacterProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'STALE', 'EXPIRED');
CREATE TYPE "CharacterProposalValidationStatus" AS ENUM ('VALID', 'REJECTED');

ALTER TABLE "Character"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "CharacterProfile" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "appearance" TEXT NOT NULL DEFAULT '',
  "backstory" TEXT NOT NULL DEFAULT '',
  "personalityTraits" TEXT NOT NULL DEFAULT '',
  "ideals" TEXT NOT NULL DEFAULT '',
  "bonds" TEXT NOT NULL DEFAULT '',
  "flaws" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CharacterProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CharacterChangeProposal" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "expectedVersion" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "previousValues" JSONB NOT NULL,
  "validationStatus" "CharacterProposalValidationStatus" NOT NULL,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "requiresPlayerConfirmation" BOOLEAN NOT NULL DEFAULT true,
  "status" "CharacterProposalStatus" NOT NULL DEFAULT 'PENDING',
  "source" "CharacterChangeSource" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "decisionIdempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "CharacterChangeProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CharacterChangeAudit" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "field" "CharacterProfileField" NOT NULL,
  "previousValue" JSONB NOT NULL,
  "newValue" JSONB NOT NULL,
  "source" "CharacterChangeSource" NOT NULL,
  "reason" TEXT,
  "revisionBefore" INTEGER NOT NULL,
  "revisionAfter" INTEGER NOT NULL,
  "proposalId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterChangeAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterProfile_characterId_key" ON "CharacterProfile"("characterId");
CREATE UNIQUE INDEX "CharacterChangeProposal_actorUserId_idempotencyKey_key" ON "CharacterChangeProposal"("actorUserId", "idempotencyKey");
CREATE UNIQUE INDEX "CharacterChangeProposal_actorUserId_decisionIdempotencyKey_key" ON "CharacterChangeProposal"("actorUserId", "decisionIdempotencyKey");
CREATE INDEX "CharacterChangeProposal_characterId_status_createdAt_idx" ON "CharacterChangeProposal"("characterId", "status", "createdAt");
CREATE UNIQUE INDEX "CharacterChangeAudit_actorUserId_idempotencyKey_key" ON "CharacterChangeAudit"("actorUserId", "idempotencyKey");
CREATE INDEX "CharacterChangeAudit_characterId_createdAt_idx" ON "CharacterChangeAudit"("characterId", "createdAt");
CREATE INDEX "CharacterChangeAudit_proposalId_idx" ON "CharacterChangeAudit"("proposalId");

ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterChangeProposal" ADD CONSTRAINT "CharacterChangeProposal_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterChangeAudit" ADD CONSTRAINT "CharacterChangeAudit_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterChangeAudit" ADD CONSTRAINT "CharacterChangeAudit_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "CharacterChangeProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
