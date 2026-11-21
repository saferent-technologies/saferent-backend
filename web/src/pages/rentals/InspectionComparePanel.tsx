import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { labelize } from "@/utils/format";

/* Lease → move-in vs move-out inspection, side by side. */

type Change = "WORSE" | "BETTER" | "SAME" | "NOT_COMPARABLE" | "MISSING" | "ADDED";
interface Row { item: string; before: { quantity: number; condition: string } | null; after: { quantity: number; condition: string } | null; change: Change; missing: number }
interface Comparison {
  ready: boolean;
  missing: string[];
  comparison: null | {
    areas: Array<{ key: string; label: string; before: string | null; after: string | null; change: Change }>;
    furniture: Row[];
    appliances: Row[];
    meter: { moveIn: number | null; moveOut: number | null; used: number | null };
    keys: { moveIn: number | null; moveOut: number | null; missing: number | null };
    damages: { moveIn: string | null; moveOut: string | null };
    summary: { areasWorse: number; itemsMissing: number; itemsWorse: number; hasIssues: boolean };
  };
}
const TONE: Record<Change, "danger" | "success" | "neutral" | "warning"> = { WORSE: "danger", BETTER: "success", SAME: "neutral", NOT_COMPARABLE: "neutral", MISSING: "danger", ADDED: "warning" };

export function InspectionComparePanel({ leaseId }: { leaseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Move-in vs move-out</Button>
      {open && <CompareModal leaseId={leaseId} onClose={() => setOpen(false)} />}
    </>
  );
}

function CompareModal({ leaseId, onClose }: { leaseId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery(() => request<Comparison>(`/leases/${leaseId}/inspection-comparison`), [leaseId]);
  const c = data?.comparison;
  const items = (title: string, rows: Row[]) =>
    rows.length ? (
      <div>
        <p className="mb-1 font-semibold">{title}</p>
        <table className="w-full text-sm"><tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line"><td className="py-1">{r.item}</td><td>{r.before ? `${r.before.quantity} · ${labelize(r.before.condition)}` : "—"}</td><td>{r.after ? `${r.after.quantity} · ${labelize(r.after.condition)}` : "—"}</td><td className="text-right"><Badge tone={TONE[r.change]}>{r.change === "MISSING" && r.missing ? `${r.missing} missing` : labelize(r.change)}</Badge></td></tr>
          ))}
        </tbody></table>
      </div>
    ) : null;
  return (
    <Modal open onClose={onClose} title="Move-in vs move-out">
      {loading && !data && <div className="flex justify-center py-6"><Spinner className="size-6 text-brand" /></div>}
      {error && <Alert kind="error">{error}</Alert>}
      {data && !data.ready && <Alert kind="info">Complete the {data.missing.map((m) => labelize(m).toLowerCase()).join(" and ")} inspection first.</Alert>}
      {c && (
        <div className="max-h-[65vh] space-y-4 overflow-y-auto text-sm">
          <Alert kind={c.summary.hasIssues ? "warning" : "success"}>{c.summary.hasIssues ? `${c.summary.areasWorse} areas worse · ${c.summary.itemsWorse} items worse · ${c.summary.itemsMissing} items missing` : "No changes found."}</Alert>
          <table className="w-full"><thead><tr className="text-left text-xs text-muted"><th>Area</th><th>Move-in</th><th>Move-out</th><th /></tr></thead><tbody>
            {c.areas.map((a) => <tr key={a.key} className="border-b border-line"><td className="py-1">{a.label}</td><td>{a.before ? labelize(a.before) : "—"}</td><td>{a.after ? labelize(a.after) : "—"}</td><td className="text-right">{a.change !== "SAME" && a.change !== "NOT_COMPARABLE" && <Badge tone={TONE[a.change]}>{labelize(a.change)}</Badge>}</td></tr>)}
          </tbody></table>
          {items("Furniture", c.furniture)}
          {items("Appliances", c.appliances)}
          <p>Meter: {c.meter.moveIn ?? "—"} → {c.meter.moveOut ?? "—"}{c.meter.used != null ? ` (${c.meter.used} units used)` : ""} · Keys: {c.keys.moveIn ?? "—"} → {c.keys.moveOut ?? "—"}{c.keys.missing ? ` (${c.keys.missing} missing)` : ""}</p>
          {(c.damages.moveIn || c.damages.moveOut) && <div className="grid gap-2 sm:grid-cols-2"><div><p className="text-xs text-muted">Damages at move-in</p><p className="whitespace-pre-wrap">{c.damages.moveIn ?? "—"}</p></div><div><p className="text-xs text-muted">Damages at move-out</p><p className="whitespace-pre-wrap">{c.damages.moveOut ?? "—"}</p></div></div>}
        </div>
      )}
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Close</Button></div>
    </Modal>
  );
}
