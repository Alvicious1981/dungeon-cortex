-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "SessionMode" AS ENUM ('PREPARING', 'NARRATIVE', 'SOCIAL', 'EXPLORATION', 'COMBAT', 'REST', 'RESOLUTION', 'PAUSED', 'COMPLETED');
CREATE TYPE "ActionRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sessionNumber" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "mode" "SessionMode" NOT NULL DEFAULT 'PREPARING',
    "sceneNumber" INTEGER NOT NULL DEFAULT 1,
    "sceneTitle" TEXT,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionRequest" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "ActionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameEventRecord" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameEventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_campaignId_sessionNumber_key" ON "GameSession"("campaignId", "sessionNumber");
CREATE INDEX "GameSession_campaignId_status_idx" ON "GameSession"("campaignId", "status");
CREATE UNIQUE INDEX "ActionRequest_campaignId_requestId_key" ON "ActionRequest"("campaignId", "requestId");
CREATE INDEX "ActionRequest_sessionId_createdAt_idx" ON "ActionRequest"("sessionId", "createdAt");
CREATE UNIQUE INDEX "GameEventRecord_sessionId_sequence_key" ON "GameEventRecord"("sessionId", "sequence");
CREATE INDEX "GameEventRecord_campaignId_createdAt_idx" ON "GameEventRecord"("campaignId", "createdAt");
CREATE INDEX "GameEventRecord_requestId_idx" ON "GameEventRecord"("requestId");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameEventRecord" ADD CONSTRAINT "GameEventRecord_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameEventRecord" ADD CONSTRAINT "GameEventRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
