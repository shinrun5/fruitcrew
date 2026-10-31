-- The schedule assistant: what managers asked it and what it proposed,
-- counted against each business's monthly allowance (and an app-wide daily cap).

-- CreateTable
CREATE TABLE "AssistantRequest" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "offTopic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantRequest_orgId_createdAt_idx" ON "AssistantRequest"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantRequest_createdAt_idx" ON "AssistantRequest"("createdAt");
