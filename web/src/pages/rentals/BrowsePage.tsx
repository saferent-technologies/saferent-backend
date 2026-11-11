import { BadgeCheck, Building2, Flag, MapPin, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { EmptyState, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { errorMessage } from "@/utils/errors";
import { formatDate, formatMoney, labelize, toOptions } from "@/utils/format";
import { CompletenessMeter, CostBreakdownView, Facts, ValueText } from "../properties/components";
import { imagePath, rentRange, type CostBreakdown, type Disclosure, type PublicListing } from "../properties/types";

const TYPES = ["APARTMENT", "VILLA", "INDIVIDUAL_HOUSE", "DUPLEX_HOUSE", "PG", "HOSTEL", "FARMHOUSE", "OFFICE_SPACE", "SHOP", "SHOWROOM", "WAREHOUSE", "INDUSTRIAL_PROPERTY", "COWORKING_SPACE", "RESIDENTIAL_PLOT", "COMMERCIAL_PLOT", "AGRICULTURAL_LAND", "INDUSTRIAL_LAND"];

/** Tenants see PUBLISHED, ACTIVE listings only. Owner identity and contact details are never shown here. */
export function BrowsePage() {
  const navigate = useNavigate();
  const list = useListParams(["city", "category", "propertyType", "listingType", "furnishing", "bedrooms", "maxRent", "sort"]);
  const { data, loading, error } = useQuery(() => request<Paged<PublicListing>>("/browse", { query: { ...list.query, pageSize: 12 } }), [list.query]);

  return (
    <>
      <PageHeader title="Find a property" description="Published listings verified by SafeRent, with every charge disclosed upfront." />
      <ListToolbar
        search={list.q}
        onSearch={list.setSearch}
        placeholder="Search by area, city, PIN or SafeRent ID"
        filters={[
          { name: "category", label: "Category", options: toOptions(["RESIDENTIAL", "COMMERCIAL", "LAND"]) },
          { name: "propertyType", label: "Type", options: toOptions(TYPES) },
          { name: "bedrooms", label: "Bedrooms", options: ["1", "2", "3", "4"].map((b) => ({ value: b, label: `${b}+ bedrooms` })) },
          { name: "furnishing", label: "Furnishing", options: toOptions(["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"]) },
          { name: "maxRent", label: "Budget", options: ["10000", "20000", "35000", "50000", "100000"].map((v) => ({ value: v, label: `Up to ${formatMoney(v)}` })) },
          { name: "sort", label: "Sort", options: [{ value: "rent_asc", label: "Rent: low to high" }, { value: "rent_desc", label: "Rent: high to low" }, { value: "completeness", label: "Most transparent" }] },
        ]}
        values={list.filters}
        onFilter={list.setFilter}
      />
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>
      ) : data?.items.length === 0 ? (
        <EmptyState text="Nothing available matches your search. Try a different area or budget." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => navigate(`/browse/${p.id}`)} className="card group block w-full overflow-hidden text-left transition-shadow hover:shadow-lg">
                {p.coverImageId ? (
                  <AuthImage path={imagePath(p.coverImageId)} alt={p.title ?? p.code} className="aspect-[16/10] w-full" />
                ) : (
                  <div className="flex aspect-[16/10] items-center justify-center bg-brand-bg text-brand"><Building2 className="size-10" /></div>
                )}
                <div className="space-y-1.5 p-4">
                  <p className="text-lg font-bold text-ink">{rentRange(p.rentFrom, p.rentTo, formatMoney)}{p.rentFrom && <span className="text-sm font-normal text-muted">/month</span>}</p>
                  <p className="truncate font-semibold text-ink group-hover:text-brand-dark">{p.title}</p>
                  <p className="flex items-center gap-1 truncate text-sm text-muted"><MapPin className="size-4 shrink-0" />{[p.locality, p.city].filter(Boolean).join(", ")}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge>{p.propertyTypeLabel}</Badge>
                    <Badge tone="success">{p.availableCount} available</Badge>
                    <Badge>{p.completenessScore}% disclosed</Badge>
                    {p.verificationStatus === "VERIFIED" && <Badge tone="success"><BadgeCheck className="size-3.5" />Verified</Badge>}
                    {p.ownerVerified && <Badge tone="success"><BadgeCheck className="size-3.5" />Owner verified</Badge>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
    </>
  );
}

interface PublicUnit {
  id: string;
  code: string;
  name: string | null;
  unitNumber: string | null;
  floorNumber: number | null;
  bhkType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  builtUpArea: string | null;
  furnishing: string;
  configuration: string | null;
  availableFrom: string | null;
  availabilityStatus: string;
  attributes: Record<string, unknown>;
  pricing: { breakdown?: CostBreakdown } | null;
}

interface PublicDetail {
  id: string;
  code: string;
  title: string | null;
  description: string | null;
  propertyTypeLabel: string;
  structure: string | null;
  listingType: string;
  locality: string | null;
  city: string | null;
  state: string | null;
  verificationStatus: string;
  ownerVerified?: boolean;
  completeness: { score: number; note: string; missing: string[] };
  rentFrom: string | null;
  rentTo: string | null;
  building: Record<string, unknown>;
  units: PublicUnit[];
  rooms: Array<{ id: string; code: string; roomNumber: string; sharingType: string; attachedBathroom: Disclosure; acAvailable: Disclosure; rentPerBed: string | null; securityDeposit: string | null; availableBeds: number; totalBeds: number; beds: Array<{ id: string; bedNumber: string; rent: string | null; availabilityStatus: string }> }>;
  utilities: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
  amenities: Array<{ key: string; label: string; status: Disclosure }>;
  pricing: { breakdown?: CostBreakdown } | null;
  images: Array<{ id: string; category: string }>;
}

const DISCLOSED_FIELDS: Array<[string, string]> = [
  ["separateElectricityMeter", "Separate electricity meter"],
  ["separateWaterMeter", "Separate water meter"],
  ["gasConnectionType", "Gas"],
  ["internetAvailable", "Internet"],
  ["powerBackup", "Power backup"],
];
const POLICY_FIELDS: Array<[string, string]> = [
  ["guestsAllowed", "Guests"],
  ["overnightGuestsAllowed", "Overnight guests"],
  ["petsAllowed", "Pets"],
  ["smokingAllowed", "Smoking"],
  ["partiesAllowed", "Parties"],
  ["cookingAllowed", "Cooking"],
  ["sublettingAllowed", "Subletting"],
  ["workFromHomeAllowed", "Work from home"],
];

export function ListingPage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const [search] = useSearchParams();
  // ?preview=1 — owner / staff see the listing exactly as tenants do, without tenant actions.
  const preview = search.get("preview") === "1";
  const can = (...args: Parameters<typeof auth.can>) => !preview && auth.can(...args);
  const { data, loading, error, reload } = useQuery(() => request<{ property: PublicDetail; myApplications: Array<{ id: string; status: string; unitId: string | null; bedId: string | null }> }>(`/browse/${id}`), [id]);
  const [apply, setApply] = useState<{ unitId?: string; bedId?: string; label: string } | null>(null);
  const [modal, setModal] = useState<"enquire" | "report" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Listing not found."}</Alert>;
  const p = data.property;
  const previewBanner = preview ? <Alert kind="info" className="mb-4">Preview — this is how tenants see this listing. Apply and enquiry buttons are hidden here.</Alert> : null;
  const pending = (unitId?: string | null, bedId?: string | null) => data.myApplications.find((a) => ["PENDING", "APPROVED"].includes(a.status) && a.unitId === (unitId ?? null) && a.bedId === (bedId ?? null));
  const canApply = can("applications.create") && p.listingType !== "SALE";

  return (
    <>
      <Link to={preview ? `/properties/${id}` : "/browse"} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">{preview ? "← Back to property" : "← Back to search"}</Link>
      {previewBanner}
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {p.images.length ? (
            <>
              <AuthImage path={imagePath(p.images[Math.min(photo, p.images.length - 1)].id)} alt={p.title ?? p.code} className="aspect-[16/10] w-full rounded-card" />
              {p.images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {p.images.map((img, i) => (
                    <button key={img.id} type="button" onClick={() => setPhoto(i)} aria-label={`${labelize(img.category)} photo`} className={i === photo ? "rounded-lg ring-2 ring-brand" : "rounded-lg"}>
                      <AuthImage path={imagePath(img.id)} alt="" className="h-16 w-24 rounded-lg" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-card bg-brand-bg text-brand"><Building2 className="size-14" /></div>
          )}
          <section className="card p-5">
            <h2 className="mb-2 font-semibold">About</h2>
            <p className="whitespace-pre-line text-sm text-ink-2">{p.description}</p>
          </section>

          {p.units.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Available units</h2>
              <ul className="space-y-3">
                {p.units.map((u) => {
                  const mine = pending(u.id, null);
                  return (
                    <li key={u.id} className="rounded-control border border-line p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{u.name ?? (u.unitNumber ? `#${u.unitNumber}` : u.code)} {u.bhkType && <span className="font-normal text-muted">· {u.bhkType}</span>}{u.configuration && <span className="font-normal text-muted"> · {u.configuration}</span>}</p>
                        <StatusBadge status={u.availabilityStatus} />
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {[u.bedrooms !== null && `${u.bedrooms} bed`, u.bathrooms !== null && `${u.bathrooms} bath`, u.builtUpArea && `${Number(u.builtUpArea)} sq ft`, labelize(u.furnishing), u.floorNumber !== null && `Floor ${u.floorNumber}`, u.availableFrom && `from ${formatDate(u.availableFrom)}`].filter(Boolean).join(" · ")}
                      </p>
                      {u.pricing?.breakdown && <div className="mt-3"><CostBreakdownView breakdown={u.pricing.breakdown} /></div>}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {mine && <span className="text-sm">Your application: <StatusBadge status={mine.status} /></span>}
                        {canApply && !mine && u.availabilityStatus === "AVAILABLE" && <Button size="sm" leftIcon={<Send className="size-4" />} onClick={() => setApply({ unitId: u.id, label: u.unitNumber ?? u.code })}>Apply for this unit</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {p.rooms.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Rooms and beds</h2>
              <ul className="space-y-3">
                {p.rooms.map((r) => (
                  <li key={r.id} className="rounded-control border border-line p-4">
                    <p className="font-semibold">Room {r.roomNumber} <span className="font-normal text-muted">· {labelize(r.sharingType)} · {r.availableBeds}/{r.totalBeds} beds available</span></p>
                    <p className="mt-1 text-sm">Rent per bed: <span className="font-semibold">{r.rentPerBed ? formatMoney(r.rentPerBed) : "Not disclosed"}</span> · Deposit: {r.securityDeposit ? formatMoney(r.securityDeposit) : <span className="text-warning">Not disclosed</span>} · Attached bathroom: <ValueText value={r.attachedBathroom} /> · AC: <ValueText value={r.acAvailable} /></p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {r.beds.map((b) => {
                        const mine = pending(null, b.id);
                        return (
                          <li key={b.id} className="flex items-center gap-2 rounded-control bg-subtle px-3 py-1.5 text-sm">
                            {b.bedNumber} <StatusBadge status={mine ? mine.status : b.availabilityStatus} />
                            {canApply && !mine && b.availabilityStatus === "AVAILABLE" && <Button size="sm" variant="ghost" onClick={() => setApply({ bedId: b.id, label: `Room ${r.roomNumber}, bed ${b.bedNumber}` })}>Apply</Button>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Utilities</h2>
            <Facts items={DISCLOSED_FIELDS.map(([k, l]) => [l, <ValueText key={k} value={p.utilities?.[k] ?? "NOT_DISCLOSED"} />])} />
          </section>
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">House rules</h2>
            <Facts items={POLICY_FIELDS.map(([k, l]) => [l, <ValueText key={k} value={p.policy?.[k] ?? "NOT_DISCLOSED"} />])} />
            {Array.isArray(p.policy?.additionalRules) && (p.policy.additionalRules as Array<{ title: string; description: string }>).length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm">{(p.policy.additionalRules as Array<{ title: string; description: string }>).map((r) => <li key={r.title}><span className="font-medium">{r.title}</span>{r.description ? ` — ${r.description}` : ""}</li>)}</ul>
            )}
          </section>
          {p.amenities.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Amenities</h2>
              <div className="flex flex-wrap gap-2">{p.amenities.map((a) => <Badge key={a.key} tone={a.status === "YES" ? "success" : a.status === "NOT_DISCLOSED" ? "warning" : "neutral"}>{a.label}{a.status !== "YES" ? `: ${labelize(a.status)}` : ""}</Badge>)}</div>
            </section>
          )}
        </div>
        <aside className="space-y-4 lg:col-span-2">
          <section className="card space-y-3 p-5">
            <h1 className="text-xl font-bold text-ink">{p.title}</h1>
            <p className="flex items-center gap-1 text-sm text-muted"><MapPin className="size-4" />{[p.locality, p.city, p.state].filter(Boolean).join(", ")}</p>
            <p className="text-2xl font-bold text-brand-dark">{rentRange(p.rentFrom, p.rentTo, formatMoney)}{p.rentFrom && <span className="text-sm font-normal text-muted">/month</span>}</p>
            <div className="flex flex-wrap gap-2">
              <Badge>{p.propertyTypeLabel}</Badge>
              <Badge>{p.code}</Badge>
              {p.verificationStatus === "VERIFIED" ? <Badge tone="success"><BadgeCheck className="size-3.5" />Verified by SafeRent</Badge> : <Badge tone="warning">Not verified</Badge>}
              {p.ownerVerified ? <Badge tone="success"><BadgeCheck className="size-3.5" />Owner verified</Badge> : <Badge tone="warning">Owner not verified</Badge>}
            </div>
            <div className="grid gap-2 pt-2">
              {can("enquiries.create") && <Button variant="secondary" leftIcon={<MessageSquare className="size-4" />} onClick={() => setModal("enquire")}>Ask a question</Button>}
              {can("fraud.report") && <Button variant="ghost" leftIcon={<Flag className="size-4" />} onClick={() => setModal("report")}>Report this listing</Button>}
            </div>
          </section>
          {p.pricing?.breakdown && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Costs</h2>
              <CostBreakdownView breakdown={p.pricing.breakdown} />
            </section>
          )}
          <section className="card p-5">
            <CompletenessMeter score={p.completeness.score} note={p.completeness.note} compact />
            {p.completeness.missing.length > 0 && <p className="mt-2 text-xs text-muted">Not disclosed yet: {p.completeness.missing.slice(0, 8).join(", ")}{p.completeness.missing.length > 8 ? "…" : ""}</p>}
          </section>
        </aside>
      </div>
      <ApplyModal open={!!apply} propertyId={p.id} target={apply} onClose={() => setApply(null)} onDone={async () => { setMsg("Application sent! The landlord will review it."); setApply(null); await reload(); }} />
      <TextModal open={modal === "enquire"} title="Ask a question" label="Your message" path={`/browse/${p.id}/enquire`} build={(t) => ({ message: t })} onClose={() => setModal(null)} onDone={() => { setMsg("Message sent. You'll hear back soon."); setModal(null); }} />
      <ReportModal open={modal === "report"} propertyId={p.id} onClose={() => setModal(null)} onDone={() => { setMsg("Thanks — our moderators will review this listing."); setModal(null); }} />
    </>
  );
}

function ApplyModal({ open, propertyId, target, onClose, onDone }: { open: boolean; propertyId: string; target: { unitId?: string; bedId?: string; label: string } | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [moveIn, setMoveIn] = useState("");
  const [occupants, setOccupants] = useState("1");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request(`/browse/${propertyId}/apply`, { method: "POST", body: { unitId: target?.unitId, bedId: target?.bedId, proposedMoveIn: moveIn, occupants: Number(occupants), message: message || undefined } });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Apply to rent${target ? ` · ${target.label}` : ""}`} description="Your name and tenant profile are shared with the landlord. Your phone number is shared only if your application is approved.">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <Input label="Preferred move-in date" type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
        <Input label="Number of occupants" type="number" min={1} max={20} value={occupants} onChange={(e) => setOccupants(e.target.value)} />
        <Textarea label="Message to landlord (optional)" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!moveIn} onClick={() => void submit()}>Send application</Button>
        </div>
      </div>
    </Modal>
  );
}

function TextModal({ open, title, label, path, build, onClose, onDone }: { open: boolean; title: string; label: string; path: string; build: (text: string) => unknown; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request(path, { method: "POST", body: build(text) });
      setText("");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <Textarea label={label} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={text.trim().length < 5} onClick={() => void submit()}>Send</Button>
        </div>
      </div>
    </Modal>
  );
}

const FRAUD_REASONS = ["FAKE_LISTING", "WRONG_PRICE", "SCAM_REQUEST", "DUPLICATE", "INAPPROPRIATE", "OTHER"];

function ReportModal({ open, propertyId, onClose, onDone }: { open: boolean; propertyId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("FAKE_LISTING");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("/fraud-reports", { method: "POST", body: { propertyId, reason, details } });
      setDetails("");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Report this listing" description="Reports are confidential and reviewed by SafeRent moderators.">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <Select label="Reason" options={toOptions(FRAUD_REASONS)} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Textarea label="Details" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={3000} placeholder="e.g. The owner asked for an advance payment outside SafeRent." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={details.trim().length < 10} onClick={() => void submit()}>Send report</Button>
        </div>
      </div>
    </Modal>
  );
}
