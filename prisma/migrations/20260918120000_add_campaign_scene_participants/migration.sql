-- Fundamento aditivo de presencia de escena canónica (DC-NARR-002B PR 1).
--
-- Añade:
-- 1. "Campaign"."scenePresenceVersion" (INTEGER NOT NULL DEFAULT 0):
--    0 = resolución heredada mediante LocationNode.npcSeed.
--    1+ = CampaignSceneParticipant es autoritativo.
-- 2. Índice único compuesto "NPC_id_campaignId_key" sobre "NPC"("id", "campaignId")
--    para garantizar aislamiento multi-tenant por base de datos.
-- 3. Tabla "CampaignSceneParticipant" con clave primaria compuesta ("campaignId", "npcId")
--    y claves foráneas con ON DELETE CASCADE hacia Campaign y NPC.
-- 4. RLS deny-by-default sobre "CampaignSceneParticipant" según tests/architecture/rls-deny-by-default.test.ts.
--
-- ORDEN DE DESPLIEGUE CRÍTICO:
-- Esta migración DEBE aplicarse en la base de datos de producción ANTES de desplegar
-- el código que incluye el nuevo cliente de Prisma. Prisma Client selecciona todas
-- las columnas escalares de Campaign por defecto; desplegar el código antes de la
-- migración rompería las consultas sobre Campaign.
--
-- ─── Por qué un único bloque DO ──────────────────────────────────────────────
-- Misma razón que 20260814120000, 20260916120000 y 20260917120000: una sola
-- sentencia atómica que revierte con todo su DDL si algo falla, garantizando que
-- ninguna ejecución deje la base de datos en un estado intermedio o parcialmente
-- aplicado.
DO $add_campaign_scene_participants$
BEGIN
  -- 1. scenePresenceVersion en Campaign
  EXECUTE 'ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "scenePresenceVersion" INTEGER NOT NULL DEFAULT 0;';

  -- 2. Restricción / índice único compuesto en NPC
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "NPC_id_campaignId_key" ON "NPC"("id", "campaignId");';

  -- 3. Tabla CampaignSceneParticipant
  EXECUTE $create_participant_table$
CREATE TABLE IF NOT EXISTS "CampaignSceneParticipant" (
  "campaignId" TEXT NOT NULL,
  "npcId" TEXT NOT NULL,
  CONSTRAINT "CampaignSceneParticipant_pkey" PRIMARY KEY ("campaignId", "npcId")
);
$create_participant_table$;

  -- 4. Claves foráneas con comprobación de existencia
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CampaignSceneParticipant_campaignId_fkey'
  ) THEN
    EXECUTE '
      ALTER TABLE "CampaignSceneParticipant"
        ADD CONSTRAINT "CampaignSceneParticipant_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CampaignSceneParticipant_npcId_campaignId_fkey'
  ) THEN
    EXECUTE '
      ALTER TABLE "CampaignSceneParticipant"
        ADD CONSTRAINT "CampaignSceneParticipant_npcId_campaignId_fkey"
        FOREIGN KEY ("npcId", "campaignId") REFERENCES "NPC"("id", "campaignId")
        ON DELETE CASCADE ON UPDATE CASCADE;
    ';
  END IF;

  -- 5. RLS deny-by-default
  EXECUTE 'ALTER TABLE "public"."CampaignSceneParticipant" ENABLE ROW LEVEL SECURITY;';
END
$add_campaign_scene_participants$;
