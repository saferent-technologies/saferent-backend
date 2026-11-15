import { LocationSearchBox, type LocationSuggestion } from "@/components/data/LocationSearchBox";
import { ArrowRight, BadgeCheck, Building2, ClipboardCheck, FileSignature, Home, KeyRound, ReceiptIndianRupee, Search, ShieldCheck, Smartphone, Store, Users } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { PATHS } from "@/utils/constants";
import { formatMoney } from "@/utils/format";
import type { PublicListing } from "../properties/types";
import { ListingCard } from "../rentals/BrowsePage";

const TYPES = [
  { value: "", label: "Any type" },
  { value: "APARTMENT", label: "Apartment" },
  { value: "INDIVIDUAL_HOUSE", label: "Independent house" },
  { value: "VILLA", label: "Villa" },
  { value: "PG", label: "PG" },
  { value: "HOSTEL", label: "Hostel" },
  { value: "OFFICE_SPACE", label: "Office space" },
  { value: "SHOP", label: "Shop" },
];
const BUDGETS = ["", "10000", "20000", "35000", "50000", "100000"];

const QUICK = [
  { label: "Apartments", icon: Building2, query: "propertyType=APARTMENT" },
  { label: "Independent houses", icon: Home, query: "propertyType=INDIVIDUAL_HOUSE" },
  { label: "PG & hostels", icon: Users, query: "propertyType=PG" },
  { label: "Shops & offices", icon: Store, query: "category=COMMERCIAL" },
];

const PROMISES = [
  { icon: ShieldCheck, title: "Verified owners", text: "Owners confirm their identity with DigiLocker before their listing goes live." },
  { icon: BadgeCheck, title: "Checked listings", text: "Ownership documents and photos are reviewed by the SafeRent team." },
  { icon: ReceiptIndianRupee, title: "Every charge upfront", text: "Rent, deposit, maintenance and utilities are shown before you apply — no surprises." },
  { icon: FileSignature, title: "Your rental in one place", text: "Applications, lease, rent receipts and move-out — tracked online for both sides." },
];

const TENANT_STEPS = [
  { icon: Search, title: "Search", text: "Browse verified homes by area, type and budget." },
  { icon: Smartphone, title: "Sign in with your phone", text: "One-time code — no passwords. Your account is ready in a minute." },
  { icon: KeyRound, title: "Apply & move in", text: "Send your application, get approved, and manage rent online." },
];

const OWNER_STEPS = [
  { icon: ShieldCheck, title: "Verify once", text: "Confirm your identity with DigiLocker and a quick selfie." },
  { icon: ClipboardCheck, title: "List your property", text: "Add photos, rent and rules. We review it before it goes live." },
  { icon: Users, title: "Choose your tenant", text: "Review applications, approve the right tenant and track rent." },
];

