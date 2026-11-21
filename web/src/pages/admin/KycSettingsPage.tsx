import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request, upload } from "@/services/api";
import { errorMessage } from "@/utils/errors";

interface IdTypeRow {
  type: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  available: boolean;
  reason: string | null;
}

interface UidaiCert {
  id: string | null;
  source: "UPLOADED" | "SERVER_FILE";
  subject: string;
  fingerprint: string;
  validTo: string;
  expired: boolean;
}

interface Tutorial {
  id: string;
  idType: string | null;
  title: string;
  description: string | null;
  type: "VIDEO" | "PDF" | "IMAGE";
  url: string;
  order: number;
  active: boolean;
  uploaded: boolean;
}

const TYPE_LABEL: Record<Tutorial["type"], string> = { VIDEO: "Video (MP4)", PDF: "PDF", IMAGE: "Image" };
const ID_TYPE_LABEL: Record<string, string> = { AADHAAR_XML: "Aadhaar offline eKYC (ZIP)", EAADHAAR_PDF: "e-Aadhaar PDF", PAN: "PAN card", PASSPORT: "Passport" };
const OTHER = "__OTHER__";
const idLabel = (k: string | null) => (k ? (ID_TYPE_LABEL[k] ?? k) : "No ID type");

const ACCEPT: Record<Tutorial["type"], string> = { VIDEO: "video/mp4", PDF: "application/pdf", IMAGE: "image/jpeg,image/png,image/webp" };

