import { Archive, CheckCircle2, Download, FilePlus2, History, Pencil, RotateCcw, Upload, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useQuery } from "@/hooks/useQuery";
import { fetchBlob, request, upload } from "@/services/api";
import type { Paged } from "@/types/auth";
import { cn } from "@/utils/cn";
import { AppError, errorMessage } from "@/utils/errors";
import { formatDate, formatTimestamp, labelize } from "@/utils/format";
import type { PropertyDetail } from "./types";

/* Shared by the landlord's property page and the tenant's "Property documents" page. */

export interface DocRow {
  id: string;
  code: string;
  name: string;
  docType: string;
  description: string | null;
  documentDate: string | null;
  expiryDate: string | null;
  sharedWithTenant: boolean;
  needsVerification: boolean;
  status: string;
  state: "ACTIVE" | "EXPIRED" | "VERIFIED";
  target: string | null;
  unitId: string | null;
  roomId: string | null;
  bedId: string | null;
  version: number;
  versions?: number;
  originalName: string;
  mimeType: string;
  fileSize: number | null;
  rejectionReason: string | null;
  archivedAt: string | null;
  createdAt: string;
  uploadedBy?: string | null;
}

interface DocRequest {
  id: string;
  code: string;
  documentName: string;
  reason: string | null;
  status: string;
  tenantName: string | null;
  place: string | null;
  createdAt: string;
  rejectionReason: string | null;
}

export const MAIN_CATEGORIES = ["RENTAL_AGREEMENT", "ELECTRICITY_BILL", "PROPERTY_TAX_RECEIPT", "OTHER"] as const;
const MORE_CATEGORIES = ["OWNERSHIP_PROOF", "SALE_DEED", "BUILDING_PERMISSION", "LANDLORD_IDENTITY"] as const;
const ACCEPT = "application/pdf,image/jpeg,image/png";
const MAX_MB = 5;

export function categoryLabel(c: string): string {
  return c === "OTHER" ? "Other document" : labelize(c);
}

export async function openDocument(doc: { id: string; originalName?: string; name: string }, onError: (t: string) => void) {
  try {
    const blob = await fetchBlob(`/files/documents/${doc.id}`);
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.originalName ?? doc.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    onError(errorMessage(err));
  }
}

function explain(err: unknown): string {
  const issues = err instanceof AppError ? (err.details?.issues as Array<{ message: string }> | undefined) : undefined;
  return issues?.length ? issues.map((i) => i.message).join(" · ") : errorMessage(err);
}

function checkFile(f: File | null | undefined): string | null {
  if (!f) return "Choose a file.";
  if (!["application/pdf", "image/jpeg", "image/png"].includes(f.type)) return "Only PDF, JPG and PNG files.";
  if (f.size > MAX_MB * 1024 * 1024) return `Files can be up to ${MAX_MB} MB.`;
  return null;
}

/** Whole property + every flat / villa, room and bed of this property. value = "unit:<id>" | "room:<id>" | "bed:<id>" | "" */
function targetOptions(p: PropertyDetail) {
  const unitLabel = p.type?.unitLabel ?? "Unit";
  const opts = [{ value: "", label: p.structure === "MULTI_UNIT" || p.structure === "ROOMS_BEDS" ? "Whole property (all tenants)" : "Whole property" }];
  for (const u of p.units) opts.push({ value: `unit:${u.id}`, label: u.name || `${unitLabel} ${u.unitNumber ?? u.code}` });
  for (const r of p.rooms) {
    opts.push({ value: `room:${r.id}`, label: `Room ${r.roomNumber} (all beds)` });
    for (const b of r.beds) opts.push({ value: `bed:${b.id}`, label: `Room ${r.roomNumber} · Bed ${b.bedNumber}` });
  }
  return opts;
}

/* ─── Upload / custom "Other" document ─── */

