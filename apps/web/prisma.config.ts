// CLI migrations must use the non-pooled Neon endpoint, which is DATABASE_URL;
// runtime/seed clients use the pooler at DATABASE_URL_POOLED. There is no
// separate direct URL: one database, one credential.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bash scripts/with-env.sh bun prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
