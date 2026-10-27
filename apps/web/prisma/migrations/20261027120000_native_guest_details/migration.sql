-- Keep historical Typeform submission identities while moving to the website form.
ALTER TYPE "GuestCreatedVia" ADD VALUE 'WEBSITE';
ALTER TABLE "TypeformSubmission" RENAME TO "GuestSubmission";
ALTER TABLE "GuestSubmission" RENAME COLUMN "responseId" TO "submissionId";
ALTER TABLE "GuestSubmission" RENAME COLUMN "formId" TO "sourceRef";
ALTER TABLE "GuestSubmission" ALTER COLUMN "sourceRef" DROP NOT NULL;
ALTER TABLE "GuestSubmission" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'typeform';
ALTER TABLE "GuestSubmission" RENAME CONSTRAINT "TypeformSubmission_pkey" TO "GuestSubmission_pkey";
ALTER TABLE "GuestSubmission" RENAME CONSTRAINT "TypeformSubmission_guestId_fkey" TO "GuestSubmission_guestId_fkey";
ALTER INDEX "TypeformSubmission_guestId_submittedAt_idx" RENAME TO "GuestSubmission_guestId_submittedAt_idx";
