import { CheckCircle2, IdCard, XCircle } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp } from "@/utils/format";

interface PanSettings {
  hasPan: boolean;
  masked: string | null;
  shareAll: boolean;
  shareAllAt: string | null;
  requests: Array<{ leaseId: string; leaseCode: string | null; place: string; tenant: string | null; status: "PENDING" | "APPROVED"; requestedAt: string }>;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Profile → PAN & tax (owners). PAN is private by default; shared only when the owner says so. */
export function PanSettingsCard() {
  const { data, loading, error, reload } = useQuery(() => request<PanSettings>("/profile/pan"), []);
  const [pan, setPan] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text: ok });
      setEditing(false);
      setPan("");
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const save = (body: Record<string, unknown>, ok: string) => call(() => request("/profile/pan", { method: "PUT", body }), ok);
  const decide = (leaseId: string, approve: boolean) =>
    call(() => request(`/leases/${leaseId}/pan/decide`, { method: "POST", body: { approve } }), approve ? "PAN shared with that tenant." : "Request declined.");
  const revoke = (leaseId: string) => call(() => request(`/leases/${leaseId}/pan/revoke`, { method: "POST", body: {} }), "Stopped sharing on that lease.");

  if (loading && !data) return <section className="card p-5"><Spinner className="size-5 text-brand" /></section>;
  if (error) return <section className="card p-5"><Alert kind="error">{error}</Alert></section>;
  if (!data) return null;
  const clean = pan.replace(/\s+/g, "").toUpperCase();
  const pending = data.requests.filter((r) => r.status === "PENDING");
  const approved = data.requests.filter((r) => r.status === "APPROVED");

  return (
    <section className="card space-y-4 p-5 sm:p-6 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><IdCard className="size-4" /> PAN &amp; tax</h2>
        {pending.length > 0 && <Badge tone="warning">{pending.length} tenant request{pending.length > 1 ? "s" : ""}</Badge>}
      </div>
      <p className="text-sm text-muted">
        Tenants need the owner's PAN for their HRA claim when yearly rent is above ₹1 lakh. Your PAN stays private — it's shown
        to a tenant (and printed on their rent receipts) only if you approve.
      </p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {data.hasPan && !editing ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Saved PAN: <span className="font-mono font-semibold">{data.masked}</span></span>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Change</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save({ pan: null }, "PAN removed. It's no longer shared with anyone.")}>Remove</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-60">
            <Input label="PAN" value={pan} maxLength={12} placeholder="ABCDE1234F" onChange={(e) => setPan(e.target.value)} hint={pan && !PAN_RE.test(clean) ? "Format: 5 letters, 4 digits, 1 letter." : undefined} />
          </div>
          <Button size="sm" loading={busy} disabled={!PAN_RE.test(clean)} onClick={() => void save({ pan: clean }, "PAN saved.")}>Save PAN</Button>
          {editing && <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setPan(""); }}>Cancel</Button>}
        </div>
      )}

      {data.hasPan && (
        <Checkbox
          label="Share my PAN with all my tenants (shown on their rent receipts)"
          checked={data.shareAll}
          disabled={busy}
          onChange={(e) => void save({ shareAll: e.target.checked }, e.target.checked ? "PAN will be shown to all your tenants." : "PAN is now shared only where you approve.")}
        />
      )}
      {data.shareAll && data.shareAllAt && <p className="text-xs text-muted">Shared with all tenants since {formatTimestamp(data.shareAllAt)}.</p>}

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Tenant requests</h3>
          {pending.map((r) => (
            <div key={r.leaseId} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3 text-sm">
              <span><span className="font-medium">{r.tenant}</span> · {r.place} <span className="text-xs text-muted">· {formatTimestamp(r.requestedAt)}</span></span>
              <span className="flex gap-2">
                <Button size="sm" leftIcon={<CheckCircle2 className="size-4" />} disabled={busy || !data.hasPan} onClick={() => void decide(r.leaseId, true)}>Approve</Button>
                <Button size="sm" variant="secondary" leftIcon={<XCircle className="size-4" />} disabled={busy} onClick={() => void decide(r.leaseId, false)}>Decline</Button>
              </span>
            </div>
          ))}
          {!data.hasPan && <p className="text-xs text-muted">Save your PAN above to approve.</p>}
        </div>
      )}

      {approved.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Shared on these leases</h3>
          {approved.map((r) => (
            <div key={r.leaseId} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3 text-sm">
              <span><span className="font-medium">{r.tenant}</span> · {r.place}</span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void revoke(r.leaseId)}>Stop sharing</Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
