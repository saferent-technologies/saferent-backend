import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { labelize } from "@/utils/format";
import type { PropertyDetail } from "./types";

/* Safety & emergency: features tenants see, and contacts / instructions for tenants with a lease. */

type Place = { name: string; phone?: string | null; address?: string | null; distanceKm?: number | null };
interface Safety {
  fireExtinguisher: boolean | null;
  fireExtinguisherCount: number | null;
  fireExtinguisherExpiry: string | null;
  smokeDetectors: boolean | null;
  smokeDetectorLocations: string | null;
  emergencyExits: number | null;
  emergencyStaircase: boolean | null;
  firstAidKit: boolean | null;
  firstAidLocation: string | null;
  securityName: string | null;
  securityPhone: string | null;
  security24x7: boolean | null;
  emergencyContacts: Array<{ label: string; phone: string }> | null;
  nearestHospital: Place | null;
  nearestPoliceStation: Place | null;
  instructions: string | null;
}
interface SafetyView { safety: Safety | null; extinguisherState: "VALID" | "EXPIRING" | "EXPIRED" | null; score: number; certificates: Array<{ docType: string; uploaded: boolean; status: string | null }> }

const EMPTY: Safety = { fireExtinguisher: null, fireExtinguisherCount: null, fireExtinguisherExpiry: null, smokeDetectors: null, smokeDetectorLocations: null, emergencyExits: null, emergencyStaircase: null, firstAidKit: null, firstAidLocation: null, securityName: null, securityPhone: null, security24x7: null, emergencyContacts: [], nearestHospital: null, nearestPoliceStation: null, instructions: null };
const yn = [{ value: "", label: "Not answered" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const toYn = (b: boolean | null) => (b == null ? "" : b ? "yes" : "no");
const fromYn = (s: string) => (s === "" ? null : s === "yes");
const STATE_TONE = { VALID: "success", EXPIRING: "warning", EXPIRED: "danger" } as const;

export function PropertySafetyTab({ p, canManage }: { p: PropertyDetail; canManage: boolean }) {
  const { data, loading, error, reload } = useQuery(() => request<SafetyView>(`/properties/${p.id}/safety`), [p.id]);
  const [s, setS] = useState<Safety>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => setS({ ...EMPTY, ...(data?.safety ?? {}), emergencyContacts: data?.safety?.emergencyContacts ?? [] }), [data]);
  if (loading && !data) return <div className="flex justify-center py-8"><Spinner className="size-6 text-brand" /></div>;
  if (error) return <Alert kind="error">{error}</Alert>;

  const place = (key: "nearestHospital" | "nearestPoliceStation", label: string) => {
    const v = s[key];
    const set = (x: Partial<Place>) => setS({ ...s, [key]: { name: "", ...(v ?? {}), ...x } });
    return (
      <div className="rounded-lg border border-line p-3">
        <p className="mb-2 text-sm font-semibold">{label}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input label="Name" maxLength={120} value={v?.name ?? ""} onChange={(e) => set({ name: e.target.value })} disabled={!canManage} />
          <Input label="Phone" value={v?.phone ?? ""} onChange={(e) => set({ phone: e.target.value || null })} disabled={!canManage} />
          <Input label="Address" maxLength={255} value={v?.address ?? ""} onChange={(e) => set({ address: e.target.value || null })} disabled={!canManage} />
          <Input label="Distance (km)" type="number" min={0} step="0.1" value={v?.distanceKm?.toString() ?? ""} onChange={(e) => set({ distanceKm: e.target.value === "" ? null : Number(e.target.value) })} disabled={!canManage} />
        </div>
      </div>
    );
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const clean = (pl: Place | null) => (pl && pl.name.trim() ? { ...pl, name: pl.name.trim() } : null);
    try {
      await request(`/properties/${p.id}/safety`, {
        method: "PUT",
        body: {
          ...s,
          fireExtinguisherCount: s.fireExtinguisher ? s.fireExtinguisherCount : null,
          fireExtinguisherExpiry: s.fireExtinguisher ? s.fireExtinguisherExpiry : null,
          smokeDetectorLocations: s.smokeDetectors ? s.smokeDetectorLocations : null,
          firstAidLocation: s.firstAidKit ? s.firstAidLocation : null,
          emergencyContacts: (s.emergencyContacts ?? []).filter((c) => c.label.trim() && c.phone.trim()),
          nearestHospital: clean(s.nearestHospital),
          nearestPoliceStation: clean(s.nearestPoliceStation),
        },
      });
      await reload();
      setMsg({ kind: "success", text: "Safety details saved." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Safety & emergency</h2>
          <p className="text-sm text-muted">Tenants see the safety features on the listing. Contacts and instructions are shown only to tenants with an active lease.</p>
        </div>
        <Badge tone={(data?.score ?? 0) >= 80 ? "success" : "warning"}>{data?.score ?? 0}% complete</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Fire extinguisher" options={yn} value={toYn(s.fireExtinguisher)} onChange={(e) => setS({ ...s, fireExtinguisher: fromYn(e.target.value) })} disabled={!canManage} />
        {s.fireExtinguisher && <Input label="How many" type="number" min={1} value={s.fireExtinguisherCount?.toString() ?? ""} onChange={(e) => setS({ ...s, fireExtinguisherCount: e.target.value === "" ? null : Number(e.target.value) })} disabled={!canManage} />}
        {s.fireExtinguisher && (
          <div>
            <Input label="Expiry / refill date *" type="date" value={s.fireExtinguisherExpiry ?? ""} onChange={(e) => setS({ ...s, fireExtinguisherExpiry: e.target.value || null })} disabled={!canManage} />
            {data?.extinguisherState && <Badge tone={STATE_TONE[data.extinguisherState]} className="mt-1">{labelize(data.extinguisherState)}</Badge>}
          </div>
        )}
        <Select label="Smoke detectors" options={yn} value={toYn(s.smokeDetectors)} onChange={(e) => setS({ ...s, smokeDetectors: fromYn(e.target.value) })} disabled={!canManage} />
        {s.smokeDetectors && <div className="sm:col-span-2"><Input label="Where" maxLength={200} value={s.smokeDetectorLocations ?? ""} onChange={(e) => setS({ ...s, smokeDetectorLocations: e.target.value })} disabled={!canManage} /></div>}
        <Input label="Emergency exits" type="number" min={0} value={s.emergencyExits?.toString() ?? ""} onChange={(e) => setS({ ...s, emergencyExits: e.target.value === "" ? null : Number(e.target.value) })} disabled={!canManage} />
        <Select label="Emergency staircase" options={yn} value={toYn(s.emergencyStaircase)} onChange={(e) => setS({ ...s, emergencyStaircase: fromYn(e.target.value) })} disabled={!canManage} />
        <Select label="First aid kit" options={yn} value={toYn(s.firstAidKit)} onChange={(e) => setS({ ...s, firstAidKit: fromYn(e.target.value) })} disabled={!canManage} />
        {s.firstAidKit && <Input label="First aid kit is at" maxLength={120} value={s.firstAidLocation ?? ""} onChange={(e) => setS({ ...s, firstAidLocation: e.target.value })} disabled={!canManage} />}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Security (name / agency)" maxLength={120} value={s.securityName ?? ""} onChange={(e) => setS({ ...s, securityName: e.target.value || null })} disabled={!canManage} />
        <Input label="Security phone" value={s.securityPhone ?? ""} onChange={(e) => setS({ ...s, securityPhone: e.target.value || null })} disabled={!canManage} />
        <Select label="Security 24×7" options={yn} value={toYn(s.security24x7)} onChange={(e) => setS({ ...s, security24x7: fromYn(e.target.value) })} disabled={!canManage} />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold">Building emergency numbers</p>
          {canManage && (s.emergencyContacts?.length ?? 0) < 6 && <Button size="sm" variant="ghost" leftIcon={<Plus className="size-4" />} onClick={() => setS({ ...s, emergencyContacts: [...(s.emergencyContacts ?? []), { label: "", phone: "" }] })}>Add number</Button>}
        </div>
        <p className="mb-2 text-xs text-muted">112, 100, 101 and 108 are always shown to tenants.</p>
        {(s.emergencyContacts ?? []).map((c, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Input aria-label="Label" placeholder="e.g. Building office" value={c.label} onChange={(e) => setS({ ...s, emergencyContacts: s.emergencyContacts!.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} disabled={!canManage} />
            <Input aria-label="Phone" placeholder="Phone" value={c.phone} onChange={(e) => setS({ ...s, emergencyContacts: s.emergencyContacts!.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)) })} disabled={!canManage} />
            {canManage && <button type="button" aria-label="Remove" className="rounded-control p-2 text-muted hover:text-danger" onClick={() => setS({ ...s, emergencyContacts: s.emergencyContacts!.filter((_, k) => k !== i) })}><Trash2 className="size-4" /></button>}
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {place("nearestHospital", "Nearest hospital")}
        {place("nearestPoliceStation", "Nearest police station")}
      </div>

      <Textarea label="Building emergency instructions" rows={4} maxLength={2000} placeholder="e.g. In a fire, use the staircase near Flat 104, not the lift. Gas main valve: ground floor, near the meter room." value={s.instructions ?? ""} onChange={(e) => setS({ ...s, instructions: e.target.value })} disabled={!canManage} />

      <div>
        <p className="mb-1 text-sm font-semibold">Safety certificates</p>
        <ul className="space-y-1 text-sm">
          {data?.certificates.map((c) => (
            <li key={c.docType} className="flex items-center gap-2">
              {labelize(c.docType)}: {c.uploaded ? <Badge tone={c.status === "APPROVED" ? "success" : "neutral"}>{c.status === "APPROVED" ? "Verified" : "Uploaded"}</Badge> : <span className="text-muted">Not uploaded (where applicable)</span>}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted">Upload them in the Documents tab.</p>
      </div>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {canManage && <div className="flex justify-end"><Button loading={busy} onClick={() => void save()}>Save safety details</Button></div>}
    </section>
  );
}
