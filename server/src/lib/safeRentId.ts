import { prisma } from "./prisma";
import { nextCode } from "../properties/ids";
import { ID_PREFIX } from "../properties/catalog";

/** Gives the user their public SafeRent ID (SR-USER-000123) if they don't have one yet. Returns it. */
export async function ensureSafeRentId(userId: string, current?: string | null): Promise<string | null> {
  if (current) return current;
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { safeRentId: true } });
    if (!u) return null;
    if (u.safeRentId) return u.safeRentId;
    const code = await nextCode(tx, ID_PREFIX.USER);
    await tx.user.updateMany({ where: { id: userId, safeRentId: null }, data: { safeRentId: code } });
    return (await tx.user.findUnique({ where: { id: userId }, select: { safeRentId: true } }))?.safeRentId ?? null;
  });
}

/** "SR-USER-000012", "sr-user-12" → "SR-USER-000012"; null when it doesn't look like a SafeRent ID. */
export function normalizeSafeRentId(raw: string): string | null {
  const m = /^\s*SR-?USER-?(\d{1,12})\s*$/i.exec(raw);
  if (!m) return null;
  return `SR-USER-${m[1].replace(/^0+(?=\d)/, "").padStart(6, "0")}`;
}

/** Indian 10-digit numbers get +91; anything already in +E.164 is kept. Null when it isn't a phone number. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^0?[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(-10)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}
