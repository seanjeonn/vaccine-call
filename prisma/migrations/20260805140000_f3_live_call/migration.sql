-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'training';

-- CreateTable
CREATE TABLE "LiveCall" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mode" TEXT NOT NULL DEFAULT 'live',
    "stage" TEXT NOT NULL DEFAULT 'none',
    "risk" INTEGER NOT NULL DEFAULT 0,
    "scamType" TEXT NOT NULL DEFAULT 'unknown',
    "summary" TEXT NOT NULL DEFAULT '',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "reportId" TEXT,
    "alertedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveCall_parentId_startedAt_idx" ON "LiveCall"("parentId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "LiveCall" ADD CONSTRAINT "LiveCall_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
