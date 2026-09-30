FROM public.ecr.aws/mostrom/bun:1.4.0
### DO NOT CHANGE THIS BASE IMAGE NO MATTER WHAT.
WORKDIR /app

# Dependencies from the committed lockfile so the image is reproducible, and the
# Prisma client, before the full source is layered in — so a source-only change
# does not reinstall or regenerate.
COPY package.json bun.lock .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# `prisma generate` loads prisma.config.ts, which resolves its datasource from
# DATABASE_URL. This placeholder exists only to satisfy that resolution: `generate`
# opens no connection and reads no database. The real DATABASE_URL and
# DATABASE_URL_POOLED are RUNTIME secrets, injected into the task from the
# `club-athletic-<stage>-web` Secrets Manager secret. They must never be build
# arguments — build args are recorded in the image history, and a build must not be
# able to reach a real database.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/club_athletic?sslmode=disable"
ENV DATABASE_URL=${DATABASE_URL}
# NODE_ENV stays unset here on purpose: the build below needs devDependencies
# (the react-router CLI, typescript, prisma).
RUN bun install --frozen-lockfile --registry=https://registry.npmjs.org/
RUN bunx prisma generate

COPY . .

ENV NODE_ENV=production
ENV PORT=4173

# Build gate: `react-router typegen` (prebuild) + `react-router build`, then
# `tsc --noEmit`. A type error fails the image, not the deploy.
RUN bun run build

# Drop the build-time placeholder so the runtime image ships no datasource of its
# own. ECS overrides this with the real secret; if the secret is ever missing, the
# app fails its env validation loudly instead of quietly pointing at localhost.
ENV DATABASE_URL=""

EXPOSE 4173

# Apply pending migrations with the RUNTIME secrets, then serve. Deliberately a
# start-time step and not a `docker build` RUN: a build must never mutate a
# database, and the image has to stay reproducible and cache-safe.
# `prisma migrate deploy` takes a Postgres advisory lock, so the overlapping tasks
# of a rolling deploy are safe — one applies the migrations, the rest no-op. A
# migration failure aborts startup, so the app never serves against a mismatched
# schema: the target group simply never sees a healthy /health and the service's
# deployment circuit breaker rolls back.
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start"]
