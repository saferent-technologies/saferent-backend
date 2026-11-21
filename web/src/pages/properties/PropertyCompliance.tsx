import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp, labelize } from "@/utils/format";
import type { PropertyDetail } from "./types";

/* India compliance: ownership declaration, property tax, assessment number, building approval, documents. */

interface ComplianceView {
  declaration: { text: string; version: string; declaredAt: string | null; declaredBy: string | null; current: boolean };
  compliance: { assessmentNumber: string | null; propertyTaxStatus: string | null; propertyTaxPaidYear: string | null; propertyTaxAmount: number | null; buildingApprovalNumber: string | null; buildingApprovalAuthority: string | null; buildingApprovalDate: string | null };
  documents: Array<{ docType: string; label: string; whereApplicable: boolean; uploaded: boolean; status: string | null; expiryDate: string | null; expiryState: string | null }>;
  expiring: Array<{ documentId: string; name: string; expiryDate: string; expiryState: string }>;
}
const TONE: Record<string, "success" | "warning" | "danger"> = { VALID: "success", EXPIRING: "warning", EXPIRED: "danger" };

export function PropertyComplianceTab({ p, canManage }: { p: PropertyDetail; canManage: boolean }) {
  const { profile } = useAuth();
  const { data, loading, error, reload } = useQuery(() => request<ComplianceView>(`/properties/${p.id}/compliance`), [p.id]);
  const [v, setV] = useState({ assessmentNumber: "", propertyTaxStatus: "", propertyTaxPaidYear: "", propertyTaxAmount: "", buildingApprovalNumber: "", buildingApprovalAuthority: "", buildingApprovalDate: "" });
  const [tick, setTick] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    const c = data.compliance;
    setV({ assessmentNumber: c.assessmentNumber ?? "", propertyTaxStatus: c.propertyTaxStatus ?? "", propertyTaxPaidYear: c.propertyTaxPaidYear ?? "", propertyTaxAmount: c.propertyTaxAmount?.toString() ?? "", buildingApprovalNumber: c.buildingApprovalNumber ?? "", buildingApprovalAuthority: c.buildingApprovalAuthority ?? "", buildingApprovalDate: c.buildingApprovalDate ?? "" });
  }, [data]);
  if (loading && !data) return <div className="flex justify-center py-8"><Spinner className="size-6 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Not available."}</Alert>;
  const isOwner = profile?.id === p.ownerId;
  const n = (s: string) => (s === "" ? null : s);
  const run = async (fn: () => Promise<unknown>, text: string) => {
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg({ kind: "success", text });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    }
  };

  return (
    <section className="card space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="font-semibold">Compliance</h2>
        <p className="text-sm text-muted">Private to the owner, managers and SafeRent. Never shown on the listing.</p>
      </div>
      {data.expiring.length > 0 && <Alert kind="warning">{data.expiring.map((d) => `${d.name}: ${d.expiryState === "EXPIRED" ? "expired" : "expires"} ${d.expiryDate}`).join(" · ")}</Alert>}

      <div className="rounded-lg border border-line p-3 text-sm">
        <p className="mb-1 font-semibold">Ownership declaration</p>
        <p className="text-muted">{data.declaration.text}</p>
        {data.declaration.current ? (
          <p className="mt-2"><Badge tone="success">Declared</Badge> by {data.declaration.declaredBy ?? "the owner"} on {formatTimestamp(data.declaration.declaredAt!)}</p>
        ) : isOwner ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} /> I agree</label>
            <Button size="sm" disabled={!tick} onClick={() => void run(() => request(`/properties/${p.id}/ownership-declaration`, { method: "POST", body: { accepted: true, version: data.declaration.version } }), "Declaration saved.")}>Declare</Button>
          </div>
        ) : (
          <p className="mt-2"><Badge tone="warning">Waiting for the owner</Badge> Needed before the listing is sent for review.</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Input label="Municipal assessment no. (PTIN)" maxLength={60} value={v.assessmentNumber} onChange={(e) => setV({ ...v, assessmentNumber: e.target.value })} disabled={!canManage} />
        <Select label="Property tax" placeholder="Not set" options={["PAID", "PENDING", "NOT_APPLICABLE"].map((x) => ({ value: x, label: labelize(x) }))} value={v.propertyTaxStatus} onChange={(e) => setV({ ...v, propertyTaxStatus: e.target.value })} disabled={!canManage} />
        {v.propertyTaxStatus === "PAID" && <Input label="Paid for year (e.g. 2025-26)" value={v.propertyTaxPaidYear} onChange={(e) => setV({ ...v, propertyTaxPaidYear: e.target.value })} disabled={!canManage} />}
        {v.propertyTaxStatus === "PAID" && <Input label="Amount (₹)" type="number" min={0} value={v.propertyTaxAmount} onChange={(e) => setV({ ...v, propertyTaxAmount: e.target.value })} disabled={!canManage} />}
        <Input label="Building approval / permit no." maxLength={80} value={v.buildingApprovalNumber} onChange={(e) => setV({ ...v, buildingApprovalNumber: e.target.value })} disabled={!canManage} />
        <Input label="Approving authority" placeholder="e.g. GHMC, BBMP, DTCP" maxLength={120} value={v.buildingApprovalAuthority} onChange={(e) => setV({ ...v, buildingApprovalAuthority: e.target.value })} disabled={!canManage} />
        <Input label="Approval date" type="date" value={v.buildingApprovalDate} onChange={(e) => setV({ ...v, buildingApprovalDate: e.target.value })} disabled={!canManage} />
      </div>
      {canManage && (
        <div className="flex justify-end">
          <Button
            onClick={() =>
              void run(
                () =>
                  request(`/properties/${p.id}/compliance`, {
                    method: "PUT",
                    body: {
                      assessmentNumber: n(v.assessmentNumber),
                      propertyTaxStatus: n(v.propertyTaxStatus),
                      propertyTaxPaidYear: v.propertyTaxStatus === "PAID" ? n(v.propertyTaxPaidYear) : null,
                      propertyTaxAmount: v.propertyTaxStatus === "PAID" && v.propertyTaxAmount !== "" ? Number(v.propertyTaxAmount) : null,
                      buildingApprovalNumber: n(v.buildingApprovalNumber),
                      buildingApprovalAuthority: n(v.buildingApprovalAuthority),
                      buildingApprovalDate: n(v.buildingApprovalDate),
                    },
                  }),
                "Compliance details saved.",
              )
            }
          >
            Save
          </Button>
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-semibold">Documents</p>
        <ul className="space-y-1 text-sm">
          {data.documents.map((d) => (
            <li key={d.docType} className="flex flex-wrap items-center gap-2">
              {d.label}{d.whereApplicable ? <span className="text-xs text-muted">(where applicable)</span> : null}:
              {d.uploaded ? <Badge tone={d.status === "APPROVED" ? "success" : "neutral"}>{d.status === "APPROVED" ? "Verified" : "Uploaded"}</Badge> : <span className="text-muted">Not uploaded</span>}
              {d.expiryState && <Badge tone={TONE[d.expiryState]}>{d.expiryState === "VALID" ? `Valid till ${d.expiryDate}` : d.expiryState === "EXPIRING" ? `Expires ${d.expiryDate}` : `Expired ${d.expiryDate}`}</Badge>}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted">Upload in the Documents tab, with the expiry date where there is one. You get a reminder 30 days before expiry.</p>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}
