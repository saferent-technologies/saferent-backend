import { CheckCircle2, IdCard, ShieldOff, XCircle } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp } from "@/utils/format";

interface LeasePan {
  side: "TENANT" | "LANDLORD" | null;
  hasPan: boolean;
  shared: boolean;
  sharedVia: "ALL_TENANTS" | "THIS_LEASE" | null;
  pan: string | null;
  masked: string | null;
  request: { status: "PENDING" | "APPROVED" | "DENIED" | "REVOKED"; note: string | null; requestedAt: string; decidedAt: string | null } | null;
  canRequest: boolean;
  canDecide: boolean;
  reaskDays: number;
}

/**
 * Lease popup → "Owner PAN (for HRA)". Tenant asks; only the owner can share it.
 * Shared PAN shows on this lease's rent receipts.
 */
export function LandlordPanPanel({ leaseId }: { leaseId: string }) {
  const { data, loading, error, reload } = useQuery(() => request<LeasePan>(`/leases/${leaseId}/pan`), [leaseId]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await request(`/leases/${leaseId}/pan${path}`, { method: "POST", body });
      setMsg({ kind: "success", text: ok });
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Spinner className="size-5 text-brand" />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data || !data.side) return null;
  const r = data.request;

  return (
    <section className="space-y-2 rounded-control bg-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><IdCard className="size-4" /> Owner PAN (for HRA)</h3>
        {data.shared ? <Badge tone="success">Shared</Badge> : r?.status === "PENDING" ? <Badge tone="warning">Requested</Badge> : <Badge>Not shared</Badge>}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {data.side === "TENANT" && (
        <>
          {data.shared ? (
            <p>PAN: <span className="font-mono font-semibold">{data.pan}</span> <span className="text-xs text-muted">· also printed on your rent receipts</span></p>
          ) : (
            <p className="text-muted">
              Needed for your HRA claim if yearly rent is above ₹1 lakh. The owner decides whether to share it.
              {r?.status === "PENDING" && ` Asked ${formatTimestamp(r.requestedAt)}.`}
              {r?.status === "DENIED" && ` The owner declined${r.note ? ` (${r.note})` : ""}. You can ask again after ${data.reaskDays} days, or ask them for a written declaration.`}
              {r?.status === "REVOKED" && " The owner stopped sharing it."}
            </p>
          )}
          {data.canRequest && (
            <Button size="sm" loading={busy} onClick={() => void run("/request", {}, "Request sent to the owner.")}>Request PAN</Button>
          )}
        </>
      )}

      {data.side === "LANDLORD" && (
        <>
          {!data.hasPan && <p className="text-muted">Add your PAN in Profile → PAN &amp; tax to share it with tenants.</p>}
          {data.shared && (
            <p className="text-muted">
              Your PAN ({data.masked}) is shown to this tenant and on their receipts
              {data.sharedVia === "ALL_TENANTS" ? " because you share it with all tenants (change in Profile)." : "."}
            </p>
          )}
          {r?.status === "PENDING" && (
            <p className="font-medium">The tenant asked for your PAN on {formatTimestamp(r.requestedAt)}.</p>
          )}
          {data.canDecide && data.hasPan && (
            <div className="flex flex-wrap gap-2">
              {!data.shared && (
                <Button size="sm" leftIcon={<CheckCircle2 className="size-4" />} loading={busy} onClick={() => void run("/decide", { approve: true }, "PAN shared with this tenant.")}>
                  {r?.status === "PENDING" ? "Approve" : "Share PAN"}
                </Button>
              )}
              {r?.status === "PENDING" && (
                <Button size="sm" variant="secondary" leftIcon={<XCircle className="size-4" />} disabled={busy} onClick={() => void run("/decide", { approve: false }, "Request declined.")}>Decline</Button>
              )}
              {data.shared && data.sharedVia === "THIS_LEASE" && (
                <Button size="sm" variant="secondary" leftIcon={<ShieldOff className="size-4" />} disabled={busy} onClick={() => void run("/revoke", {}, "PAN no longer shared on this lease.")}>Stop sharing</Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
