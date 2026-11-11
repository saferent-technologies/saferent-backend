import { Download, FileText, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { cn } from "@/utils/cn";
import { AppError, errorMessage } from "@/utils/errors";
import { formatDate } from "@/utils/format";
import { categoryLabel, openDocument } from "@/pages/properties/PropertyDocuments";

interface Rental {
  leaseId: string;
  property: { id: string; name: string };
  place: string | null;
  documents: Array<{ id: string; code: string; name: string; category: string; description: string | null; uploadedAt: string; documentDate: string | null; expiryDate: string | null; state: "ACTIVE" | "EXPIRED" | "VERIFIED"; version: number; level: "PROPERTY" | "UNIT" }>;
}

interface MyRequest {
  id: string;
  code: string;
  leaseId: string;
  documentName: string;
  reason: string | null;
  status: string;
  rejectionReason: string | null;
  linkedDocumentId: string | null;
  createdAt: string;
}

const STATE: Record<string, { label: string; tone: "success" | "danger" | "brand" }> = {
  ACTIVE: { label: "Active", tone: "brand" },
  VERIFIED: { label: "Verified by SafeRent", tone: "success" },
  EXPIRED: { label: "Expired", tone: "danger" },
};

/** Tenant → "Property documents": documents the landlord shared for my home + requesting documents. */
export function MyDocumentsPage() {
  const [params] = useSearchParams();
  const highlight = params.get("doc");
  const docs = useQuery(() => request<{ rentals: Rental[] }>("/my/documents"), []);
  const reqs = useQuery(() => request<{ items: MyRequest[] }>("/my/document-requests"), []);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState<Record<string, { name: string; reason: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (leaseId: string) => {
    const f = form[leaseId] ?? { name: "", reason: "" };
    setBusy(leaseId);
    setMsg(null);
    try {
      await request(`/leases/${leaseId}/document-requests`, { method: "POST", body: { documentName: f.name.trim(), reason: f.reason.trim() || undefined } });
      setForm({ ...form, [leaseId]: { name: "", reason: "" } });
      setMsg({ kind: "success", text: "Request sent to your landlord." });
      await reqs.reload();
    } catch (err) {
      const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
      setMsg({ kind: "error", text: issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Property documents" description="Documents your landlord has shared for your home, and documents you've asked for." />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {docs.loading && !docs.data && <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>}
      {docs.error && <Alert kind="error">{docs.error}</Alert>}
      {docs.data && docs.data.rentals.length === 0 && <p className="card p-5 text-sm text-muted">You don't have an active rental on SafeRent yet.</p>}
      <div className="space-y-6">
        {docs.data?.rentals.map((r) => {
          const f = form[r.leaseId] ?? { name: "", reason: "" };
          const myReqs = (reqs.data?.items ?? []).filter((x) => x.leaseId === r.leaseId);
          return (
            <section key={r.leaseId} className="space-y-4">
              <h2 className="text-lg font-semibold">{r.place ? `${r.place} · ` : ""}{r.property.name}</h2>
              <div className="card p-5">
                {r.documents.length === 0 ? (
                  <p className="text-sm text-muted">Your landlord hasn't shared any documents yet. You can request one below.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {r.documents.map((d) => (
                      <li key={d.id} className={cn("flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between", highlight === d.id && "rounded-control bg-brand-bg px-2")}>
                        <div className="flex min-w-0 items-start gap-3">
                          <FileText className="mt-0.5 size-5 shrink-0 text-brand" />
                          <div className="min-w-0">
                            <p className="font-medium">{d.name} {d.version > 1 && <Badge>Updated</Badge>}</p>
                            <p className="text-xs text-muted">{categoryLabel(d.category)} · uploaded {formatDate(d.uploadedAt)}{d.expiryDate ? ` · valid till ${formatDate(d.expiryDate)}` : ""} · {d.level === "PROPERTY" ? "for the whole property" : "for your home"}</p>
                            {d.description && <p className="text-xs text-muted">{d.description}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={STATE[d.state]!.tone}>{STATE[d.state]!.label}</Badge>
                          <Button size="sm" variant="secondary" leftIcon={<Download className="size-4" />} onClick={() => void openDocument(d, (t) => setMsg({ kind: "error", text: t }))}>View</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="card space-y-3 p-5">
                <h3 className="font-semibold">Request a document</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Document name *" placeholder="e.g. Rental agreement copy, NOC, Maintenance receipt" maxLength={150} value={f.name} onChange={(e) => setForm({ ...form, [r.leaseId]: { ...f, name: e.target.value } })} />
                  <Textarea label="Reason (optional)" rows={1} maxLength={1000} value={f.reason} onChange={(e) => setForm({ ...form, [r.leaseId]: { ...f, reason: e.target.value } })} />
                </div>
                <div className="flex justify-end"><Button loading={busy === r.leaseId} disabled={f.name.trim().length < 2} leftIcon={<Send className="size-4" />} onClick={() => void send(r.leaseId)}>Submit request</Button></div>
                {myReqs.length > 0 && (
                  <ul className="divide-y divide-line border-t border-line pt-2 text-sm">
                    {myReqs.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>{x.documentName} <span className="text-xs text-muted">{x.code} · {formatDate(x.createdAt)}{x.rejectionReason ? ` · ${x.rejectionReason}` : ""}</span></span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={x.status} />
                          {["PENDING", "IN_PROGRESS"].includes(x.status) && (
                            <Button size="sm" variant="ghost" leftIcon={<XCircle className="size-4" />} onClick={() => void request(`/document-requests/${x.id}/cancel`, { method: "POST" }).then(() => reqs.reload()).catch((e) => setMsg({ kind: "error", text: errorMessage(e) }))}>Cancel</Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
