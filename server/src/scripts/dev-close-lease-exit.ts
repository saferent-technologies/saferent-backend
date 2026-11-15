/**
 * DEVELOPMENT ONLY — for testing the lease close → review flow without waiting for the move-out date.
 *
 * Moves the agreed move-out date of an ACCEPTED close request to yesterday and runs the normal
 * closing job (the same code the server runs every 10 minutes): the lease closes, both sides get the
 * "How was your rental experience?" notification and the review option opens.
 *
 *   npm --prefix server run dev:close-exit              → the most recently accepted request
 *   npm --prefix server run dev:close-exit -- <leaseId|leaseCode>
 *
 * Refuses to run when NODE_ENV=production.
 */
import { finalizeDueExits } from "../controllers/leaseExit.controller";
import { prisma } from "../lib/prisma";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("❌ Refusing to run: NODE_ENV=production. This script is for local testing only.");
    process.exit(1);
  }
  const key = process.argv[2];
  const leaseFilter = key ? { lease: { OR: [{ id: key }, { code: key }] } } : {};

  const pending = await prisma.leaseExitRequest.findFirst({ where: { status: "PENDING", ...leaseFilter }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const x = await prisma.leaseExitRequest.findFirst({
    where: { status: "ACCEPTED", lease: { status: "ACTIVE", ...(key ? { OR: [{ id: key }, { code: key }] } : {}) } },
    orderBy: { respondedAt: "desc" },
    include: { lease: { select: { id: true, code: true, property: { select: { title: true, code: true } } } } },
  });
  if (!x) {
    console.log(pending ? "ℹ️  That close request is still PENDING — accept it from the other side first, then run this again." : "ℹ️  No accepted close request on an active lease was found.");
    return;
  }

  const yesterday = new Date();
  yesterday.setUTCHours(0, 0, 0, 0);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await prisma.leaseExitRequest.update({ where: { id: x.id }, data: { moveOutDate: yesterday } });
  console.log(`→ Lease ${x.lease.code ?? x.lease.id} ("${x.lease.property.title ?? x.lease.property.code}"): move-out date set to ${yesterday.toISOString().slice(0, 10)}`);

  const closed = await finalizeDueExits();
  const lease = await prisma.lease.findUnique({ where: { id: x.lease.id }, select: { status: true, endedAt: true } });
  console.log(closed ? `✅ Lease closed: status=${lease?.status}. Open /reviews as the tenant and the landlord to write reviews.` : `⚠️  Nothing was closed (lease status=${lease?.status}). Check the API terminal for errors.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