/** saferenttechnologies.com — the public home page: search, latest homes, why SafeRent. */
export function HomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [place, setPlace] = useState<LocationSuggestion | null>(null);
  const [type, setType] = useState("");
  const [budget, setBudget] = useState("");
  const latest = useQuery(() => request<Paged<PublicListing>>("/public/listings", { auth: false, query: { pageSize: 6 } }), []);

  const search = (e: FormEvent) => {
    e.preventDefault();
    go(place);
  };
  const go = (picked: LocationSuggestion | null, text = q) => {
    const params = new URLSearchParams();
    if (picked) {
      for (const [k, v] of Object.entries(picked.filters)) if (v) params.set(k, v);
    } else if (text.trim()) {
      params.set("q", text.trim());
    }
    if (type) params.set("propertyType", type);
    if (budget) params.set("maxRent", budget);
    const qs = params.toString();
    navigate(`${PATHS.homes}${qs ? `?${qs}` : ""}`);
  };

  const field = "h-12 w-full rounded-control border border-line bg-surface px-4 text-sm text-ink focus:border-brand focus:shadow-focus focus:outline-none";

  return (
    <>
      {/* Hero + search */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-bg to-surface">
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-brand/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[24rem] rounded-full bg-brand-light/10" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-brand-dark shadow-card">
              <BadgeCheck className="size-4" /> Verified owners · every charge disclosed
            </p>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Find a home you can <span className="text-brand">trust</span>.
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-ink-2">Rent verified flats, houses and PGs — with the full cost shown upfront and your whole rental managed online.</p>
          </div>

          <form onSubmit={search} role="search" className="card mt-8 grid gap-3 p-3 sm:p-4 md:grid-cols-[2fr_1fr_1fr_auto]">
            <LocationSearchBox
              isPublic
              value={place?.label ?? q}
              placeholder="Area, city, PIN or SafeRent ID"
              inputClassName="h-12"
              onSelect={(s) => {
                setPlace(s);
                setQ("");
              }}
              onSubmit={(text) => {
                setPlace(null);
                setQ(text);
                if (text) go(null, text);
              }}
            />
            <label className="block">
              <span className="sr-only">Property type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Budget</span>
              <select value={budget} onChange={(e) => setBudget(e.target.value)} className={field}>
                {BUDGETS.map((b) => <option key={b} value={b}>{b ? `Up to ${formatMoney(b)}` : "Any budget"}</option>)}
              </select>
            </label>
            <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-control bg-brand px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-dark">
              <Search className="size-4" /> Search
            </button>
          </form>

          <div className="mt-5 flex flex-wrap gap-2">
            {QUICK.map(({ label, icon: Icon, query }) => (
              <Link key={label} to={`${PATHS.homes}?${query}`} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-2 transition-colors hover:border-brand hover:text-brand-dark">
                <Icon className="size-4 text-brand" /> {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Latest homes */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Latest homes</h2>
            <p className="mt-1 text-muted">Freshly listed and available now.</p>
          </div>
          <Link to={PATHS.homes} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
            View all homes <ArrowRight className="size-4" />
          </Link>
        </div>
        {latest.loading && !latest.data ? (
          <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>
        ) : latest.error ? (
          <p className="rounded-card border border-line bg-canvas p-8 text-center text-muted">Homes couldn't be loaded right now. Please try again in a moment.</p>
        ) : !latest.data?.items.length ? (
          <div className="rounded-card border border-dashed border-line bg-canvas p-10 text-center">
            <Building2 className="mx-auto size-10 text-brand" />
            <p className="mt-3 font-semibold text-ink">New homes are being verified.</p>
            <p className="mt-1 text-sm text-muted">Check back soon — or list your own property on SafeRent.</p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {latest.data.items.map((p) => (
              <li key={p.id}>
                <ListingCard listing={p} isPublic onOpen={() => navigate(`${PATHS.homes}/${p.id}`)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Why SafeRent */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <h2 className="text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">Renting, without the guesswork</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-muted">SafeRent checks the owner and the listing, and shows you the real cost before you commit.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="card p-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-bg text-brand"><Icon className="size-5" /></span>
                <h3 className="mt-4 font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-14 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">How it works</h2>
        <div className="mt-8 grid gap-10 lg:grid-cols-2">
          <Steps title="For tenants" steps={TENANT_STEPS} cta={<Link to={PATHS.homes} className="inline-flex items-center gap-1.5 font-semibold text-brand-dark hover:text-brand">Start searching <ArrowRight className="size-4" /></Link>} />
          <div id="owners" className="scroll-mt-20">
            <Steps title="For owners" steps={OWNER_STEPS} cta={<Link to={PATHS.login} className="inline-flex items-center gap-1.5 font-semibold text-brand-dark hover:text-brand">List your property <ArrowRight className="size-4" /></Link>} />
          </div>
        </div>
      </section>

      {/* Owner CTA */}
      <section className="px-4 pb-16 sm:px-6 lg:px-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-card bg-gradient-to-br from-brand to-brand-dark px-6 py-12 text-white sm:px-12">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-white/10" />
          <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-bold sm:text-3xl">Own a property? Rent it to verified tenants.</h2>
              <p className="mt-2 max-w-xl text-white/85">Reach tenants who see every charge upfront, review applications, and track rent and agreements in one place.</p>
            </div>
            <Link to={PATHS.login} className="inline-flex h-12 shrink-0 items-center gap-2 rounded-control bg-white px-6 text-sm font-semibold text-brand-dark transition-colors hover:bg-brand-bg">
              List your property <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Steps({ title, steps, cta }: { title: string; steps: Array<{ icon: typeof Search; title: string; text: string }>; cta: ReactNode }) {
  return (
    <div className="card p-6 sm:p-8">
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <ol className="mt-6 space-y-6">
        {steps.map(({ icon: Icon, title: t, text }, i) => (
          <li key={t} className="flex gap-4">
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-bg text-brand">
              <Icon className="size-5" />
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">{i + 1}</span>
            </span>
            <span>
              <span className="block font-semibold text-ink">{t}</span>
              <span className="block text-sm text-muted">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6">{cta}</div>
    </div>
  );
}
