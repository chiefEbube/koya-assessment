import { defineConfig } from "prisma/config";
import { loadTestDatabaseEnvironment } from "./src/scripts/test-db-env.js";

const testEnv = loadTestDatabaseEnvironment();

process.env.DATABASE_URL = testEnv.TEST_DATABASE_URL;
process.env.DIRECT_URL = testEnv.TEST_DIRECT_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: testEnv.TEST_DIRECT_URL,
  },
});
