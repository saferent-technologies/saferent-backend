import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Tabs } from "@/components/ui/Tabs";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { formatTimestamp } from "@/utils/format";
import { maskPhone } from "@/utils/mask";
import { MATCH_LABEL, OWNERSHIP_LABEL, type KycIdentity, type KycProperty, type NameMatch } from "@/pages/kyc/VerifyPage";

type Status = "SUBMITTED" | "APPROVED" | "REJECTED";

interface Row {
  userId: string;
  fullName: string;
  phoneNumber: string | null;
  kycStatus: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  digilockerName: string | null;
  nameMatch: NameMatch | null;
  test: boolean;
  pendingOwnershipDocs: number;
}

interface Detail {
  user: { id: string; fullName: string; phoneNumber: string | null; phoneVerified: boolean; email: string | null; createdAt: string };
  stage: string;
  kycStatus: string;
  note: string | null;
  submittedAt: string | null;
  identity: KycIdentity | null;
  selfie: boolean;
  properties: KycProperty[];
}

/** /admin/kyc — staff compare DigiLocker photo vs live selfie and names, then approve / reject. */
export function OwnerVerificationPage() {
  const [status, setStatus] = useState<Status>("SUBMITTED");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const list = useQuery(() => request<Paged<Row>>("/admin/kyc", { query: { status, page, pageSize: 20 } }), [status, page]);

  return (
    <>
      <PageHeader title="Owner verification" description="Check each owner's DigiLocker ID against their live selfie before their listings can go live." />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <Tabs<Status>
        idPrefix="kyc"
        className="mb-4"
        value={status}
        onChange={(v) => { setStatus(v); setPage(1); }}
        items={[{ value: "SUBMITTED", label: "Waiting" }, { value: "APPROVED", label: "Verified" }, { value: "REJECTED", label: "Sent back" }]}
      />
      <DataTable<Row>
        rows={list.data?.items}
        loading={list.loading}
        error={list.error}
        rowKey={(r) => r.userId}
        onRowClick={(r) => setOpen(r.userId)}
        empty={status === "SUBMITTED" ? "No owners waiting for review." : "Nothing here yet."}
        columns={[
          { key: "name", header: "Owner", render: (r) => <span className="font-semibold">{r.fullName}</span> },
          { key: "dl", header: "DigiLocker name", render: (r) => <span className="flex flex-wrap items-center gap-1">{r.digilockerName ?? "—"}{r.nameMatch && <Badge tone={MATCH_LABEL[r.nameMatch].tone}>{MATCH_LABEL[r.nameMatch].text}</Badge>}{r.test && <Badge tone="warning">TEST</Badge>}</span> },
          { key: "phone", header: "Phone", render: (r) => (r.phoneNumber ? maskPhone(r.phoneNumber) : "—"), className: "hidden md:table-cell" },
          { key: "docs", header: "Ownership docs to check", render: (r) => (r.pendingOwnershipDocs ? <Badge tone="warning">{r.pendingOwnershipDocs}</Badge> : "—"), className: "hidden lg:table-cell" },
          { key: "when", header: status === "SUBMITTED" ? "Submitted" : "Reviewed", render: (r) => formatTimestamp(status === "SUBMITTED" ? r.submittedAt : r.reviewedAt) },
        ]}
      />
      {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />}
      {open && (
        <ReviewModal
          userId={open}
          onClose={() => setOpen(null)}
          onDone={async (text) => { setOpen(null); setMsg({ kind: "success", text }); await list.reload(); }}
        />
      )}
    </>
  );
}

