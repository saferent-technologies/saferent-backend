import { Pencil, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { request, upload } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { labelize } from "@/utils/format";
import { imagePath, type PropertyDetail } from "./types";

/*
 * Photos grouped where they belong: the building / common areas first (front view, entrance, parking …),
 * then each flat / unit (Flat 302 → bedroom, kitchen …) or PG room. "Add photos" asks where the photos
 * are from and what they show (and which bedroom / bathroom), so tenants see the right photos per flat.
 */

const COMMON_CATEGORIES = ["FRONT_VIEW", "BUILDING_EXTERIOR", "ENTRANCE", "COMMON_AREA", "PARKING", "PANORAMA_360", "OTHER"];
const PLACE_CATEGORIES = ["LIVING_ROOM", "BEDROOM", "KITCHEN", "BATHROOM", "BALCONY", "ENTRANCE", "METER_READING", "PANORAMA_360", "OTHER"];
const SINGLE_CATEGORIES = ["FRONT_VIEW", "ENTRANCE", "LIVING_ROOM", "BEDROOM", "KITCHEN", "BATHROOM", "BALCONY", "PARKING", "BUILDING_EXTERIOR", "COMMON_AREA", "METER_READING", "PANORAMA_360", "OTHER"];
const NUMBERED = new Set(["BEDROOM", "BATHROOM", "BALCONY"]);

type Img = PropertyDetail["images"][number];
export type Where = { key: string; label: string; unitId: string | null; roomId: string | null; categories: string[] };

export function placesOf(p: PropertyDetail): Where[] {
  const unitWord = p.type?.unitLabel ?? "Unit";
  const multi = p.units.length > 1 || p.rooms.length > 0 || p.structure === "MULTI_UNIT" || p.structure === "ROOMS_BEDS";
  if (!multi) return [{ key: "common", label: "Property", unitId: null, roomId: null, categories: SINGLE_CATEGORIES }];
  return [
    { key: "common", label: "Building & common areas", unitId: null, roomId: null, categories: COMMON_CATEGORIES },
    ...p.units.map((u) => ({ key: `u:${u.id}`, label: u.name || `${unitWord} ${u.unitNumber ?? u.code}`, unitId: u.id, roomId: null, categories: PLACE_CATEGORIES })),
    ...p.rooms.map((r) => ({ key: `r:${r.id}`, label: `Room ${r.roomNumber}`, unitId: null, roomId: r.id, categories: PLACE_CATEGORIES })),
  ];
}

const keyOf = (i: { unitId: string | null; roomId: string | null }) => (i.unitId ? `u:${i.unitId}` : i.roomId ? `r:${i.roomId}` : "common");
const photoLabel = (i: Img) => `${labelize(i.category)}${i.slot ? ` ${i.slot}` : ""}`;

export function PropertyPhotosTab({ p, editable, onDone, onError }: { p: PropertyDetail; editable: boolean; onDone: (message: string) => void; onError: (message: string) => void }) {
  const places = placesOf(p);
  const photos = p.images.filter((i) => !i.inspectionId);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<Img | null>(null);
  const { confirm, dialog } = useConfirm();

  return (
    <section className="card space-y-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">New photos are reviewed before tenants see them. Tenants see the building photos and the photos of the flat they open.</p>
        {editable && <Button variant="secondary" size="sm" leftIcon={<Upload className="size-4" />} onClick={() => setAdding("common")}>Add photos</Button>}
      </div>
      {places.map((w) => {
        const list = photos.filter((i) => keyOf(i) === w.key);
        if (!list.length && w.key !== "common" && !editable) return null;
        return (
          <div key={w.key}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold">{w.label} <span className="text-xs font-normal text-muted">{list.length} photo{list.length === 1 ? "" : "s"}</span></h3>
              {editable && <Button size="sm" variant="ghost" leftIcon={<Upload className="size-4" />} onClick={() => setAdding(w.key)}>Add</Button>}
            </div>
            {list.length === 0 ? (
              <p className="rounded-control border border-dashed border-line p-4 text-sm text-muted">No photos for {w.label.toLowerCase()} yet.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {list.map((img) => (
                  <li key={img.id} className="group relative overflow-hidden rounded-control border border-line">
                    <AuthImage path={imagePath(img.id)} alt={photoLabel(img)} className="aspect-[4/3] w-full" />
                    <span className="absolute left-2 top-2"><StatusBadge status={img.status} /></span>
                    <span className="absolute bottom-2 left-2 rounded bg-surface/90 px-1.5 py-0.5 text-xs font-medium">{photoLabel(img)}</span>
                    {editable && (
                      <span className="absolute right-2 top-2 flex gap-1">
                        <button type="button" title="Change place / type" className="rounded bg-surface/90 p-1 hover:bg-surface" onClick={() => setEditing(img)}><Pencil className="size-4" /></button>
                        <button
                          type="button"
                          title="Delete"
                          className="rounded bg-surface/90 p-1 text-danger hover:bg-surface"
                          onClick={() => confirm({ title: "Delete photo", message: "This photo is removed for everyone.", tone: "danger", confirmLabel: "Delete", onConfirm: async () => { await request(`/properties/${p.id}/images/${img.id}`, { method: "DELETE" }); onDone("Photo deleted."); } })}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {adding && <AddPhotosModal p={p} places={places} initial={adding} onClose={() => setAdding(null)} onDone={(m) => { setAdding(null); onDone(m); }} onError={onError} />}
      {editing && <EditPhotoModal p={p} places={places} img={editing} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); onDone(m); }} />}
      {dialog}
    </section>
  );
}

function PlaceAndType({ places, where, category, slot, onChange }: { places: Where[]; where: string; category: string; slot: string; onChange: (v: { where?: string; category?: string; slot?: string }) => void }) {
  const place = places.find((w) => w.key === where) ?? places[0];
  return (
    <div className="space-y-3">
      {places.length > 1 && (
        <Select
          label="Where are these photos from?"
          options={places.map((w) => ({ value: w.key, label: w.label }))}
          value={where}
          onChange={(e) => {
            const next = places.find((w) => w.key === e.target.value)!;
            onChange({ where: next.key, category: next.categories.includes(category) ? category : next.categories[0], slot: "" });
          }}
        />
      )}
      <Select label="What do they show?" options={place.categories.map((c) => ({ value: c, label: labelize(c) }))} value={category} onChange={(e) => onChange({ category: e.target.value, slot: "" })} />
      {NUMBERED.has(category) && (
        <Select
          label={`Which ${labelize(category).toLowerCase()}?`}
          placeholder="Not numbered"
          options={Array.from({ length: 6 }, (_, i) => ({ value: String(i + 1), label: `${labelize(category)} ${i + 1}` }))}
          value={slot}
          onChange={(e) => onChange({ slot: e.target.value })}
        />
      )}
    </div>
  );
}

function AddPhotosModal({ p, places, initial, onClose, onDone, onError }: { p: PropertyDetail; places: Where[]; initial: string; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const start = places.find((w) => w.key === initial) ?? places[0];
  const [v, setV] = useState({ where: start.key, category: start.categories[0], slot: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const place = places.find((w) => w.key === v.where) ?? places[0];

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    form.append("category", v.category);
    if (place.unitId) form.append("unitId", place.unitId);
    if (place.roomId) form.append("roomId", place.roomId);
    if (v.slot) form.append("slot", v.slot);
    setBusy(true);
    setErr(null);
    try {
      await upload(`/properties/${p.id}/images`, form);
      onDone(`Photos added to ${place.label}.`);
    } catch (e) {
      setErr(errorMessage(e));
      onError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Modal open onClose={onClose} title="Add photos" description="Choose where the photos are from and what they show — tenants see them under that flat / room.">
      {err && <Alert kind="error" className="mb-3">{err}</Alert>}
      <PlaceAndType places={places} where={v.where} category={v.category} slot={v.slot} onChange={(x) => setV((cur) => ({ ...cur, ...x }))} />
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void send(e.target.files)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} leftIcon={<Upload className="size-4" />} onClick={() => input.current?.click()}>Choose photos</Button>
      </div>
    </Modal>
  );
}

function EditPhotoModal({ p, places, img, onClose, onDone }: { p: PropertyDetail; places: Where[]; img: Img; onClose: () => void; onDone: (m: string) => void }) {
  const [v, setV] = useState({ where: keyOf(img), category: img.category, slot: img.slot ? String(img.slot) : "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const place = places.find((w) => w.key === v.where) ?? places[0];
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await request(`/properties/${p.id}/images/${img.id}`, {
        method: "PATCH",
        body: { category: v.category, unitId: place.unitId, roomId: place.roomId, slot: v.slot ? Number(v.slot) : null },
      });
      onDone("Photo updated.");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Change photo details" description="Move it to the right flat / room or fix what it shows.">
      {err && <Alert kind="error" className="mb-3">{err}</Alert>}
      <AuthImage path={imagePath(img.id)} alt={photoLabel(img)} className="mb-3 aspect-[4/3] w-full rounded-control" />
      <PlaceAndType places={places} where={v.where} category={v.category} slot={v.slot} onChange={(x) => setV((cur) => ({ ...cur, ...x }))} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}
