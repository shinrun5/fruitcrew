-- AlterTable
ALTER TABLE "Store" ADD COLUMN "tracksClosingDuties" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "EmployeeStore" ADD COLUMN "canClose" BOOLEAN NOT NULL DEFAULT false;

-- Data: Ciao Poke doesn't use the Closing Duties feature.
UPDATE "Store" SET "tracksClosingDuties" = false WHERE "name" = 'Ciao Poke';

-- Data: only these named people are trusted to hold the "Closing" role at Mango Mango.
UPDATE "EmployeeStore" es
SET "canClose" = true
FROM "Employee" e, "Store" s
WHERE es."employeeId" = e.id
  AND es."storeId" = s.id
  AND s.name = 'Mango Mango'
  AND e.name IN ('Daniel He', 'Rey', 'Owen', 'Cynthia Yao', 'Rachel Z.', 'Cindy');