function UploadModal({ p, preset, onClose, onDone }: { p: PropertyDetail; preset?: { requestId: string; name: string }; onClose: () => void; onDone: (t: string) => void }) {
  const [v, setV] = useState({ target: "", docType: preset ? "OTHER" : "RENTAL_AGREEMENT", customName: preset?.name ?? "", description: "", documentDate: "", expiryDate: "", share: !!preset });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => targetOptions(p), [p]);
  const isOther = v.docType === "OTHER";

  const submit = async () => {
    const fileProblem = checkFile(file);
    if (fileProblem) return setError(fileProblem);
    if (isOther && v.customName.trim().length < 2) return setError("Enter the document name.");
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file!);
      form.append("docType", v.docType);
      const [kind, id] = v.target.split(":");
      if (kind && id) form.append(`${kind}Id`, id);
      if (v.customName.trim()) form.append("customName", v.customName.trim());
      if (v.description.trim()) form.append("description", v.description.trim());
      if (v.documentDate) form.append("documentDate", v.documentDate);
      if (v.expiryDate) form.append("expiryDate", v.expiryDate);
      form.append("shareWithTenant", String(v.share));
      if (preset) form.append("requestId", preset.requestId);
      const res = await upload<{ notifiedTenants: number }>(`/properties/${p.id}/documents`, form);
      onDone(v.share ? `Uploaded and shared${res.notifiedTenants ? ` — ${res.notifiedTenants} tenant(s) notified` : ""}.` : "Uploaded (private).");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={preset ? `Upload "${preset.name}"` : "Upload document"} description={preset ? "This fulfils the tenant's request and is shared with them." : "PDF, JPG or PNG, up to 5 MB. Private unless you share it."}>
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
        {!preset && <Select label="For" options={options} value={v.target} onChange={(e) => setV({ ...v, target: e.target.value })} />}
        {!preset && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Category</p>
            <div className="grid grid-cols-2 gap-2">
              {MAIN_CATEGORIES.map((c) => (
                <button key={c} type="button" aria-pressed={v.docType === c} onClick={() => setV({ ...v, docType: c })} className={cn("min-h-11 rounded-control border px-3 text-left text-sm", v.docType === c ? "border-brand bg-brand-bg font-semibold text-brand-dark" : "border-line hover:bg-subtle")}>
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
            <Select className="mt-2" aria-label="More categories" placeholder="More (ownership proof, sale deed …)" options={MORE_CATEGORIES.map((c) => ({ value: c, label: labelize(c) }))} value={(MORE_CATEGORIES as readonly string[]).includes(v.docType) ? v.docType : ""} onChange={(e) => e.target.value && setV({ ...v, docType: e.target.value })} />
          </div>
        )}
        <Input label={isOther ? "Document name *" : "Title (optional)"} placeholder={isOther ? "e.g. Parking Allotment Letter, NOC, Encumbrance Certificate" : ""} maxLength={150} value={v.customName} onChange={(e) => setV({ ...v, customName: e.target.value })} />
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="doc-file">Upload document *</label>
          <input id="doc-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-control file:border-0 file:bg-brand-bg file:px-3 file:py-2 file:font-semibold file:text-brand-dark" />
          {file && <p className="mt-1 text-xs text-muted">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
        </div>
        <Textarea label="Description" rows={2} maxLength={1000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Document date" type="date" value={v.documentDate} onChange={(e) => setV({ ...v, documentDate: e.target.value })} />
          <Input label="Expiry date" type="date" value={v.expiryDate} onChange={(e) => setV({ ...v, expiryDate: e.target.value })} />
        </div>
        {!preset && (
          <label className="flex items-center justify-between gap-3 rounded-control border border-line p-3 text-sm">
            <span><span className="font-medium">Share with tenant</span><span className="block text-xs text-muted">Only the tenant(s) of the selected property / unit can see it. They get a notification.</span></span>
            <input type="checkbox" className="size-5" checked={v.share} onChange={(e) => setV({ ...v, share: e.target.checked })} />
          </label>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} leftIcon={<Upload className="size-4" />} onClick={() => void submit()}>Upload</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditModal({ doc, onClose, onDone }: { doc: DocRow; onClose: () => void; onDone: (t: string) => void }) {
  const [v, setV] = useState({ customName: doc.docType === "OTHER" ? doc.name : (doc.name === labelize(doc.docType) ? "" : doc.name), description: doc.description ?? "", documentDate: doc.documentDate?.slice(0, 10) ?? "", expiryDate: doc.expiryDate?.slice(0, 10) ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await request(`/documents/${doc.id}`, { method: "PATCH", body: { customName: v.customName.trim() || null, description: v.description.trim() || null, documentDate: v.documentDate || null, expiryDate: v.expiryDate || null } });
      onDone("Details saved.");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${doc.name}`}>
      <div className="space-y-3">
        <Input label={doc.docType === "OTHER" ? "Document name *" : "Title"} maxLength={150} value={v.customName} onChange={(e) => setV({ ...v, customName: e.target.value })} />
        <Textarea label="Description" rows={2} maxLength={1000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Document date" type="date" value={v.documentDate} onChange={(e) => setV({ ...v, documentDate: e.target.value })} />
          <Input label="Expiry date" type="date" value={v.expiryDate} onChange={(e) => setV({ ...v, expiryDate: e.target.value })} />
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function VersionsModal({ doc, onClose, onError }: { doc: DocRow; onClose: () => void; onError: (t: string) => void }) {
  const { data, error } = useQuery(() => request<{ items: DocRow[] }>(`/documents/${doc.id}/versions`), [doc.id]);
  return (
    <Modal open onClose={onClose} title={`${doc.name} — history`} description="Every version is kept. Only the newest one is shown to tenants.">
      {error && <Alert kind="error">{error}</Alert>}
      <ul className="divide-y divide-line text-sm">
        {data?.items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0"><span className="font-medium">v{r.version}</span> {r.version === doc.version && <Badge tone="success">Current</Badge>}<span className="block truncate text-xs text-muted">{r.originalName} · {formatTimestamp(r.createdAt)}{r.uploadedBy ? ` · ${r.uploadedBy}` : ""}</span></span>
            <Button size="sm" variant="ghost" leftIcon={<Download className="size-4" />} onClick={() => void openDocument(r, onError)}>Open</Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ─── Landlord: property page → Documents ─── */

export function PropertyDocumentsTab({ p, canManage, canVerify }: { p: PropertyDetail; canManage: boolean; canVerify: boolean }) {
  const [filter, setFilter] = useState({ target: "", docType: "", archived: false });
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState<{ requestId: string; name: string } | null | false>(false);
  const [editing, setEditing] = useState<DocRow | null>(null);
  const [history, setHistory] = useState<DocRow | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<DocRow | null>(null);
  const { confirm, dialog } = useConfirm();
  const [kind, id] = filter.target.split(":");
  const query = { page, docType: filter.docType || undefined, archived: filter.archived ? "true" : undefined, ...(filter.target === "property" ? { level: "property" } : kind && id ? { [`${kind}Id`]: id } : {}) };
  const docs = useQuery(() => request<Paged<DocRow>>(`/properties/${p.id}/documents`, { query }), [p.id, JSON.stringify(query)]);
  const requests = useQuery(() => request<Paged<DocRequest>>(`/properties/${p.id}/document-requests`), [p.id], canManage);
  const options = useMemo(() => targetOptions(p), [p]);
  const ok = async (text: string) => {
    setMsg({ kind: "success", text });
    await Promise.all([docs.reload(), canManage ? requests.reload() : Promise.resolve()]);
  };
  const err = (text: string) => setMsg({ kind: "error", text });

  const toggleShare = async (d: DocRow) => {
    try {
      await request(`/documents/${d.id}`, { method: "PATCH", body: { sharedWithTenant: !d.sharedWithTenant } });
      await ok(d.sharedWithTenant ? `${d.name} is now private.` : `${d.name} is shared with the tenant.`);
    } catch (e) {
      err(explain(e));
    }
  };
  const replace = async (f: File | undefined) => {
    const d = replacing;
    if (!d) return;
    const problem = checkFile(f);
    if (problem) return err(problem);
    const form = new FormData();
    form.append("file", f!);
    try {
      await upload(`/documents/${d.id}/replace`, form);
      await ok(`New version of ${d.name} uploaded. The old file is kept in history.`);
    } catch (e) {
      err(explain(e));
    } finally {
      setReplacing(null);
      if (replaceInput.current) replaceInput.current.value = "";
    }
  };
  const verify = (d: DocRow, status: "APPROVED" | "REJECTED") =>
    confirm({
      title: status === "APPROVED" ? "Verify document" : "Reject document",
      message: status === "APPROVED" ? "Mark this ownership document as verified." : "Tell the owner what's wrong.",
      tone: status === "APPROVED" ? "primary" : "danger",
      confirmLabel: status === "APPROVED" ? "Verify" : "Reject",
      reason: status === "REJECTED" ? { label: "Reason", required: true, minLength: 5 } : undefined,
      onConfirm: async (reason) => {
        await request(`/documents/${d.id}/verify`, { method: "POST", body: { status, rejectionReason: reason || undefined } });
        await ok("Document updated.");
      },
    });

  const pending = requests.data?.items ?? [];

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {canManage && pending.length > 0 && (
        <section className="card border-brand/40 p-5">
          <h3 className="mb-3 font-semibold">Pending document requests ({pending.length})</h3>
          <ul className="divide-y divide-line text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{r.documentName} <span className="text-xs font-normal text-muted">{r.code}</span></p>
                  <p className="text-xs text-muted">{r.tenantName}{r.place ? ` · ${r.place}` : ""} · {formatDate(r.createdAt)}{r.reason ? ` · “${r.reason}”` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={r.status} />
                  <Button size="sm" leftIcon={<Upload className="size-4" />} onClick={() => setUploading({ requestId: r.id, name: r.documentName })}>Upload</Button>
                  {r.status === "PENDING" && <Button size="sm" variant="secondary" onClick={() => void request(`/document-requests/${r.id}/respond`, { method: "POST", body: { status: "IN_PROGRESS" } }).then(() => ok("Marked in progress — the tenant is told.")).catch((e) => err(explain(e)))}>In progress</Button>}
                  <Button size="sm" variant="ghost" leftIcon={<XCircle className="size-4 text-danger" />} onClick={() => confirm({ title: "Reject request", message: "The tenant sees your reason.", tone: "danger", confirmLabel: "Reject", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: async (reason) => { await request(`/document-requests/${r.id}/respond`, { method: "POST", body: { status: "REJECTED", rejectionReason: reason } }); await ok("Request rejected."); } })}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <Select label="Show" options={[{ value: "", label: "All documents" }, { value: "property", label: "Whole-property documents" }, ...options.filter((o) => o.value)]} value={filter.target} onChange={(e) => { setFilter({ ...filter, target: e.target.value }); setPage(1); }} />
            <Select label="Category" options={[{ value: "", label: "All categories" }, ...[...MAIN_CATEGORIES, ...MORE_CATEGORIES].map((c) => ({ value: c, label: categoryLabel(c) }))]} value={filter.docType} onChange={(e) => { setFilter({ ...filter, docType: e.target.value }); setPage(1); }} />
            <label className="flex items-end gap-2 pb-2.5 text-sm"><input type="checkbox" checked={filter.archived} onChange={(e) => { setFilter({ ...filter, archived: e.target.checked }); setPage(1); }} /> Archived</label>
          </div>
          {canManage && <Button leftIcon={<FilePlus2 className="size-4" />} onClick={() => setUploading(null)}>Upload document</Button>}
        </div>
        <p className="mb-3 text-xs text-muted">Private by default — only you, assigned managers and SafeRent verifiers can open them. Shared documents are visible only to the tenant(s) of that property or unit. Every download is logged.</p>
        {docs.loading && !docs.data && <div className="flex justify-center py-8"><Spinner className="size-6 text-brand" /></div>}
        {docs.error && <Alert kind="error">{docs.error}</Alert>}
        {docs.data && docs.data.items.length === 0 && <p className="py-6 text-center text-sm text-muted">{filter.archived ? "No archived documents." : "No documents yet. Upload a rental agreement, electricity bill, tax receipt or any other document."}</p>}
        <ul className="divide-y divide-line">
          {docs.data?.items.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{d.name} {d.version > 1 && <Badge>v{d.version}</Badge>}</p>
                <p className="text-xs text-muted">{categoryLabel(d.docType)} · {d.target ?? "Whole property"} · {formatDate(d.createdAt)}{d.expiryDate ? ` · expires ${formatDate(d.expiryDate)}` : ""} · {d.code}</p>
                {d.rejectionReason && <p className="text-xs text-danger">{d.rejectionReason}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.state === "EXPIRED" && <Badge tone="danger">Expired</Badge>}
                {d.needsVerification && <StatusBadge status={d.status} />}
                {canManage && !d.archivedAt ? (
                  <label className="flex items-center gap-1.5 text-xs font-medium">
                    <input type="checkbox" checked={d.sharedWithTenant} onChange={() => void toggleShare(d)} /> Shared with tenant
                  </label>
                ) : (
                  <Badge tone={d.sharedWithTenant ? "success" : "neutral"}>{d.sharedWithTenant ? "Shared" : "Private"}</Badge>
                )}
                <Button size="sm" variant="ghost" leftIcon={<Download className="size-4" />} onClick={() => void openDocument(d, err)}>Open</Button>
                {canManage && !d.archivedAt && (
                  <>
                    <Button size="sm" variant="ghost" leftIcon={<Pencil className="size-4" />} onClick={() => setEditing(d)}>Edit</Button>
                    <Button size="sm" variant="ghost" leftIcon={<Upload className="size-4" />} onClick={() => { setReplacing(d); replaceInput.current?.click(); }}>Replace</Button>
                  </>
                )}
                {canManage && (d.versions ?? 1) > 1 && <Button size="sm" variant="ghost" leftIcon={<History className="size-4" />} onClick={() => setHistory(d)}>History</Button>}
                {canManage && (d.archivedAt ? (
                  <Button size="sm" variant="ghost" leftIcon={<RotateCcw className="size-4" />} onClick={() => void request(`/documents/${d.id}/restore`, { method: "POST" }).then(() => ok("Restored.")).catch((e) => err(explain(e)))}>Restore</Button>
                ) : (
                  <Button size="sm" variant="ghost" leftIcon={<Archive className="size-4" />} onClick={() => confirm({ title: "Archive document", message: "It's hidden from lists and from tenants. The file and its history are kept.", confirmLabel: "Archive", reason: { label: "Reason", required: true, minLength: 3 }, onConfirm: async (reason) => { await request(`/documents/${d.id}/archive`, { method: "POST", body: { reason } }); await ok("Archived."); } })}>Archive</Button>
                ))}
                {canVerify && d.needsVerification && d.status === "PENDING" && (
                  <>
                    <Button size="sm" leftIcon={<CheckCircle2 className="size-4" />} onClick={() => verify(d, "APPROVED")}>Verify</Button>
                    <Button size="sm" variant="secondary" onClick={() => verify(d, "REJECTED")}>Reject</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {docs.data && docs.data.totalPages > 1 && (
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page >= docs.data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </section>
      <input ref={replaceInput} type="file" hidden accept={ACCEPT} onChange={(e) => void replace(e.target.files?.[0])} />
      {uploading !== false && <UploadModal p={p} preset={uploading ?? undefined} onClose={() => setUploading(false)} onDone={(t) => { setUploading(false); void ok(t); }} />}
      {editing && <EditModal doc={editing} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); void ok(t); }} />}
      {history && <VersionsModal doc={history} onClose={() => setHistory(null)} onError={err} />}
      {dialog}
    </div>
  );
}
