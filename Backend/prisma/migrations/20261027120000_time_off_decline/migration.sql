-- A manager can turn time off down (it then stops blocking scheduling)
ALTER TABLE "TimeOffRequest" ADD COLUMN "declinedAt" TIMESTAMP(3),
ADD COLUMN "declinedById" INTEGER,
ADD COLUMN "declineNote" TEXT;
