-- Times for every schedule entry, so breakfast, the event and dinner are all
-- first-class rows on the schedule page instead of the meals being a footnote.
ALTER TABLE "ScheduleDay" ADD COLUMN "breakfastAt" TEXT;
ALTER TABLE "ScheduleDay" ADD COLUMN "dinnerAt" TEXT;
ALTER TABLE "ScheduleDay" ADD COLUMN "eventAt" TEXT;

-- Backfill the standing times. A meal only gets a time when the chef serves it;
-- "on your own" and "none" stay NULL so the page can say so rather than imply a
-- sitting that does not exist. Event times remain NULL — TBD for now.
UPDATE "ScheduleDay" SET "breakfastAt" = '07:00' WHERE "breakfast" = 'CHEF';
UPDATE "ScheduleDay" SET "dinnerAt" = '19:30' WHERE "dinner" = 'CHEF';
