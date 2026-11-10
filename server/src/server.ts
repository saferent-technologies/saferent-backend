import "./config/env"; // validates server/.env first
import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { syncRbacCatalog } from "./rbac/service";

async function start(): Promise<void> {
  try {
    await prisma.$connect();
  } catch (error) {
    console.error("\n❌ Could not connect to MySQL. Check DATABASE_URL in server/.env and that MySQL is running.\n", error);
    process.exit(1);
  }
  // Keep roles / permissions / default settings in MySQL in sync with the code catalog.
  await syncRbacCatalog();

  const server = app.listen(env.PORT, () => {
    console.log(`\n🏠 SafeRent API running on http://localhost:${env.PORT}  (email: ${env.EMAIL_PROVIDER})\n`);
  });

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void start();
