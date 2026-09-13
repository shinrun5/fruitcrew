-- AlterTable
ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Data: the app's operator gets read-only cross-org oversight. Not self-serve.
UPDATE "User" SET "isSuperAdmin" = true WHERE "email" = 'hxrdaniel88@gmail.com';
