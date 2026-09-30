-- Stripe billing: free trial, comped businesses, and the subscription mirror.
-- Additive only; nothing is enforced until the Stripe env vars are set.
ALTER TABLE "Org" ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripeSubscriptionId" TEXT,
ADD COLUMN "subscriptionStatus" TEXT,
ADD COLUMN "trialReminderSentDays" INTEGER;

CREATE UNIQUE INDEX "Org_stripeCustomerId_key" ON "Org"("stripeCustomerId");
CREATE UNIQUE INDEX "Org_stripeSubscriptionId_key" ON "Org"("stripeSubscriptionId");
