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

/* Lease → rental agreement registration and police verification. */

interface LeaseCompliance {
  agreement: { type: string | null; registrationNumber: string | null; office: string | null; date: string | null; stampDutyAmount: number | null };
  policeVerification: { status: string; reference: string | null; submittedOn: string | null; verifiedOn: string | null };
  can: { editAgreement: boolean; editPoliceVerification: boolean };
}
const POLICE_TONE: Record<string, "success" | "warning" | "neutral" | "brand"> = { VERIFIED: "success", SUBMITTED: "brand", NOT_STARTED: "warning", NOT_REQUIRED: "neutral" };

export function LeaseCompliancePanel({ leaseId }: { leaseId: string }) {
  const { data, reload } = useQuery(() => request<LeaseCompliance>(`/leases/${leaseId}/compliance`), [leaseId]);
  const [a, setA] = useState({ type: "", registrationNumber: "", office: "", date: "", stampDutyAmount: "" });
  const [pv, setPv] = useState({ status: "NOT_STARTED", reference: "", submittedOn: "", verifiedOn: "" });
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setA({ type: data.agreement.type ?? "", registrationNumber: data.agreement.registrationNumber ?? "", office: data.agreement.office ?? "", date: data.agreement.date ?? "", stampDutyAmount: data.agreement.stampDutyAmount?.toString() ?? "" });
    setPv({ status: data.policeVerification.status, reference: data.policeVerification.reference ?? "", submittedOn: data.policeVerification.submittedOn ?? "", verifiedOn: data.policeVerification.verifiedOn ?? "" });
  }, [data]);
  if (!data) return null;
  const save = async (body: Record<string, unknown>) => {
    setMsg(null);
    try {
      await request(`/leases/${leaseId}/compliance`, { method: "PUT", body });
      await reload();
      setMsg({ kind: "success", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    }
  };
  const n = (s: string) => (s === "" ? null : s);
  return (
    <section className="space-y-3 rounded-lg border border-line p-4 text-sm">
      <h3 className="font-semibold">Agreement & police verification</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select label="Agreement" placeholder="Not set" options={["REGISTERED", "NOTARIZED", "E_STAMP", "UNREGISTERED"].map((x) => ({ value: x, label: labelize(x) }))} value={a.type} onChange={(e) => setA({ ...a, type: e.target.value })} disabled={!data.can.editAgreement} />
        <Input label={a.type === "E_STAMP" ? "e-Stamp certificate no." : "Registration / document no."} maxLength={80} value={a.registrationNumber} onChange={(e) => setA({ ...a, registrationNumber: e.target.value })} disabled={!data.can.editAgreement} />
        <Input label="Office (SRO / notary)" maxLength={120} value={a.office} onChange={(e) => setA({ ...a, office: e.target.value })} disabled={!data.can.editAgreement} />
        <Input label="Agreement date" type="date" value={a.date} onChange={(e) => setA({ ...a, date: e.target.value })} disabled={!data.can.editAgreement} />
        <Input label="Stamp duty (₹)" type="number" min={0} value={a.stampDutyAmount} onChange={(e) => setA({ ...a, stampDutyAmount: e.target.value })} disabled={!data.can.editAgreement} />
      </div>
      {data.can.editAgreement && <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={() => void save({ agreementType: n(a.type), agreementRegistrationNumber: n(a.registrationNumber), agreementOffice: n(a.office), agreementDate: n(a.date), stampDutyAmount: a.stampDutyAmount === "" ? null : Number(a.stampDutyAmount) })}>Save agreement</Button></div>}
      <div className="flex items-center gap-2"><span className="font-medium">Police verification</span><Badge tone={POLICE_TONE[data.policeVerification.status] ?? "neutral"}>{labelize(data.policeVerification.status)}</Badge></div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Select label="Status" options={["NOT_STARTED", "SUBMITTED", "VERIFIED", "NOT_REQUIRED"].map((x) => ({ value: x, label: labelize(x) }))} value={pv.status} onChange={(e) => setPv({ ...pv, status: e.target.value })} disabled={!data.can.editPoliceVerification} />
        <Input label="Reference no." maxLength={80} value={pv.reference} onChange={(e) => setPv({ ...pv, reference: e.target.value })} disabled={!data.can.editPoliceVerification} />
        <Input label="Submitted on" type="date" value={pv.submittedOn} onChange={(e) => setPv({ ...pv, submittedOn: e.target.value })} disabled={!data.can.editPoliceVerification} />
        <Input label="Verified on" type="date" value={pv.verifiedOn} onChange={(e) => setPv({ ...pv, verifiedOn: e.target.value })} disabled={!data.can.editPoliceVerification} />
      </div>
      {data.can.editPoliceVerification && <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={() => void save({ policeVerificationStatus: pv.status, policeVerificationRef: n(pv.reference), policeVerificationSubmittedOn: n(pv.submittedOn), policeVerificationVerifiedOn: n(pv.verifiedOn) })}>Save police verification</Button></div>}
      <p className="text-xs text-muted">Upload the agreement and the police acknowledgement in the property's Documents (Rental agreement / Police verification).</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}
