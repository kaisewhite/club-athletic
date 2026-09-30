-- Owner, 2026-09-28: "There's no dinner on Wednesday, but we will have dinner on
-- that Friday."
--
-- Wednesday is the Le Cap Horn night, so the event IS dinner and a chalet dinner
-- row alongside it was wrong. Friday moves the other way: it was marked "on your
-- own" and the chef is in fact cooking. The chef's total stays at 5 dinners, so
-- the pricing inclusion line ("6 breakfasts, 5 dinners") is unaffected.
--
-- dinnerAt follows the Meal value: a chef sitting has a time, nothing else does.
UPDATE "ScheduleDay" SET "dinner" = 'NONE', "dinnerAt" = NULL
  WHERE "eventTitle" LIKE 'Le Cap Horn%';

UPDATE "ScheduleDay" SET "dinner" = 'CHEF', "dinnerAt" = '19:30'
  WHERE "eventTitle" LIKE 'Open — last ski day%';
