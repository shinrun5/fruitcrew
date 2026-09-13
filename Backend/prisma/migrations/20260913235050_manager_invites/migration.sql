-- CreateTable
CREATE TABLE "ManagerInvite" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,
    "role" "Role" NOT NULL,
    "storeIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" INTEGER,

    CONSTRAINT "ManagerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerInvite_code_key" ON "ManagerInvite"("code");

-- AddForeignKey
ALTER TABLE "ManagerInvite" ADD CONSTRAINT "ManagerInvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
