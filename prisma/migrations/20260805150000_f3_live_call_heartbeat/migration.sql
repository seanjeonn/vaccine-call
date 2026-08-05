-- AlterTable
-- 기존 행을 채우려면 기본값이 필요하지만, 스키마에는 @default이 없으므로 채운 뒤 기본값을 뗀다.
ALTER TABLE "LiveCall" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "LiveCall" ALTER COLUMN "updatedAt" DROP DEFAULT;
