import { Menu, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/hooks/useAuth";
import { toEmployeePath } from "@/routes/portal";
import { cn } from "@/utils/cn";
import { COMPANY_NAME, PATHS } from "@/utils/constants";

const LINKS = [
  { to: PATHS.homes, label: "Homes for rent" },
  { to: `${PATHS.home}#how-it-works`, label: "How it works" },
  { to: `${PATHS.home}#owners`, label: "For owners" },
];

/** The public website shell: saferenttechnologies.com — browse homes without signing in. */
export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname, location.hash]);

  // Scroll to #section links on the home page.
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash]);

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to={PATHS.home} aria-label="SafeRent home">
            <Logo className="h-9" />
          </Link>
          <nav aria-label="Website" className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <NavLink
                key={l.label}
                to={l.to}
                className={({ isActive }) => cn("rounded-control px-3 py-2 text-sm font-semibold transition-colors", isActive && !l.to.includes("#") ? "text-brand-dark" : "text-ink-2 hover:text-ink")}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <AccountButtons />
          </div>
          <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} className="ml-auto flex size-11 items-center justify-center rounded-control text-ink-2 hover:bg-subtle md:hidden">
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-line bg-surface px-4 pb-4 pt-2 md:hidden">
            <nav aria-label="Website" className="grid">
              {LINKS.map((l) => (
                <Link key={l.label} to={l.to} className="rounded-control px-3 py-3 text-sm font-semibold text-ink-2 hover:bg-subtle">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 grid gap-2">
              <AccountButtons stacked />
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
          <div className="md:col-span-2">
            <Logo className="h-9" />
            <p className="mt-3 max-w-sm text-sm text-muted">Verified homes and honest renting — verified owners, every charge disclosed upfront, and your whole rental in one place.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Tenants</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link to={PATHS.homes} className="hover:text-brand-dark">Homes for rent</Link></li>
              <li><Link to={`${PATHS.home}#how-it-works`} className="hover:text-brand-dark">How it works</Link></li>
              <li><Link to={PATHS.login} className="hover:text-brand-dark">Sign in</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Owners</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link to={PATHS.login} className="hover:text-brand-dark">List your property</Link></li>
              <li><Link to={`${PATHS.home}#owners`} className="hover:text-brand-dark">Why SafeRent</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-muted sm:px-6 lg:px-8">© {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/** Signed out: Sign in / Get started. Signed in: back to the right portal. */
function AccountButtons({ stacked = false }: { stacked?: boolean }) {
  const { status, activeRole } = useAuth();
  const button = "inline-flex h-10 items-center justify-center rounded-control px-4 text-sm font-semibold transition-colors";
  if (status === "authenticated") {
    const to = activeRole?.isStaff ? toEmployeePath(PATHS.dashboard) : PATHS.dashboard;
    return (
      <Link to={to} className={cn(button, "bg-brand text-white hover:bg-brand-dark", stacked && "w-full")}>
        My account
      </Link>
    );
  }
  return (
    <>
      <Link to={PATHS.login} className={cn(button, "text-ink-2 hover:bg-subtle", stacked && "w-full border border-line")}>
        Sign in
      </Link>
      <Link to={PATHS.login} className={cn(button, "bg-brand text-white hover:bg-brand-dark", stacked && "w-full")}>
        Get started
      </Link>
    </>
  );
}

/** Page body width for website pages that reuse app screens (search results, listing details). */
export function PublicContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>;
}
