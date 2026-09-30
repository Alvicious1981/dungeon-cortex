-- DC-PARTY-001: establishes the Party/companion data foundation — a
-- normalized membership table between Campaign and Character, independent
-- of the existing Campaign.characterId scalar, which stays authoritative
-- for "the current main Character" during this compatibility phase.
-- See docs/PARTY_AND_COMPANIONS.md.

CREATE TYPE "PartyRole" AS ENUM ('MAIN', 'COMPANION');
CREATE TYPE "PartyControlMode" AS ENUM ('AI', 'USER');

CREATE TABLE "PartyMember" (
  "id"          TEXT NOT NULL,
  "campaignId"  TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "role"        "PartyRole" NOT NULL,
  "control"     "PartyControlMode" NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartyMember_pkey" PRIMARY KEY ("id")
);

-- Invariant: a Character cannot appear twice in the same Party.
CREATE UNIQUE INDEX "PartyMember_campaignId_characterId_key"
  ON "PartyMember"("campaignId", "characterId");

CREATE INDEX "PartyMember_campaignId_idx" ON "PartyMember"("campaignId");
CREATE INDEX "PartyMember_characterId_idx" ON "PartyMember"("characterId");

-- Exactly one MAIN per campaign. Same pattern as
-- 20260912220000_enforce_single_active_encounter's
-- Encounter_one_active_per_campaign_key. No pre-check DO block needed the
-- way that migration had one: this table is new in this same migration, so
-- no pre-existing data could already violate the invariant.
CREATE UNIQUE INDEX "PartyMember_one_main_per_campaign_key"
  ON "PartyMember"("campaignId")
  WHERE "role" = 'MAIN';

-- Matches the universal default for every FK to Campaign/Character in this
-- codebase. PartyMember is ordinary campaign-owned domain data, not
-- ephemeral infrastructure like ActionRequestReceipt, so it does not take
-- that table's CASCADE exception.
ALTER TABLE "PartyMember"
  ADD CONSTRAINT "PartyMember_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartyMember"
  ADD CONSTRAINT "PartyMember_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mandatory per tests/architecture/rls-deny-by-default.test.ts: every table
-- created after 20260816120000 must enable RLS in its own creating
-- migration. No policies — deny-by-default; the app connects via a role
-- with rolbypassrls = true, so this only closes Supabase's public Data API.
ALTER TABLE "public"."PartyMember" ENABLE ROW LEVEL SECURITY;

-- Backfill: every existing Campaign gets a role=MAIN, control=USER
-- PartyMember row for its current characterId, so "this Campaign has a
-- Party" is true for historical data the instant this migration applies.
-- Runs last, after every constraint above exists, so a bug here fails
-- loudly instead of landing bad rows silently.
--
-- Idempotent via ON CONFLICT on the (campaignId, characterId) unique index,
-- so a retried `prisma migrate deploy` is safe.
--
-- gen_random_uuid() (pgcrypto — enabled in schema.prisma's datasource
-- extensions list) is used for the id because cuid() is a Prisma
-- Client-side JS default, not a Postgres function; hand-written SQL has no
-- way to call it, and PartyMember.id carries no format requirement beyond
-- uniqueness.
--
-- createdAt/updatedAt are backdated to the Campaign's own createdAt: the
-- MAIN membership has existed since the campaign began, not since this
-- migration happened to run.
INSERT INTO "PartyMember" ("id", "campaignId", "characterId", "role", "control", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "Campaign"."id",
  "Campaign"."characterId",
  'MAIN',
  'USER',
  "Campaign"."createdAt",
  "Campaign"."createdAt"
FROM "Campaign"
ON CONFLICT ("campaignId", "characterId") DO NOTHING;
