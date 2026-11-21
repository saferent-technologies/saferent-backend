import { dispatchSupportQueue } from "./services/supportQueue";
import { finalizeDueExits } from "./controllers/leaseExit.controller";
import { publishDueReviews } from "./controllers/reviews.controller";
import { rebuildLocations } from "./properties/locations";
import { sendRentNotifications } from "./services/rentNotifications";
import { endExpiredLeases } from "./services/leaseExpiry";
import { processHomeAlerts } from "./services/homeAlerts";
import { processVisitReminders } from "./properties/controllers/visitBooking.controller";
import { processSafetyReminders } from "./properties/controllers/safety.controller";
import { processDocumentExpiry } from "./properties/controllers/compliance.controller";
import { processSmartRentReminders } from "./properties/controllers/smart.controller";

/** Search-suggestion places are rebuilt from the properties at most once an hour (safety net). */
let lastLocationsRebuild = 0;
async function rebuildLocationsHourly(): Promise<void> {
  if (Date.now() - lastLocationsRebuild < 60 * 60 * 1000) return;
  lastLocationsRebuild = Date.now();
  await rebuildLocations();
}

/**
 * Small in-process scheduler for time-based work that must not wait for someone to open the app:
 *  - close leases whose agreed move-out date has come;
 *  - publish reviews whose double-blind window has closed;
 *  - create rent dues and send "rent due today" / "rent overdue" notifications.
 * Every job is idempotent (conditional updates), so overlapping runs or several API instances are safe.
 * The same functions also run before the related reads, so nothing depends on the timer alone.
 */
const EVERY_MS = 10 * 60 * 1000;

async function runOnce(): Promise<void> {
  for (const [name, job] of [
    ["lease-exits", finalizeDueExits],
    ["lease-expiry", endExpiredLeases],
    ["review-publication", publishDueReviews],
    ["locations", rebuildLocationsHourly],
    ["rent-notifications", sendRentNotifications],
    ["home-alerts", processHomeAlerts],
    ["support-queue", dispatchSupportQueue],
    ["visit-reminders", processVisitReminders],
    ["safety-reminders", processSafetyReminders],
    ["document-expiry", processDocumentExpiry],
    ["smart-rent-reminders", () => processSmartRentReminders()],
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
