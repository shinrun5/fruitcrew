-- Sign in with Apple: what's needed to revoke it when the account is deleted.
ALTER TABLE "User" ADD COLUMN "appleRefreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "appleClientId" TEXT;
