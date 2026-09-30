-- Schema only. Content lives in prisma/seed.ts and is pushed by the seed
-- (owner, 2026-09-29: "keep everything in these seed scripts and then push them
-- up to the database").
CREATE TABLE "FlightRecommendation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "outro" TEXT,
    CONSTRAINT "FlightRecommendation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FlightRecommendationOption" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "route" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "departs" TEXT NOT NULL,
    "arrives" TEXT NOT NULL,
    "fitsShuttle" BOOLEAN,
    "note" TEXT,
    CONSTRAINT "FlightRecommendationOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FlightRecommendation_tripId_sortOrder_key" ON "FlightRecommendation"("tripId", "sortOrder");
CREATE UNIQUE INDEX "FlightRecommendationOption_recommendationId_sortOrder_key" ON "FlightRecommendationOption"("recommendationId", "sortOrder");
ALTER TABLE "FlightRecommendation" ADD CONSTRAINT "FlightRecommendation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FlightRecommendationOption" ADD CONSTRAINT "FlightRecommendationOption_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "FlightRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hotel links carry the organizer's one-line note ("free shuttle, <5 min").
ALTER TABLE "Link" ADD COLUMN "note" TEXT;
