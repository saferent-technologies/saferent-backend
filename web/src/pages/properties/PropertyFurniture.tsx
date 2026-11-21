import { Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { UploadButton } from "@/components/ui/UploadButton";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { formatDate, labelize } from "@/utils/format";
import { placesOf } from "./PropertyPhotos";
import type { PropertyDetail } from "./types";

/*
 * Furniture & appliance register (furnished / semi-furnished): items per flat / room or the building,
 * with photos and repair history. Inspections check these items and update their condition.
 */

const CATEGORIES = ["BEDROOM", "LIVING_ROOM", "KITCHEN", "BATHROOM", "APPLIANCES", "OTHER"] as const;
const CONDITIONS = ["GOOD", "FAIR", "POOR", "NOT_APPLICABLE", "NOT_INSPECTED"] as const;
const WORKING = ["WORKING", "NEEDS_REPAIR", "NOT_WORKING"] as const;
const PAID_BY = ["OWNER", "TENANT", "SHARED"] as const;
const REPAIR_STATUS = ["OPEN", "IN_PROGRESS", "DONE"] as const;
const WORK_TONE = { WORKING: "success", NEEDS_REPAIR: "warning", NOT_WORKING: "danger" } as const;

interface Repair { id: string; repairDate: string; description: string; cost: number | null; paidBy: string; doneBy: string | null; status: string }
interface Item {
  id: string;
  unitId: string | null;
  roomId: string | null;
  name: string;
  category: (typeof CATEGORIES)[number];
  quantity: number;
  brand: string | null;
  model: string | null;
  purchaseDate: string | null;
  condition: string;
  workingStatus: (typeof WORKING)[number];
  serialNumber: string | null;
  notes: string | null;
  photos: Array<{ id: string; url: string }>;
  repairs: Repair[];
  openRepairs: number;
}
interface InventoryResponse { items: Item[]; summary: { total: number; needsRepair: number; openRepairs: number }; suggestions: Record<string, string[]> }

const photoPath = (url: string) => url.replace(/^\/api\/v1/, "");
const placeKey = (i: { unitId: string | null; roomId: string | null }) => (i.unitId ? `u:${i.unitId}` : i.roomId ? `r:${i.roomId}` : "common");

export function PropertyFurnitureTab({ p, canManage }: { p: PropertyDetail; canManage: boolean }) {
  const { data, error, reload } = useQuery(() => request<InventoryResponse>(`/properties/${p.id}/inventory`), [p.id]);
  const places = placesOf(p);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [repairFor, setRepairFor] = useState<Item | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const items = data?.items ?? [];

  return (
    <section className="card space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Furniture and appliances in this property{data ? ` · ${data.summary.total} items · ${data.summary.needsRepair} need repair · ${data.summary.openRepairs} open repairs` : ""}. Tenants see the item, condition and photos, not the serial number, purchase date or repair costs.
        </p>
        {canManage && <Button size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add item</Button>}
      </div>
      {(error || msg) && <Alert kind="error">{error ?? msg}</Alert>}
      {data && items.length === 0 && <p className="text-sm text-muted">No furniture added yet.</p>}
      {places.map((w) => {
        const here = items.filter((i) => placeKey(i) === w.key);
        if (!here.length) return null;
        return (
          <div key={w.key}>
            <h3 className="mb-2 text-sm font-semibold">{w.label}</h3>
            {CATEGORIES.filter((c) => here.some((i) => i.category === c)).map((c) => (
              <div key={c} className="mb-3">
                <p className="mb-1 text-xs font-semibold text-muted">{labelize(c)}</p>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {here.filter((i) => i.category === c).map((i) => (
                    <li key={i.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 gap-3">
                        {i.photos[0] ? <AuthImage path={photoPath(i.photos[0].url)} alt={i.name} className="size-14 shrink-0 rounded-lg object-cover" /> : <div className="size-14 shrink-0 rounded-lg bg-subtle" />}
                        <div className="min-w-0 text-sm">
                          <p className="font-medium">{i.name} × {i.quantity}</p>
                          <p className="text-xs text-muted">{[i.brand, i.model].filter(Boolean).join(" ") || "No brand"}{i.serialNumber ? ` · S/N ${i.serialNumber}` : ""}{i.purchaseDate ? ` · bought ${formatDate(i.purchaseDate)}` : ""}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone={WORK_TONE[i.workingStatus]}>{labelize(i.workingStatus)}</Badge>
                            <Badge>{labelize(i.condition)}</Badge>
                            {i.openRepairs > 0 && <Badge tone="warning">{i.openRepairs} open repair{i.openRepairs > 1 ? "s" : ""}</Badge>}
                          </div>
                          {i.repairs.length > 0 && (
                            <ul className="mt-2 space-y-0.5 text-xs text-muted">
                              {i.repairs.slice(0, 3).map((r) => (
                                <li key={r.id}>{formatDate(r.repairDate)} · {r.description} · {labelize(r.status)}{r.cost != null ? ` · ₹${r.cost} (${labelize(r.paidBy)})` : ""}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          <UploadButton path={`/properties/${p.id}/inventory/${i.id}/photos`} label="Photos" onDone={() => void reload()} onError={setMsg} />
                          <Button size="sm" variant="secondary" leftIcon={<Wrench className="size-4" />} onClick={() => setRepairFor(i)}>Repair</Button>
                          <Button size="sm" variant="ghost" leftIcon={<Pencil className="size-4" />} onClick={() => setEditing(i)}>Edit</Button>
                          <button
                            type="button"
                            aria-label="Remove item"
                            className="rounded-control p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                            onClick={() => confirm({ title: "Remove item", message: "The item, its photos and its repair history are removed.", tone: "danger", confirmLabel: "Remove", onConfirm: async () => { await request(`/properties/${p.id}/inventory/${i.id}`, { method: "DELETE" }); await reload(); } })}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      })}
      {editing && <ItemModal p={p} item={editing === "new" ? null : editing} suggestions={data?.suggestions ?? {}} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
      {repairFor && <RepairModal p={p} item={repairFor} onClose={() => setRepairFor(null)} onSaved={async () => { setRepairFor(null); await reload(); }} />}
      {dialog}
    </section>
  );
}

function ItemModal({ p, item, suggestions, onClose, onSaved }: { p: PropertyDetail; item: Item | null; suggestions: Record<string, string[]>; onClose: () => void; onSaved: () => Promise<void> }) {
  const places = placesOf(p);
  const [v, setV] = useState({
    where: item ? placeKey(item) : places[0].key,
    name: item?.name ?? "",
    category: item?.category ?? "BEDROOM",
    quantity: String(item?.quantity ?? 1),
    brand: item?.brand ?? "",
    model: item?.model ?? "",
    purchaseDate: item?.purchaseDate ?? "",
    condition: item?.condition ?? "GOOD",
    workingStatus: item?.workingStatus ?? "WORKING",
    serialNumber: item?.serialNumber ?? "",
    notes: item?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const place = places.find((w) => w.key === v.where) ?? places[0];
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { where: _w, quantity, ...rest } = v;
      const body = { ...rest, quantity: Number(quantity), unitId: place.unitId, roomId: place.roomId, purchaseDate: v.purchaseDate || null };
      if (item) await request(`/properties/${p.id}/inventory/${item.id}`, { method: "PATCH", body });
      else await request(`/properties/${p.id}/inventory`, { method: "POST", body });
      await onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: labelize(x) }));
  return (
    <Modal open onClose={onClose} title={item ? "Edit item" : "Add furniture / appliance"}>
      {err && <Alert kind="error" className="mb-3">{err}</Alert>}
      <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        <Select label="Where" options={places.map((w) => ({ value: w.key, label: w.label }))} value={v.where} onChange={(e) => setV({ ...v, where: e.target.value })} />
        <Select label="Category" options={opts(CATEGORIES)} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as Item["category"] })} />
        <div className="sm:col-span-2">
          <Input label="Name" maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <div className="mt-1 flex flex-wrap gap-1">
            {(suggestions[v.category] ?? []).map((s) => (
              <button key={s} type="button" className="rounded-full border border-line px-2 py-0.5 text-xs hover:border-brand" onClick={() => setV({ ...v, name: s })}>{s}</button>
            ))}
          </div>
        </div>
        <Input label="Quantity" type="number" min={1} max={500} value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} />
        <Input label="Purchase date (optional)" type="date" value={v.purchaseDate} onChange={(e) => setV({ ...v, purchaseDate: e.target.value })} />
        <Input label="Brand" maxLength={80} value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })} />
        <Input label="Model" maxLength={80} value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} />
        <Select label="Condition" options={opts(CONDITIONS)} value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value })} />
        <Select label="Working status" options={opts(WORKING)} value={v.workingStatus} onChange={(e) => setV({ ...v, workingStatus: e.target.value as Item["workingStatus"] })} />
        <Input label="Serial number (optional)" maxLength={80} value={v.serialNumber} onChange={(e) => setV({ ...v, serialNumber: e.target.value })} />
        <div className="sm:col-span-2"><Textarea label="Notes" rows={2} maxLength={500} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={v.name.trim().length < 2} onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}

function RepairModal({ p, item, onClose, onSaved }: { p: PropertyDetail; item: Item; onClose: () => void; onSaved: () => Promise<void> }) {
  const [v, setV] = useState({ repairDate: new Date().toISOString().slice(0, 10), description: "", cost: "", paidBy: "OWNER", doneBy: "", status: "DONE" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = `/properties/${p.id}/inventory/${item.id}/repairs`;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: labelize(x) }));
  return (
    <Modal open onClose={onClose} title={`Repairs · ${item.name}`}>
      {err && <Alert kind="error" className="mb-3">{err}</Alert>}
      {item.repairs.length > 0 && (
        <ul className="mb-4 max-h-48 space-y-2 overflow-y-auto text-sm">
          {item.repairs.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-line p-2">
              <span>
                <span className="font-medium">{formatDate(r.repairDate)}</span> · {r.description}
                <span className="block text-xs text-muted">{labelize(r.status)}{r.cost != null ? ` · ₹${r.cost} (${labelize(r.paidBy)})` : ""}{r.doneBy ? ` · by ${r.doneBy}` : ""}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                {r.status !== "DONE" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => request(`${base}/${r.id}`, { method: "PATCH", body: { status: "DONE" } }))}>Mark done</Button>}
                <button type="button" aria-label="Delete repair" className="rounded-control p-1.5 text-muted hover:text-danger" onClick={() => void run(() => request(`${base}/${r.id}`, { method: "DELETE" }))}><Trash2 className="size-4" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-2 text-sm font-semibold">Add repair</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Date" type="date" value={v.repairDate} onChange={(e) => setV({ ...v, repairDate: e.target.value })} />
        <Select label="Status" options={opts(REPAIR_STATUS)} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} />
        <div className="sm:col-span-2"><Input label="What was done / needs doing" maxLength={1000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
        <Input label="Cost (₹)" type="number" min={0} value={v.cost} onChange={(e) => setV({ ...v, cost: e.target.value })} />
        <Select label="Paid by" options={opts(PAID_BY)} value={v.paidBy} onChange={(e) => setV({ ...v, paidBy: e.target.value })} />
        <div className="sm:col-span-2"><Input label="Done by (optional)" maxLength={120} value={v.doneBy} onChange={(e) => setV({ ...v, doneBy: e.target.value })} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button loading={busy} disabled={v.description.trim().length < 3} onClick={() => void run(() => request(base, { method: "POST", body: { ...v, cost: v.cost === "" ? null : Number(v.cost), doneBy: v.doneBy || null } }))}>Add repair</Button>
      </div>
    </Modal>
  );
}
