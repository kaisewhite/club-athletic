DELETE FROM "FolieDouceVote" AS vote
USING "Trip" AS trip
WHERE vote."tripId" = trip."id"
  AND trip."seedKey" = 'meribel-2027'
  AND vote."nameKey" IN ('ari stobaugh', 'joanna gonzalez');
