-- CreateTable
CREATE TABLE "NoteDraft" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteDraft_pkey" PRIMARY KEY ("key")
);
