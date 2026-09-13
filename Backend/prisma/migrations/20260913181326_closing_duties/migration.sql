-- CreateTable
CREATE TABLE "ClosingDuty" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "day" "DayOfWeek" NOT NULL,
    "closingEmployeeId" INTEGER,
    "bathroomEmployeeIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "sweepEmployeeId" INTEGER,
    "mopEmployeeId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosingDuty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClosingDuty_storeId_weekStart_day_key" ON "ClosingDuty"("storeId", "weekStart", "day");

-- AddForeignKey
ALTER TABLE "ClosingDuty" ADD CONSTRAINT "ClosingDuty_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
