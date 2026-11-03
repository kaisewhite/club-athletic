/*
  Warnings:

  - You are about to drop the column `emergencyContact` on the `Guest` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Guest` table. All the data in the column will be lost.
  - You are about to drop the `Payment` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_guestId_fkey";

-- AlterTable
ALTER TABLE "Guest" DROP COLUMN "emergencyContact",
DROP COLUMN "notes";

-- AlterTable
ALTER TABLE "GuestSubmission" ALTER COLUMN "source" SET DEFAULT 'website';

-- DropTable
DROP TABLE "Payment";
