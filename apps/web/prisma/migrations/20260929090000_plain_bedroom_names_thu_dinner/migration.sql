-- Owner, 2026-09-29: "Remove Chambre from everywhere you find it … and cabine."
-- Rooms are the bedroom number the plan prints, nothing more. shortName already
-- held exactly that, so the display name becomes it. (floorId, name) stays unique
-- because shortNames are unique.
UPDATE "Room" SET "name" = "shortName" WHERE "name" <> "shortName";

-- Owner, 2026-09-29, chef page: "only put something for the days where we
-- actually have chefs." Thursday's dinner is the final night out, the same shape
-- as Wednesday's Le Cap Horn: not a meal the trip serves, so not OWN but NONE.
UPDATE "ScheduleDay" SET "dinner" = 'NONE', "dinnerAt" = NULL WHERE "dinner" = 'OWN';
