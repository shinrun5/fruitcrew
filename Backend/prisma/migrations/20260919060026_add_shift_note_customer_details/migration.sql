-- AlterTable
ALTER TABLE "ShiftNote" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "issueAt" TIMESTAMP(3),
ADD COLUMN     "orderDetails" TEXT;
