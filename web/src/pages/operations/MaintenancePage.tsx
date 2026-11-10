import { Camera, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { UploadButton } from "@/components/ui/UploadButton";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatMoney, formatTimestamp, labelize, toOptions } from "@/utils/format";

interface Job {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  serviceCharge: string | null;
  providerNote: string | null;
  createdAt: string;
  property: { id: string; title: string; addressLine: string; locality: string | null; city: string };
  raisedBy: { id: string; fullName: string; phoneNumber: string | null };
  provider: { id: string; fullName: string } | null;
  photos: Array<{ id: string }>;
  isMine: boolean;
  isAssignedToMe: boolean;
}

const STATUSES = ["OPEN", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "DECLINED", "CANCELLED", "CLOSED"];

export function MaintenancePage() {
  const { can, profile } = useAuth();
  const [params] = useSearchParams();
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<Job>>("/maintenance", { query: list.query }), [list.query]);
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [open, setOpen] = useState<Job | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const isProvider = profile?.role === "SERVICE_PROVIDER";

  useEffect(() => {
    if (open && data) setOpen(data.items.find((j) => j.id === open.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <>
      <PageHeader
        title={isProvider ? "My jobs" : "Maintenance"}
        description={isProvider ? "Accept jobs, update progress and upload completion photos." : "Repair requests for your properties."}
        actions={can("maintenance.create") && <Button leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New request</Button>}
      />
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <ListToolbar search={list.q} onSearch={list.setSearch} placeholder="Search title or property" filters={[{ name: "status", label: "Status", options: toOptions(STATUSES) }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(j) => j.id}
        onRowClick={setOpen}
        empty="No maintenance requests."
        columns={[
          { key: "title", header: "Request", render: (j) => <span><span className="block font-semibold">{j.title}</span><span className="text-xs text-muted">{labelize(j.category)} · {j.property.title}</span></span> },
          { key: "priority", header: "Priority", render: (j) => <StatusBadge status={j.priority} />, className: "hidden lg:table-cell" },
          { key: "provider", header: "Provider", render: (j) => j.provider?.fullName ?? "—", className: "hidden lg:table-cell" },
          { key: "status", header: "Status", render: (j) => <StatusBadge status={j.status} /> },
          { key: "date", header: "Raised", render: (j) => formatTimestamp(j.createdAt), className: "hidden xl:table-cell" },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      <CreateRequestModal open={creating} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); setMsg("Request submitted."); await reload(); }} />
      {open && <JobModal job={open} onClose={() => setOpen(null)} onChanged={async (text) => { setMsg(text); await reload(); }} />}
    </>
  );
}

function CreateRequestModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { profile } = useAuth();
  // Tenants: property of their active lease. Landlords/managers: their properties.
  const { data: leases } = useQuery(() => request<Paged<{ property: { id: string; title: string }; status: string }>>("/leases", { query: { status: "ACTIVE", pageSize: 50 } }), [], open && profile?.role === "TENANT");
  const { data: props } = useQuery(() => request<Paged<{ id: string; title: string }>>("/properties", { query: { pageSize: 100 } }), [], open && profile?.role !== "TENANT");
  const options = profile?.role === "TENANT" ? (leases?.items ?? []).map((l) => ({ value: l.property.id, label: l.property.title })) : (props?.items ?? []).map((p) => ({ value: p.id, label: p.title }));
  const [form, setForm] = useState({ propertyId: "", category: "PLUMBING", title: "", description: "", priority: "MEDIUM" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("/maintenance", { method: "POST", body: form });
      setForm({ propertyId: "", category: "PLUMBING", title: "", description: "", priority: "MEDIUM" });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New maintenance request">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {options.length === 0 && <Alert kind="info">{profile?.role === "TENANT" ? "You need an active rental to raise a request." : "Add a property first."}</Alert>}
        <Select label="Property" placeholder="Choose…" options={options} value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Category" options={toOptions(["PLUMBING", "ELECTRICAL", "CARPENTRY", "PAINTING", "APPLIANCE", "PEST_CONTROL", "CLEANING", "OTHER"])} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Select label="Priority" options={toOptions(["LOW", "MEDIUM", "HIGH", "URGENT"])} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
        </div>
        <Input label="Title" placeholder="Kitchen tap is leaking" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Details" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!form.propertyId || form.title.length < 5 || form.description.length < 10} onClick={() => void submit()}>Submit</Button>
        </div>
      </div>
    </Modal>
  );
}

function JobModal({ job, onClose, onChanged }: { job: Job; onClose: () => void; onChanged: (msg: string) => Promise<void> }) {
  const { can } = useAuth();
  const [providerId, setProviderId] = useState("");
  const [charge, setCharge] = useState(job.serviceCharge ? String(Number(job.serviceCharge)) : "");
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const canManage = can("maintenance.manage") && !job.isAssignedToMe;
  const { data: providers } = useQuery(() => request<{ items: Array<{ id: string; fullName: string }> }>("/users/lookup", { query: { role: "SERVICE_PROVIDER" } }), [], canManage && ["OPEN", "DECLINED", "ASSIGNED"].includes(job.status));

  const post = async (path: string, body: unknown, text: string) => {
    setError(null);
    try {
      await request(path, { method: "POST", body });
      await onChanged(text);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal open onClose={onClose} title={job.title} description={`${labelize(job.category)} · ${job.property.title}`}>
      <div className="space-y-4 text-sm">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex flex-wrap gap-2"><StatusBadge status={job.status} /><StatusBadge status={job.priority} /></div>
        <p className="whitespace-pre-line text-ink-2">{job.description}</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-muted">Address</dt><dd>{[job.property.addressLine, job.property.locality, job.property.city].filter(Boolean).join(", ")}</dd></div>
          <div><dt className="text-muted">Raised by</dt><dd>{job.raisedBy.fullName}{job.raisedBy.phoneNumber ? ` · ${job.raisedBy.phoneNumber}` : ""}</dd></div>
          <div><dt className="text-muted">Provider</dt><dd>{job.provider?.fullName ?? "Not assigned"}</dd></div>
          <div><dt className="text-muted">Service charge</dt><dd>{job.serviceCharge ? formatMoney(job.serviceCharge) : "—"}</dd></div>
        </dl>
        {job.providerNote && <Alert kind="info">Provider note: {job.providerNote}</Alert>}

        {job.photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {job.photos.map((ph) => <AuthImage key={ph.id} path={`/files/maintenance-photos/${ph.id}`} alt="Completion photo" className="aspect-square w-full rounded-lg" />)}
          </div>
        )}

        {canManage && ["OPEN", "DECLINED", "ASSIGNED"].includes(job.status) && (
          <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-end">
            <div className="flex-1"><Select label="Assign service provider" placeholder="Choose…" options={(providers?.items ?? []).map((p) => ({ value: p.id, label: p.fullName }))} value={providerId} onChange={(e) => setProviderId(e.target.value)} /></div>
            <Button disabled={!providerId} onClick={() => void post(`/maintenance/${job.id}/assign`, { providerId }, "Provider assigned.")}>Assign</Button>
          </div>
        )}

        {job.isAssignedToMe && (
          <div className="space-y-3 border-t border-line pt-4">
            {job.status === "ASSIGNED" && (
              <div className="flex gap-2">
                <Button onClick={() => void post(`/maintenance/${job.id}/respond`, { accept: true }, "Job accepted.")}>Accept job</Button>
                <Button variant="secondary" onClick={() => confirm({ title: "Decline job", message: "The owner will assign someone else.", tone: "danger", confirmLabel: "Decline", reason: { label: "Reason (optional)" }, onConfirm: async (note) => { await request(`/maintenance/${job.id}/respond`, { method: "POST", body: { accept: false, note: note || undefined } }); await onChanged("Job declined."); } })}>Decline</Button>
              </div>
            )}
            {job.status === "ACCEPTED" && <Button onClick={() => void post(`/maintenance/${job.id}/work`, { status: "IN_PROGRESS" }, "Marked in progress.")}>Start work</Button>}
            {["ACCEPTED", "IN_PROGRESS"].includes(job.status) && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1"><Input label="Service charge (₹)" type="number" min={0} value={charge} onChange={(e) => setCharge(e.target.value)} /></div>
                <UploadButton path={`/maintenance/${job.id}/photos`} label="Add photos" icon={<Camera className="size-4" />} onDone={() => void onChanged("Photos uploaded.")} onError={setError} />
                <Button onClick={() => void post(`/maintenance/${job.id}/work`, { status: "COMPLETED", serviceCharge: charge ? Number(charge) : undefined }, "Job completed.")}>Mark completed</Button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          {canManage && job.status === "COMPLETED" && <Button onClick={() => void post(`/maintenance/${job.id}/close`, { action: "CLOSE" }, "Request closed.")}>Close request</Button>}
          {(job.isMine || canManage) && ["OPEN", "ASSIGNED", "DECLINED"].includes(job.status) && (
            <Button variant="ghost" onClick={() => confirm({ title: "Cancel request", message: "Cancel this maintenance request?", tone: "danger", confirmLabel: "Cancel request", onConfirm: async () => { await request(`/maintenance/${job.id}/close`, { method: "POST", body: { action: "CANCEL" } }); await onChanged("Request cancelled."); } })}>
              Cancel request
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      {dialog}
    </Modal>
  );
}
