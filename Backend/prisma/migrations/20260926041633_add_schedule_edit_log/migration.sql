-- CreateTable
CREATE TABLE "ScheduleEditLog" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedById" INTEGER NOT NULL,

    CONSTRAINT "ScheduleEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleEditLog_storeId_weekStart_idx" ON "ScheduleEditLog"("storeId", "weekStart");

-- AddForeignKey
ALTER TABLE "ScheduleEditLog" ADD CONSTRAINT "ScheduleEditLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
