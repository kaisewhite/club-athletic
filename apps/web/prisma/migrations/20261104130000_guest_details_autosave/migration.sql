ALTER TYPE "GuestStatus" ADD VALUE 'PENDING';
ALTER TABLE "Guest" ADD COLUMN "preferredRoomId" TEXT;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_preferredRoomId_fkey" FOREIGN KEY ("preferredRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Guest_preferredRoomId_idx" ON "Guest"("preferredRoomId");
