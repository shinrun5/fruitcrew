-- CreateTable
CREATE TABLE "ShiftCounterOffer" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftCounterOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftCounterOffer_requestId_idx" ON "ShiftCounterOffer"("requestId");

-- AddForeignKey
ALTER TABLE "ShiftCounterOffer" ADD CONSTRAINT "ShiftCounterOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ShiftChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCounterOffer" ADD CONSTRAINT "ShiftCounterOffer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
