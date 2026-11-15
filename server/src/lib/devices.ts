import { z } from "zod";
import { withoutNulls } from "./validation";
import { prisma } from "./prisma";

/*
 * Push (FCM) device tokens. Saved after OTP sign-in and on token refresh; removed on logout.
 * A token identifies one app install, so whoever signed in last on that device owns it.
 */

/** FCM registration tokens are ~150–200 URL-safe characters (with a ":" separator). */
export const fcmTokenSchema = z.string().trim().min(20, "fcmToken looks too short.").max(255, "fcmToken is too long.").regex(/^[A-Za-z0-9:_-]+$/, "fcmToken has unexpected characters.");

export const deviceSchema = z.preprocess(
  withoutNulls,
  z
  .object({
    fcmToken: fcmTokenSchema,
    platform: z.enum(["ANDROID", "IOS", "WEB"], { error: "platform must be ANDROID, IOS or WEB." }).default("ANDROID"),
    appVersion: z.string().trim().max(32).optional(),
  })
  .strict(),
);
export type DeviceInput = z.infer<typeof deviceSchema>;

export async function saveDevice(uid: string, d: DeviceInput): Promise<void> {
  const data = { userUid: uid, platform: d.platform, appVersion: d.appVersion || null, lastSeenAt: new Date() };
  await prisma.userDevice.upsert({ where: { fcmToken: d.fcmToken }, create: { fcmToken: d.fcmToken, ...data }, update: data });
}

/** On logout: forget this device's token (only if it belongs to the caller). */
export async function removeDevice(uid: string, fcmToken: string): Promise<void> {
  await prisma.userDevice.deleteMany({ where: { fcmToken, userUid: uid } });
}
