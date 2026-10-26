-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "autoApproveTrades" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tradeCutoffHours" INTEGER NOT NULL DEFAULT 0;
