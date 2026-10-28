-- Preserve all legacy columns and photos. No personal records are deleted.
CREATE TABLE "TravelCity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TravelCity_name_key" ON "TravelCity"("name");
INSERT INTO "TravelCity" ("id", "name")
SELECT 'c' || lower(hex(randomblob(12))), name FROM (
  SELECT DISTINCT CASE WHEN trim("city") = '' THEN '未分类' ELSE trim("city") END AS name
  FROM "TravelRecord"
);
-- Nullable FK keeps this additive and lossless; API writes require a valid city.
ALTER TABLE "TravelRecord" ADD COLUMN "cityId" TEXT REFERENCES "TravelCity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TravelRecord" ADD COLUMN "date" DATETIME;
UPDATE "TravelRecord" SET
  "cityId" = (SELECT "id" FROM "TravelCity" WHERE "name" = CASE WHEN trim("TravelRecord"."city") = '' THEN '未分类' ELSE trim("TravelRecord"."city") END),
  "date" = coalesce("startDate", "endDate"),
  "status" = CASE WHEN "status" = '已去' THEN '已去' ELSE '想去' END;
CREATE INDEX "TravelRecord_cityId_isPublic_date_idx" ON "TravelRecord"("cityId", "isPublic", "date");
