/**
 * Multi-step property workflow (create + continue draft + edit). Every step saves to the shared
 * /api/v1 endpoints used by the Android and iOS apps; field schemas come from GET /property-types.
 */
import { ArrowLeft, ArrowRight, Building2, Check, FileUp, Home, LandPlot, LocateFixed, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PhoneField } from "@/components/ui/PhoneField";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { UploadButton } from "@/components/ui/UploadButton";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { cn } from "@/utils/cn";
import { AppError, errorMessage } from "@/utils/errors";
import { formatMoney, labelize } from "@/utils/format";
import { currentPosition, INDIAN_STATES, normalizeState } from "@/utils/location";
import { CompletenessMeter, CostBreakdownView, DisclosureSelect, DynamicFields, toApiValues, type Values } from "./components";
import { imagePath, type Disclosure, type PropertyCan, type PropertyDetail, type PropertyTypeDef, type PropertyTypesResponse, type Unit } from "./types";

type Msg = { kind: "success" | "error" | "warning"; text: string } | null;

function useTypes() {
  return useQuery(() => request<PropertyTypesResponse>("/property-types"), []);
}

/** Pulls field-level problems out of an API error for display. */
function problemsOf(err: unknown): string[] {
  const details = (err as { details?: { problems?: string[]; issues?: Array<{ path: string; message: string }> } }).details;
  return details?.problems ?? details?.issues?.map((i) => (i.path ? `${labelize(i.path.split(".").filter((x) => !/^\d+$/.test(x)).pop())}: ${i.message}` : i.message)) ?? [];
}

/** Error text with every field problem spelled out. */
function explain(err: unknown): string {
  const problems = problemsOf(err);
  return problems.length ? problems.join(" · ") : errorMessage(err);
}

export function PropertyFormPage() {
  const { id } = useParams();
  return id ? <EditWizard id={id} /> : <CreateStart />;
}

/* ─────────────── Steps 1–2: category, type, listing ─────────────── */

const CATEGORY_ICON: Record<string, ReactNode> = { RESIDENTIAL: <Home className="size-5" />, COMMERCIAL: <Building2 className="size-5" />, LAND: <LandPlot className="size-5" /> };

