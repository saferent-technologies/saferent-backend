import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { labelize } from "@/utils/format";
import type { PropertyDetail } from "./types";

/* Society / association: details for apartment complexes and gated communities, and parking slots. */

interface Society {
  isSociety: boolean;
  associationName: string | null;
  registrationNumber: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  officeHours: string | null;
  maintenanceAmount: number | null;
  maintenanceFrequency: string | null;
  maintenancePaidBy: string | null;
  maintenancePayTo: string | null;
  rules: Array<{ title: string; description: string }>;
  visitorPolicy: string | null;
  gateAccessMethods: string[];
  gateContactName: string | null;
  gateContactPhone: string | null;
  clubhouseRules: string | null;
  commonAreas: Array<{ name: string; timings: string; notes?: string | null }>;
  moveRequiresPermission: boolean | null;
  moveNoticeDays: number | null;
  moveAllowedTimings: string | null;
  moveChargeAmount: number | null;
  moveDepositAmount: number | null;
  moveLiftBooking: boolean | null;
  moveNotes: string | null;
}
interface Slot { id: string; slotNumber: string; unitId: string | null; unitLabel: string | null; vehicleType: string; covered: boolean; notes: string | null }

const EMPTY: Society = { isSociety: true, associationName: null, registrationNumber: null, contactName: null, contactRole: null, contactPhone: null, contactEmail: null, officeHours: null, maintenanceAmount: null, maintenanceFrequency: null, maintenancePaidBy: null, maintenancePayTo: null, rules: [], visitorPolicy: null, gateAccessMethods: [], gateContactName: null, gateContactPhone: null, clubhouseRules: null, commonAreas: [], moveRequiresPermission: null, moveNoticeDays: null, moveAllowedTimings: null, moveChargeAmount: null, moveDepositAmount: null, moveLiftBooking: null, moveNotes: null };
const GATE = ["MYGATE", "NOBROKERHOOD", "ADDA", "APNACOMPLEX", "ACCESS_CARD", "BIOMETRIC", "GUARD_REGISTER", "OTHER"];
const GATE_LABEL: Record<string, string> = { MYGATE: "MyGate", NOBROKERHOOD: "NoBrokerHood", ADDA: "ADDA", APNACOMPLEX: "ApnaComplex", ACCESS_CARD: "Access card", BIOMETRIC: "Biometric", GUARD_REGISTER: "Guard register", OTHER: "Other" };
const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: labelize(x) }));
const yn = [{ value: "", label: "Not answered" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const toYn = (b: boolean | null) => (b == null ? "" : b ? "yes" : "no");
const fromYn = (s: string) => (s === "" ? null : s === "yes");
const numOrNull = (s: string) => (s === "" ? null : Number(s));

export function PropertySocietyTab({ p, canManage }: { p: PropertyDetail; canManage: boolean }) {
  const { data, loading, error, reload } = useQuery(() => request<{ society: Society | null; parkingSlots: Slot[]; rulesDocument: { documentId: string } | null }>(`/properties/${p.id}/society`), [p.id]);
  const [s, setS] = useState<Society>(EMPTY);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState({ slotNumber: "", unitId: "", vehicleType: "CAR", covered: false });
  useEffect(() => setS({ ...EMPTY, ...(data?.society ?? {}) }), [data]);
  if (loading && !data) return <div className="flex justify-center py-8"><Spinner className="size-6 text-brand" /></div>;
  if (error) return <Alert kind="error">{error}</Alert>;
  const dis = !canManage;
  const t = (k: keyof Society) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value || null });
  const run = async (fn: () => Promise<unknown>, text: string) => {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      await reload();
      setMsg({ kind: "success", text });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const { ...body } = s as Society & { maintenanceMonthly?: unknown; updatedAt?: unknown };
    delete (body as { maintenanceMonthly?: unknown }).maintenanceMonthly;
    delete (body as { updatedAt?: unknown }).updatedAt;
    return run(() => request(`/properties/${p.id}/society`, { method: "PUT", body: { ...body, rules: s.rules.filter((r) => r.title.trim()), commonAreas: s.commonAreas.filter((c) => c.name.trim() && c.timings.trim()), maintenancePayTo: s.maintenancePaidBy === "TENANT" ? s.maintenancePayTo : null } }), "Society details saved.");
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Society / association</h2>
            <p className="text-sm text-muted">Tenants see maintenance, rules, visitor policy, gate access, amenity timings and move rules. Contacts are shown only to tenants with a lease.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={s.isSociety} onChange={(e) => setS({ ...s, isSociety: e.target.checked })} disabled={dis} /> Part of a society / gated community</label>
        </div>
        {s.isSociety && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Society / association name" maxLength={150} value={s.associationName ?? ""} onChange={t("associationName")} disabled={dis} />
              <Input label="Registration no. (optional)" maxLength={60} value={s.registrationNumber ?? ""} onChange={t("registrationNumber")} disabled={dis} />
              <Input label="Office hours" maxLength={120} value={s.officeHours ?? ""} onChange={t("officeHours")} disabled={dis} />
              <Input label="Contact person" maxLength={120} value={s.contactName ?? ""} onChange={t("contactName")} disabled={dis} />
              <Select label="Role" placeholder="—" options={opts(["SECRETARY", "PRESIDENT", "MANAGER", "FACILITY_MANAGER", "OTHER"])} value={s.contactRole ?? ""} onChange={t("contactRole")} disabled={dis} />
              <Input label="Contact phone" value={s.contactPhone ?? ""} onChange={t("contactPhone")} disabled={dis} />
              <Input label="Contact email" type="email" value={s.contactEmail ?? ""} onChange={t("contactEmail")} disabled={dis} />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Input label="Maintenance (₹)" type="number" min={0} value={s.maintenanceAmount?.toString() ?? ""} onChange={(e) => setS({ ...s, maintenanceAmount: numOrNull(e.target.value) })} disabled={dis} />
              <Select label="How often" placeholder="—" options={opts(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"])} value={s.maintenanceFrequency ?? ""} onChange={t("maintenanceFrequency")} disabled={dis} />
              <Select label="Who pays" placeholder="—" options={[{ value: "INCLUDED_IN_RENT", label: "Included in rent" }, { value: "TENANT", label: "Tenant" }, { value: "OWNER", label: "Owner" }]} value={s.maintenancePaidBy ?? ""} onChange={t("maintenancePaidBy")} disabled={dis} />
              {s.maintenancePaidBy === "TENANT" && <Select label="Tenant pays to" placeholder="—" options={opts(["SOCIETY", "OWNER"])} value={s.maintenancePayTo ?? ""} onChange={t("maintenancePayTo")} disabled={dis} />}
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><p className="text-sm font-semibold">Society rules</p>{!dis && s.rules.length < 30 && <Button size="sm" variant="ghost" leftIcon={<Plus className="size-4" />} onClick={() => setS({ ...s, rules: [...s.rules, { title: "", description: "" }] })}>Add rule</Button>}</div>
              {s.rules.map((r, i) => (
                <div key={i} className="mb-2 grid grid-cols-[1fr_2fr_auto] items-end gap-2">
                  <Input aria-label="Rule" placeholder="e.g. No parking on the ramp" maxLength={80} value={r.title} onChange={(e) => setS({ ...s, rules: s.rules.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} disabled={dis} />
                  <Input aria-label="Details" placeholder="Details (optional)" maxLength={500} value={r.description} onChange={(e) => setS({ ...s, rules: s.rules.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) })} disabled={dis} />
                  {!dis && <button type="button" aria-label="Remove" className="rounded-control p-2 text-muted hover:text-danger" onClick={() => setS({ ...s, rules: s.rules.filter((_, k) => k !== i) })}><Trash2 className="size-4" /></button>}
                </div>
              ))}
              <p className="text-xs text-muted">{data?.rulesDocument ? "Society rules document uploaded." : "You can also upload the rules PDF in Documents (Society rules)."}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea label="Visitor entry policy" rows={3} maxLength={1000} placeholder="e.g. Visitors are approved in MyGate; delivery only till the gate after 10 PM." value={s.visitorPolicy ?? ""} onChange={t("visitorPolicy")} disabled={dis} />
              <div>
                <p className="mb-1 text-sm font-semibold">Gate access</p>
                <div className="flex flex-wrap gap-3 text-sm">
                  {GATE.map((g) => <label key={g} className="flex items-center gap-1.5"><input type="checkbox" disabled={dis} checked={s.gateAccessMethods.includes(g)} onChange={(e) => setS({ ...s, gateAccessMethods: e.target.checked ? [...s.gateAccessMethods, g] : s.gateAccessMethods.filter((x) => x !== g) })} /> {GATE_LABEL[g]}</label>)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input label="Gate contact" placeholder="Main gate security" maxLength={120} value={s.gateContactName ?? ""} onChange={t("gateContactName")} disabled={dis} />
                  <Input label="Gate phone" value={s.gateContactPhone ?? ""} onChange={t("gateContactPhone")} disabled={dis} />
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><p className="text-sm font-semibold">Common area timings</p>{!dis && s.commonAreas.length < 15 && <Button size="sm" variant="ghost" leftIcon={<Plus className="size-4" />} onClick={() => setS({ ...s, commonAreas: [...s.commonAreas, { name: "", timings: "" }] })}>Add area</Button>}</div>
              {s.commonAreas.map((c, i) => (
                <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <Input aria-label="Area" placeholder="Gym / Pool / Terrace" maxLength={60} value={c.name} onChange={(e) => setS({ ...s, commonAreas: s.commonAreas.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} disabled={dis} />
                  <Input aria-label="Timings" placeholder="6 AM – 10 PM" maxLength={80} value={c.timings} onChange={(e) => setS({ ...s, commonAreas: s.commonAreas.map((x, k) => (k === i ? { ...x, timings: e.target.value } : x)) })} disabled={dis} />
                  <Input aria-label="Notes" placeholder="Notes" maxLength={200} value={c.notes ?? ""} onChange={(e) => setS({ ...s, commonAreas: s.commonAreas.map((x, k) => (k === i ? { ...x, notes: e.target.value || null } : x)) })} disabled={dis} />
                  {!dis && <button type="button" aria-label="Remove" className="rounded-control p-2 text-muted hover:text-danger" onClick={() => setS({ ...s, commonAreas: s.commonAreas.filter((_, k) => k !== i) })}><Trash2 className="size-4" /></button>}
                </div>
              ))}
            </div>
            <Textarea label="Clubhouse booking rules" rows={2} maxLength={1000} value={s.clubhouseRules ?? ""} onChange={t("clubhouseRules")} disabled={dis} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Select label="Move-in/out needs society permission" options={yn} value={toYn(s.moveRequiresPermission)} onChange={(e) => setS({ ...s, moveRequiresPermission: fromYn(e.target.value) })} disabled={dis} />
              {s.moveRequiresPermission && <Input label="Notice (days)" type="number" min={0} value={s.moveNoticeDays?.toString() ?? ""} onChange={(e) => setS({ ...s, moveNoticeDays: numOrNull(e.target.value) })} disabled={dis} />}
              {s.moveRequiresPermission && <Input label="Moving charges (₹)" type="number" min={0} value={s.moveChargeAmount?.toString() ?? ""} onChange={(e) => setS({ ...s, moveChargeAmount: numOrNull(e.target.value) })} disabled={dis} />}
              {s.moveRequiresPermission && <Input label="Refundable deposit (₹)" type="number" min={0} value={s.moveDepositAmount?.toString() ?? ""} onChange={(e) => setS({ ...s, moveDepositAmount: numOrNull(e.target.value) })} disabled={dis} />}
              <Input label="Allowed moving timings" placeholder="9 AM – 6 PM, not on Sundays" maxLength={120} value={s.moveAllowedTimings ?? ""} onChange={t("moveAllowedTimings")} disabled={dis} />
              <Select label="Lift booking needed" options={yn} value={toYn(s.moveLiftBooking)} onChange={(e) => setS({ ...s, moveLiftBooking: fromYn(e.target.value) })} disabled={dis} />
              <div className="sm:col-span-2"><Input label="Moving notes" maxLength={500} value={s.moveNotes ?? ""} onChange={t("moveNotes")} disabled={dis} /></div>
            </div>
          </>
        )}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {canManage && <div className="flex justify-end"><Button loading={busy} onClick={() => void save()}>Save society details</Button></div>}
      </section>

      <section className="card space-y-3 p-5 sm:p-6">
        <h2 className="font-semibold">Parking slots</h2>
        <ul className="divide-y divide-line text-sm">
          {data?.parkingSlots.map((sl) => (
            <li key={sl.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="font-medium">{sl.slotNumber}</span> · {labelize(sl.vehicleType)} · {sl.covered ? "Covered" : "Open"}</span>
              <span className="flex items-center gap-2">
                <Select aria-label="Allocated to" placeholder="Not allocated" options={p.units.map((u) => ({ value: u.id, label: u.name || `Flat ${u.unitNumber ?? u.code}` }))} value={sl.unitId ?? ""} onChange={(e) => void run(() => request(`/properties/${p.id}/parking-slots/${sl.id}`, { method: "PATCH", body: { unitId: e.target.value || null } }), "Parking updated.")} disabled={dis} />
                {!dis && <button type="button" aria-label="Remove slot" className="rounded-control p-2 text-muted hover:text-danger" onClick={() => void run(() => request(`/properties/${p.id}/parking-slots/${sl.id}`, { method: "DELETE" }), "Parking slot removed.")}><Trash2 className="size-4" /></button>}
              </span>
            </li>
          ))}
          {data?.parkingSlots.length === 0 && <li className="py-2 text-muted">No parking slots yet.</li>}
        </ul>
        {canManage && (
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_8rem_8rem_auto]">
            <Input label="Slot no." maxLength={20} value={slot.slotNumber} onChange={(e) => setSlot({ ...slot, slotNumber: e.target.value })} />
            <Select label="Allocated to" placeholder="Not allocated" options={p.units.map((u) => ({ value: u.id, label: u.name || `Flat ${u.unitNumber ?? u.code}` }))} value={slot.unitId} onChange={(e) => setSlot({ ...slot, unitId: e.target.value })} />
            <Select label="Vehicle" options={opts(["CAR", "BIKE", "BOTH"])} value={slot.vehicleType} onChange={(e) => setSlot({ ...slot, vehicleType: e.target.value })} />
            <Select label="Type" options={[{ value: "open", label: "Open" }, { value: "covered", label: "Covered" }]} value={slot.covered ? "covered" : "open"} onChange={(e) => setSlot({ ...slot, covered: e.target.value === "covered" })} />
            <Button disabled={!slot.slotNumber.trim() || busy} onClick={() => void run(async () => { await request(`/properties/${p.id}/parking-slots`, { method: "POST", body: { slotNumber: slot.slotNumber.trim(), unitId: slot.unitId || null, vehicleType: slot.vehicleType, covered: slot.covered } }); setSlot({ slotNumber: "", unitId: "", vehicleType: "CAR", covered: false }); }, "Parking slot added.")}>Add slot</Button>
          </div>
        )}
      </section>
    </div>
  );
}
