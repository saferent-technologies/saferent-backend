import { messaging } from "./firebaseAdmin";
import { prisma } from "./prisma";

/**
 * Push notifications (FCM) to every app install of a user (tokens saved after OTP sign-in / token refresh).
 * Best effort: never throws. Tokens that FCM reports as dead are removed. Blocked accounts get no pushes.
 *
 * Android receives:
 *   notification: { title, body }          → shown by the system when the app is in the background
 *   data: { notificationId, link, type }   → open `link` (e.g. /properties/<id>) on tap
 *   android channel: "saferent_default"    → create it in the app (high importance)
 *
 * dataOnly (announcements): no `notification` block, android priority high — the app always builds the
 * notification itself (so it can load the auth-protected `imageUrl`). data then also has title / body.
 */
const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

export async function sendPush(
  userId: string,
  msg: { title: string; body: string; link?: string | null; notificationId?: string; type?: string; data?: Record<string, string>; dataOnly?: boolean; imageUrl?: string | null },
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { firebaseUid: true, accountStatus: true } });
    if (!user || user.accountStatus !== "ACTIVE") return;
    const devices = await prisma.userDevice.findMany({ where: { userUid: user.firebaseUid }, select: { fcmToken: true }, orderBy: { lastSeenAt: "desc" }, take: 20 });
    if (!devices.length) return;
    const tokens = devices.map((d) => d.fcmToken);
    const data: Record<string, string> = { ...(msg.data ?? {}), notificationId: msg.notificationId ?? "", link: msg.link ?? "", type: msg.type ?? "GENERAL" };
    if (msg.imageUrl) data.imageUrl = msg.imageUrl;
    const result = await messaging.sendEachForMulticast(
      msg.dataOnly
        ? {
            tokens,
            data: { ...data, title: msg.title.slice(0, 150), body: msg.body.slice(0, 500) },
            android: { priority: "high" },
            apns: { headers: { "apns-priority": "5" }, payload: { aps: { contentAvailable: true } } },
          }
        : {
            tokens,
            notification: { title: msg.title.slice(0, 150), body: msg.body.slice(0, 500) },
            data,
            android: { priority: "high", notification: { channelId: "saferent_default", sound: "default" } },
            apns: { payload: { aps: { sound: "default" } } },
          },
    );
    const dead = result.responses.map((r, i) => (!r.success && r.error && DEAD_TOKEN.has(r.error.code) ? tokens[i] : null)).filter((t): t is string => !!t);
    if (dead.length) await prisma.userDevice.deleteMany({ where: { fcmToken: { in: dead } } });
    const failed = result.responses.filter((r) => !r.success && !(r.error && DEAD_TOKEN.has(r.error.code)));
    if (failed.length) console.error(`[push] ${failed.length} of ${tokens.length} failed`, failed[0]?.error?.code, failed[0]?.error?.message);
    else console.log(`[push] sent to ${tokens.length - dead.length} device(s)`);
  } catch (error) {
    console.error("[push] send failed", error);
  }
}
