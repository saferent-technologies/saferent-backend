import { prisma } from "./prisma";
import { sendPush } from "./push";
import { notificationAllowed, type NotificationCategory } from "../appConfig/schema";
import { appConfig } from "../appConfig/service";

export type { NotificationCategory };

/**
 * In-app notification + push (FCM) to the user's devices (best effort — never breaks the main action).
 * `category` ties it to a switch in Admin → App configuration → Notifications; a switched-off
 * category (or the whole notifications module) is skipped. Uncategorised ones are always sent.
 */
export async function notify(userId: string | null | undefined, title: string, body: string, link?: string, category?: NotificationCategory): Promise<void> {
  if (!userId) return;
  try {
    if (category && !notificationAllowed(await appConfig(), category)) return;
    const row = await prisma.notification.create({ data: { userId, title, body, link: link ?? null } });
    // Also a push to the user's phone(s), in the background (never delays the request).
    void sendPush(userId, { title, body, link: link ?? null, notificationId: row.id, type: category ?? "GENERAL" });
  } catch (error) {
    console.error("[notify] failed", error);
  }
}
