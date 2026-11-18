import { unitPriced } from "../properties/types";
import { BadgeCheck, Building2, Flag, MapPin, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { EmptyState, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { LocationSearchBox } from "@/components/data/LocationSearchBox";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ListingPhoto } from "@/components/ui/ListingPhoto";
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
import { savePendingReturn } from "@/routes/pendingReturn";
import { PATHS } from "@/utils/constants";
import { rentRange, type CostBreakdown, type Disclosure, type PublicListing } from "../properties/types";

const TYPES = ["APARTMENT", "INDEPENDENT_BUILDING", "VILLA", "INDIVIDUAL_HOUSE", "DUPLEX_HOUSE", "PG", "HOSTEL", "FARMHOUSE", "OFFICE_SPACE", "SHOP", "SHOWROOM", "WAREHOUSE", "INDUSTRIAL_PROPERTY", "COWORKING_SPACE", "COMMERCIAL_COMPLEX", "RESIDENTIAL_PLOT", "COMMERCIAL_PLOT", "AGRICULTURAL_LAND", "INDUSTRIAL_LAND"];

/** "app" = signed-in tenants (/browse); "public" = the website, no login (/homes). */
type BrowseMode = "app" | "public";

/**
 * PUBLISHED, ACTIVE listings only. Owner identity and contact details are never shown here.
 * The public website uses the same search through /public/listings (no login).
 */
export function BrowsePage({ mode = "app" }: { mode?: BrowseMode }) {
  const navigate = useNavigate();
  const isPublic = mode === "public";
  const base = isPublic ? PATHS.homes : "/browse";
  const list = useListParams(["city", "locality", "state", "category", "propertyType", "listingType", "furnishing", "bedrooms", "maxRent", "sort"]);
  // The place picked from the suggestions (shown in the search box), else the free-text search.
  const place = [list.filters.locality, list.filters.city || (!list.filters.locality ? list.filters.state : "")].filter(Boolean).join(", ");
  const { data, loading, error } = useQuery(
    () => request<Paged<PublicListing>>(isPublic ? "/public/listings" : "/browse", { auth: !isPublic, query: { ...list.query, pageSize: 12 } }),
    [list.query, isPublic],
  );

  return (
    <>
      <PageHeader title={isPublic ? "Homes for rent" : "Find a property"} description="Published listings verified by SafeRent, with every charge disclosed upfront." />
      <ListToolbar
        searchSlot={
          <LocationSearchBox
            isPublic={isPublic}
            value={place || list.q}
            placeholder="Search city, area, PIN or SafeRent ID"
            onSelect={(s) => list.update({ q: undefined, city: s.filters.city ?? undefined, locality: s.filters.locality, state: s.filters.state })}
            onSubmit={(text) => list.update({ q: text || undefined, city: undefined, locality: undefined, state: undefined })}
          />
        }
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
              <ListingCard listing={p} isPublic={isPublic} onOpen={() => navigate(`${base}/${p.id}`)} />
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
    </>
  );
}

/** Listing summary card (app search, public search and the home page). */
export function ListingCard({ listing: p, isPublic, onOpen }: { listing: PublicListing; isPublic: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="card group block w-full overflow-hidden text-left transition-shadow hover:shadow-lg">
      {p.coverImageId ? (
        <ListingPhoto isPublic={isPublic} imageId={p.coverImageId} alt={p.title ?? p.code} className="aspect-[16/10] w-full" />
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
  /** The flat's own amenities (the building's common ones are on the listing). */
  amenities?: Array<{ key: string; label: string; status: Disclosure }>;
  /** Approved photos of this flat. */
  imageIds?: string[];
}

interface PublicDetail {
  propertyType?: string;
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
  rooms: Array<{ id: string; code: string; roomNumber: string; sharingType: string; attachedBathroom: Disclosure; acAvailable: Disclosure; rentPerBed: string | null; securityDeposit: string | null; availableBeds: number; totalBeds: number; beds: Array<{ id: string; bedNumber: string; rent: string | null; availabilityStatus: string }>; imageIds?: string[]; amenities?: Array<{ key: string; label: string; status: Disclosure }>; pricing?: { breakdown?: CostBreakdown } | null }>;
  utilities: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
  amenities: Array<{ key: string; label: string; status: Disclosure }>;
  pricing: { breakdown?: CostBreakdown } | null;
  images: Array<{ id: string; category: string; unitId?: string | null }>;
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
];

export function ListingPage({ mode = "app" }: { mode?: BrowseMode }) {
  const { id = "" } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const isPublic = mode === "public";
  // ?preview=1 — owner / staff see the listing exactly as tenants do, without tenant actions.
  const preview = search.get("preview") === "1";
  // Website visitors get no in-page actions: they sign in (or open the app view) to apply or ask.
  const can = (...args: Parameters<typeof auth.can>) => !preview && !isPublic && auth.can(...args);
  const { data, loading, error, reload } = useQuery(
    () =>
      isPublic
        ? request<{ property: PublicDetail }>(`/public/listings/${id}`, { auth: false }).then((r) => ({ ...r, myApplications: [] as Array<{ id: string; status: string; unitId: string | null; bedId: string | null }> }))
        : request<{ property: PublicDetail; myApplications: Array<{ id: string; status: string; unitId: string | null; bedId: string | null }> }>(`/browse/${id}`),
    [id, isPublic],
  );
  const signedInCustomer = auth.status === "authenticated" && !auth.activeRole?.isStaff;
  /** Website → the full listing in the app (apply, ask a question); signs in first when needed. */
  const continueInApp = () => {
    const target = `/browse/${id}`;
    if (signedInCustomer) {
      navigate(target);
      return;
    }
    savePendingReturn(target);
    navigate(PATHS.login);
  };
  const [apply, setApply] = useState<{ unitId?: string; bedId?: string; label: string } | null>(null);
  const [modal, setModal] = useState<"enquire" | "report" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);
  // ?unitId= (App Link / share link) preselects that flat / unit.
  const [chosenFlat, setChosenFlat] = useState<string | null>(() => search.get("unitId"));

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Listing not found."}</Alert>;
  const p = data.property;
  // Apartments: the building (common details, amenities, photos) + flats chosen one at a time.
  // Building → units (apartment flats, portions, shops, community villas): choose one unit at a time.
  const flatMode = unitPriced({ propertyType: p.propertyType ?? "", building: p.building }) && p.units.length > 0;
  const unitWord = UNIT_WORDS[p.propertyType ?? ""] ?? "Unit";
  const flat = flatMode ? (p.units.find((u) => u.id === chosenFlat) ?? p.units.find((u) => u.availabilityStatus === "AVAILABLE") ?? p.units[0]) : null;
  const buildingImages = p.images.filter((i) => !i.unitId);
  const gallery = flat ? [...p.images.filter((i) => flat.imageIds?.includes(i.id)), ...buildingImages] : p.images;
  const chooseFlat = (unitId: string) => {
    setChosenFlat(unitId);
    setPhoto(0);
  };
  const previewBanner = preview ? <Alert kind="info" className="mb-4">Preview — this is how tenants see this listing. Apply and enquiry buttons are hidden here.</Alert> : null;
  const pending = (unitId?: string | null, bedId?: string | null) => data.myApplications.find((a) => ["PENDING", "APPROVED"].includes(a.status) && a.unitId === (unitId ?? null) && a.bedId === (bedId ?? null));
  const canApply = can("applications.create");

  return (
    <>
      <Link to={preview ? `/properties/${id}` : isPublic ? PATHS.homes : "/browse"} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">{preview ? "← Back to property" : "← Back to search"}</Link>
      {previewBanner}
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {gallery.length ? (
            <>
              <ListingPhoto isPublic={isPublic} imageId={gallery[Math.min(photo, gallery.length - 1)].id} alt={p.title ?? p.code} className="aspect-[16/10] w-full rounded-card" />
              {gallery.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((img, i) => (
                    <button key={img.id} type="button" onClick={() => setPhoto(i)} aria-label={`${labelize(img.category)} photo`} className={i === photo ? "rounded-lg ring-2 ring-brand" : "rounded-lg"}>
                      <ListingPhoto isPublic={isPublic} imageId={img.id} alt="" className="h-16 w-24 rounded-lg" />
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

          {flatMode && flat && (
            <FlatSection
              flats={p.units}
              flat={flat}
              onChoose={chooseFlat}
              mine={pending(flat.id, null)}
              canApply={canApply}
              word={unitWord}
              onApply={() => setApply({ unitId: flat.id, label: flat.unitNumber ? `${unitWord} ${flat.unitNumber}` : flat.code })}
            />
          )}

          {!flatMode && p.units.length > 0 && (
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
                    {(r.imageIds ?? []).length > 0 && (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                        {r.imageIds!.map((imgId) => <ListingPhoto key={imgId} isPublic={isPublic} imageId={imgId} alt={`Room ${r.roomNumber}`} className="h-20 w-28 shrink-0 rounded-lg" />)}
                      </div>
                    )}
                    {(r.amenities ?? []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.amenities!.map((a) => <Badge key={a.key} tone={a.status === "YES" ? "success" : a.status === "NOT_DISCLOSED" ? "warning" : "neutral"}>{a.label}{a.status !== "YES" ? `: ${labelize(a.status)}` : ""}</Badge>)}
                      </div>
                    )}
                    {r.pricing?.breakdown && r.rentPerBed && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-brand-dark">What a bed in this room costs</summary>
                        <div className="mt-2"><CostBreakdownView breakdown={r.pricing.breakdown} /></div>
                      </details>
                    )}
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
            <Facts items={POLICY_FIELDS.filter(([k]) => k !== "cookingAllowed" || p.structure === "ROOMS_BEDS").map(([k, l]) => [l, <ValueText key={k} value={p.policy?.[k] ?? "NOT_DISCLOSED"} />])} />
            {Array.isArray(p.policy?.additionalRules) && (p.policy.additionalRules as Array<{ title: string; description: string }>).length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm">{(p.policy.additionalRules as Array<{ title: string; description: string }>).map((r) => <li key={r.title}><span className="font-medium">{r.title}</span>{r.description ? ` — ${r.description}` : ""}</li>)}</ul>
            )}
          </section>
          {p.amenities.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">{flatMode ? `Building amenities (common to all ${unitWord.toLowerCase()}s)` : p.rooms.length ? "Common amenities (whole PG)" : "Amenities"}</h2>
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
              {isPublic && (
                <>
                  <Button leftIcon={<Send className="size-4" />} onClick={continueInApp}>{signedInCustomer ? "Apply or ask a question" : "Sign in to apply"}</Button>
                  {!signedInCustomer && <p className="text-center text-xs text-muted">Sign in with your mobile number — new here? Your account is created in a minute.</p>}
                </>
              )}
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

const UNIT_WORDS: Record<string, string> = { APARTMENT: "Flat", INDEPENDENT_BUILDING: "Portion", COMMERCIAL_COMPLEX: "Shop", VILLA: "Villa" };

/** Apartments: pick a flat; its details, price and amenities are shown (with the building's common ones below). */
function FlatSection({
  flats,
  flat,
  onChoose,
  mine,
  canApply,
  onApply,
  word,
}: {
  word: string;
  flats: PublicUnit[];
  flat: PublicUnit;
  onChoose: (id: string) => void;
  mine: { status: string } | undefined;
  canApply: boolean;
  onApply: () => void;
}) {
  const label = (u: PublicUnit) => u.name ?? (u.unitNumber ? `${word} ${u.unitNumber}` : u.code);
  const words = `${word.toLowerCase()}${flats.length === 1 ? "" : "s"}`;
  const rentOf = (u: PublicUnit) => (u.pricing as { monthlyRent?: string | null } | null)?.monthlyRent ?? null;
  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Choose a {word.toLowerCase()}</h2>
      <p className="mb-3 text-sm text-muted">{flats.length} {words} here — each with its own rent and details.</p>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={`${word}s`}>
        {flats.map((u) => {
          const active = u.id === flat.id;
          const rent = rentOf(u);
          return (
            <button
              key={u.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChoose(u.id)}
              className={`min-w-[9.5rem] shrink-0 rounded-control border px-3 py-2 text-left transition ${active ? "border-brand bg-brand-bg" : "border-line hover:border-brand-light"}`}
            >
              <span className="block text-sm font-semibold">{label(u)}</span>
              <span className="block text-xs text-muted">{[u.bhkType, u.floorNumber !== null && `Floor ${u.floorNumber}`].filter(Boolean).join(" · ") || " "}</span>
              <span className="mt-1 block text-sm font-semibold text-brand-dark">{rent ? formatMoney(rent) : "Rent not disclosed"}</span>
              <span className="mt-1 block"><StatusBadge status={u.availabilityStatus} /></span>
            </button>
          );
        })}
      </div>

      <div className="rounded-control border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-semibold">{label(flat)} {flat.bhkType && <span className="font-normal text-muted">· {flat.bhkType}</span>}</p>
          <StatusBadge status={flat.availabilityStatus} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {[flat.bedrooms !== null && `${flat.bedrooms} bed`, flat.bathrooms !== null && `${flat.bathrooms} bath`, flat.builtUpArea && `${Number(flat.builtUpArea)} sq ft`, labelize(flat.furnishing), flat.floorNumber !== null && `Floor ${flat.floorNumber}`, flat.availableFrom && `available from ${formatDate(flat.availableFrom)}`].filter(Boolean).join(" · ")}
        </p>
        {flat.pricing?.breakdown ? (
          <div className="mt-3">
            <h3 className="mb-2 text-sm font-semibold">What this {word.toLowerCase()} costs</h3>
            <CostBreakdownView breakdown={flat.pricing.breakdown} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-warning">Rent not disclosed for this {word.toLowerCase()}.</p>
        )}
        {(flat.amenities ?? []).length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">In this {word.toLowerCase()}</h3>
            <div className="flex flex-wrap gap-2">
              {flat.amenities!.map((a) => <Badge key={a.key} tone={a.status === "YES" ? "success" : a.status === "NOT_DISCLOSED" ? "warning" : "neutral"}>{a.label}{a.status !== "YES" ? `: ${labelize(a.status)}` : ""}</Badge>)}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {mine && <span className="text-sm">Your application: <StatusBadge status={mine.status} /></span>}
          {canApply && !mine && flat.availabilityStatus === "AVAILABLE" && <Button leftIcon={<Send className="size-4" />} onClick={onApply}>Apply for {label(flat)}</Button>}
        </div>
      </div>
    </section>
  );
}
