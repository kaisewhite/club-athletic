import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const DATABASE_KEYS = ["DATABASE_URL", "DATABASE_URL_POOLED"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLoopbackDatabaseUrls(env: Record<string, string | undefined>): void {
  for (const key of DATABASE_KEYS) {
    const value = env[key];
    let allowed = false;
    try {
      if (value) {
        const url = new URL(value);
        allowed = ["postgres:", "postgresql:"].includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
      }
    } catch {
      // The generic error below avoids echoing a possibly credential-bearing URL.
    }
    if (!allowed) {
      throw new Error(`Playwright local acceptance requires ${key} to point to loopback PostgreSQL.`);
    }
  }
}

export function loadExplicitLocalTestEnv(source: NodeJS.ProcessEnv = process.env) {
  const configuredPath = source.CLUB_ATHLETIC_WEB_ENV_FILE;
  if (!configuredPath) {
    throw new Error("Set CLUB_ATHLETIC_WEB_ENV_FILE to an explicit local test env file before running Playwright acceptance.");
  }
  const envFile = resolve(configuredPath);
  if (!existsSync(envFile)) {
    throw new Error("The configured Playwright local test env file does not exist.");
  }
  const values = parse(readFileSync(envFile));
  assertLoopbackDatabaseUrls(values);
  if (!values.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("The configured Playwright local test env file requires ANTHROPIC_API_KEY.");
  }
  return { envFile, values };
}
