ALTER TABLE "GuestSubmission"
  ALTER COLUMN "processedAt" DROP DEFAULT,
  ALTER COLUMN "processedAt" DROP NOT NULL;

UPDATE "GuestSubmission" AS submission
SET "processedAt" = NULL
FROM "Guest" AS guest
WHERE submission."guestId" = guest.id
  AND submission.source = 'website'
  AND guest.status = 'PENDING';
