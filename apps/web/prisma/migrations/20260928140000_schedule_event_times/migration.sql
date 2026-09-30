-- Two event times are not TBD — they are already recorded on the Shuttle row and
-- were only ever missing from ScheduleDay.
--
-- Arrival (Sat 30 Jan): the inbound shuttle leaves GVA in a 10:30–11:00 window
-- and "Shuttle"."durationMinutes" is 120, so the bus reaches the chalet by
-- 13:00. The window END is used, not the start: a guest planning around this
-- needs the time they can count on being there, not the earliest possible one.
--
-- Departure (Sat 6 Feb): the outbound shuttle's pickup window opens at 04:15 at
-- the chalet. The title carried "— pickup 4:15 AM" as prose; the time column now
-- states it, so the title drops it rather than saying it twice.
--
-- Owner, 2026-09-28: "if the shuttle leaves between 10:30 and 11, and you know
-- it's a 2-hour trip, then you should know that there actually is a time for the
-- arrival (TBD)."
UPDATE "ScheduleDay" SET "eventAt" = '13:00'
  WHERE "eventTitle" LIKE 'Arrival —%' AND "eventAt" IS NULL;

UPDATE "ScheduleDay"
   SET "eventAt" = '04:15',
       "eventTitle" = 'Departure — shuttle to GVA'
  WHERE "eventTitle" LIKE 'Departure —%' AND "eventAt" IS NULL;
