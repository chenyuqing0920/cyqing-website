-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TravelRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT '',
    "province" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "place" TEXT NOT NULL DEFAULT '',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT '想去',
    "story" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL DEFAULT [],
    "latitude" REAL,
    "longitude" REAL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TravelPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "travelId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TravelPhoto_travelId_fkey" FOREIGN KEY ("travelId") REFERENCES "TravelRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TravelPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnimeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "coverId" TEXT,
    "tags" JSONB NOT NULL DEFAULT [],
    "totalEpisodes" INTEGER NOT NULL DEFAULT 0,
    "currentEpisode" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT '想看',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "score" INTEGER,
    "review" TEXT NOT NULL DEFAULT '',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnimeRecord_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL DEFAULT [],
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NoteDraft" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "data" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Todo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Countdown" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "targetDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '未分类',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SiteConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'site',
    "title" TEXT NOT NULL DEFAULT '我的数字空间',
    "subtitle" TEXT NOT NULL DEFAULT '记录生活，也收藏每一个闪光的瞬间',
    "bio" TEXT NOT NULL DEFAULT '欢迎来到我的小小世界。',
    "heroImageId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SiteConfig_heroImageId_fkey" FOREIGN KEY ("heroImageId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "TravelRecord_isPublic_startDate_idx" ON "TravelRecord"("isPublic", "startDate");

-- CreateIndex
CREATE INDEX "TravelRecord_status_city_idx" ON "TravelRecord"("status", "city");

-- CreateIndex
CREATE INDEX "TravelPhoto_travelId_position_idx" ON "TravelPhoto"("travelId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TravelPhoto_travelId_assetId_key" ON "TravelPhoto"("travelId", "assetId");

-- CreateIndex
CREATE INDEX "AnimeRecord_isPublic_updatedAt_idx" ON "AnimeRecord"("isPublic", "updatedAt");

-- CreateIndex
CREATE INDEX "AnimeRecord_status_score_idx" ON "AnimeRecord"("status", "score");

-- CreateIndex
CREATE INDEX "Note_isPublic_isDraft_updatedAt_idx" ON "Note"("isPublic", "isDraft", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_filename_key" ON "MediaAsset"("filename");