/** /admin/kyc-settings — Super Admin: which ID documents owners can use, and the guides shown in the app. */
export function KycSettingsPage() {
  const settings = useQuery(() => request<{ idTypes: IdTypeRow[]; uidaiCertificates: UidaiCert[] }>("/admin/kyc-settings"), []);
  const certInput = useRef<HTMLInputElement>(null);
  const uploadCert = (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    void run(async () => {
      await upload("/admin/kyc-settings/uidai-certificates", form);
      await settings.reload();
    }, "Certificate added. Aadhaar offline eKYC can be checked now.");
    if (certInput.current) certInput.current.value = "";
  };
  const tutorials = useQuery(() => request<{ items: Tutorial[] }>("/admin/kyc-tutorials"), []);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const { confirm, dialog } = useConfirm();

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: "success", text: ok });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  };

  const toggleType = (t: IdTypeRow) =>
    run(async () => {
      await request("/admin/kyc-settings", { method: "PUT", body: { idTypes: { [t.type]: !t.enabled } } });
      await settings.reload();
    }, `${t.label} ${t.enabled ? "turned off" : "turned on"}.`);

  const items = tutorials.data?.items ?? [];
  const [editing, setEditing] = useState<Tutorial | null>(null);
  const patch = (t: Tutorial, body: Partial<Pick<Tutorial, "active" | "order" | "title" | "description" | "idType">>, ok: string) =>
    run(async () => {
      await request(`/admin/kyc-tutorials/${t.id}`, { method: "PATCH", body });
      await tutorials.reload();
    }, ok);
  // Move up / down: swap display order with the neighbour.
  const move = (i: number, dir: -1 | 1) => {
    const a = items[i];
    const b = items[i + dir];
    if (!a || !b) return;
    void run(async () => {
      await request(`/admin/kyc-tutorials/${a.id}`, { method: "PATCH", body: { order: b.order } });
      await request(`/admin/kyc-tutorials/${b.id}`, { method: "PATCH", body: { order: a.order === b.order ? a.order + dir : a.order } });
      await tutorials.reload();
    }, "Order saved.");
  };

  return (
    <>
      <PageHeader title="Owner verification settings" description="Choose which ID documents owners can use, and the guides the app shows them." />
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      <section className="card mb-4 p-4 sm:p-6">
        <h2 className="mb-1 font-semibold">ID documents</h2>
        <p className="mb-3 text-sm text-muted">An ID shows in the app only when it's switched on here AND the server can check it.</p>
        {settings.loading && !settings.data ? (
          <Spinner className="size-6 text-brand" />
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {settings.data?.idTypes.map((t) => (
              <li key={t.type} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <span className="font-medium">{t.label}</span>{" "}
                  {t.available ? <Badge tone="success">Shown in app</Badge> : <Badge tone="neutral">Hidden</Badge>}
                  {!t.configured && <span className="block text-xs text-muted">{t.reason}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {t.type === "AADHAAR_XML" && (
                    <>
                      <input ref={certInput} type="file" hidden accept=".cer,.crt,.pem,application/x-x509-ca-cert,application/pkix-cert" onChange={(e) => uploadCert(e.target.files?.[0])} />
                      <Button size="sm" variant="secondary" leftIcon={<Upload className="size-4" />} onClick={() => certInput.current?.click()}>
                        Upload UIDAI public key
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant={t.enabled ? "secondary" : "primary"} onClick={() => void toggleType(t)}>
                    {t.enabled ? "Turn off" : "Turn on"}
                  </Button>
                </span>
                {t.type === "AADHAAR_XML" && (
                  <div className="w-full rounded-control bg-subtle p-3 text-xs">
                    <p className="text-muted">
                      Download the latest <span className="font-medium">Offline e-KYC public key certificate</span> (.cer) from{" "}
                      <a className="text-brand-dark underline" href="https://uidai.gov.in/en/data-and-download" target="_blank" rel="noreferrer">uidai.gov.in → Data and Downloads</a>{" "}
                      and upload it here. Aadhaar ZIPs are accepted only when UIDAI signed them with one of these.
                    </p>
                    {(settings.data?.uidaiCertificates ?? []).length === 0 ? (
                      <p className="mt-2 font-medium text-ink">No certificate yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {settings.data!.uidaiCertificates.map((c) => (
                          <li key={c.fingerprint} className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              <span className="font-medium text-ink">{c.subject}</span> · valid until {new Date(c.validTo).toLocaleDateString()}{" "}
                              {c.expired ? <Badge tone="danger">Expired</Badge> : <Badge tone="success">Active</Badge>} {c.source === "SERVER_FILE" && <Badge>Server file</Badge>}
                            </span>
                            {c.id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  confirm({
                                    title: "Remove certificate",
                                    message: "Aadhaar ZIPs signed with this certificate won't be accepted any more. If it's the only one, Aadhaar offline eKYC turns off.",
                                    tone: "danger",
                                    confirmLabel: "Remove",
                                    onConfirm: async () => {
                                      await request(`/admin/kyc-settings/uidai-certificates/${c.id}`, { method: "DELETE" });
                                      setMessage({ kind: "success", text: "Certificate removed." });
                                      await settings.reload();
                                    },
                                  })
                                }
                              >
                                Remove
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Guides in the app</h2>
            <p className="text-sm text-muted">Videos, PDFs or pictures for each ID type, shown in the app (GET /kyc/tutorials). Hidden ones aren't shown. A new ID type's guide shows without an app update.</p>
          </div>
          <Button leftIcon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add guide</Button>
        </div>
        {tutorials.loading && !tutorials.data ? (
          <Spinner className="size-6 text-brand" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No guides yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {items.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="font-medium">{t.title}</span> <Badge tone="brand">{idLabel(t.idType)}</Badge> <Badge>{TYPE_LABEL[t.type]}</Badge> {!t.active && <Badge tone="warning">Hidden</Badge>}
                  {t.description && <span className="block text-xs text-muted">{t.description}</span>}
                  <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-dark underline">
                    Open {t.uploaded ? "file" : "link"} <ExternalLink className="size-3" />
                  </a>
                </span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button>
                  <Button size="sm" variant="secondary" onClick={() => void patch(t, { active: !t.active }, t.active ? "Guide hidden." : "Guide shown.")}>{t.active ? "Hide" : "Show"}</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete guide"
                    onClick={() =>
                      confirm({
                        title: "Delete guide",
                        message: `"${t.title}" will be removed from the app.${t.uploaded ? " The uploaded file is deleted too." : ""}`,
                        tone: "danger",
                        confirmLabel: "Delete",
                        onConfirm: async () => {
                          await request(`/admin/kyc-tutorials/${t.id}`, { method: "DELETE" });
                          setMessage({ kind: "success", text: "Guide deleted." });
                          await tutorials.reload();
                        },
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && (
        <EditGuideModal
          guide={editing}
          idTypes={settings.data?.idTypes.map((r) => r.type) ?? []}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await request(`/admin/kyc-tutorials/${editing.id}`, { method: "PATCH", body });
            setEditing(null);
            setMessage({ kind: "success", text: "Guide saved." });
            await tutorials.reload();
          }}
        />
      )}
      <AddGuideModal idTypes={settings.data?.idTypes.map((r) => r.type) ?? []} open={adding} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); setMessage({ kind: "success", text: "Guide added." }); await tutorials.reload(); }} />
      {dialog}
    </>
  );
}

/** ID type picker: known types + "Other" for a new key (e.g. VOTER_ID). */
function IdTypeField({ value, onChange, idTypes }: { value: string; onChange: (v: string) => void; idTypes: string[] }) {
  const known = [...new Set([...idTypes, ...Object.keys(ID_TYPE_LABEL)])];
  const isOther = !!value && !known.includes(value);
  const [other, setOther] = useState(isOther);
  return (
    <>
      <Select
        label="For which ID"
        value={other ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOther(true);
            onChange("");
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
        options={[...known.map((k) => ({ value: k, label: idLabel(k) })), { value: OTHER, label: "Other (new ID type)" }]}
      />
      {other && <Input label="New ID type key" placeholder="VOTER_ID" value={value} onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} hint="Capital letters, numbers and _ only. Use the same key the verification uses." />}
    </>
  );
}

function EditGuideModal({ guide, idTypes, onClose, onSave }: { guide: Tutorial; idTypes: string[]; onClose: () => void; onSave: (body: { idType: string; title: string; description: string | null }) => Promise<void> }) {
  const [idType, setIdType] = useState(guide.idType ?? "AADHAAR_XML");
  const [title, setTitle] = useState(guide.title);
  const [description, setDescription] = useState(guide.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ idType, title, description: description.trim() || null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Edit guide" description="To change the file, delete this guide and add a new one.">
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <IdTypeField value={idType} onChange={setIdType} idTypes={idTypes} />
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} hint={`${title.length}/60. No dashes.`} />
        <Textarea label="Description (optional)" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} hint={`${description.length}/200`} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={title.trim().length < 2 || !idType} onClick={() => void save()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function AddGuideModal({ open, onClose, onDone, idTypes }: { open: boolean; onClose: () => void; onDone: () => Promise<void>; idTypes: string[] }) {
  const [idType, setIdType] = useState("AADHAAR_XML");
  const [type, setType] = useState<Tutorial["type"]>("VIDEO");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setNote("");
    setUrl("");
    setFile(null);
    setError(null);
    if (picker.current) picker.current.value = "";
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "upload") {
        if (!file) throw new Error("Choose a file.");
        const form = new FormData();
        form.append("idType", idType);
        form.append("type", type);
        form.append("title", title);
        if (note) form.append("description", note);
        form.append("file", file);
        await upload("/admin/kyc-tutorials", form);
      } else {
        await request("/admin/kyc-tutorials", { method: "POST", body: { idType, type, title, description: note || undefined, url } });
      }
      reset();
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add guide" description="Videos: MP4 (H.264) up to 50 MB. PDFs up to 30 MB. Images: JPG / PNG / WEBP up to 5 MB.">
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Select label="Type" value={type} onChange={(e) => { setType(e.target.value as Tutorial["type"]); setFile(null); if (picker.current) picker.current.value = ""; }} options={(["VIDEO", "PDF", "IMAGE"] as const).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        <IdTypeField value={idType} onChange={setIdType} idTypes={idTypes} />
        <Input label="Title" placeholder="Aadhaar offline eKYC" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} hint={`${title.length}/60. No dashes.`} />
        <Textarea label="Description (optional)" rows={3} placeholder="Download the ZIP from myAadhaar in Chrome and upload it with your share code." value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} hint={`${note.length}/200`} />
        <Select label="File" value={mode} onChange={(e) => setMode(e.target.value as "upload" | "link")} options={[{ value: "upload", label: "Upload a file" }, { value: "link", label: "Direct https link to the file" }]} />
        {mode === "upload" ? (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink-2">File</span>
            <input ref={picker} type="file" hidden accept={ACCEPT[type]} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="flex flex-wrap items-center gap-3 rounded-control border border-dashed border-line p-3">
              <Button variant="secondary" size="sm" leftIcon={<Upload className="size-4" />} onClick={() => picker.current?.click()}>
                {file ? "Change file" : "Choose file"}
              </Button>
              <span className="min-w-0 truncate text-sm text-muted">{file ? `${file.name} (${(file.size / 1048576).toFixed(1)} MB)` : `No file chosen. ${TYPE_LABEL[type]} only.`}</span>
            </div>
          </div>
        ) : (
          <Input label="Link" placeholder="https://…/guide.mp4" value={url} onChange={(e) => setUrl(e.target.value)} hint="A direct file link (Firebase Storage download URL or our CDN). Not YouTube or Drive pages." />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={title.trim().length < 2 || !idType || (mode === "upload" ? !file : !url)} onClick={() => void submit()}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}
