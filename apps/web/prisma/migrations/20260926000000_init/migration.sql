-- Initial schema authored from schema.prisma. Prisma CLI verification and Neon
-- application must be completed after the sandbox dependency-install block clears.
-- Expression indexes and CHECK constraints below are maintained in SQL.

BEGIN;

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('MASTER_DOUBLE', 'DOUBLE', 'TWIN', 'QUAD_BUNK', 'BUNK_CABIN');

-- CreateEnum
CREATE TYPE "SpotStatus" AS ENUM ('ASSIGNED', 'AVAILABLE', 'NOT_OFFERED');

-- CreateEnum
CREATE TYPE "GuestStatus" AS ENUM ('CONFIRMED', 'INVITED', 'WAITLIST', 'DECLINED');

-- CreateEnum
CREATE TYPE "GuestCreatedVia" AS ENUM ('SEED', 'IMPORT', 'AGENT');

-- CreateEnum
CREATE TYPE "GuestTaskType" AS ENUM ('FLIGHT', 'PAYMENT', 'DETAILS');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "FlightSource" AS ENUM ('AGENT_EXTRACTION', 'ORGANIZER');

-- CreateEnum
CREATE TYPE "Meal" AS ENUM ('CHEF', 'NONE', 'OWN');

-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('FLIGHT_CONFIRMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('AGENT', 'ORGANIZER');

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "seedKey" TEXT,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "resort" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT,
    "chefBreakfastCount" INTEGER NOT NULL,
    "chefDinnerCount" INTEGER NOT NULL,
    "pricing" JSONB NOT NULL,
    "flightArrivalCutoff" TEXT NOT NULL,
    "flightArrivalTarget" TEXT NOT NULL,
    "flightReturnCutoff" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "seedKey" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(9, 6),
    "lng" DECIMAL(9, 6),
    "mapsUrl" TEXT,
    "sizeSquareMeters" INTEGER,
    "floorCount" INTEGER,
    "bedroomCount" INTEGER,
    "sleepsMin" INTEGER,
    "sleepsMax" INTEGER,
    "description" TEXT,
    "externalListingUrls" JSONB NOT NULL,
    "photos" JSONB NOT NULL,
    "amenities" JSONB NOT NULL,
    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "propertyId" TEXT NOT NULL,
    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "type" "RoomType" NOT NULL,
    "ensuite" BOOLEAN,
    "balcony" BOOLEAN,
    "pricePerPerson" DECIMAL(10, 2),
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spot" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" "SpotStatus" NOT NULL,
    "guestId" TEXT,
    "priceOverride" DECIMAL(10, 2),
    CONSTRAINT "Spot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "seedKey" TEXT,
    "tripId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" "GuestStatus" NOT NULL,
    "dietaryNotes" TEXT,
    "emergencyContact" JSONB,
    "notes" TEXT,
    "createdVia" "GuestCreatedVia" NOT NULL,
    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestTask" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "type" "GuestTaskType" NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    CONSTRAINT "GuestTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "amount" DECIMAL(10, 2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "reference" TEXT,
    "status" TEXT NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flight" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "airline" TEXT,
    "flightNumber" TEXT,
    "origin" CHAR(3) NOT NULL,
    "destination" CHAR(3) NOT NULL,
    "scheduledDeparture" TIMESTAMPTZ(3) NOT NULL,
    "scheduledArrival" TIMESTAMPTZ(3) NOT NULL,
    "terminal" TEXT,
    "confirmationCode" TEXT,
    "notes" TEXT,
    "source" "FlightSource" NOT NULL,
    "uploadId" TEXT,
    "supersededById" TEXT,
    "supersededAt" TIMESTAMPTZ(3),
    "confirmedByGuest" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMPTZ(3),
    "extractionConfidence" DOUBLE PRECISION,
    "rawExtraction" JSONB,
    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shuttle" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 49,
    "departWindowStart" TIMESTAMPTZ(3) NOT NULL,
    "departWindowEnd" TIMESTAMPTZ(3) NOT NULL,
    "pickupLocation" TEXT NOT NULL,
    "dropoffLocation" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "driverContact" TEXT,
    "notes" TEXT,
    CONSTRAINT "Shuttle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleDay" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dow" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "eventTitle" TEXT NOT NULL,
    "eventDetail" TEXT,
    "venue" TEXT,
    "venueUrl" TEXT,
    "breakfast" "Meal" NOT NULL,
    "dinner" "Meal" NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ScheduleDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "seedKey" TEXT,
    "section" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" "UploadPurpose" NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "extractionResult" JSONB,
    "deletedFromAnthropicAt" TIMESTAMPTZ(3),
    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceSections" JSONB NOT NULL DEFAULT '[]',
    "uploadId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingExtraction" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "flightCandidates" JSONB NOT NULL,
    "outstandingQuestion" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PendingExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "source" "AuditSource" NOT NULL,
    "conversationId" TEXT,
    "claimedGuestName" TEXT,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trip_seedKey_key" ON "Trip"("seedKey");
CREATE INDEX "Trip_propertyId_idx" ON "Trip"("propertyId");
CREATE UNIQUE INDEX "Property_seedKey_key" ON "Property"("seedKey");
CREATE UNIQUE INDEX "Floor_propertyId_code_key" ON "Floor"("propertyId", "code");
CREATE INDEX "Floor_propertyId_sortOrder_idx" ON "Floor"("propertyId", "sortOrder");
CREATE UNIQUE INDEX "Room_floorId_name_key" ON "Room"("floorId", "name");
CREATE INDEX "Room_floorId_sortOrder_idx" ON "Room"("floorId", "sortOrder");
CREATE UNIQUE INDEX "Spot_guestId_key" ON "Spot"("guestId");
CREATE UNIQUE INDEX "Spot_roomId_index_key" ON "Spot"("roomId", "index");
CREATE INDEX "Spot_status_idx" ON "Spot"("status");
CREATE UNIQUE INDEX "Guest_seedKey_key" ON "Guest"("seedKey");
CREATE INDEX "Guest_tripId_idx" ON "Guest"("tripId");
CREATE UNIQUE INDEX "GuestTask_guestId_type_key" ON "GuestTask"("guestId", "type");
CREATE INDEX "Payment_guestId_idx" ON "Payment"("guestId");
CREATE UNIQUE INDEX "Flight_guestId_direction_live_key" ON "Flight"("guestId", "direction") WHERE "supersededById" IS NULL;
CREATE INDEX "Flight_guestId_idx" ON "Flight"("guestId");
CREATE INDEX "Flight_uploadId_idx" ON "Flight"("uploadId");
CREATE INDEX "Flight_supersededById_idx" ON "Flight"("supersededById");
CREATE UNIQUE INDEX "Shuttle_tripId_direction_key" ON "Shuttle"("tripId", "direction");
CREATE UNIQUE INDEX "ScheduleDay_tripId_date_key" ON "ScheduleDay"("tripId", "date");
CREATE UNIQUE INDEX "Link_tripId_group_href_key" ON "Link"("tripId", "group", "href");
CREATE INDEX "Link_tripId_sortOrder_idx" ON "Link"("tripId", "sortOrder");
CREATE UNIQUE INDEX "Note_seedKey_key" ON "Note"("seedKey");
CREATE INDEX "Note_tripId_idx" ON "Note"("tripId");
CREATE UNIQUE INDEX "Upload_sha256_key" ON "Upload"("sha256");
CREATE INDEX "Upload_conversationId_idx" ON "Upload"("conversationId");
CREATE UNIQUE INDEX "Conversation_agentSessionId_key" ON "Conversation"("agentSessionId");
CREATE INDEX "Conversation_tripId_idx" ON "Conversation"("tripId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_uploadId_idx" ON "Message"("uploadId");
CREATE INDEX "PendingExtraction_conversationId_idx" ON "PendingExtraction"("conversationId");
CREATE INDEX "PendingExtraction_expiresAt_idx" ON "PendingExtraction"("expiresAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_conversationId_idx" ON "AuditLog"("conversationId");
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- Guest surname matching is case-insensitive; Prisma does not model
-- expression indexes. Keep this index in subsequent SQL migrations.
CREATE INDEX "Guest_lastName_lower_idx" ON "Guest" (lower("lastName"));

-- Preserve the three spot states independently of whether a guest is present.
ALTER TABLE "Spot" ADD CONSTRAINT "Spot_status_guest_check" CHECK (
    ("status" = 'ASSIGNED' AND "guestId" IS NOT NULL) OR
    ("status" IN ('AVAILABLE', 'NOT_OFFERED') AND "guestId" IS NULL)
);

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Spot" ADD CONSTRAINT "Spot_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Spot" ADD CONSTRAINT "Spot_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestTask" ADD CONSTRAINT "GuestTask_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Flight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shuttle" ADD CONSTRAINT "Shuttle_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleDay" ADD CONSTRAINT "ScheduleDay_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Link" ADD CONSTRAINT "Link_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingExtraction" ADD CONSTRAINT "PendingExtraction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
