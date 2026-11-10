/**
 * One-time Super Admin bootstrap. Runs on YOUR computer; there is no public endpoint.
 *
 *   npm run bootstrap:super-admin
 *
 * Uses server/.env (MySQL + Firebase service account). The temporary password is typed at a hidden
 * prompt — it is never stored in code or git.
 */
import "../config/env";
import * as readline from "node:readline";
import { adminAuth } from "../lib/firebaseAdmin";
import { prisma } from "../lib/prisma";
import { BootstrapError, bootstrapSuperAdmin } from "./bootstrap";

const DEFAULT_EMAIL = "admin@saferenttechnologies.com";
const DEFAULT_NAME = "Shaik Shabeer";
const DEFAULT_PHONE = "+917995153536";

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const internal = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      internal._writeToOutput = (s: string) => {
        if (s.startsWith(question)) internal.output.write(s);
        else if (!s.includes("\n") && !s.includes("\r")) internal.output.write("*".repeat(s.length));
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  console.log(`\nSafeRent — one-time founder (Super Admin) bootstrap (Firebase project "${process.env.FIREBASE_PROJECT_ID}")\n`);
  const email = (await ask(`Admin email [${DEFAULT_EMAIL}]: `)) || DEFAULT_EMAIL;
  const name = (await ask(`Founder name [${DEFAULT_NAME}]: `)) || DEFAULT_NAME;
  const phoneNumber = (await ask(`Founder phone [${DEFAULT_PHONE}]: `)) || DEFAULT_PHONE;

  console.log("Temporary password: min 12 chars with upper, lower, number and symbol. You must change it at first login.");
  const password = await ask("Temporary password: ", true);
  const confirm = await ask("Confirm temporary password: ", true);
  if (password !== confirm) throw new BootstrapError("Passwords do not match.");

  const { uid } = await bootstrapSuperAdmin({ prisma, auth: adminAuth }, { email, name, phoneNumber, password });
  console.log(`\n✅ Super Admin created (Firebase uid: ${uid}).`);
  console.log("   Open the app, sign in, enter the email code from the API terminal, then set a new password.\n");
}

main()
  .catch((error: unknown) => {
    if (error instanceof BootstrapError) console.error(`\n❌ ${error.message}\n`);
    else if (error && typeof error === "object" && "issues" in error) {
      console.error("\n❌ Invalid input:", (error as { issues: { message: string }[] }).issues.map((i) => i.message).join("; "), "\n");
    } else if ((error as { code?: string }).code === "auth/email-already-exists") {
      console.error("\n❌ A Firebase user with this email already exists. Delete it in Firebase console → Authentication → Users, then run again.\n");
    } else if ((error as { code?: string }).code === "auth/phone-number-already-exists") {
      console.error("\n❌ A Firebase user with this phone number already exists. Delete it in Firebase console → Authentication → Users, then run again.\n");
    } else console.error("\n❌ Bootstrap failed:", error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
