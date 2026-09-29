-- CreateEnum
CREATE TYPE "PayPeriodType" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- AlterTable: company-wide payroll cadence. Single-statement default (unlike
-- the Shift.weekStart migration) since there's no per-row-correct value to
-- derive here — every existing Org can safely share the same anchor Monday.
ALTER TABLE "Org" ADD COLUMN     "payPeriodType" "PayPeriodType" NOT NULL DEFAULT 'BIWEEKLY';
ALTER TABLE "Org" ADD COLUMN     "payPeriodAnchor" TIMESTAMP(3) NOT NULL DEFAULT '2026-09-21T00:00:00.000Z';

-- AlterTable: when a worker started. Nullable, no default — existing Employee
-- rows have no real hire date to backfill, and a fabricated "today" would be
-- wrong. New rows get today's date set in application code at creation time
-- (see routes/employees.ts), not via a DB default.
ALTER TABLE "Employee" ADD COLUMN     "hireDate" TIMESTAMP(3);
