import { BadgeCheck, BedDouble, Building2, Flag, MapPin, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
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
import { FURNISHING, imagePath, PROPERTY_TYPES, type PublicListing } from "../properties/types";

/** Tenants browse ACTIVE listings only. Owner contact details are never shown here. */
export function BrowsePage() {
  const navigate = useNavigate();
  const list = useListParams(["city", "type", "furnishing", "bedrooms", "maxRent", "sort"]);
  const { data, loading, error } = useQuery(() => request<Paged<PublicListing>>("/browse", { query: { ...list.query, pageSize: 12 } }), [list.query]);

  return (
    <>
      <PageHeader title="Find a home" description="Verified rental properties on SafeRent." />
      <ListToolbar
        search={list.q}
        onSearch={list.setSearch}
        placeholder="Search by area, city or title"
        filters={[
          { name: "type", label: "Type", options: toOptions(PROPERTY_TYPES) },
          { name: "bedrooms", label: "Bedrooms", options: ["1", "2", "3", "4"].map((b) => ({ value: b, label: `${b}+ BHK` })) },
          { name: "furnishing", label: "Furnishing", options: toOptions(FURNISHING) },
          { name: "maxRent", label: "Budget", options: ["10000", "20000", "35000", "50000", "100000"].map((v) => ({ value: v, label: `Up to ${formatMoney(v)}` })) },
          { name: "sort", label: "Sort", options: [{ value: "rent_asc", label: "Rent: low to high" }, { value: "rent_desc", label: "Rent: high to low" }] },
        ]}
        values={list.filters}
        onFilter={list.setFilter}
      />
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>
      ) : data?.items.length === 0 ? (
        <EmptyState text="No homes match your search. Try a different area or budget." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => navigate(`/browse/${p.id}`)} className="card group block w-full overflow-hidden text-left transition-shadow hover:shadow-lg">
                {p.images[0] ? (
                  <AuthImage path={imagePath(p.images[0].id)} alt={p.title} className="aspect-[16/10] w-full" />
                ) : (
                  <div className="flex aspect-[16/10] items-center justify-center bg-brand-bg text-brand"><Building2 className="size-10" /></div>
                )}
                <div className="space-y-1.5 p-4">
                  <p className="text-lg font-bold text-ink">{formatMoney(p.monthlyRent)}<span className="text-sm font-normal text-muted">/month</span></p>
                  <p className="truncate font-semibold text-ink group-hover:text-brand-dark">{p.title}</p>
                  <p className="flex items-center gap-1 truncate text-sm text-muted"><MapPin className="size-4 shrink-0" />{[p.locality, p.city].filter(Boolean).join(", ")}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge><BedDouble className="size-3.5" />{p.bedrooms} BHK</Badge>
                    <Badge>{labelize(p.furnishing)}</Badge>
                    {p.verified && <Badge tone="success"><BadgeCheck className="size-3.5" />Verified</Badge>}
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

export function ListingPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const { data, loading, error, reload } = useQuery(() => request<{ property: PublicListing; myApplication: { id: string; status: string } | null }>(`/browse/${id}`), [id]);
  const [modal, setModal] = useState<"apply" | "enquire" | "report" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "Listing not found."}</Alert>;
  const p = data.property;
  const applied = data.myApplication && ["PENDING", "APPROVED"].includes(data.myApplication.status);

  return (
    <>
      <Link to="/browse" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">← Back to search</Link>
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          {p.images.length ? (
            <>
              <AuthImage path={imagePath(p.images[photo].id)} alt={p.title} className="aspect-[16/10] w-full rounded-card" />
              {p.images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {p.images.map((img, i) => (
                    <button key={img.id} type="button" onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1}`} className={i === photo ? "ring-2 ring-brand rounded-lg" : "rounded-lg"}>
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
            <h2 className="mb-2 font-semibold">About this home</h2>
            <p className="whitespace-pre-line text-sm text-ink-2">{p.description}</p>
          </section>
        </div>
        <aside className="space-y-4 lg:col-span-2">
          <section className="card space-y-3 p-5">
            <h1 className="text-xl font-bold text-ink">{p.title}</h1>
            <p className="flex items-center gap-1 text-sm text-muted"><MapPin className="size-4" />{[p.locality, p.city, p.state].filter(Boolean).join(", ")}</p>
            <p className="text-2xl font-bold text-brand-dark">{formatMoney(p.monthlyRent)}<span className="text-sm font-normal text-muted">/month</span></p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted">Deposit</dt><dd className="font-medium">{formatMoney(p.securityDeposit)}</dd></div>
              <div><dt className="text-muted">Type</dt><dd className="font-medium">{labelize(p.propertyType)}</dd></div>
              <div><dt className="text-muted">Bedrooms</dt><dd className="font-medium">{p.bedrooms}</dd></div>
              <div><dt className="text-muted">Bathrooms</dt><dd className="font-medium">{p.bathrooms}</dd></div>
              <div><dt className="text-muted">Furnishing</dt><dd className="font-medium">{labelize(p.furnishing)}</dd></div>
              <div><dt className="text-muted">Available</dt><dd className="font-medium">{formatDate(p.availableFrom, "Now")}</dd></div>
            </dl>
            {data.myApplication && <p className="flex items-center gap-2 text-sm">Your application: <StatusBadge status={data.myApplication.status} /></p>}
            <div className="grid gap-2 pt-2">
              {can("applications.create") && !applied && <Button size="lg" leftIcon={<Send className="size-4" />} onClick={() => setModal("apply")}>Apply to rent</Button>}
              {can("enquiries.create") && <Button variant="secondary" leftIcon={<MessageSquare className="size-4" />} onClick={() => setModal("enquire")}>Ask a question</Button>}
              {can("fraud.report") && <Button variant="ghost" leftIcon={<Flag className="size-4" />} onClick={() => setModal("report")}>Report this listing</Button>}
            </div>
          </section>
        </aside>
      </div>
      <ApplyModal open={modal === "apply"} propertyId={p.id} onClose={() => setModal(null)} onDone={async () => { setMsg("Application sent! The landlord will review it."); setModal(null); await reload(); }} />
      <TextModal open={modal === "enquire"} title="Ask a question" label="Your message" path={`/browse/${p.id}/enquire`} build={(t) => ({ message: t })} onClose={() => setModal(null)} onDone={() => { setMsg("Message sent. You'll hear back soon."); setModal(null); }} />
      <ReportModal open={modal === "report"} propertyId={p.id} onClose={() => setModal(null)} onDone={() => { setMsg("Thanks — our moderators will review this listing."); setModal(null); }} />
    </>
  );
}

function ApplyModal({ open, propertyId, onClose, onDone }: { open: boolean; propertyId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [moveIn, setMoveIn] = useState("");
  const [occupants, setOccupants] = useState("1");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await request(`/browse/${propertyId}/apply`, { method: "POST", body: { proposedMoveIn: moveIn, occupants: Number(occupants), message: message || undefined } });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Apply to rent" description="Your name and tenant profile are shared with the landlord. Your phone number is shared only if your application is approved.">
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