function ReviewModal({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const { data, loading, error } = useQuery(() => request<Detail>(`/admin/kyc/${userId}`), [userId]);
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (decision: "APPROVED" | "REJECTED", note?: string) => {
    setBusy(true);
    setErr(null);
    try {
      await request(`/users/${userId}/kyc`, { method: "POST", body: { decision, note } });
      await onDone(decision === "APPROVED" ? "Owner verified." : "Sent back to the owner.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const id = data?.identity;
  const canDecide = data && data.kycStatus !== "APPROVED" && !!id && data.selfie;

  return (
    <Modal open onClose={onClose} title={data ? `Verify ${data.user.fullName}` : "Owner verification"} description={data ? `Profile name: ${data.user.fullName}` : undefined}>
      {loading && !data && <Spinner className="size-6 text-brand" />}
      {error && <Alert kind="error">{error}</Alert>}
      {data && (
        <div className="space-y-4 text-sm">
          {err && <Alert kind="error">{err}</Alert>}
          {id?.test && <Alert kind="info">TEST data from the fake DigiLocker — don't approve real owners from this.</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <figure className="space-y-1">
              {id?.hasPhoto ? <AuthImage path={`/kyc/files/${userId}/photo`} alt="DigiLocker photo" className="aspect-[4/5] w-full rounded-control" /> : <div className="flex aspect-[4/5] items-center justify-center rounded-control bg-subtle text-muted">No DigiLocker photo</div>}
              <figcaption className="text-center text-xs text-muted">DigiLocker (Aadhaar) photo</figcaption>
            </figure>
            <figure className="space-y-1">
              {data.selfie ? <AuthImage path={`/kyc/files/${userId}/selfie`} alt="Live selfie" className="aspect-[4/5] w-full rounded-control" /> : <div className="flex aspect-[4/5] items-center justify-center rounded-control bg-subtle text-muted">No selfie</div>}
              <figcaption className="text-center text-xs text-muted">Live selfie</figcaption>
            </figure>
          </div>

          <dl className="grid grid-cols-2 gap-2 rounded-control bg-subtle p-3">
            <dt className="text-muted">DigiLocker name</dt>
            <dd className="flex flex-wrap items-center gap-1 font-medium">{id?.name ?? "—"}{id && <Badge tone={MATCH_LABEL[id.nameMatch].tone}>{MATCH_LABEL[id.nameMatch].text}</Badge>}</dd>
            <dt className="text-muted">Profile name</dt><dd className="font-medium">{data.user.fullName}</dd>
            <dt className="text-muted">Date of birth</dt><dd>{id?.dob ?? "—"}</dd>
            <dt className="text-muted">Aadhaar</dt><dd>{id?.aadhaarLast4 ? `•••• ${id.aadhaarLast4}` : "—"}</dd>
            <dt className="text-muted">Address (Aadhaar)</dt><dd>{id ? [id.city, id.state, id.pincode].filter(Boolean).join(", ") : "—"}</dd>
            <dt className="text-muted">Phone</dt><dd>{data.user.phoneNumber ? maskPhone(data.user.phoneNumber) : "—"} {data.user.phoneVerified ? "✓" : ""}</dd>
          </dl>

          <div className="space-y-2">
            <h3 className="font-semibold">Properties &amp; ownership proof</h3>
            <p className="text-xs text-muted">Open the property's Documents tab to verify the proof. Check the name matches the DigiLocker name, and cross-check the tax / power-bill number on the official site.</p>
            {data.properties.length === 0 ? <p className="text-muted">No properties yet.</p> : (
              <ul className="divide-y divide-line rounded-control border border-line">
                {data.properties.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                    <span className="truncate">{p.title} <span className="text-xs text-muted">{p.code}</span></span>
                    <span className="flex items-center gap-2">
                      <Badge tone={OWNERSHIP_LABEL[p.ownership].tone}>{OWNERSHIP_LABEL[p.ownership].text}</Badge>
                      <Link to={`/properties/${p.id}?tab=documents`} className="inline-flex items-center gap-1 text-brand-dark underline">Documents <ExternalLink className="size-3.5" /></Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.note && <p className="text-muted">Last note: {data.note}</p>}
          {data.kycStatus !== "APPROVED" && (!id || !data.selfie) && <Alert kind="info">The owner hasn't finished DigiLocker and the selfie yet.</Alert>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {data.kycStatus === "APPROVED" ? (
              <Button variant="danger" disabled={busy} onClick={() => confirm({ title: "Revoke verification", message: "The owner loses “Owner verified” and new listings can't go live until they verify again.", tone: "danger", confirmLabel: "Revoke", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: (note) => decide("REJECTED", note) })}>
                Revoke
              </Button>
            ) : (
              <>
                <Button variant="secondary" leftIcon={<XCircle className="size-4" />} disabled={busy || !id} onClick={() => confirm({ title: "Send back to owner", message: "Tell the owner what to fix (e.g. selfie unclear, name doesn't match).", tone: "danger", confirmLabel: "Send back", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: (note) => decide("REJECTED", note) })}>
                  Send back
                </Button>
                <Button leftIcon={<CheckCircle2 className="size-4" />} disabled={!canDecide} loading={busy} onClick={() => confirm({ title: "Verify owner", message: "Confirm the selfie matches the DigiLocker photo and the names match.", confirmLabel: "Verify", onConfirm: () => decide("APPROVED") })}>
                  Verify owner
                </Button>
              </>
            )}
          </div>
          {dialog}
        </div>
      )}
    </Modal>
  );
}
