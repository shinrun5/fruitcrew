-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "postedWeekStart" TIMESTAMP(3);

-- AlterTable: add Shift.weekStart NULLABLE first — the table is populated,
-- so a NOT NULL column needs a backfill before it can be enforced.
ALTER TABLE "Shift" ADD COLUMN     "weekStart" TIMESTAMP(3);

-- Backfill: every existing Shift row belongs to whatever its store's current
-- Schedule.weekStart is — there was only ever one live week per store before
-- this migration, by construction.
UPDATE "Shift" s
SET "weekStart" = sc."weekStart"
FROM "Schedule" sc
WHERE sc."storeId" = s."storeId" AND sc."weekStart" IS NOT NULL;

-- Fallback for the (should be rare/nonexistent) case of a Shift row whose
-- store has no Schedule row yet, or a null weekStart — anchor it to this
-- Monday UTC rather than leaving it null. Computed with the same mondayUTC()
-- helper scheduleGen.ts uses, not re-derived in SQL.
UPDATE "Shift"
SET "weekStart" = '2026-09-21T00:00:00.000Z'
WHERE "weekStart" IS NULL;

-- Now safe to enforce NOT NULL
ALTER TABLE "Shift" ALTER COLUMN "weekStart" SET NOT NULL;

-- Backfill: a store that's currently published has its live week == its
-- posted week today, by construction.
UPDATE "Schedule"
SET "postedWeekStart" = "weekStart"
WHERE "publishedAt" IS NOT NULL;

-- DropIndex: superseded by the compound indexes below
DROP INDEX "Shift_employeeId_idx";

-- DropIndex
DROP INDEX "Shift_storeId_idx";

-- CreateIndex
CREATE INDEX "Shift_storeId_weekStart_idx" ON "Shift"("storeId", "weekStart");

-- CreateIndex
CREATE INDEX "Shift_employeeId_weekStart_idx" ON "Shift"("employeeId", "weekStart");
