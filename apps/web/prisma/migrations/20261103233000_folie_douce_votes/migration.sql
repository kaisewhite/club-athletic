CREATE TYPE "FolieDouceChoice" AS ENUM ('GENERAL_ADMISSION', 'VIP_TABLE');

CREATE TABLE "FolieDouceVote" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "choice" "FolieDouceChoice" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FolieDouceVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FolieDouceVote_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FolieDouceVote_tripId_nameKey_key" ON "FolieDouceVote"("tripId", "nameKey");
CREATE INDEX "FolieDouceVote_tripId_choice_idx" ON "FolieDouceVote"("tripId", "choice");

-- Initial poll responses. Tim Kurdi is excluded because he is no longer a guest.
WITH votes ("id", "firstName", "lastName", "nameKey", "choice") AS (
  VALUES
    ('iwqz6r3932f6yuritdwsed5v', 'Kaise', '', 'kaise', 'VIP_TABLE'),
    ('kibf8sq6w7jydvywtmozvywv', 'Kristy', 'Khoury', 'kristy khoury', 'VIP_TABLE'),
    ('qwp5fiz1vggwzopxhodq9zw4', 'Pete', 'F.', 'pete f.', 'VIP_TABLE'),
    ('r7s28lzsnwsf40mud1gknbel', 'Christie', 'Navarre', 'christie navarre', 'VIP_TABLE'),
    ('ptjv0v6nxknx5bni63mbx4w5', 'Valeriia', 'Stobolva', 'valeriia stobolva', 'VIP_TABLE'),
    ('l785r2g7bm6edhlk5cwmvwh0', 'Augustus', 'Shewchuck', 'augustus shewchuck', 'VIP_TABLE'),
    ('t0v4ghiqyc5rsodlkyojub18', 'Ari', 'Stobaugh', 'ari stobaugh', 'GENERAL_ADMISSION'),
    ('fkpk71vmqm8ohmzum9vjv9du', 'Joanna', 'Gonzalez', 'joanna gonzalez', 'GENERAL_ADMISSION'),
    ('z90b4jqpplq2f1tm02oyzo1b', 'Wayne', 'Martindale', 'wayne martindale', 'GENERAL_ADMISSION'),
    ('loxo14nf893rjj68h0e3aow5', 'Elijah', 'Jones', 'elijah jones', 'GENERAL_ADMISSION')
)
INSERT INTO "FolieDouceVote" ("id", "tripId", "firstName", "lastName", "nameKey", "choice")
SELECT votes."id", trip."id", votes."firstName", votes."lastName", votes."nameKey", votes."choice"::"FolieDouceChoice"
FROM "Trip" AS trip
CROSS JOIN votes
WHERE trip."seedKey" = 'meribel-2027'
ON CONFLICT ("tripId", "nameKey") DO NOTHING;
