import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { relativePath, removeStoredFile, sendStoredFile } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { can, me } from "../middleware/auth";
import { ROLE_INFO, type RoleKey } from "../rbac/catalog";
import { toProfile } from "./serializers";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const roleProfileSchemas = {
  LANDLORD: z.object({
    businessName: optionalText(120),
    address: optionalText(255),
    city: optionalText(80),
    state: optionalText(80),
    pincode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter a 6-digit PIN code.")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
  }),
  TENANT: z.object({
    occupation: optionalText(80),
    employer: optionalText(120),
    currentCity: optionalText(80),
    familySize: z.coerce.number().int().min(1).max(20).optional().nullable(),
    preferredMoveIn: z.coerce.date().optional().nullable(),
    emergencyContactName: optionalText(120),
    emergencyContactPhone: z
      .string()
      .trim()
      .regex(/^\+?\d{10,15}$/, "Enter a valid phone number.")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null)),
  }),
  PROPERTY_AGENT: z.object({
    agencyName: optionalText(120),
    licenseNumber: optionalText(60),
    serviceAreas: optionalText(255),
    experienceYears: z.coerce.number().int().min(0).max(60).optional().nullable(),
  }),
  SERVICE_PROVIDER: z.object({
    businessName: optionalText(120),
    categories: optionalText(255),
    serviceAreas: optionalText(255),
    available: z.boolean().optional(),
  }),
} as const;

async function loadRoleProfile(userId: string, role: RoleKey) {
  switch (role) {
    case "LANDLORD":
      return prisma.landlordProfile.findUnique({ where: { userId } });
    case "TENANT":
      return prisma.tenantProfile.findUnique({ where: { userId } });
    case "PROPERTY_AGENT":
      return prisma.agentProfile.findUnique({ where: { userId } });
    case "SERVICE_PROVIDER":
      return prisma.serviceProviderProfile.findUnique({ where: { userId } });
    default:
      return null;
  }
}

/** GET /api/profile — own common profile + role-specific profile. */
export async function getProfile(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const role = user.role as RoleKey;
  res.json({ user: toProfile(user), roleInfo: { key: role, ...ROLE_INFO[role] }, roleProfile: await loadRoleProfile(user.id, role) });
}

const commonSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(254)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  roleProfile: z.record(z.string(), z.unknown()).optional(),
});

/** PUT /api/profile — update own name, (non-staff) contact email and role-specific profile. */
export async function updateProfile(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const role = user.role as RoleKey;
  const input = parseInput(commonSchema, req.body);

  const data: { fullName: string; email?: string | null; emailVerified?: boolean } = { fullName: input.fullName };
  // Staff emails are sign-in identities and change only through the verified flow (Settings → Email).
  if (!ROLE_INFO[role].isStaff && input.email !== undefined && input.email !== user.email) {
    if (input.email) {
      const taken = await prisma.user.findFirst({ where: { email: input.email, NOT: { id: user.id } }, select: { id: true } });
      if (taken) fail("already-exists", REASONS.EMAIL_IN_USE, "This email address is already in use.");
    }
    data.email = input.email;
    data.emailVerified = false;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data });
    if (input.roleProfile && role in roleProfileSchemas) {
      const schema = roleProfileSchemas[role as keyof typeof roleProfileSchemas];
      const profile = parseInput(schema as z.ZodType<Record<string, unknown>>, input.roleProfile);
      const where = { userId: user.id };
      switch (role) {
        case "LANDLORD":
          await tx.landlordProfile.upsert({ where, create: { ...where, ...profile }, update: profile });
          break;
        case "TENANT":
          await tx.tenantProfile.upsert({ where, create: { ...where, ...profile }, update: profile });
          break;
        case "PROPERTY_AGENT":
          await tx.agentProfile.upsert({ where, create: { ...where, ...profile }, update: profile });
          break;
        case "SERVICE_PROVIDER":
          await tx.serviceProviderProfile.upsert({ where, create: { ...where, ...profile }, update: profile });
          break;
      }
    }
  });

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  res.json({ user: toProfile(fresh), roleProfile: await loadRoleProfile(user.id, role) });
}

/** POST /api/profile/image — upload own profile photo (multipart field "file"). */
export async function uploadProfileImage(req: Request, res: Response): Promise<void> {
  const user = me(req);
  if (!req.file) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose an image to upload.");
  const stored = relativePath(req.file.path);
  if (user.profileImage) await removeStoredFile(user.profileImage);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { profileImage: stored } });
  res.json({ user: toProfile(updated) });
}

/** GET /api/profile/image/:userId — own photo, or any photo for users.view holders. */
export async function getProfileImage(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const targetId = String(req.params.userId);
  if (targetId !== user.id && !can(req, "users.view")) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { profileImage: true } });
  if (!target?.profileImage) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  const ext = target.profileImage.split(".").pop();
  sendStoredFile(res, target.profileImage, ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
}
