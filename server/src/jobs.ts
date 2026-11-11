import { finalizeDueExits } from "./controllers/leaseExit.controller";
import { publishDueReviews } from "./controllers/reviews.controller";

/**
 * Small in-process scheduler for time-based work that must not wait for someone to open the app:
 *  - close leases whose agreed move-out date has come;
 *  - publish reviews whose double-blind window has closed.
 * Every job is idempotent (conditional updates), so overlapping runs or several API instances are safe.
 * The same functions also run before the related reads, so nothing depends on the timer alone.
 */
const EVERY_MS = 10 * 60 * 1000;

async function runOnce(): Promise<void> {
  for (const [name, job] of [
    ["lease-exits", finalizeDueExits],
    ["review-publication", publishDueReviews],
  ] as const) {
    try {
      await job();
    } catch (err) {
      console.error(`[jobs] ${name} failed`, err);
    }
  }
}

export function startJobs(): () => void {
  const first = setTimeout(() => void runOnce(), 30_000);
  const timer = setInterval(() => void runOnce(), EVERY_MS);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
