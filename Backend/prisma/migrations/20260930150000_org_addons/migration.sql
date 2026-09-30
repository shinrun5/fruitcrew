-- Paid add-ons a business subscribes to (chat, notes, closing), mirrored from Stripe.
ALTER TABLE "Org" ADD COLUMN "addons" TEXT[] DEFAULT ARRAY[]::TEXT[];
