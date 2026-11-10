import { Badge } from "./Badge";
import { labelize } from "@/utils/format";

type Tone = "brand" | "neutral" | "success" | "warning" | "danger";

const TONES: Record<string, Tone> = {
  ACTIVE: "success",
  APPROVED: "success",
  PAID: "success",
  SUCCESS: "success",
  COMPLETED: "success",
  RESOLVED: "success",
  PROCESSED: "success",
  VERIFIED: "success",
  CLOSED: "neutral",
  ENDED: "neutral",
  DRAFT: "neutral",
  INACTIVE: "neutral",
  WITHDRAWN: "neutral",
  CANCELLED: "neutral",
  VOID: "neutral",
  DISMISSED: "neutral",
  PENDING: "warning",
  PENDING_REVIEW: "warning",
  DUE: "warning",
  OPEN: "warning",
  REQUESTED: "warning",
  ASSIGNED: "brand",
  ACCEPTED: "brand",
  IN_PROGRESS: "brand",
  ISSUED: "brand",
  SCHEDULED: "brand",
  RENTED: "brand",
  NEW: "brand",
  CONTACTED: "brand",
  VISIT_SCHEDULED: "brand",
  INVESTIGATING: "brand",
  REJECTED: "danger",
  OVERDUE: "danger",
  FAILED: "danger",
  TERMINATED: "danger",
  SUSPENDED: "danger",
  DEACTIVATED: "danger",
  DECLINED: "danger",
  REVERSED: "danger",
  URGENT: "danger",
  HIGH: "warning",
  NO_SHOW: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{labelize(status)}</Badge>;
}
