-- CreateEnum
CREATE TYPE "TimeClockMode" AS ENUM ('OFF', 'APP', 'POS');

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('CLOCK', 'IMPORT', 'MANUAL');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "timeClock" "TimeClockMode" NOT NULL DEFAULT 'OFF';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "posName" TEXT;

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakStartedAt" TIMESTAMP(3),
    "source" "TimeEntrySource" NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "editedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_employeeId_storeId_clockIn_key" ON "TimeEntry"("employeeId", "storeId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_storeId_clockIn_idx" ON "TimeEntry"("storeId", "clockIn");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
