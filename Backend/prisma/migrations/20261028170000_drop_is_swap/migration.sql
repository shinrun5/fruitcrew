-- A "drop" and an open "swap" were the same thing: a shift posted for anyone
-- to take. Keep one: existing drops become open swaps, then DROP goes away.
UPDATE "ShiftChangeRequest" SET "type" = 'SWAP', "openOffer" = true WHERE "type" = 'DROP';

-- AlterEnum
BEGIN;
CREATE TYPE "ChangeType_new" AS ENUM ('SWAP', 'PICKUP');
ALTER TABLE "ShiftChangeRequest" ALTER COLUMN "type" TYPE "ChangeType_new" USING ("type"::text::"ChangeType_new");
ALTER TYPE "ChangeType" RENAME TO "ChangeType_old";
ALTER TYPE "ChangeType_new" RENAME TO "ChangeType";
DROP TYPE "ChangeType_old";
COMMIT;
