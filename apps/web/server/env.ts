import { z } from "zod";

const postgresUrl = z.string().url().refine((value) => /^postgres(?:ql)?:\/\//.test(value));

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().min(1),
  DATABASE_URL: postgresUrl,
  DATABASE_URL_POOLED: postgresUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(4173),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Bun loads the app-local .env before this module runs. Never serialize inputs.
  const result = envSchema.safeParse({
    ...source,
    PORT: source.PORT ?? source.WEB_PORT,
  });
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid or missing environment variables: ${keys.join(", ")}`);
  }
  return result.data;
}
