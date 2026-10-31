-- Student ambassador program: applications, ambassador logins, program
-- settings, referrals and commissions per store, payouts, the shared lead list
-- with claims and outreach history, and an audit log. Also the yearly-billing
-- column on Org and the address/website/referral code on sign-up requests.

-- CreateEnum
CREATE TYPE "AmbassadorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('BOUNTY', 'RECURRING', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('APPROVED', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "LeadContactStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'DECLINED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('IMPORT', 'AMBASSADOR', 'HISTORY');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('IN_PERSON', 'PHONE', 'EMAIL', 'SOCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactOutcome" AS ENUM ('NO_ANSWER', 'LEFT_INFO', 'SPOKE', 'INTERESTED', 'FOLLOW_UP', 'DECLINED', 'DO_NOT_CONTACT');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'AMBASSADOR';

-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "billingInterval" TEXT;

-- AlterTable
ALTER TABLE "SignupRequest" ADD COLUMN     "address" TEXT,
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "AmbassadorApplication" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "school" TEXT,
    "area" TEXT NOT NULL,
    "experience" TEXT,
    "why" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" INTEGER,
    "decisionNote" TEXT,

    CONSTRAINT "AmbassadorApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ambassador" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "school" TEXT,
    "area" TEXT,
    "code" TEXT NOT NULL,
    "status" "AmbassadorStatus" NOT NULL DEFAULT 'ACTIVE',
    "userId" INTEGER,
    "inviteCode" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "applicationId" INTEGER,
    "isAdult" BOOLEAN NOT NULL DEFAULT false,
    "w9Received" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ambassador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorTermsAcceptance" (
    "id" SERIAL NOT NULL,
    "ambassadorId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbassadorTermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorProgram" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "bountyCents" INTEGER NOT NULL DEFAULT 800,
    "rateBps" INTEGER NOT NULL DEFAULT 2500,
    "extraStoreRateBps" INTEGER NOT NULL DEFAULT 1500,
    "maxPaidPeriods" INTEGER NOT NULL DEFAULT 12,
    "holdDays" INTEGER NOT NULL DEFAULT 14,
    "claimDays" INTEGER NOT NULL DEFAULT 7,
    "maxActiveClaims" INTEGER NOT NULL DEFAULT 5,
    "budgetCents" INTEGER NOT NULL DEFAULT 100000,
    "enrollmentOpen" BOOLEAN NOT NULL DEFAULT true,
    "referralsOpen" BOOLEAN NOT NULL DEFAULT true,
    "termsVersion" INTEGER NOT NULL DEFAULT 1,
    "termsText" TEXT NOT NULL,
    "termsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" SERIAL NOT NULL,
    "ambassadorId" INTEGER NOT NULL,
    "signupRequestId" INTEGER,
    "orgId" INTEGER,
    "source" TEXT NOT NULL,
    "leadId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bountyCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "extraStoreRateBps" INTEGER NOT NULL,
    "maxPaidPeriods" INTEGER NOT NULL,
    "foundOnline" BOOLEAN NOT NULL DEFAULT false,
    "phoneChecked" BOOLEAN NOT NULL DEFAULT false,
    "ownerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectNote" TEXT,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" SERIAL NOT NULL,
    "ambassadorId" INTEGER NOT NULL,
    "referralId" INTEGER,
    "storeId" INTEGER,
    "storeName" TEXT,
    "kind" "CommissionKind" NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "bountyStoreId" INTEGER,
    "stripeInvoiceId" TEXT,
    "stripePaymentRef" TEXT,
    "grossCents" INTEGER,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "periods" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT NOT NULL,
    "flags" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" INTEGER,
    "decisionNote" TEXT,
    "payoutId" INTEGER,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" SERIAL NOT NULL,
    "ambassadorId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" INTEGER,
    "paidAt" TIMESTAMP(3),
    "paidById" INTEGER,
    "method" TEXT,
    "reference" TEXT,
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "address" TEXT,
    "addressKey" TEXT,
    "city" TEXT,
    "cityKey" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "category" TEXT,
    "placeId" TEXT,
    "source" "LeadSource" NOT NULL,
    "submittedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contactStatus" "LeadContactStatus" NOT NULL DEFAULT 'NEW',
    "lastContactAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "dncReason" TEXT,
    "orgId" INTEGER,
    "followUpAskById" INTEGER,
    "followUpAskAt" TIMESTAMP(3),
    "followUpAskNote" TEXT,
    "reopenedForId" INTEGER,
    "mergedIntoId" INTEGER,
    "reviewNote" TEXT,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadClaim" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "ambassadorId" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "LeadClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadContact" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "ambassadorId" INTEGER,
    "contactedAt" TIMESTAMP(3) NOT NULL,
    "method" "ContactMethod" NOT NULL,
    "outcome" "ContactOutcome" NOT NULL,
    "notes" TEXT,
    "followUp" BOOLEAN NOT NULL DEFAULT false,
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorAudit" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" INTEGER,
    "action" TEXT NOT NULL,
    "ambassadorId" INTEGER,
    "referralId" INTEGER,
    "leadId" INTEGER,
    "commissionId" INTEGER,
    "payoutId" INTEGER,
    "detail" JSONB,

    CONSTRAINT "AmbassadorAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmbassadorApplication_email_idx" ON "AmbassadorApplication"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_email_key" ON "Ambassador"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_code_key" ON "Ambassador"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_userId_key" ON "Ambassador"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_inviteCode_key" ON "Ambassador"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_applicationId_key" ON "Ambassador"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorTermsAcceptance_ambassadorId_version_key" ON "AmbassadorTermsAcceptance"("ambassadorId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_signupRequestId_key" ON "Referral"("signupRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_orgId_key" ON "Referral"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_bountyStoreId_key" ON "Commission"("bountyStoreId");

-- CreateIndex
CREATE INDEX "Commission_ambassadorId_idx" ON "Commission"("ambassadorId");

-- CreateIndex
CREATE INDEX "Commission_stripePaymentRef_idx" ON "Commission"("stripePaymentRef");

-- CreateIndex
CREATE INDEX "Commission_status_idx" ON "Commission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_stripeInvoiceId_storeId_key" ON "Commission"("stripeInvoiceId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_placeId_key" ON "Lead"("placeId");

-- CreateIndex
CREATE INDEX "Lead_nameKey_idx" ON "Lead"("nameKey");

-- CreateIndex
CREATE INDEX "Lead_zip_idx" ON "Lead"("zip");

-- CreateIndex
CREATE INDEX "Lead_cityKey_idx" ON "Lead"("cityKey");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");

-- CreateIndex
CREATE INDEX "LeadClaim_leadId_idx" ON "LeadClaim"("leadId");

-- CreateIndex
CREATE INDEX "LeadClaim_ambassadorId_idx" ON "LeadClaim"("ambassadorId");

-- CreateIndex
CREATE INDEX "LeadContact_leadId_idx" ON "LeadContact"("leadId");

-- CreateIndex
CREATE INDEX "AmbassadorAudit_at_idx" ON "AmbassadorAudit"("at");

-- CreateIndex
CREATE INDEX "AmbassadorAudit_ambassadorId_idx" ON "AmbassadorAudit"("ambassadorId");

-- CreateIndex
CREATE INDEX "AmbassadorAudit_leadId_idx" ON "AmbassadorAudit"("leadId");

-- AddForeignKey
ALTER TABLE "Ambassador" ADD CONSTRAINT "Ambassador_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ambassador" ADD CONSTRAINT "Ambassador_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AmbassadorApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorTermsAcceptance" ADD CONSTRAINT "AmbassadorTermsAcceptance_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_signupRequestId_fkey" FOREIGN KEY ("signupRequestId") REFERENCES "SignupRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadClaim" ADD CONSTRAINT "LeadClaim_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadClaim" ADD CONSTRAINT "LeadClaim_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one open claim per lead, so two students can't hold the same
-- business at once (Prisma can't express a partial unique index).
CREATE UNIQUE INDEX "LeadClaim_one_open" ON "LeadClaim"("leadId") WHERE "endedAt" IS NULL;
