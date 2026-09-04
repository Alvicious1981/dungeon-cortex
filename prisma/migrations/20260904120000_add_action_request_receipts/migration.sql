-- Recibos persistentes de acción (DC-AUD-003).
--
-- Por qué existe esta tabla: `POST /api/campaign/[id]/action` transmite desde
-- DC-AUD-002 el `requestId` que el cliente genera por envío, pero nada lo
-- consumía. Sin un registro duradero, un reintento tras perder la conexión
-- vuelve a ejecutar las mecánicas completas: segundo ataque, segunda ranura de
-- conjuro gastada, turno avanzado dos veces y una fila `role:"user"` duplicada
-- en la historia canónica. El índice único de más abajo es lo que convierte la
-- adquisición en atómica: decide la base de datos qué petición posee un envío,
-- no la aplicación.
--
-- INVARIANTE: `COMPLETED` significa que el resultado autoritativo/mecánico
-- terminó. No dice nada sobre si la narración se entregó o se persistió.
--
-- No hay backfill: las peticiones anteriores a esta migración no tienen recibo
-- y siguen comportándose como hasta ahora (el `requestId` es opcional).
--
-- CREATE TABLE en SQL plano, no envuelto en `DO ... EXECUTE`, porque
-- tests/architecture/migration-schema-drift.test.ts contrasta estáticamente
-- estas columnas contra schema.prisma y necesita poder parsearlas.

CREATE TYPE "ActionRequestStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'REJECTED');

CREATE TABLE "ActionRequestReceipt" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "ActionRequestStatus" NOT NULL DEFAULT 'PROCESSING',
  "responseStatus" INTEGER,
  "responseBody" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActionRequestReceipt_pkey" PRIMARY KEY ("id")
);

-- La adquisición depende de esta restricción: un `create` que la viole devuelve
-- P2002, y ese conflicto es la señal de duplicado. Sin el índice único la
-- exclusión mutua desaparece y dos peticiones concurrentes ejecutarían ambas.
CREATE UNIQUE INDEX "ActionRequestReceipt_actorUserId_requestId_key"
  ON "ActionRequestReceipt"("actorUserId", "requestId");

CREATE INDEX "ActionRequestReceipt_campaignId_createdAt_idx"
  ON "ActionRequestReceipt"("campaignId", "createdAt");

-- CASCADE, a diferencia de GameLog (RESTRICT): los recibos son infraestructura
-- efímera, no historia. Además es necesario, no solo ordenado — el ayudante de
-- limpieza E2E borra campañas, y un RESTRICT bloquearía ese borrado en cuanto
-- existiera un recibo.
ALTER TABLE "ActionRequestReceipt"
  ADD CONSTRAINT "ActionRequestReceipt_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Obligatorio en esta misma migración: el barrido 20260816120000 activó RLS
-- deny-by-default sobre todas las tablas existentes entonces, y
-- tests/architecture/rls-deny-by-default.test.ts exige que toda tabla creada
-- después la active explícitamente donde se crea.
ALTER TABLE "public"."ActionRequestReceipt" ENABLE ROW LEVEL SECURITY;
