-- Owner, 2026-09-28: "it's bedroom 5 that actually got updated, so bedroom 5 no
-- longer has 2 spots available. It's 1 spot available. and it was taken by Pete
-- F." Open spots therefore go 10 -> 9.
--
-- Nothing here hardcodes a count: `openCount` on /spots, /rooms and the home FAQ
-- is derived from Spot.status = 'AVAILABLE' (countOpenSpots), so assigning the
-- spot is the whole change.
--
-- "F." is the surname exactly as given. Guest.lastName's contract is that a
-- surname is never invented, so an initial stays an initial.

INSERT INTO "Guest" (id, "seedKey", "tripId", "firstName", "lastName", "displayName", status, "createdVia")
SELECT 'seed_guest_pete_f', 'meribel-2027:guest:Pete F.', t.id, 'Pete', 'F.', 'Pete F.', 'CONFIRMED', 'SEED'
  FROM "Trip" t
 WHERE t."seedKey" = 'meribel-2027'
    ON CONFLICT ("seedKey") DO NOTHING;

-- Same three tasks every seeded guest gets, so /tasks does not show Pete as a
-- guest with no outstanding items.
INSERT INTO "GuestTask" (id, "guestId", "type", done)
SELECT 'seed_task_pete_f_' || lower(t.type::text), 'seed_guest_pete_f', t.type, false
  FROM unnest(ARRAY['FLIGHT', 'PAYMENT', 'DETAILS']::"GuestTaskType"[]) AS t(type)
 WHERE EXISTS (SELECT 1 FROM "Guest" WHERE id = 'seed_guest_pete_f')
    ON CONFLICT ("guestId", "type") DO NOTHING;

-- Lowest-numbered still-open bunk in Bedroom 5, so a re-run cannot consume the
-- second one. Spot_status_guest_check enforces that ASSIGNED carries a guest.
UPDATE "Spot" s
   SET "guestId" = 'seed_guest_pete_f', status = 'ASSIGNED'
  FROM "Room" r
 WHERE s."roomId" = r.id
   AND r.name LIKE 'Bedroom 5 %'
   AND s.status = 'AVAILABLE'
   AND s."index" = (
     SELECT min(s2."index") FROM "Spot" s2
      WHERE s2."roomId" = r.id AND s2.status = 'AVAILABLE'
   )
   AND NOT EXISTS (SELECT 1 FROM "Spot" WHERE "guestId" = 'seed_guest_pete_f');
