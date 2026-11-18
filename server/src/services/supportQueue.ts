import type { Prisma } from "@prisma/client";
import { SUPPORT_QUEUE } from "../config/constants";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";

/**
 * Support queue.
 *  - Agents = active users with the SUPPORT role (main or extra role).
 *  - Online = portal heartbeat (POST /support/presence) within ONLINE_WINDOW_MS while "Available".
 *  - Each agent handles up to AGENT_CAPACITY open tickets (OPEN / IN_PROGRESS) at a time.
 *  - New tickets go to the free online agent with the fewest open tickets (round robin on ties);
 *    no free agent → the ticket waits in the queue (oldest first) and the owner sees their position.
 *  - The queue drains whenever a ticket is created, a ticket is resolved / closed / unassigned,
 *    an agent comes online, and every 10 min from the jobs runner.
 * A MySQL named lock makes dispatch safe with several API instances. Logs carry ids / counts only.
 */

const ACTIVE = ["OPEN", "IN_PROGRESS"] as const;
const AGENT_WHERE: Prisma.UserWhereInput = { accountStatus: "ACTIVE", OR: [{ role: "SUPPORT" }, { extraRoles: { some: { role: "SUPPORT" } } }] };
export const QUEUED_WHERE: Prisma.SupportTicketWhereInput = { assignedToId: null, status: { in: [...ACTIVE] } };

const onlineSince = () => new Date(Date.now() - SUPPORT_QUEUE.ONLINE_WINDOW_MS);
export const isOnline = (seenAt: Date | null | undefined) => !!seenAt && seenAt >= onlineSince();
export const ticketData = (id: string) => ({ ticketId: id, type: "SUPPORT_TICKET" });

/** Online agents with their open-ticket load (db = a transaction or the client). */
export async function onlineAgents(db: Prisma.TransactionClient = prisma) {
  const agents = await db.user.findMany({
    where: { ...AGENT_WHERE, supportSeenAt: { gte: onlineSince() } },
    select: { id: true, fullName: true, supportAssignedAt: true },
  });
  if (!agents.length) return [];
  const loads = await db.supportTicket.groupBy({ by: ["assignedToId"], where: { assignedToId: { in: agents.map((a) => a.id) }, status: { in: [...ACTIVE] } }, _count: { _all: true } });
  const load = new Map(loads.map((l) => [l.assignedToId, l._count._all]));
  return agents.map((a) => ({ ...a, load: load.get(a.id) ?? 0 }));
}

/** Is this user an agent the queue can assign to (SUPPORT role, active)? */
export async function isSupportAgent(userId: string): Promise<boolean> {
  return !!(await prisma.user.findFirst({ where: { id: userId, ...AGENT_WHERE }, select: { id: true } }));
}

/** Ids of queued tickets, oldest first (position = index + 1). */
export async function queueOrder(): Promise<string[]> {
  const rows = await prisma.supportTicket.findMany({ where: QUEUED_WHERE, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true }, take: 2000 });
  return rows.map((r) => r.id);
}

type Assignment = { ticketId: string; ownerId: string; subject: string; agentId: string; agentName: string };

let running: Promise<number> | null = null;
let again = false;

/** Give queued tickets to free online agents. Returns how many were assigned. Never throws. */
export function dispatchSupportQueue(): Promise<number> {
  if (running) {
    again = true; // a dispatch is in flight: run once more after it so nothing is missed
    return running;
  }
  running = (async () => {
    let total = 0;
    do {
      again = false;
      total += await dispatchOnce().catch((err) => {
        console.error("[support-queue] dispatch failed", (err as Error).message);
        return 0;
      });
    } while (again);
    return total;
  })().finally(() => {
    running = null;
  });
  return running;
}

async function dispatchOnce(): Promise<number> {
  const made = await prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ got: bigint | number | null }>>`SELECT GET_LOCK('saferent_support_queue', 5) AS got`;
      if (!lock || Number(lock.got) !== 1) return [] as Assignment[];
      try {
        const agents = (await onlineAgents(tx)).filter((a) => a.load < SUPPORT_QUEUE.AGENT_CAPACITY);
        const slots = agents.reduce((n, a) => n + (SUPPORT_QUEUE.AGENT_CAPACITY - a.load), 0);
        if (!slots) return [];
        const queued = await tx.supportTicket.findMany({ where: QUEUED_WHERE, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: slots, select: { id: true, raisedById: true, subject: true } });
        const out: Assignment[] = [];
        for (const t of queued) {
          // Fewest open tickets first; ties → whoever got a ticket longest ago (never-assigned first).
          const free = agents
            .filter((a) => a.load < SUPPORT_QUEUE.AGENT_CAPACITY && a.id !== t.raisedById)
            .sort((x, y) => x.load - y.load || (x.supportAssignedAt?.getTime() ?? 0) - (y.supportAssignedAt?.getTime() ?? 0));
          const agent = free[0];
          if (!agent) continue;
          const now = new Date();
          const { count } = await tx.supportTicket.updateMany({ where: { id: t.id, assignedToId: null }, data: { assignedToId: agent.id, assignedAt: now, agentSeenAt: null } });
          if (!count) continue;
          await tx.user.update({ where: { id: agent.id }, data: { supportAssignedAt: now } });
          agent.load += 1;
          agent.supportAssignedAt = now;
          out.push({ ticketId: t.id, ownerId: t.raisedById, subject: t.subject, agentId: agent.id, agentName: agent.fullName });
        }
        return out;
      } finally {
        await tx.$queryRaw`SELECT RELEASE_LOCK('saferent_support_queue')`;
      }
    },
    { timeout: 15_000 },
  );
  for (const a of made) {
    const link = `/support/${a.ticketId}`;
    // The agent sees it on their Support badge (unread) and the portal rings: no notification row for staff.
    await notify(a.ownerId, "Your ticket is being handled", `${a.agentName} is now looking into "${a.subject}".`, link, undefined, ticketData(a.ticketId));
  }
  if (made.length) console.info("[support-queue] assigned", { count: made.length });
  return made.length;
}

/** Portal heartbeat ("Available" = online; "Away" / sign out = offline). An online agent drains the queue. */
export async function heartbeat(userId: string, available: boolean): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { supportSeenAt: available ? new Date() : null } });
  if (available) void dispatchSupportQueue(); // cheap; picks up anything waiting the moment they're free
}
