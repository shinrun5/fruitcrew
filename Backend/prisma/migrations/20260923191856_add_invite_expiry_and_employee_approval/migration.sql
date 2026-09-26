-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "inviteCodeExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ManagerInvite" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoreInvite" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT true;
