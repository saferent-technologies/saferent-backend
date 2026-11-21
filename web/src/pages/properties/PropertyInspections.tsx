import { CalendarPlus, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { UploadButton } from "@/components/ui/UploadButton";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp, labelize } from "@/utils/format";
import { imagePath, type PropertyDetail } from "./types";

/*
 * Inspection report: one rating per area (overall, walls, flooring, doors & windows, electrical, plumbing,
 * bathroom, kitchen, furniture, appliances), furniture / appliance lists, existing damages, repairs needed,
 * photos, date and the inspector's remarks.
 */

type Condition = "GOOD" | "FAIR" | "POOR" | "NOT_APPLICABLE" | "NOT_INSPECTED";
interface InventoryItem { item: string; quantity: number; condition: Condition; inventoryItemId?: string | null; workingStatus?: string | null }
interface Repair { item: string; description?: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; estimatedCost?: number | null; responsibility: "OWNER" | "TENANT" | "SHARED"; status: "OPEN" | "IN_PROGRESS" | "DONE" }

interface Inspection {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  inspectionDate: string | null;
  propertyCondition: Condition;
  wallCondition: Condition;
  flooringCondition: Condition;
  doorsAndWindows: Condition;
  electricalCondition: Condition;
  plumbingCondition: Condition;
  bathroomCondition: Condition;
  kitchenCondition: Condition;
  furnitureCondition: Condition;
  applianceCondition: Condition;
  furnitureInventory: InventoryItem[] | null;
  applianceInventory: InventoryItem[] | null;
  repairRequirements: Repair[] | null;
  existingDamages: string | null;
  handoverMeterReading: string | null;
  keysHandedOver: number | null;
  result: string | null;
  notes: string | null;
  leaseId: string | null;
  unitId: string | null;
  roomId: string | null;
  landlordAcknowledgedAt: string | null;
  tenantAcknowledgedAt: string | null;
  photos: Array<{ id: string; category: string }>;
}

const CONDITIONS: Condition[] = ["GOOD", "FAIR", "POOR", "NOT_APPLICABLE", "NOT_INSPECTED"];
const AREAS = [
  ["propertyCondition", "Overall condition"],
  ["wallCondition", "Walls"],
  ["flooringCondition", "Flooring"],
  ["doorsAndWindows", "Doors & windows"],
  ["electricalCondition", "Electrical"],
  ["plumbingCondition", "Plumbing"],
  ["bathroomCondition", "Bathroom"],
  ["kitchenCondition", "Kitchen"],
  ["furnitureCondition", "Furniture"],
  ["applianceCondition", "Appliances"],
] as const;
type AreaKey = (typeof AREAS)[number][0];
const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { GOOD: "success", FAIR: "warning", POOR: "danger" };

