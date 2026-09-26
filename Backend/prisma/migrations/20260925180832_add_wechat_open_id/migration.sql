-- AlterTable
ALTER TABLE "User" ADD COLUMN     "wechatOpenId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_wechatOpenId_key" ON "User"("wechatOpenId");
