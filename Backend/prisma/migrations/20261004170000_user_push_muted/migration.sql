-- Phone-push categories a person has switched off.
ALTER TABLE "User" ADD COLUMN "pushMuted" TEXT[] DEFAULT ARRAY[]::TEXT[];
