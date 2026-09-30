-- Trial plans get one store (sections don't count); raised per business from the admin console. NULL = no limit.
ALTER TABLE "Org" ADD COLUMN "storeLimit" INTEGER DEFAULT 1;
