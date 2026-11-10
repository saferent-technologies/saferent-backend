import { prisma } from "./prisma";

/** In-app notification (best effort — never breaks the main action). */
export async function notify(userId: string | null | undefined, title: string, body: string, link?: string): Promise<void> {
  if (!userId) return;
  try {
    await prisma.notification.create({ data: { userId, title, body, link: link ?? null } });
  } catch (error) {
    console.error("[notify] failed", error);
  }
}
