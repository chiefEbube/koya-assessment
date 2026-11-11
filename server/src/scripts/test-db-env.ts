import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

export function loadTestDatabaseEnvironment() {
  const testEnvPath = resolve(process.cwd(), ".env.test");
  if (!existsSync(testEnvPath)) {
    throw new Error(
      "This command requires server/.env.test with a dedicated test database."
    );
  }

  const testEnv = parse(readFileSync(testEnvPath));
  if (
    !testEnv.TEST_DATABASE_URL ||
    !testEnv.TEST_DIRECT_URL ||
    testEnv.ALLOW_DESTRUCTIVE_TEST_DB !== "yes"
  ) {
    throw new Error(
      "Set TEST_DATABASE_URL, TEST_DIRECT_URL, and ALLOW_DESTRUCTIVE_TEST_DB=yes in server/.env.test."
    );
  }

  const defaultEnvPath = resolve(process.cwd(), ".env");
  if (existsSync(defaultEnvPath)) {
    const defaultEnv = parse(readFileSync(defaultEnvPath));
    const configuredUrls = [
      defaultEnv.DATABASE_URL,
      defaultEnv.DIRECT_URL,
    ].filter((value): value is string => Boolean(value));
    const testUrls = [testEnv.TEST_DATABASE_URL, testEnv.TEST_DIRECT_URL];

    for (const testUrl of testUrls) {
      for (const configuredUrl of configuredUrls) {
        const testDatabase = new URL(testUrl);
        const configuredDatabase = new URL(configuredUrl);
        const canonicalHost = (host: string) =>
          host.replace(/-pooler(?=\.|$)/, "");
        if (
          canonicalHost(testDatabase.hostname) ===
            canonicalHost(configuredDatabase.hostname) &&
          testDatabase.pathname === configuredDatabase.pathname
        ) {
          throw new Error(
            "The test database targets the same host and database as server/.env; refusing destructive test-database operation."
          );
        }
      }
    }
  }

  return testEnv;
}
