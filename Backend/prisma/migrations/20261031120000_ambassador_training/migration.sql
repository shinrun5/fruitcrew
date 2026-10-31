-- AlterTable
ALTER TABLE "Ambassador" ADD COLUMN     "trainingDone" TEXT[] DEFAULT ARRAY[]::TEXT[];
