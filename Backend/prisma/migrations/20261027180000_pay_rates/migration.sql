-- Hourly pay per worker, and whether managers (not just owners) can see it
ALTER TABLE "Employee" ADD COLUMN "payRateCents" INTEGER;
ALTER TABLE "Org" ADD COLUMN "managersSeePay" BOOLEAN NOT NULL DEFAULT false;