function CreateStart() {
  const navigate = useNavigate();
  const { activeRole, can, permissions } = useAuth();
  const types = useTypes();
  const [category, setCategory] = useState("RESIDENTIAL");
  const [typeKey, setTypeKey] = useState("");
  const [listingType, setListingType] = useState("RENT");
  const [title, setTitle] = useState("");
  const [landlordPhone, setLandlordPhone] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const scopes = permissions["properties.create"] ?? [];
  const forOthers = activeRole?.key !== "LANDLORD" && (scopes.includes("ALL") || scopes.includes("ASSIGNED"));
  // Only types an admin has turned on can be added; categories with none are hidden.
  const categories = (types.data?.categories ?? []).map((c) => ({ ...c, types: c.types.filter((t) => t.enabled !== false) })).filter((c) => c.types.length > 0);
  const activeCategory = categories.some((c) => c.key === category) ? category : (categories[0]?.key ?? "");
  const type = categories.flatMap((c) => c.types).find((t) => t.key === typeKey);

  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body = { propertyTypeKey: typeKey, category: activeCategory, listingType, title: title.trim() || undefined, landlordPhone: forOthers && landlordPhone ? landlordPhone : undefined };
      const res = await request<{ property: { id: string } }>("/properties", { method: "POST", body });
      navigate(`/properties/${res.property.id}/edit?step=3`, { replace: true });
    } catch (err) {
      setMsg({ kind: "error", text: explain(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!can("properties.create")) return <Alert kind="error">You don't have permission to add properties.</Alert>;
  return (
    <>
      <Link to="/properties" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
        <ArrowLeft className="size-4" /> Properties
      </Link>
      <PageHeader title="Add property" description="Step 1–2 of 12 · Choose what you are listing. You can save and continue the draft at any time." />
      {types.loading && <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>}
      {types.error && <Alert kind="error">{types.error}</Alert>}
      {types.data && categories.length === 0 && <Alert kind="info">No property types are open for new listings right now.</Alert>}
      {types.data && categories.length > 0 && (
        <div className="space-y-6">
          <section className="card p-5 sm:p-6">
            <h2 className="mb-3 font-semibold">1. Category</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {categories.map((c) => (
                <button key={c.key} type="button" onClick={() => { setCategory(c.key); setTypeKey(""); }} className={cn("flex min-h-16 items-center gap-3 rounded-control border p-4 text-left font-semibold", activeCategory === c.key ? "border-brand bg-brand-bg text-brand-dark" : "border-line hover:bg-subtle")}>
                  {CATEGORY_ICON[c.key]} {c.label}
                </button>
              ))}
            </div>
          </section>
          <section className="card p-5 sm:p-6">
            <h2 className="mb-3 font-semibold">2. Property type</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {categories.find((c) => c.key === activeCategory)?.types.map((t) => (
                <button key={t.key} type="button" onClick={() => { setTypeKey(t.key); if (!t.listingTypes.includes(listingType)) setListingType(t.listingTypes[0]); }} className={cn("rounded-control border p-4 text-left", typeKey === t.key ? "border-brand bg-brand-bg" : "border-line hover:bg-subtle")}>
                  <span className="block font-semibold">{t.label}</span>
                  <span className="text-xs text-muted">{t.structure === "ROOMS_BEDS" ? "Rooms & beds" : t.structure === "MULTI_UNIT" ? `Many ${(t.unitLabel ?? "unit").toLowerCase()}s` : t.structure === "VILLA" ? "Single villa or villa community" : "Single property"}</span>
                </button>
              ))}
            </div>
          </section>
          {type && (
            <section className="card space-y-4 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Listing for" options={type.listingTypes.map((l) => ({ value: l, label: labelize(l) }))} value={listingType} onChange={(e) => setListingType(e.target.value)} />
                <Input label="Title (optional now)" placeholder={`e.g. ${type.label} in Madhapur`} maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              {forOthers && (
                <PhoneField label="Landlord's registered phone" hint="Leave empty to create a SafeRent-managed listing (admins only)." value={landlordPhone} onChange={setLandlordPhone} />
              )}
              {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
              <div className="flex justify-end">
                <Button loading={busy} leftIcon={<ArrowRight className="size-4" />} onClick={() => void create()}>Create draft & continue</Button>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

/* ─────────────── Steps 3–12 ─────────────── */

const STEPS = [
  { step: 3, title: "Basic information" },
  { step: 4, title: "Property details" },
  { step: 5, title: "Units, rooms or beds" },
  { step: 6, title: "Utilities" },
  { step: 7, title: "Guest policies" },
  { step: 8, title: "Amenities" },
  { step: 9, title: "Rent & charges" },
  { step: 10, title: "Photos & documents" },
  { step: 11, title: "Condition & inspection" },
  { step: 12, title: "Review & submit" },
];

interface StepProps {
  p: PropertyDetail;
  type: PropertyTypeDef;
  enums: Record<string, string[]>;
  reload: () => Promise<void>;
  next: () => void;
  setMsg: (m: Msg) => void;
}

function EditWizard({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const types = useTypes();
  const { data, loading, error, reload } = useQuery(() => request<{ property: PropertyDetail; can: PropertyCan }>(`/properties/${id}`), [id]);
  const [msg, setMsg] = useState<Msg>(null);
  const step = Math.min(12, Math.max(3, Number(params.get("step") ?? data?.property.wizardStep ?? 3)));
  const type = useMemo(() => types.data?.categories.flatMap((c) => c.types).find((t) => t.key === data?.property.propertyType), [types.data, data]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  if ((loading && !data) || types.loading) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Property not found."}</Alert>;
  if (!type || !types.data) return <Alert kind="error">This property type is not available.</Alert>;
  const p = data.property;
  if (!data.can.manage) return <Alert kind="error">You can view this property but not edit it.</Alert>;
  const locked = p.publicationStatus === "PENDING_VERIFICATION" || p.activeStatus === "ARCHIVED" || p.activeStatus === "SUSPENDED";

  const go = (s: number) => {
    setMsg(null);
    setParams({ step: String(s) }, { replace: true });
  };
  const next = () => {
    const n = Math.min(12, step + 1);
    go(n);
    // Remember progress, then refresh so every step holds the latest version.
    void request(`/properties/${p.id}`, { method: "PATCH", body: { wizardStep: n } })
      .catch(() => undefined)
      .then(() => reload());
  };
  const props: StepProps = { p, type, enums: types.data.enums, reload: async () => { await reload(); }, next, setMsg };

  return (
    <>
      <Link to={`/properties/${p.id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
        <ArrowLeft className="size-4" /> {p.title ?? p.code}
      </Link>
      <PageHeader
        title={`${p.code} · ${type.label}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.publicationStatus} />
            {p.activeStatus !== "ACTIVE" && <StatusBadge status={p.activeStatus} />}
            <span>Step {step} of 12 · {STEPS.find((s) => s.step === step)?.title}</span>
          </span>
        }
        actions={<Button variant="secondary" onClick={() => navigate(`/properties/${p.id}`)}>Preview</Button>}
      />
      {locked && <Alert kind="warning" className="mb-4">This property is {labelize(p.publicationStatus === "PENDING_VERIFICATION" ? "pending verification" : p.activeStatus)} and can't be edited right now.</Alert>}
      {p.publicationStatus === "REJECTED" && p.moderationNote && <Alert kind="warning" title="Changes requested by SafeRent" className="mb-4">{p.moderationNote}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Steps" className="card h-max p-3">
          <ol className="space-y-0.5">
            {[{ step: 1, title: "Category & type" }, ...STEPS].map((s) => (
              <li key={s.step}>
                <button type="button" disabled={s.step < 3} onClick={() => go(s.step)} className={cn("flex min-h-10 w-full items-center gap-2 rounded-control px-2.5 text-left text-sm", s.step === step ? "bg-brand-bg font-semibold text-brand-dark" : "text-ink-2 hover:bg-subtle disabled:hover:bg-transparent")}>
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", s.step < step || s.step < 3 ? "bg-success text-white" : s.step === step ? "bg-brand text-white" : "bg-subtle text-muted")}>
                    {s.step < step || s.step < 3 ? <Check className="size-3.5" /> : s.step}
                  </span>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-3 border-t border-line px-1 pt-3">
            <CompletenessMeter score={p.completeness.score} compact />
          </div>
        </nav>
        <div className={cn("min-w-0 space-y-4", locked && "pointer-events-none opacity-60")}>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          {step === 3 && <BasicStep {...props} />}
          {step === 4 && <BuildingStep {...props} />}
          {step === 5 && (type.structure === "ROOMS_BEDS" ? <RoomsStep {...props} /> : <UnitsStep {...props} />)}
          {step === 6 && <UtilitiesStep {...props} />}
          {step === 7 && <PoliciesStep {...props} />}
          {step === 8 && <AmenitiesStep {...props} />}
          {step === 9 && <PricingStep {...props} />}
          {step === 10 && <MediaStep {...props} />}
          {step === 11 && <InspectionStep {...props} />}
          {step === 12 && <ReviewStep {...props} />}
        </div>
      </div>
    </>
  );
}

function StepCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
      {footer && <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line pt-4">{footer}</div>}
    </section>
  );
}

function SaveButtons({ save, next, busy }: { save: () => Promise<boolean>; next: () => void; busy: boolean }) {
  return (
    <>
      <Button variant="secondary" loading={busy} leftIcon={<Save className="size-4" />} onClick={() => void save()}>Save draft</Button>
      <Button loading={busy} leftIcon={<ArrowRight className="size-4" />} onClick={() => void save().then((ok) => ok && next())}>Save & continue</Button>
    </>
  );
}

/** Wraps a save call with busy state, success / error messages and a reload. */
function useSaver({ reload, setMsg }: Pick<StepProps, "reload" | "setMsg">) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success = "Saved."): Promise<boolean> => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg({ kind: "success", text: success });
      return true;
    } catch (err) {
      if (err instanceof AppError && err.reason === "VERSION_CONFLICT") {
        // The draft moved on (another tab, or an earlier save). Fetch the latest copy; what you typed is kept.
        await reload().catch(() => undefined);
        setMsg({ kind: "warning", text: "This property was updated elsewhere. We loaded the latest copy — your changes are still here, click Save again." });
        return false;
      }
      const problems = problemsOf(err);
      setMsg({ kind: "error", text: problems.length ? problems.join(" · ") : errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/* Step 3 */
function BasicStep({ p, type, reload, next, setMsg }: StepProps) {
  const [v, setV] = useState({
    title: p.title ?? "",
    description: p.description ?? "",
    listingType: p.listingType,
    addressLine: p.addressLine ?? "",
    locality: p.locality ?? "",
    city: p.city ?? "",
    state: normalizeState(p.state),
    pincode: p.pincode ?? "",
    latitude: p.latitude ?? "",
    longitude: p.longitude ?? "",
  });
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<{ kind: "info" | "warning"; text: string } | null>(null);
  const { busy, run } = useSaver({ reload, setMsg });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: k === "pincode" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value });

  /** Runs only when the user clicks "Use my current location": takes latitude/longitude from the device. */
  const fillFromMyLocation = async () => {
    setLocating(true);
    setLocationNote(null);
    try {
      const pos = await currentPosition();
      setV((cur) => ({ ...cur, latitude: pos.latitude.toFixed(6), longitude: pos.longitude.toFixed(6) }));
    } catch (err) {
      setLocationNote({ kind: "warning", text: err instanceof Error ? err.message : "Couldn't get your location." });
    } finally {
      setLocating(false);
    }
  };

  const save = () =>
    run(() =>
      request(`/properties/${p.id}`, {
        method: "PATCH",
        body: {
          version: p.version,
          title: v.title.trim() || null,
          description: v.description.trim() || null,
          listingType: v.listingType,
          addressLine: v.addressLine.trim() || null,
          locality: v.locality.trim() || null,
          city: v.city.trim() || null,
          state: v.state.trim() || null,
          pincode: v.pincode.trim() || null,
          latitude: v.latitude === "" ? null : String(v.latitude),
          longitude: v.longitude === "" ? null : String(v.longitude),
        },
      }),
    );
  return (
    <StepCard title="Basic information & location" description="Tenants see this first. Be specific and honest." footer={<SaveButtons save={save} next={next} busy={busy} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Title *" maxLength={150} value={v.title} onChange={set("title")} />
        <Select label="Listing for" options={type.listingTypes.map((l) => ({ value: l, label: labelize(l) }))} value={v.listingType} onChange={set("listingType")} />
        <div className="sm:col-span-2">
          <Textarea label="Description *" hint="At least 30 characters (50+ improves completeness)." rows={5} maxLength={5000} value={v.description} onChange={set("description")} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Location</h3>
            <p className="text-sm text-muted">Stand at the property and tap “Use my current location” to capture the map location. Type the address below.</p>
          </div>
          <Button variant="secondary" size="sm" loading={locating} leftIcon={<LocateFixed className="size-4" />} onClick={() => void fillFromMyLocation()}>
            Use my current location
          </Button>
        </div>
        {locationNote && <Alert kind={locationNote.kind} className="sm:col-span-2">{locationNote.text}</Alert>}
        <Input label="Address *" maxLength={255} placeholder="Flat / house no., building, street" value={v.addressLine} onChange={set("addressLine")} />
        <Input label="Locality" maxLength={120} placeholder="e.g. Madhapur" value={v.locality} onChange={set("locality")} />
        <Input label="PIN code *" inputMode="numeric" maxLength={6} placeholder="6 digits" value={v.pincode} onChange={set("pincode")} />
        <Input label="City *" maxLength={80} placeholder="e.g. Hyderabad" value={v.city} onChange={set("city")} />
        <Select label="State *" placeholder="Choose state" options={INDIAN_STATES.map((st) => ({ value: st, label: st }))} value={normalizeState(v.state)} onChange={set("state")} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Latitude" disabled value={v.latitude} placeholder="From your location" />
          <Input label="Longitude" disabled value={v.longitude} placeholder="From your location" />
        </div>
        {v.latitude && v.longitude && (
          <a className="text-sm font-semibold text-brand-dark hover:text-brand sm:col-span-2" href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`} target="_blank" rel="noreferrer">
            Check the pin on Google Maps ↗
          </a>
        )}
      </div>
    </StepCard>
  );
}

/* Step 4 */
function BuildingStep({ p, type, reload, next, setMsg }: StepProps) {
  const [values, setValues] = useState<Values>(() => ({ ...p.building }));
  const { busy, run } = useSaver({ reload, setMsg });
  const save = () => run(() => request(`/properties/${p.id}`, { method: "PATCH", body: { version: p.version, building: toApiValues(type.buildingFields, values) } }));
  return (
    <StepCard
      title={`${type.label} details`}
      description={type.structure === "MULTI_UNIT" ? `Entered once for the whole building — you won't repeat them for each ${(type.unitLabel ?? "unit").toLowerCase()}.` : "Choose Not disclosed if you'd rather not say — it is never shown as No."}
      footer={<SaveButtons save={save} next={next} busy={busy} />}
    >
      <DynamicFields defs={type.buildingFields} values={values} onChange={(k, val) => setValues({ ...values, [k]: val })} />
    </StepCard>
  );
}

/* Step 5 — units (apartment flats, villas, houses, duplex, commercial spaces, plots) */
function UnitsStep({ p, type, reload, next, setMsg }: StepProps) {
  const [editing, setEditing] = useState<Unit | "new" | null>(type.structure === "SINGLE_UNIT" && p.units[0] ? p.units[0] : null);
  const label = type.unitLabel ?? "Unit";
  const { confirm, dialog } = useConfirm();
  const single = type.structure === "SINGLE_UNIT" || (type.structure === "VILLA" && p.building.villaListing !== "COMMUNITY");
  return (
    <StepCard
      title={single ? `${label} details` : `${label}s`}
      description={single ? undefined : `Add each ${label.toLowerCase()} with its own number, details, rent and availability. Every ${label.toLowerCase()} gets its own SafeRent ID.`}
      footer={<Button leftIcon={<ArrowRight className="size-4" />} onClick={next}>Continue</Button>}
    >
      {!single && (
        <>
          <ul className="mb-4 divide-y divide-line rounded-control border border-line">
            {p.units.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="font-semibold">{label} {u.unitNumber ?? "—"}</span> <span className="text-xs text-muted">{u.code}{u.bhkType ? ` · ${u.bhkType}` : ""}{u.floorNumber !== null ? ` · Floor ${u.floorNumber}` : ""}{u.pricing?.monthlyRent ? ` · ${formatMoney(u.pricing.monthlyRent)}/mo` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={u.availabilityStatus} />
                  <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>Edit</Button>
                  <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => confirm({ title: `Archive ${label.toLowerCase()} ${u.unitNumber ?? ""}`, message: "It will be removed from this property (history is kept).", tone: "danger", confirmLabel: "Archive", onConfirm: async () => { await request(`/properties/${p.id}/units/${u.id}`, { method: "DELETE" }); await reload(); } })}>
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
            {p.units.length === 0 && <li className="px-4 py-3 text-sm text-muted">No {label.toLowerCase()}s yet.</li>}
          </ul>
          <Button leftIcon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add {label.toLowerCase()}</Button>
        </>
      )}
      {single && (p.units[0] || type.structure === "VILLA") && <UnitForm p={p} type={type} unit={p.units[0] ?? null} onSaved={async () => { await reload(); setMsg({ kind: "success", text: "Saved." }); }} setMsg={setMsg} />}
      <Modal open={!single && editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? `Add ${label.toLowerCase()}` : `Edit ${label.toLowerCase()} ${(editing as Unit | null)?.unitNumber ?? ""}`}>
        {editing && !single && (
          <UnitForm
            p={p}
            type={type}
            unit={editing === "new" ? null : editing}
            onSaved={async () => {
              setEditing(null);
              await reload();
              setMsg({ kind: "success", text: `${label} saved.` });
            }}
            setMsg={setMsg}
          />
        )}
      </Modal>
      {dialog}
    </StepCard>
  );
}

function UnitForm({ p, type, unit, onSaved, setMsg }: { p: PropertyDetail; type: PropertyTypeDef; unit: Unit | null; onSaved: () => Promise<void>; setMsg: (m: Msg) => void }) {
  const [values, setValues] = useState<Values>(() => (unit ? { ...unit.attributes, ...unit, availableFrom: unit.availableFrom?.slice(0, 10) ?? "" } : { availabilityStatus: "AVAILABLE", furnishing: "NOT_DISCLOSED" }));
  const sale = p.listingType === "SALE";
  const [rent, setRent] = useState(unit?.pricing?.[sale ? "salePrice" : "monthlyRent"] ?? "");
  const [deposit, setDeposit] = useState(unit?.pricing?.securityDeposit ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = type.unitFields.filter((f) => !(f.key === "availabilityStatus" && values.availabilityStatus === "OCCUPIED"));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Values = { ...toApiValues(fields, values) };
      if (body.availabilityStatus === "OCCUPIED") delete body.availabilityStatus;
      if (rent !== "" || deposit !== "") body.pricing = sale ? { salePrice: rent === "" ? null : String(rent) } : { monthlyRent: rent === "" ? null : String(rent), securityDeposit: deposit === "" ? null : String(deposit) };
      if (unit) await request(`/properties/${p.id}/units/${unit.id}`, { method: "PATCH", body: { ...body, version: unit.version } });
      else await request(`/properties/${p.id}/units`, { method: "POST", body });
      await onSaved();
    } catch (err) {
      setError(explain(err));
      setMsg(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}
      <DynamicFields defs={fields} values={values} onChange={(k, v) => setValues({ ...values, [k]: v })} />
      {values.availabilityStatus === "OCCUPIED" && <Alert kind="info">Occupied by an active lease — availability changes when the lease ends.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={sale ? "Sale price (₹)" : "Monthly rent (₹)"} type="number" min={0} step="any" value={String(rent ?? "")} onChange={(e) => setRent(e.target.value)} hint="You can add all charges in the Rent & charges step." />
        {!sale && <Input label="Security deposit (₹)" type="number" min={0} step="any" value={String(deposit ?? "")} onChange={(e) => setDeposit(e.target.value)} />}
      </div>
      {type.floorWise && unit && <DuplexFloors p={p} unit={unit} onSaved={onSaved} />}
      <div className="flex justify-end">
        <Button loading={busy} leftIcon={<Save className="size-4" />} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}

function DuplexFloors({ p, unit, onSaved }: { p: PropertyDetail; unit: Unit; onSaved: () => Promise<void> }) {
  const count = Math.max(unit.totalFloors ?? 2, 2);
  const [floors, setFloors] = useState(() =>
    Array.from({ length: count }, (_, i) => unit.floors?.find((f) => f.floorNumber === i) ?? { floorNumber: i, label: i === 0 ? "Ground floor" : `Floor ${i}`, bedrooms: 0, bathrooms: 0, kitchens: 0, livingRooms: 0, balconies: 0, additionalDetails: "" }),
  );
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, key: string, value: string) => setFloors(floors.map((f, j) => (j === i ? { ...f, [key]: key === "additionalDetails" || key === "label" ? value : Number(value || 0) } : f)));
  const save = async () => {
    setError(null);
    try {
      await request(`/properties/${p.id}/units/${unit.id}/floors`, { method: "PUT", body: { version: unit.version, floors: floors.map((f) => ({ floorNumber: f.floorNumber, label: f.label || null, bedrooms: f.bedrooms, bathrooms: f.bathrooms, kitchens: f.kitchens, livingRooms: f.livingRooms, balconies: f.balconies, additionalDetails: f.additionalDetails || null })) } });
      await onSaved();
    } catch (err) {
      setError(explain(err));
    }
  };
  return (
    <div className="rounded-control border border-line p-4">
      <h3 className="mb-3 font-semibold">Floor-wise details</h3>
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      <div className="space-y-3">
        {floors.map((f, i) => (
          <div key={f.floorNumber} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <Input label="Floor" value={f.label ?? ""} onChange={(e) => set(i, "label", e.target.value)} />
            {(["bedrooms", "bathrooms", "kitchens", "livingRooms", "balconies"] as const).map((k) => (
              <Input key={k} label={labelize(k.replace("livingRooms", "living_rooms"))} type="number" min={0} value={String(f[k])} onChange={(e) => set(i, k, e.target.value)} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => void save()}>Save floors</Button>
      </div>
    </div>
  );
}

/* Step 5 — PG / hostel rooms and beds */
function RoomsStep({ p, enums, reload, next, setMsg }: StepProps) {
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState({ roomNumber: "", floorNumber: "", sharingType: "DOUBLE", customSharing: "", rentPerBed: "", securityDeposit: "", attachedBathroom: "NOT_DISCLOSED" as Disclosure, acAvailable: "NOT_DISCLOSED" as Disclosure, availabilityStatus: "AVAILABLE" });
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    try {
      await request(`/properties/${p.id}/rooms`, {
        method: "POST",
        body: {
          roomNumber: room.roomNumber,
          floorNumber: room.floorNumber === "" ? null : Number(room.floorNumber),
          sharingType: room.sharingType,
          customSharing: room.sharingType === "CUSTOM" ? Number(room.customSharing) : null,
          rentPerBed: room.rentPerBed === "" ? null : room.rentPerBed,
          securityDeposit: room.securityDeposit === "" ? null : room.securityDeposit,
          attachedBathroom: room.attachedBathroom,
          acAvailable: room.acAvailable,
          availabilityStatus: room.availabilityStatus,
        },
      });
      setOpen(false);
      await reload();
      setMsg({ kind: "success", text: "Room added with its beds." });
    } catch (err) {
      setError(explain(err));
    }
  };
  const bedStatus = async (roomId: string, bedId: string, availabilityStatus: string) => {
    try {
      await request(`/properties/${p.id}/rooms/${roomId}/beds/${bedId}`, { method: "PATCH", body: { availabilityStatus } });
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: explain(err) });
    }
  };
  return (
    <StepCard title="Rooms and beds" description="PG building → rooms → beds. Available beds are always counted from the actual bed records." footer={<Button leftIcon={<ArrowRight className="size-4" />} onClick={next}>Continue</Button>}>
      <div className="space-y-3">
        {p.rooms.map((r) => (
          <div key={r.id} className="rounded-control border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Room {r.roomNumber} <span className="text-xs font-normal text-muted">{r.code} · {labelize(r.sharingType)}{r.rentPerBed ? ` · ${formatMoney(r.rentPerBed)}/bed` : ""}</span></p>
              <span className="text-sm text-muted">{r.availableBeds ?? 0} available · {r.occupiedBeds ?? 0} occupied</span>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {r.beds.map((b) => (
                <li key={b.id} className="flex items-center gap-2 rounded-control bg-subtle px-3 py-2 text-sm">
                  <span className="font-semibold">{b.bedNumber}</span>
                  {b.availabilityStatus === "OCCUPIED" ? (
                    <StatusBadge status="OCCUPIED" />
                  ) : (
                    <select aria-label={`Bed ${b.bedNumber} availability`} className="rounded border border-line bg-surface px-1.5 py-1 text-xs" value={b.availabilityStatus} onChange={(e) => void bedStatus(r.id, b.id, e.target.value)}>
                      {["AVAILABLE", "RESERVED", "UNDER_MAINTENANCE", "NOT_AVAILABLE"].map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {p.rooms.length === 0 && <p className="text-sm text-muted">No rooms yet.</p>}
      </div>
      <Button className="mt-4" leftIcon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Add room</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add room" description="Beds (B1, B2 …) are created automatically for the sharing type.">
        <div className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Room number *" value={room.roomNumber} onChange={(e) => setRoom({ ...room, roomNumber: e.target.value })} />
            <Input label="Floor" type="number" value={room.floorNumber} onChange={(e) => setRoom({ ...room, floorNumber: e.target.value })} />
            <Select label="Sharing *" options={(enums.sharingTypes ?? []).map((s) => ({ value: s, label: labelize(s) }))} value={room.sharingType} onChange={(e) => setRoom({ ...room, sharingType: e.target.value })} />
            {room.sharingType === "CUSTOM" && <Input label="People sharing *" type="number" min={1} value={room.customSharing} onChange={(e) => setRoom({ ...room, customSharing: e.target.value })} />}
            <Input label="Rent per bed (₹)" type="number" min={0} value={room.rentPerBed} onChange={(e) => setRoom({ ...room, rentPerBed: e.target.value })} />
            <Input label="Security deposit (₹)" type="number" min={0} value={room.securityDeposit} onChange={(e) => setRoom({ ...room, securityDeposit: e.target.value })} />
            <DisclosureSelect label="Attached bathroom" value={room.attachedBathroom} onChange={(v) => setRoom({ ...room, attachedBathroom: v })} />
            <DisclosureSelect label="AC" value={room.acAvailable} onChange={(v) => setRoom({ ...room, acAvailable: v })} />
            <Select label="Bed availability" options={["AVAILABLE", "RESERVED", "NOT_AVAILABLE"].map((s) => ({ value: s, label: labelize(s) }))} value={room.availabilityStatus} onChange={(e) => setRoom({ ...room, availabilityStatus: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!room.roomNumber} onClick={() => void add()}>Add room</Button>
          </div>
        </div>
      </Modal>
    </StepCard>
  );
}

/* Step 6 */
const UTILITY_GROUPS: Array<{ title: string; fields: Array<{ key: string; label: string; kind: "disclosure" | "enum" | "number" | "text"; options?: string[] }> }> = [
  {
    title: "Utilities",
    fields: [
      { key: "separateElectricityMeter", label: "Separate electricity meter", kind: "disclosure" },
      { key: "separateWaterMeter", label: "Separate water meter", kind: "disclosure" },
      { key: "gasConnectionType", label: "Gas connection", kind: "enum", options: ["PIPED", "CYLINDER", "NONE", "NOT_DISCLOSED"] },
      { key: "internetAvailable", label: "Internet", kind: "disclosure" },
      { key: "internetCharges", label: "Internet charges (₹/month)", kind: "number" },
      { key: "powerBackup", label: "Power backup", kind: "disclosure" },
      { key: "generatorAvailable", label: "Generator", kind: "disclosure" },
      { key: "sewageFacilities", label: "Sewage", kind: "disclosure" },
      { key: "wasteCollection", label: "Waste collection", kind: "disclosure" },
    ],
  },
];

function UtilitiesStep({ p, reload, next, setMsg }: StepProps) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...(p.utilities ?? {}) }));
  const { busy, run } = useSaver({ reload, setMsg });
  const save = () =>
    run(() => {
      const body: Record<string, unknown> = {};
      for (const g of UTILITY_GROUPS) for (const f of g.fields) {
        const val = v[f.key];
        if (f.kind === "number" || f.kind === "text") body[f.key] = val === "" || val === undefined ? null : String(val);
        else if (val !== undefined && val !== null) body[f.key] = val;
      }
      return request(`/properties/${p.id}/utilities`, { method: "PUT", body });
    });
  return (
    <StepCard title="Utilities" description="Disclose what applies. Leave Not disclosed only if you don't want to say — tenants will see it as not disclosed, never as No." footer={<SaveButtons save={save} next={next} busy={busy} />}>
      <div className="space-y-6">
        {UTILITY_GROUPS.map((g) => (
          <fieldset key={g.title}>
            {UTILITY_GROUPS.length > 1 && <legend className="mb-3 font-semibold">{g.title}</legend>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.fields.map((f) =>
                f.kind === "disclosure" ? (
                  <DisclosureSelect key={f.key} label={f.label} value={v[f.key] as string} onChange={(val) => setV({ ...v, [f.key]: val })} />
                ) : f.kind === "enum" ? (
                  <Select key={f.key} label={f.label} options={(f.options ?? []).map((o) => ({ value: o, label: labelize(o) }))} value={(v[f.key] as string) ?? "NOT_DISCLOSED"} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
                ) : (
                  <Input key={f.key} label={f.label} type={f.kind === "number" ? "number" : "text"} step="any" min={0} value={v[f.key] === null || v[f.key] === undefined ? "" : String(v[f.key])} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
                ),
              )}
            </div>
          </fieldset>
        ))}
      </div>
    </StepCard>
  );
}

/* Step 7 */
const POLICY_FIELDS: Array<[string, string]> = [
  ["guestsAllowed", "Guests allowed"],
  ["overnightGuestsAllowed", "Overnight guests"],
  ["guestRegistrationRequired", "Guest registration required"],
  ["landlordApprovalRequired", "Landlord approval required"],
  ["guestParkingAvailable", "Guest parking"],
  ["guestChargesApplicable", "Guest charges"],
  ["petsAllowed", "Pets"],
  ["smokingAllowed", "Smoking"],
  ["partiesAllowed", "Parties"],
  ["cookingAllowed", "Cooking"],
  ["sublettingAllowed", "Subletting"],
  ["workFromHomeAllowed", "Work from home"],
];

function PoliciesStep({ p, reload, next, setMsg }: StepProps) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...(p.policy ?? {}) }));
  const [rules, setRules] = useState<Array<{ title: string; description: string }>>(() => (p.policy?.additionalRules as Array<{ title: string; description: string }> | null) ?? []);
  const { busy, run } = useSaver({ reload, setMsg });
  const save = () =>
    run(() =>
      request(`/properties/${p.id}/policies`, {
        method: "PUT",
        body: {
          ...Object.fromEntries(POLICY_FIELDS.map(([k]) => [k, (v[k] as string) ?? "NOT_DISCLOSED"])),
          maximumGuestStayDays: v.maximumGuestStayDays === "" || v.maximumGuestStayDays === null || v.maximumGuestStayDays === undefined ? null : Number(v.maximumGuestStayDays),
          guestChargeAmount: v.guestChargeAmount === "" || v.guestChargeAmount === null || v.guestChargeAmount === undefined ? null : String(v.guestChargeAmount),
          visitorTimingRestrictions: (v.visitorTimingRestrictions as string) || null,
          loudMusicPolicy: (v.loudMusicPolicy as string) || null,
          additionalRules: rules.filter((r) => r.title.trim()),
        },
      }),
    );
  return (
    <StepCard title="Guest policies and restrictions" description="Shown to tenants exactly as entered. Custom rules are stored as structured rules." footer={<SaveButtons save={save} next={next} busy={busy} />}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {POLICY_FIELDS.map(([k, label]) => (
          <DisclosureSelect key={k} label={label} value={v[k] as string} onChange={(val) => setV({ ...v, [k]: val })} />
        ))}
        {v.overnightGuestsAllowed === "YES" && <Input label="Maximum guest stay (days)" type="number" min={1} value={String(v.maximumGuestStayDays ?? "")} onChange={(e) => setV({ ...v, maximumGuestStayDays: e.target.value })} />}
        {v.guestChargesApplicable === "YES" && <Input label="Guest charge (₹)" type="number" min={0} value={String(v.guestChargeAmount ?? "")} onChange={(e) => setV({ ...v, guestChargeAmount: e.target.value })} />}
        <Input label="Visitor timings" placeholder="e.g. 8 AM – 10 PM" value={String(v.visitorTimingRestrictions ?? "")} onChange={(e) => setV({ ...v, visitorTimingRestrictions: e.target.value })} />
        <Input label="Loud music policy" value={String(v.loudMusicPolicy ?? "")} onChange={(e) => setV({ ...v, loudMusicPolicy: e.target.value })} />
      </div>
      <h3 className="mb-2 mt-6 font-semibold">Additional rules</h3>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[14rem_1fr_auto]">
            <Input aria-label="Rule" placeholder="Rule" value={r.title} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Input aria-label="Details" placeholder="Details" value={r.description} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <Button variant="ghost" aria-label="Remove rule" onClick={() => setRules(rules.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" leftIcon={<Plus className="size-4" />} onClick={() => setRules([...rules, { title: "", description: "" }])}>Add rule</Button>
      </div>
    </StepCard>
  );
}

/* Step 8 */
function AmenitiesStep({ p, reload, next, setMsg }: StepProps) {
  const catalog = useQuery(() => request<{ items: Array<{ key: string; label: string; categories: string[] }> }>("/amenities"), []);
  const [selected, setSelected] = useState<Record<string, Disclosure>>(() => Object.fromEntries(p.amenities.filter((a) => !a.key.startsWith("custom:")).map((a) => [a.key, a.status])));
  const [custom, setCustom] = useState<string[]>(() => p.amenities.filter((a) => a.key.startsWith("custom:")).map((a) => a.label));
  const [newCustom, setNewCustom] = useState("");
  const { busy, run } = useSaver({ reload, setMsg });
  const items = (catalog.data?.items ?? []).filter((a) => a.categories.includes(p.category));
  const save = () =>
    run(() =>
      request(`/properties/${p.id}/amenities`, {
        method: "PUT",
        body: { items: Object.entries(selected).map(([key, status]) => ({ key, status })), custom: custom.map((label) => ({ label, status: "YES" })) },
      }),
    );
  return (
    <StepCard title="Amenities and facilities" description="Tick what the property has. Mark No for things tenants commonly ask about." footer={<SaveButtons save={save} next={next} busy={busy} />}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <div key={a.key} className="flex items-center justify-between gap-2 rounded-control border border-line px-3 py-2">
            <span className="text-sm font-medium">{a.label}</span>
            <select aria-label={a.label} className="rounded border border-line bg-surface px-2 py-1 text-sm" value={selected[a.key] ?? ""} onChange={(e) => {
              const next = { ...selected };
              if (e.target.value) next[a.key] = e.target.value as Disclosure;
              else delete next[a.key];
              setSelected(next);
            }}>
              <option value="">—</option>
              <option value="YES">Yes</option>
              <option value="NO">No</option>
              <option value="NOT_DISCLOSED">Not disclosed</option>
            </select>
          </div>
        ))}
      </div>
      <h3 className="mb-2 mt-6 font-semibold">Custom amenities</h3>
      <div className="flex flex-wrap gap-2">
        {custom.map((c) => (
          <Badge key={c} tone="brand">{c} <button type="button" aria-label={`Remove ${c}`} onClick={() => setCustom(custom.filter((x) => x !== c))}>×</button></Badge>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input aria-label="Custom amenity" placeholder="e.g. Rooftop terrace" maxLength={60} value={newCustom} onChange={(e) => setNewCustom(e.target.value)} />
        <Button variant="secondary" disabled={newCustom.trim().length < 2} onClick={() => { setCustom([...custom, newCustom.trim()]); setNewCustom(""); }}>Add</Button>
      </div>
    </StepCard>
  );
}

/* Step 9 */
const CHARGE_ROWS = [
  ["MAINTENANCE", "Maintenance"],
  ["ELECTRICITY", "Electricity"],
  ["WATER", "Water"],
  ["GAS", "Gas"],
  ["PARKING", "Parking"],
  ["INTERNET", "Internet"],
] as const;

function PricingStep({ p, type, enums, reload, next, setMsg }: StepProps) {
  const pr = p.pricing;
  const sale = p.listingType === "SALE";
  // Flats / rooms carry their own rent and deposit (step 5), so the property-level ones aren't asked again.
  const perUnitRent = type.structure === "MULTI_UNIT" || type.structure === "ROOMS_BEDS";
  // …and for rentals of those, the lease terms grid (advance, due day, lock-in, notice, agreement) isn't asked either.
  const showTerms = sale || !perUnitRent;
  const [v, setV] = useState<Record<string, string>>(() => ({
    monthlyRent: pr?.monthlyRent ?? "",
    salePrice: pr?.salePrice ?? "",
    securityDeposit: pr?.securityDeposit ?? "",
    advanceRentMonths: pr?.advanceRentMonths?.toString() ?? "",
    rentDueDay: pr?.rentDueDay?.toString() ?? "",
    lateFeePolicy: pr?.lateFeePolicy ?? "",
    lockInPeriodMonths: pr?.lockInPeriodMonths?.toString() ?? "",
    noticePeriodDays: pr?.noticePeriodDays?.toString() ?? "",
    rentIncreasePolicy: pr?.rentIncreasePolicy ?? "",
    agreementCharges: pr?.agreementCharges ?? "",
    agreementChargesPaidBy: pr?.agreementChargesPaidBy ?? "NOT_DISCLOSED",
    refundPolicy: pr?.refundPolicy ?? "",
    otherTerms: pr?.otherTerms ?? "",
  }));
  const [charges, setCharges] = useState(() =>
    CHARGE_ROWS.map(([kind, label]) => {
      const c = pr?.charges.find((x) => x.kind === kind);
      return { kind, label, billing: c?.billing ?? "NOT_DISCLOSED", amount: c?.amount ?? "", frequency: c?.frequency ?? "MONTHLY" };
    }),
  );
  const { busy, run } = useSaver({ reload, setMsg });
  const num = (x: string) => (x === "" ? null : Number(x));
  const money = (x: string) => (x === "" ? null : x);
  const save = () =>
    run(() =>
      request(`/properties/${p.id}/pricing`, {
        method: "PUT",
        body: {
          ...(sale ? { salePrice: money(v.salePrice) } : showTerms ? { monthlyRent: money(v.monthlyRent), securityDeposit: money(v.securityDeposit), advanceRentMonths: num(v.advanceRentMonths), rentDueDay: num(v.rentDueDay), lockInPeriodMonths: num(v.lockInPeriodMonths), noticePeriodDays: num(v.noticePeriodDays) } : {}),
          ...(showTerms ? { agreementCharges: money(v.agreementCharges), agreementChargesPaidBy: v.agreementChargesPaidBy } : {}),
          lateFeePolicy: v.lateFeePolicy || null,
          rentIncreasePolicy: v.rentIncreasePolicy || null,
          refundPolicy: v.refundPolicy || null,
          otherTerms: v.otherTerms || null,
          charges: charges.map((c) => ({
            kind: c.kind,
            label: c.label,
            billing: c.billing,
            amount: ["FIXED_MONTHLY", "ONE_TIME", "USAGE_BASED"].includes(c.billing) && c.amount !== "" ? c.amount : null,
            frequency: c.billing === "FIXED_MONTHLY" ? c.frequency : c.billing === "ONE_TIME" ? "ONE_TIME" : null,
          })),
        },
      }),
    );
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <StepCard
      title="Rent and financial details"
      description={perUnitRent && !sale ? "Charges common to every unit. Rent and deposit are set for each unit in step 5." : "Every charge is listed separately — never combined into one unclear amount."}
      footer={<SaveButtons save={save} next={next} busy={busy} />}
    >
      {showTerms && (
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sale ? (
          <Input label="Sale price (₹)" type="number" min={0} value={v.salePrice} onChange={set("salePrice")} />
        ) : (
          <>
            {!perUnitRent && (
              <>
                <Input label="Monthly rent (₹)" type="number" min={0} value={v.monthlyRent} onChange={set("monthlyRent")} />
                <Input label="Security deposit (₹)" type="number" min={0} value={v.securityDeposit} onChange={set("securityDeposit")} />
              </>
            )}
            <Input label="Advance rent (months)" type="number" min={0} max={24} value={v.advanceRentMonths} onChange={set("advanceRentMonths")} />
            <Input label="Rent due day (1–28)" type="number" min={1} max={28} value={v.rentDueDay} onChange={set("rentDueDay")} />
            <Input label="Lock-in period (months)" type="number" min={0} value={v.lockInPeriodMonths} onChange={set("lockInPeriodMonths")} />
            <Input label="Notice period (days)" type="number" min={0} value={v.noticePeriodDays} onChange={set("noticePeriodDays")} />
          </>
        )}
        <Input label="Agreement charges (₹)" type="number" min={0} value={v.agreementCharges} onChange={set("agreementCharges")} />
        <Select label="Agreement charges paid by" options={["LANDLORD", "TENANT", "SHARED", "NOT_APPLICABLE", "NOT_DISCLOSED"].map((o) => ({ value: o, label: labelize(o) }))} value={v.agreementChargesPaidBy} onChange={set("agreementChargesPaidBy")} />
      </div>
      )}
      <h3 className="mb-2 font-semibold">Charges</h3>
      <div className="space-y-2">
        {charges.map((c, i) => (
          <div key={c.kind} className="grid items-end gap-2 rounded-control border border-line p-3 sm:grid-cols-[8rem_1fr_9rem_9rem]">
            <span className="pb-3 text-sm font-semibold">{c.label}</span>
            <Select aria-label={`${c.label} billing`} options={(enums.chargeBilling ?? []).map((b) => ({ value: b, label: labelize(b) }))} value={c.billing} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, billing: e.target.value } : x)))} />
            <Input aria-label={`${c.label} amount`} placeholder="Amount ₹" type="number" min={0} disabled={!["FIXED_MONTHLY", "ONE_TIME"].includes(c.billing)} value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <Select aria-label={`${c.label} frequency`} disabled={c.billing !== "FIXED_MONTHLY"} options={["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"].map((f) => ({ value: f, label: labelize(f) }))} value={c.frequency} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)))} />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Textarea label="Late fee policy" rows={2} value={v.lateFeePolicy} onChange={set("lateFeePolicy")} />
        <Textarea label="Rent increase policy" rows={2} value={v.rentIncreasePolicy} onChange={set("rentIncreasePolicy")} />
        <Textarea label="Refund policy" rows={2} value={v.refundPolicy} onChange={set("refundPolicy")} />
        <Textarea label="Other terms" rows={2} value={v.otherTerms} onChange={set("otherTerms")} />
      </div>
      {pr?.breakdown && (
        <div className="mt-6 rounded-control bg-subtle p-4">
          <h3 className="mb-3 font-semibold">What tenants will see</h3>
          <CostBreakdownView breakdown={pr.breakdown} chargesOnly={perUnitRent && !sale} />
        </div>
      )}
    </StepCard>
  );
}

/* Step 10 */
/** Room counts of a flat / house → the photo slots to ask for (only rooms that exist). */
type RoomSlot = { category: string; slot: number; label: string };
function roomSlots(u: Unit): RoomSlot[] {
  const sum = (k: "bedrooms" | "bathrooms" | "kitchens" | "livingRooms" | "balconies") => (u.floors?.length ? u.floors.reduce((n, f) => n + (f[k] || 0), 0) : null);
  const bhk = (u.bhkType ?? "").toUpperCase();
  const counts: Array<[string, string, number]> = [
    ["BEDROOM", "Bedroom", sum("bedrooms") ?? u.bedrooms ?? (Number(bhk.match(/^(\d+)/)?.[1]) || 0)],
    ["BATHROOM", "Bathroom", sum("bathrooms") ?? u.bathrooms ?? 0],
    ["LIVING_ROOM", "Living room", sum("livingRooms") ?? u.livingRoomCount ?? (bhk.includes("H") ? 1 : 0)],
    ["KITCHEN", "Kitchen", sum("kitchens") ?? u.kitchenCount ?? (bhk.includes("K") ? 1 : 0)],
    ["BALCONY", "Balcony", sum("balconies") ?? u.balconies ?? 0],
  ];
  return counts.flatMap(([category, name, n]) =>
    Array.from({ length: Math.min(Math.max(0, n), 20) }, (_, i) => ({ category, slot: i + 1, label: n > 1 ? `${name} ${i + 1}` : name })),
  );
}

function RoomPhotos({ p, units, reload, setMsg, askDelete }: { p: PropertyDetail; units: Unit[]; reload: () => Promise<void>; setMsg: StepProps["setMsg"]; askDelete: (imageId: string) => void }) {
  const done = async () => {
    await reload();
    setMsg({ kind: "success", text: "Photo uploaded." });
  };
  const fail = (t: string) => setMsg({ kind: "error", text: t });
  return (
    <div className="space-y-5">
      {units.map((u) => {
        const slots = roomSlots(u);
        const photoFor = (s: RoomSlot) => p.images.filter((i) => i.unitId === u.id && i.category === s.category && i.slot === s.slot && !i.inspectionId);
        const filled = slots.filter((s) => photoFor(s).length > 0).length;
        return (
          <div key={u.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">
                {units.length > 1 ? `${u.name || (u.unitNumber ? `Flat ${u.unitNumber}` : u.code)} · ` : ""}
                {u.bhkType ?? "Rooms"}
              </h4>
              <span className={cn("text-xs font-medium", filled === slots.length ? "text-success" : "text-muted")}>{filled} of {slots.length} rooms added</span>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {slots.map((s) => {
                const photos = photoFor(s);
                const extra = { category: s.category, unitId: u.id, slot: String(s.slot) };
                return (
                  <li key={`${s.category}-${s.slot}`} className="overflow-hidden rounded-control border border-line">
                    {photos[0] ? (
                      <div className="relative">
                        <AuthImage path={imagePath(photos[0].id)} alt={s.label} className="aspect-[4/3] w-full" />
                        <span className="absolute left-2 top-2"><StatusBadge status={photos[0].status} /></span>
                        <button type="button" aria-label={`Delete ${s.label} photo`} onClick={() => askDelete(photos[0].id)} className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-lg bg-surface/90 text-danger">
                          <Trash2 className="size-4" />
                        </button>
                        {photos.length > 1 && <span className="absolute bottom-2 right-2 rounded bg-surface/90 px-1.5 py-0.5 text-xs">+{photos.length - 1}</span>}
                      </div>
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center bg-subtle text-xs text-muted">No photo yet</div>
                    )}
                    <div className="flex items-center justify-between gap-2 p-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <UploadButton path={`/properties/${p.id}/images`} extra={extra} label={photos.length ? "Add more" : "Add photo"} onDone={() => void done()} onError={fail} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function MediaStep({ p, enums, reload, next, setMsg }: StepProps) {
  const [category, setCategory] = useState("FRONT_VIEW");
  const [docType, setDocType] = useState("OWNERSHIP_PROOF");
  const { confirm, dialog } = useConfirm();
  const ok = (t: string) => async () => {
    await reload();
    setMsg({ kind: "success", text: t });
  };
  const fail = (t: string) => setMsg({ kind: "error", text: t });
  // Units whose room counts are filled in get one photo slot per room; everything else is a general photo.
  const roomUnits = p.units.filter((u) => u.activeStatus === "ACTIVE" && roomSlots(u).length > 0);
  const listingImages = p.images.filter((i) => !i.inspectionId && !(i.slot && i.unitId && roomUnits.some((u) => u.id === i.unitId)));
  const askDelete = (imageId: string) =>
    confirm({ title: "Delete photo", message: "This photo will be removed.", tone: "danger", confirmLabel: "Delete", onConfirm: async () => { await request(`/properties/${p.id}/images/${imageId}`, { method: "DELETE" }); await reload(); } });
  return (
    <StepCard title="Photos and documents" description="Photos are reviewed by SafeRent before tenants see them. Documents are private." footer={<Button leftIcon={<ArrowRight className="size-4" />} onClick={next}>Continue</Button>}>
      {roomUnits.length > 0 && (
        <>
          <h3 className="mb-1 font-semibold">Room photos</h3>
          <p className="mb-3 text-sm text-muted">Add one clear photo of each room. The list follows the bedrooms, bathrooms and other rooms you entered.</p>
          <RoomPhotos p={p} units={roomUnits} reload={reload} setMsg={setMsg} askDelete={askDelete} />
          <h3 className="mb-1 mt-8 font-semibold">Other photos</h3>
          <p className="mb-3 text-sm text-muted">Front view, entrance, building, parking and common areas.</p>
        </>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:w-60">
          <Select label="Photo category" options={(enums.imageCategories ?? []).filter((c) => c !== "INSPECTION").map((c) => ({ value: c, label: labelize(c) }))} value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <UploadButton path={`/properties/${p.id}/images`} extra={{ category }} label="Upload photos" onDone={ok("Photos uploaded.")} onError={fail} />
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {listingImages.map((img) => (
          <li key={img.id} className="relative overflow-hidden rounded-control border border-line">
            <AuthImage path={imagePath(img.id)} alt={labelize(img.category)} className="aspect-[4/3] w-full" />
            <span className="absolute left-2 top-2"><StatusBadge status={img.status} /></span>
            <span className="absolute bottom-2 left-2 rounded bg-surface/90 px-1.5 py-0.5 text-xs font-medium">{labelize(img.category)}</span>
            <button type="button" aria-label="Delete photo" onClick={() => askDelete(img.id)} className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-lg bg-surface/90 text-danger">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {listingImages.length === 0 && <li className="text-sm text-muted">No photos yet. Add at least one (three or more improves completeness).</li>}
      </ul>
      <h3 className="mb-2 mt-8 font-semibold">Documents (private)</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:w-60">
          <Select label="Document type" options={(enums.documentTypes ?? []).map((d) => ({ value: d, label: labelize(d) }))} value={docType} onChange={(e) => setDocType(e.target.value)} />
        </div>
        <UploadButton path={`/properties/${p.id}/documents`} field="file" multiple={false} accept="application/pdf,image/jpeg,image/png,image/webp" extra={{ docType }} label="Upload document" icon={<FileUp className="size-4" />} onDone={ok("Document uploaded.")} onError={fail} />
      </div>
      <ul className="mt-3 divide-y divide-line">
        {p.documents.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>{d.originalName} <span className="text-xs text-muted">· {labelize(d.docType)} · {d.code}</span></span>
            <StatusBadge status={d.status} />
          </li>
        ))}
      </ul>
      {dialog}
    </StepCard>
  );
}

/* Step 11 */
function InspectionStep({ p, next, setMsg, reload }: StepProps) {
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const { busy, run } = useSaver({ reload, setMsg });
  return (
    <StepCard title="Property condition and inspection" description="Optional: request a SafeRent verification inspection. Move-in and move-out inspections are recorded per lease from the property page." footer={<Button leftIcon={<ArrowRight className="size-4" />} onClick={next}>Continue</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Preferred date and time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <Textarea label="Condition notes for the inspector" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="mt-3">
        <Button variant="secondary" loading={busy} disabled={!when} onClick={() => void run(() => request(`/properties/${p.id}/inspections`, { method: "POST", body: { type: "VERIFICATION", scheduledAt: new Date(when).toISOString(), notes: notes || undefined } }), "Inspection requested.")}>
          Request inspection
        </Button>
      </div>
    </StepCard>
  );
}

/* Step 12 */
function ReviewStep({ p, reload, setMsg }: StepProps) {
  const navigate = useNavigate();
  const { data, reload: reloadCheck } = useQuery(() => request<{ completeness: PropertyDetail["completeness"]; submissionProblems: string[] }>(`/properties/${p.id}/completeness`), [p.id, p.version]);
  const { busy, run } = useSaver({ reload, setMsg });
  const canSubmit = ["DRAFT", "REJECTED"].includes(p.publicationStatus);
  const submit = async () => {
    const ok = await run(() => request(`/properties/${p.id}/submit`, { method: "POST" }), "Submitted for verification. We'll notify you after review.");
    if (ok) navigate(`/properties/${p.id}`);
    else await reloadCheck();
  };
  return (
    <StepCard title="Review and submit" description="SafeRent verifies the listing before it can be published.">
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <CompletenessMeter score={data.completeness.score} sections={data.completeness.sections} note={data.completeness.note} />
          <div>
            <h3 className="mb-2 font-semibold">Before you submit</h3>
            {data.submissionProblems.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
                {data.submissionProblems.map((x) => <li key={x}>{x}</li>)}
              </ul>
            ) : (
              <Alert kind="success">Everything required is filled in.</Alert>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate(`/properties/${p.id}`)}>Preview</Button>
              {canSubmit && <Button loading={busy} disabled={data.submissionProblems.length > 0} leftIcon={<Send className="size-4" />} onClick={() => void submit()}>Submit for verification</Button>}
            </div>
            {!canSubmit && <p className="mt-3 text-sm text-muted">Status: {labelize(p.publicationStatus)}.</p>}
          </div>
        </div>
      )}
    </StepCard>
  );
}
