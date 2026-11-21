import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { labelize } from "@/utils/format";

/* Lease → society contacts, my parking, society approval of the tenant. */

interface LeaseSociety {
  society: null | { associationName: string | null; contactName: string | null; contactRole: string | null; contactPhone: string | null; gateContactName: string | null; gateContactPhone: string | null };
  myParking: Array<{ id: string; slotNumber: string; vehicleType: string; covered: boolean }>;
  approval: { status: string | null; date: string | null; note: string | null };
  can: { editApproval: boolean };
}
const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { APPROVED: "success", PENDING: "warning", REJECTED: "danger", NOT_REQUIRED: "neutral" };

export function LeaseSocietyPanel({ leaseId }: { leaseId: string }) {
  const { data, error, reload } = useQuery(() => request<LeaseSociety>(`/leases/${leaseId}/society`), [leaseId]);
  const [v, setV] = useState({ status: "", date: "", note: "" });
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => { if (data) setV({ status: data.approval.status ?? "", date: data.approval.date ?? "", note: data.approval.note ?? "" }); }, [data]);
  if (error || !data || (!data.society && !data.approval.status && !data.can.editApproval)) return null;
  const save = async () => {
    setMsg(null);
    try {
      await request(`/leases/${leaseId}/society-approval`, { method: "PUT", body: { status: v.status, date: v.date || null, note: v.note || null } });
      await reload();
      setMsg({ kind: "success", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    }
  };
  return (
    <section className="space-y-2 rounded-lg border border-line p-4 text-sm">
      <h3 className="font-semibold">Society</h3>
      {data.society && (
        <p>
          {data.society.associationName ?? "Society"}
          {data.society.contactName && <> · {data.society.contactName}{data.society.contactRole ? ` (${labelize(data.society.contactRole)})` : ""} {data.society.contactPhone}</>}
          {data.society.gateContactPhone && <> · Gate: {data.society.gateContactName} {data.society.gateContactPhone}</>}
        </p>
      )}
      {data.myParking.length > 0 && <p>Parking: {data.myParking.map((s) => `${s.slotNumber} (${labelize(s.vehicleType)}, ${s.covered ? "covered" : "open"})`).join(", ")}</p>}
      <p className="flex items-center gap-2">Society approval: {data.approval.status ? <Badge tone={TONE[data.approval.status] ?? "neutral"}>{labelize(data.approval.status)}</Badge> : <span className="text-muted">Not set</span>}{data.approval.note ? ` · ${data.approval.note}` : ""}</p>
      {data.can.editApproval && (
        <div className="grid items-end gap-2 sm:grid-cols-[10rem_10rem_1fr_auto]">
          <Select label="Status" placeholder="—" options={["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"].map((x) => ({ value: x, label: labelize(x) }))} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} />
          <Input label="Date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          <Input label="Note" maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          <Button size="sm" variant="secondary" disabled={!v.status} onClick={() => void save()}>Save</Button>
        </div>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}
