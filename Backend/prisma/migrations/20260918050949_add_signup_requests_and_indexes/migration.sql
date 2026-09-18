-- CreateTable
CREATE TABLE "SignupRequest" (
    "id" SERIAL NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,
    "orgId" INTEGER,

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeStore_storeId_idx" ON "EmployeeStore"("storeId");

-- CreateIndex
CREATE INDEX "RecurringAvailability_employeeId_idx" ON "RecurringAvailability"("employeeId");

-- CreateIndex
CREATE INDEX "Shift_storeId_idx" ON "Shift"("storeId");

-- CreateIndex
CREATE INDEX "Shift_employeeId_idx" ON "Shift"("employeeId");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_shiftId_idx" ON "ShiftChangeRequest"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_requestedById_idx" ON "ShiftChangeRequest"("requestedById");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_status_idx" ON "ShiftChangeRequest"("status");
