/**
 * DEVELOPMENT ONLY — deletes EVERY property and everything that hangs off it, for a clean start:
 *   units, rooms, beds, pricing, utilities, policies, amenities, photos, documents (+ the files),
 *   inspections, history, applications, invitations, leases, lease exits, rent payments and their
 *   transactions / refunds / invoices, reviews, maintenance, enquiries, visits, fraud reports,
 *   search locations, and notifications that link to them.
 * Users, roles, KYC, wallets and referrals are kept (referrals lose their lease / invitation link;
 * support tickets lose their property link).
 *
 *   npm --prefix server run dev:delete-properties            → dry run: shows what would be deleted
 *   npm --prefix server run dev:delete-properties -- --yes   → deletes (can't be undone)
 *
 * Refuses when NODE_ENV=production, and when DATABASE_URL isn't a local database
 * (localhost / 127.0.0.1 / ::1) unless you also pass --allow-remote.
 */
import { prisma } from "../lib/prisma";
import { removeStoredFile } from "../lib/uploads";

/** Tables whose rows all belong to properties (deleted completely). */
const PROPERTY_TABLES = [
  "bed_assignments",
  "duplex_floors",
  "property_beds",
  "property_rooms",
  "property_units",
  "property_utilities",
  "property_policies",
  "property_amenities",
  "property_pricing",
  "property_images",
  "property_documents",
  "document_requests",
  "property_assignments",
  "property_inspections",
  "property_status_history",
  "property_audit_logs",
  "rental_applications",
  "tenant_invitations",
  "lease_exit_requests",
  "pan_share_requests",
  "review_reports",
  "review_moderation_logs",
  "rental_reviews",
  "maintenance_photos",
  "maintenance_requests",
  "property_visits",
  "enquiries",
  "rent_payments",
  "leases",
  "locations",
  "property_revisions",
  "properties",
] as const;

function isLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  } catch {
    return false;
  }
}

async function count(table: string, where = ""): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM \`${table}\` ${where}`);
  return Number(rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const yes = process.argv.includes("--yes");
  if (process.env.NODE_ENV === "production") {
    console.error("❌ Refusing to run: NODE_ENV=production. This script is for local development only.");
    process.exit(1);
  }
  if (!isLocal(process.env.DATABASE_URL) && !process.argv.includes("--allow-remote")) {
    console.error("❌ Refusing to run: DATABASE_URL is not a local database. Pass --allow-remote only if you're sure it's a throwaway dev database.");
    process.exit(1);
  }

  const txWhere = "WHERE property_id IS NOT NULL OR rent_payment_id IS NOT NULL";
  const counts: Array<[string, number]> = [];
  for (const t of PROPERTY_TABLES) counts.push([t, await count(t)]);
  counts.push(["transactions (rent / property)", await count("transactions", txWhere)]);
  counts.push(["invoices (property)", await count("invoices", "WHERE property_id IS NOT NULL")]);
  counts.push(["fraud_reports (property)", await count("fraud_reports", "WHERE property_id IS NOT NULL")]);
  counts.push(["notifications (property / lease links)", await count("notifications", "WHERE link LIKE '/properties%' OR link LIKE '/leases%' OR link LIKE '/browse%' OR link LIKE '/invite%' OR link LIKE '/applications%'")]);

  console.log(`\nDatabase: ${new URL(process.env.DATABASE_URL!).hostname}/${new URL(process.env.DATABASE_URL!).pathname.slice(1)}`);
  console.table(Object.fromEntries(counts.filter(([, n]) => n > 0)));
  const properties = counts.find(([t]) => t === "properties")?.[1] ?? 0;
  if (!properties) {
    console.log("ℹ️  There are no properties. Nothing to delete.");
    return;
  }
  if (!yes) {
    console.log(`\nDry run — nothing was deleted. To delete these ${properties} properties and everything above, run:\n  npm --prefix server run dev:delete-properties -- --yes\n`);
    return;
  }

  // Files on disk (photos, documents, maintenance photos) — collected before the rows go.
  const files = [
    ...(await prisma.propertyImage.findMany({ select: { filePath: true } })).map((r) => r.filePath),
    ...(await prisma.propertyDocument.findMany({ select: { filePath: true } })).map((r) => r.filePath),
    ...(await prisma.$queryRawUnsafe<Array<{ file_path: string }>>("SELECT file_path FROM maintenance_photos")).map((r) => r.file_path),
  ].filter(Boolean);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
      try {
        await tx.$executeRawUnsafe(`DELETE r FROM refunds r JOIN transactions t ON t.id = r.transaction_id WHERE t.property_id IS NOT NULL OR t.rent_payment_id IS NOT NULL`);
        await tx.$executeRawUnsafe(`DELETE FROM transactions ${txWhere}`);
        await tx.$executeRawUnsafe("UPDATE transactions SET invoice_id = NULL WHERE invoice_id IN (SELECT id FROM (SELECT id FROM invoices WHERE property_id IS NOT NULL) x)");
        await tx.$executeRawUnsafe("DELETE FROM invoices WHERE property_id IS NOT NULL");
        await tx.$executeRawUnsafe("DELETE FROM fraud_reports WHERE property_id IS NOT NULL");
        await tx.$executeRawUnsafe("UPDATE referrals SET lease_id = NULL, invitation_id = NULL WHERE lease_id IS NOT NULL OR invitation_id IS NOT NULL");
        await tx.$executeRawUnsafe("UPDATE support_tickets SET property_id = NULL WHERE property_id IS NOT NULL");
        await tx.$executeRawUnsafe(
          "DELETE FROM notifications WHERE link LIKE '/properties%' OR link LIKE '/leases%' OR link LIKE '/browse%' OR link LIKE '/invite%' OR link LIKE '/applications%'",
        );
        for (const t of PROPERTY_TABLES) await tx.$executeRawUnsafe(`DELETE FROM \`${t}\``);
      } finally {
        await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
      }
    },
    { timeout: 120_000 },
  );

  let removed = 0;
  for (const f of files) {
    try {
      await removeStoredFile(f);
      removed++;
    } catch {
      /* already gone */
    }
  }
  console.log(`\n✅ Deleted ${properties} properties and everything linked to them. Removed ${removed} of ${files.length} files.\n`);
}

main()
  .catch((err) => {
    console.error("❌ Failed — nothing was deleted (the database changes run in one transaction).", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
