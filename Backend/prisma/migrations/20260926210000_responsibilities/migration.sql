-- CreateEnum
CREATE TYPE "ResponsibilityScope" AS ENUM ('OPENING', 'CLOSING', 'ANY');

-- CreateTable
CREATE TABLE "Responsibility" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "ResponsibilityScope" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeResponsibility" (
    "employeeId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "responsibilityId" INTEGER NOT NULL,

    CONSTRAINT "EmployeeResponsibility_pkey" PRIMARY KEY ("employeeId","storeId","responsibilityId")
);

-- CreateTable
CREATE TABLE "ClosingDutyAssignment" (
    "id" SERIAL NOT NULL,
    "closingDutyId" INTEGER NOT NULL,
    "responsibilityId" INTEGER NOT NULL,
    "employeeIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "ClosingDutyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Responsibility_storeId_name_key" ON "Responsibility"("storeId", "name");

-- CreateIndex
CREATE INDEX "EmployeeResponsibility_storeId_responsibilityId_idx" ON "EmployeeResponsibility"("storeId", "responsibilityId");

-- CreateIndex
CREATE UNIQUE INDEX "ClosingDutyAssignment_closingDutyId_responsibilityId_key" ON "ClosingDutyAssignment"("closingDutyId", "responsibilityId");

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeResponsibility" ADD CONSTRAINT "EmployeeResponsibility_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeResponsibility" ADD CONSTRAINT "EmployeeResponsibility_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeResponsibility" ADD CONSTRAINT "EmployeeResponsibility_responsibilityId_fkey" FOREIGN KEY ("responsibilityId") REFERENCES "Responsibility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingDutyAssignment" ADD CONSTRAINT "ClosingDutyAssignment_closingDutyId_fkey" FOREIGN KEY ("closingDutyId") REFERENCES "ClosingDuty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingDutyAssignment" ADD CONSTRAINT "ClosingDutyAssignment_responsibilityId_fkey" FOREIGN KEY ("responsibilityId") REFERENCES "Responsibility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: every store gets the one built-in responsibility that keeps powering
-- the auto-scheduler (Opener, read by lib/scheduleGen.ts) -- this replaces
-- EmployeeStore.canOpen, dropped at the bottom of this migration. There's no
-- equivalent single "Closer" builtin: canClose gated exactly one thing (who
-- could hold the "Closing" role below), so it's backfilled straight into that
-- role's own grants instead of inventing a second universal flag -- the whole
-- point of this feature is that each closing-time role gets its own
-- independently-grantable flag, not one flag that covers all of them.
INSERT INTO "Responsibility" ("storeId", "name", "scope", "sortOrder", "builtin")
SELECT "id", 'Opener', 'OPENING', 0, true FROM "Store";

-- Data: stores that use (or have ever used) the Closing Duties feature get the
-- same 4 roles they already had -- Closing/Bathroom/Sweep/Mop -- as ordinary,
-- store-editable Responsibility rows instead of ClosingDuty's fixed columns.
-- Matched against existing ClosingDuty rows too (not just the current
-- tracksClosingDuties toggle) so a store that had history before the feature
-- was switched off for it still gets rows to backfill into below.
INSERT INTO "Responsibility" ("storeId", "name", "scope", "sortOrder", "builtin")
SELECT s."id", 'Closing', 'CLOSING', 1, false FROM "Store" s
WHERE s."tracksClosingDuties" = true OR EXISTS (SELECT 1 FROM "ClosingDuty" cd WHERE cd."storeId" = s."id");

INSERT INTO "Responsibility" ("storeId", "name", "scope", "sortOrder", "builtin")
SELECT s."id", 'Bathroom', 'CLOSING', 2, false FROM "Store" s
WHERE s."tracksClosingDuties" = true OR EXISTS (SELECT 1 FROM "ClosingDuty" cd WHERE cd."storeId" = s."id");

INSERT INTO "Responsibility" ("storeId", "name", "scope", "sortOrder", "builtin")
SELECT s."id", 'Sweep', 'CLOSING', 3, false FROM "Store" s
WHERE s."tracksClosingDuties" = true OR EXISTS (SELECT 1 FROM "ClosingDuty" cd WHERE cd."storeId" = s."id");

INSERT INTO "Responsibility" ("storeId", "name", "scope", "sortOrder", "builtin")
SELECT s."id", 'Mop', 'CLOSING', 4, false FROM "Store" s
WHERE s."tracksClosingDuties" = true OR EXISTS (SELECT 1 FROM "ClosingDuty" cd WHERE cd."storeId" = s."id");

-- Data: backfill EmployeeResponsibility from the old canOpen/canClose flags.
-- canClose maps onto the "Closing" responsibility itself (see note above) --
-- for a store with no such row (never used Closing Duties) this silently
-- matches nothing, which is correct: canClose was never actionable there.
INSERT INTO "EmployeeResponsibility" ("employeeId", "storeId", "responsibilityId")
SELECT es."employeeId", es."storeId", r."id"
FROM "EmployeeStore" es
JOIN "Responsibility" r ON r."storeId" = es."storeId" AND r."name" = 'Opener'
WHERE es."canOpen" = true;

INSERT INTO "EmployeeResponsibility" ("employeeId", "storeId", "responsibilityId")
SELECT es."employeeId", es."storeId", r."id"
FROM "EmployeeStore" es
JOIN "Responsibility" r ON r."storeId" = es."storeId" AND r."name" = 'Closing'
WHERE es."canClose" = true;

-- Data: backfill ClosingDutyAssignment from ClosingDuty's old 4 fixed columns.
INSERT INTO "ClosingDutyAssignment" ("closingDutyId", "responsibilityId", "employeeIds")
SELECT cd."id", r."id", ARRAY[cd."closingEmployeeId"]
FROM "ClosingDuty" cd
JOIN "Responsibility" r ON r."storeId" = cd."storeId" AND r."name" = 'Closing'
WHERE cd."closingEmployeeId" IS NOT NULL;

INSERT INTO "ClosingDutyAssignment" ("closingDutyId", "responsibilityId", "employeeIds")
SELECT cd."id", r."id", cd."bathroomEmployeeIds"
FROM "ClosingDuty" cd
JOIN "Responsibility" r ON r."storeId" = cd."storeId" AND r."name" = 'Bathroom'
WHERE array_length(cd."bathroomEmployeeIds", 1) > 0;

INSERT INTO "ClosingDutyAssignment" ("closingDutyId", "responsibilityId", "employeeIds")
SELECT cd."id", r."id", ARRAY[cd."sweepEmployeeId"]
FROM "ClosingDuty" cd
JOIN "Responsibility" r ON r."storeId" = cd."storeId" AND r."name" = 'Sweep'
WHERE cd."sweepEmployeeId" IS NOT NULL;

INSERT INTO "ClosingDutyAssignment" ("closingDutyId", "responsibilityId", "employeeIds")
SELECT cd."id", r."id", ARRAY[cd."mopEmployeeId"]
FROM "ClosingDuty" cd
JOIN "Responsibility" r ON r."storeId" = cd."storeId" AND r."name" = 'Mop'
WHERE cd."mopEmployeeId" IS NOT NULL;

-- AlterTable: drop the columns these now replace -- only after every backfill above.
ALTER TABLE "EmployeeStore" DROP COLUMN "canOpen",
DROP COLUMN "canClose";

ALTER TABLE "ClosingDuty" DROP COLUMN "closingEmployeeId",
DROP COLUMN "bathroomEmployeeIds",
DROP COLUMN "sweepEmployeeId",
DROP COLUMN "mopEmployeeId";
