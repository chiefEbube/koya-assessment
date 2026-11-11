import { loadTestDatabaseEnvironment } from "../src/scripts/test-db-env.js";

const testEnv = loadTestDatabaseEnvironment();
process.env.DATABASE_URL = testEnv.TEST_DATABASE_URL;
process.env.DIRECT_URL = testEnv.TEST_DIRECT_URL;
process.env.API_KEY = testEnv.API_KEY || "integration-test-key";
