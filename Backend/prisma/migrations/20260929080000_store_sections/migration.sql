-- A section (e.g. "Front of House" / "Back of House") is just a Store row
-- with a parent — every existing subsystem already hangs off storeId, so a
-- section gets its own independent schedule/requirements/responsibilities/
-- hours for free. Null = an ordinary top-level store (every store today).
ALTER TABLE "Store" ADD COLUMN "parentStoreId" INTEGER;

ALTER TABLE "Store" ADD CONSTRAINT "Store_parentStoreId_fkey"
  FOREIGN KEY ("parentStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Store_parentStoreId_idx" ON "Store"("parentStoreId");
