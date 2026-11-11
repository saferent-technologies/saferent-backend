// Creates / resets the INTEGRATION TEST database (never the main one):  npm --prefix server run test:migrate
const { execSync } = require("node:child_process");
const test = process.env.TEST_DATABASE_URL;
if (!test) {
  console.error("❌ Set TEST_DATABASE_URL in server/.env first (a separate database, e.g. .../saferent_test).");
  process.exit(1);
}
if (test === process.env.DATABASE_URL || !/test/i.test(new URL(test).pathname)) {
  console.error("❌ TEST_DATABASE_URL must be a separate database whose name contains 'test' — it is wiped on every run.");
  process.exit(1);
}
execSync("npx prisma migrate reset --force --skip-seed --skip-generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: test } });
