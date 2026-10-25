-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "sectionId" INTEGER;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Responsibility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