export function InspectionsTab({ p, canInspect, onDone }: { p: PropertyDetail; canInspect: boolean; onDone: (t: string) => () => Promise<void> }) {
  const { data, reload } = useQuery(() => request<Paged<Inspection>>(`/properties/${p.id}/inspections`), [p.id]);
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<Inspection | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [form, setForm] = useState({ type: "ROUTINE", when: "", leaseId: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const schedule = async () => {
    setError(null);
    try {
      await request(`/properties/${p.id}/inspections`, { method: "POST", body: { type: form.type, scheduledAt: new Date(form.when).toISOString(), leaseId: form.leaseId || undefined, notes: form.notes || undefined } });
      setOpen(false);
      await reload();
      await onDone("Inspection scheduled.")();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <section className="card p-5 sm:p-6">
      {canInspect && <div className="mb-4 flex justify-end"><Button leftIcon={<CalendarPlus className="size-4" />} onClick={() => setOpen(true)}>Schedule inspection</Button></div>}
      <ul className="divide-y divide-line">
        {data?.items.map((i) => (
          <li key={i.id} className="py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{labelize(i.type)} · {formatTimestamp(i.inspectionDate ?? i.scheduledAt)}</p>
                <p className="text-xs text-muted">Condition: {labelize(i.propertyCondition)}{i.result ? ` · ${labelize(i.result)}` : ""}{i.repairRequirements?.length ? ` · ${i.repairRequirements.filter((r) => r.status !== "DONE").length} repairs open` : ""}{i.landlordAcknowledgedAt ? " · landlord acknowledged" : ""}{i.tenantAcknowledgedAt ? " · tenant acknowledged" : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={i.status} />
                <Button size="sm" variant="ghost" leftIcon={shown === i.id ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />} onClick={() => setShown(shown === i.id ? null : i.id)}>Report</Button>
                {canInspect && !i.landlordAcknowledgedAt && !i.tenantAcknowledgedAt && <Button size="sm" variant="secondary" onClick={() => setRecord(i)}>Record report</Button>}
              </div>
            </div>
            {shown === i.id && <InspectionReport i={i} />}
          </li>
        ))}
        {data?.items.length === 0 && <li className="py-3 text-sm text-muted">No inspections yet.</li>}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule inspection">
        {error && <Alert kind="error" className="mb-3">{error}</Alert>}
        <div className="space-y-3">
          <Select label="Type" options={["ROUTINE", "VERIFICATION", "MOVE_IN", "MOVE_OUT"].map((t) => ({ value: t, label: labelize(t) }))} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
          {(form.type === "MOVE_IN" || form.type === "MOVE_OUT") && <Input label="Lease ID" value={form.leaseId} onChange={(e) => setForm({ ...form, leaseId: e.target.value.trim() })} />}
          <Input label="Date and time" type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!form.when} onClick={() => void schedule()}>Schedule</Button>
        </div>
      </Modal>
      {record && <RecordInspection p={p} inspection={record} onClose={() => setRecord(null)} onSaved={async () => { setRecord(null); await reload(); await onDone("Inspection saved.")(); }} />}
    </section>
  );
}

/** Read-only report (everything the inspector recorded). */
function InspectionReport({ i }: { i: Inspection }) {
  const list = (title: string, items: InventoryItem[] | null) =>
    items?.length ? (
      <div>
        <p className="mb-1 text-xs font-semibold text-muted">{title}</p>
        <ul className="text-sm">{items.map((x, n) => <li key={n}>{x.item} × {x.quantity} · {labelize(x.condition)}</li>)}</ul>
      </div>
    ) : null;
  return (
    <div className="mt-3 space-y-4 rounded-lg bg-subtle p-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {AREAS.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-2 rounded-control bg-surface px-2 py-1.5">
            <span className="text-xs text-muted">{label}</span>
            <Badge tone={TONE[i[k]] ?? "neutral"}>{labelize(i[k])}</Badge>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {list("Furniture", i.furnitureInventory)}
        {list("Appliances", i.applianceInventory)}
      </div>
      {i.existingDamages && <div><p className="mb-1 text-xs font-semibold text-muted">Existing damages</p><p className="whitespace-pre-wrap">{i.existingDamages}</p></div>}
      {!!i.repairRequirements?.length && (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted">Repairs needed</p>
          <ul className="space-y-1">
            {i.repairRequirements.map((r, n) => (
              <li key={n} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.item}</span>
                <Badge tone={r.priority === "URGENT" || r.priority === "HIGH" ? "danger" : "neutral"}>{labelize(r.priority)}</Badge>
                <span className="text-xs text-muted">{labelize(r.responsibility)} pays{r.estimatedCost != null ? ` · ₹${r.estimatedCost}` : ""} · {labelize(r.status)}</span>
                {r.description && <span className="w-full text-xs text-muted">{r.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {i.notes && <div><p className="mb-1 text-xs font-semibold text-muted">Inspector remarks</p><p className="whitespace-pre-wrap">{i.notes}</p></div>}
      {(i.handoverMeterReading != null || i.keysHandedOver != null) && <p className="text-xs text-muted">Meter reading: {i.handoverMeterReading ?? "—"} · Keys handed over: {i.keysHandedOver ?? "—"}</p>}
      {i.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {i.photos.map((ph) => <AuthImage key={ph.id} path={imagePath(ph.id)} alt={labelize(ph.category)} className="aspect-square w-full rounded-lg object-cover" />)}
        </div>
      )}
    </div>
  );
}

function InventoryEditor({ title, items, onChange }: { title: string; items: InventoryItem[]; onChange: (v: InventoryItem[]) => void }) {
  const set = (n: number, x: Partial<InventoryItem>) => onChange(items.map((it, k) => (k === n ? { ...it, ...x } : it)));
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <Button size="sm" variant="ghost" leftIcon={<Plus className="size-4" />} onClick={() => onChange([...items, { item: "", quantity: 1, condition: "GOOD" }])}>Add</Button>
      </div>
      {items.map((it, n) => (
        <div key={n} className="mb-2 grid grid-cols-[1fr_5rem_9rem_auto] items-end gap-2">
          <Input aria-label="Item" placeholder="Item" value={it.item} onChange={(e) => set(n, { item: e.target.value })} />
          <Input aria-label="Quantity" type="number" min={0} value={String(it.quantity)} onChange={(e) => set(n, { quantity: Number(e.target.value) })} />
          <Select aria-label="Condition" options={CONDITIONS.map((c) => ({ value: c, label: labelize(c) }))} value={it.condition} onChange={(e) => set(n, { condition: e.target.value as Condition })} />
          <button type="button" aria-label="Remove" className="rounded-control p-2 text-muted hover:text-danger" onClick={() => onChange(items.filter((_, k) => k !== n))}><Trash2 className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}

function RepairsEditor({ items, onChange }: { items: Repair[]; onChange: (v: Repair[]) => void }) {
  const set = (n: number, x: Partial<Repair>) => onChange(items.map((it, k) => (k === n ? { ...it, ...x } : it)));
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold">Repairs needed</p>
        <Button size="sm" variant="ghost" leftIcon={<Plus className="size-4" />} onClick={() => onChange([...items, { item: "", priority: "MEDIUM", responsibility: "OWNER", status: "OPEN", estimatedCost: null, description: "" }])}>Add repair</Button>
      </div>
      {items.map((r, n) => (
        <div key={n} className="mb-3 grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-3">
          <Input label="What" value={r.item} onChange={(e) => set(n, { item: e.target.value })} />
          <Select label="Priority" options={["LOW", "MEDIUM", "HIGH", "URGENT"].map((x) => ({ value: x, label: labelize(x) }))} value={r.priority} onChange={(e) => set(n, { priority: e.target.value as Repair["priority"] })} />
          <Input label="Estimated cost (₹)" type="number" min={0} value={r.estimatedCost == null ? "" : String(r.estimatedCost)} onChange={(e) => set(n, { estimatedCost: e.target.value === "" ? null : Number(e.target.value) })} />
          <Select label="Who pays" options={["OWNER", "TENANT", "SHARED"].map((x) => ({ value: x, label: labelize(x) }))} value={r.responsibility} onChange={(e) => set(n, { responsibility: e.target.value as Repair["responsibility"] })} />
          <Select label="Status" options={["OPEN", "IN_PROGRESS", "DONE"].map((x) => ({ value: x, label: labelize(x) }))} value={r.status} onChange={(e) => set(n, { status: e.target.value as Repair["status"] })} />
          <div className="flex items-end gap-2">
            <Input label="Details" value={r.description ?? ""} onChange={(e) => set(n, { description: e.target.value })} />
            <button type="button" aria-label="Remove repair" className="mb-1 rounded-control p-2 text-muted hover:text-danger" onClick={() => onChange(items.filter((_, k) => k !== n))}><Trash2 className="size-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecordInspection({ p, inspection, onClose, onSaved }: { p: PropertyDetail; inspection: Inspection; onClose: () => void; onSaved: () => Promise<void> }) {
  const [areas, setAreas] = useState<Record<AreaKey, Condition>>(() => Object.fromEntries(AREAS.map(([k]) => [k, inspection[k] ?? "NOT_INSPECTED"])) as Record<AreaKey, Condition>);
  const [v, setV] = useState({
    inspectionDate: (inspection.inspectionDate ?? inspection.scheduledAt).slice(0, 16),
    existingDamages: inspection.existingDamages ?? "",
    handoverMeterReading: inspection.handoverMeterReading ?? "",
    keysHandedOver: inspection.keysHandedOver?.toString() ?? "",
    result: inspection.result ?? "",
    notes: inspection.notes ?? "",
  });
  const [furniture, setFurniture] = useState<InventoryItem[]>(inspection.furnitureInventory ?? []);
  const [appliances, setAppliances] = useState<InventoryItem[]>(inspection.applianceInventory ?? []);
  const [repairs, setRepairs] = useState<Repair[]>(inspection.repairRequirements ?? []);
  const [error, setError] = useState<string | null>(null);
  /** Fill the lists from the furniture register (rows keep the item id so the register gets the new condition). */
  const loadRegister = async () => {
    setError(null);
    try {
      const r = await request<{ items: Array<{ id: string; name: string; quantity: number; category: string; condition: Condition; workingStatus: string; unitId: string | null; roomId: string | null }> }>(`/properties/${p.id}/inventory`);
      const here = r.items.filter((x) => (!inspection.unitId && !inspection.roomId) || x.unitId === inspection.unitId || x.roomId === inspection.roomId || (!x.unitId && !x.roomId));
      const row = (x: (typeof here)[number]): InventoryItem => ({ item: x.name, quantity: x.quantity, condition: x.condition, inventoryItemId: x.id, workingStatus: x.workingStatus });
      setFurniture(here.filter((x) => x.category !== "APPLIANCES").map(row));
      setAppliances(here.filter((x) => x.category === "APPLIANCES").map(row));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const save = async () => {
    setError(null);
    const clean = (xs: InventoryItem[]) => xs.filter((x) => x.item.trim());
    try {
      await request(`/properties/${p.id}/inspections/${inspection.id}`, {
        method: "PATCH",
        body: {
          status: "COMPLETED",
          inspectionDate: new Date(v.inspectionDate).toISOString(),
          ...areas,
          furnitureInventory: clean(furniture),
          applianceInventory: clean(appliances),
          repairRequirements: repairs.filter((r) => r.item.trim()).map((r) => ({ ...r, description: r.description || null })),
          existingDamages: v.existingDamages || null,
          handoverMeterReading: v.handoverMeterReading === "" ? null : String(v.handoverMeterReading),
          keysHandedOver: v.keysHandedOver === "" ? null : Number(v.keysHandedOver),
          result: v.result || null,
          notes: v.notes || null,
        },
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal open onClose={onClose} title={`${labelize(inspection.type)} inspection report`}>
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        <Input label="Inspection date" type="datetime-local" value={v.inspectionDate} onChange={(e) => setV({ ...v, inspectionDate: e.target.value })} />
        {AREAS.map(([k, label]) => <Select key={k} label={label} options={CONDITIONS.map((c) => ({ value: c, label: labelize(c) }))} value={areas[k]} onChange={(e) => setAreas({ ...areas, [k]: e.target.value as Condition })} />)}
        <div className="sm:col-span-2"><Button size="sm" variant="secondary" onClick={() => void loadRegister()}>Load from furniture register</Button></div>
        <InventoryEditor title="Furniture items" items={furniture} onChange={setFurniture} />
        <InventoryEditor title="Appliances" items={appliances} onChange={setAppliances} />
        <div className="sm:col-span-2"><Textarea label="Existing damages" rows={3} maxLength={5000} value={v.existingDamages} onChange={(e) => setV({ ...v, existingDamages: e.target.value })} /></div>
        <RepairsEditor items={repairs} onChange={setRepairs} />
        <Input label="Meter reading" type="number" min={0} value={v.handoverMeterReading} onChange={(e) => setV({ ...v, handoverMeterReading: e.target.value })} />
        <Input label="Keys handed over" type="number" min={0} value={v.keysHandedOver} onChange={(e) => setV({ ...v, keysHandedOver: e.target.value })} />
        <Select label="Result" placeholder="—" options={["PASSED", "NEEDS_REPAIRS", "FAILED"].map((r) => ({ value: r, label: labelize(r) }))} value={v.result} onChange={(e) => setV({ ...v, result: e.target.value })} />
        <div className="sm:col-span-2"><Textarea label="Inspector remarks" rows={3} maxLength={5000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <UploadButton path={`/properties/${p.id}/images`} extra={{ inspectionId: inspection.id }} label="Add photos" onDone={() => undefined} onError={setError} />
        <Button onClick={() => void save()}>Save report</Button>
      </div>
    </Modal>
  );
}
