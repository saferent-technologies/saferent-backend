import type { PrismaClient } from "@prisma/client";
import type { Auth } from "firebase-admin/auth";
import { companyEmailSchema, passwordSchema, phoneE164Schema } from "../lib/validation";

export interface BootstrapInput {
  name: string;
  email: string;
  password: string;
  phoneNumber: string;
}

export class BootstrapError extends Error {}

const LOCK = "bootstrap_super_admin";

/**
 * Creates the first Super Admin exactly once:
 *  - a lock row (system_locks) is inserted atomically; a second run fails,
 *  - refuses if any SUPER_ADMIN already exists,
 *  - creates the Firebase Auth user (email + phone) and sets the custom claim via the Admin SDK,
 *  - creates the MySQL user row (the protected FOUNDER account) with mustChangePassword = true.
 */
export async function bootstrapSuperAdmin(deps: { prisma: PrismaClient; auth: Auth }, input: BootstrapInput): Promise<{ uid: string }> {
  const { prisma, auth } = deps;

  const email = companyEmailSchema.parse(input.email);
  const phone = phoneE164Schema.parse(input.phoneNumber.replace(/[\s-]/g, ""));
  const passwordCheck = passwordSchema.safeParse(input.password);
  if (!passwordCheck.success) {
    throw new BootstrapError(passwordCheck.error.issues[0]?.message ?? "Password does not meet the policy.");
  }
  const name = input.name.trim() || "Shaik Shabeer";

  const existingLock = await prisma.systemLock.findUnique({ where: { name: LOCK } });
  if (existingLock?.status === "completed") throw new BootstrapError("Bootstrap has already been completed. It can only run once.");
  if (existingLock) {
    throw new BootstrapError(
      "A previous bootstrap did not finish. Check Firebase Authentication and the users table, fix any partial state, delete the 'bootstrap_super_admin' row from system_locks, then run again.",
    );
  }
  await prisma.systemLock.create({ data: { name: LOCK, status: "in_progress", data: { email } } }).catch(() => {
    throw new BootstrapError("Another bootstrap is already running.");
  });

  if (await prisma.user.findFirst({ where: { OR: [{ role: "SUPER_ADMIN" }, { isFounder: true }] }, select: { id: true } })) {
    await prisma.systemLock.update({ where: { name: LOCK }, data: { status: "completed", data: { note: "Super Admin already existed" } } });
    throw new BootstrapError("A Super Admin already exists. No account was created.");
  }

  // Reuse an existing Firebase account (e.g. one created by an earlier phone/email test login)
  // instead of failing with "phone-number-already-exists" / "email-already-exists".
  const lookup = async (fn: () => Promise<{ uid: string }>) => fn().catch((e: { code?: string }) => {
    if (e?.code === "auth/user-not-found") return null;
    throw e;
  });
  const byEmail = await lookup(() => auth.getUserByEmail(email));
  const byPhone = await lookup(() => auth.getUserByPhoneNumber(phone));
  if (byEmail && byPhone && byEmail.uid !== byPhone.uid) {
    await prisma.systemLock.delete({ where: { name: LOCK } });
    throw new BootstrapError(
      `Firebase has two different accounts for ${email} and ${phone}. Delete one of them in Firebase Console → Authentication → Users, then run again.`,
    );
  }
  const existing = byEmail ?? byPhone;
  const profile = { email, password: input.password, phoneNumber: phone, displayName: name, emailVerified: true, disabled: false };
  const firebaseUser = existing ? await auth.updateUser(existing.uid, profile) : await auth.createUser(profile);
  if (await prisma.user.findUnique({ where: { firebaseUid: firebaseUser.uid }, select: { id: true } })) {
    await prisma.systemLock.delete({ where: { name: LOCK } });
    throw new BootstrapError("This Firebase account is already linked to another SafeRent user.");
  }
  await auth.setCustomUserClaims(firebaseUser.uid, { role: "SUPER_ADMIN" });

  const user = await prisma.user.create({
    data: {
      firebaseUid: firebaseUser.uid,
      fullName: name,
      email,
      phoneNumber: phone,
      role: "SUPER_ADMIN",
      isFounder: true,
      accountStatus: "ACTIVE",
      emailVerified: true,
      phoneVerified: true,
      mustChangePassword: true,
    },
  });

  await prisma.systemLock.update({ where: { name: LOCK }, data: { status: "completed", data: { email, userId: user.id } } });
  await prisma.auditLog.create({
    data: { action: "bootstrap.super_admin.created", outcome: "SUCCESS", userId: user.id, firebaseUid: firebaseUser.uid, userAgent: "bootstrap-cli" },
  });

  return { uid: firebaseUser.uid };
}
