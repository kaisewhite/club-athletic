-- Sync the existing guest details Typeform into the records the trip site reads.
ALTER TABLE "Guest"
    ADD COLUMN "venmoHandle" TEXT,
    ADD COLUMN "favoriteCocktails" TEXT;

-- Keep only response identity and linkage for idempotent webhook delivery.
-- The response body contains contact and dietary data and is intentionally not
-- copied into this table.
CREATE TABLE "TypeformSubmission" (
    "responseId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TypeformSubmission_pkey" PRIMARY KEY ("responseId")
);

CREATE INDEX "TypeformSubmission_guestId_submittedAt_idx"
    ON "TypeformSubmission"("guestId", "submittedAt");

ALTER TABLE "TypeformSubmission"
    ADD CONSTRAINT "TypeformSubmission_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
