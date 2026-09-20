-- CreateTable
CREATE TABLE "StoreInvite" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "storeId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreInvite_code_key" ON "StoreInvite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StoreInvite_storeId_key" ON "StoreInvite"("storeId");

-- AddForeignKey
ALTER TABLE "StoreInvite" ADD CONSTRAINT "StoreInvite_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
