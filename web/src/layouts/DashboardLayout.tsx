import { Bell, ChevronDown, LogOut, Menu, Settings, ShieldCheck, UserRound, Wallet, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { ReviewRequiredGate } from "@/pages/reviews/ReviewsPages";
import { visibleNavigation } from "@/routes/navigation";
import { usePortal } from "@/routes/portal";
import { request } from "@/services/api";
import { AuthImage } from "@/components/ui/AuthImage";
import { cn } from "@/utils/cn";
import { COMPANY_NAME, PATHS, ROLE_LABELS } from "@/utils/constants";
import { installSoundUnlock, playNotificationSound } from "@/utils/notificationSound";
import { useSupportHeartbeat } from "@/utils/supportPresence";
import { initials } from "@/utils/format";

/** Counts per sidebar path (GET /me/badges), refreshed every 15 s while the tab is visible. */
const BadgesContext = createContext<Record<string, number>>({});

function useBadgePolling(enabled: boolean): Record<string, number> {
  const location = useLocation();
  const { data, reload } = useQuery(() => request<{ badges: Record<string, number>; total: number; signals?: Record<string, string | null> }>("/me/badges"), [location.pathname], enabled);
  // Every 15 s, also in a background tab (so the bell rings while you work elsewhere), and right away on return.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => void reload();
    const timer = window.setInterval(tick, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, reload]);
  // Support has no notification rows for staff: ring whenever something new happens there (new ticket for me,
  // an owner reply on mine, a ticket joining the queue for supervisors), even if the count doesn't change.
  // Not when that ticket's chat is already open (that page rings for its own replies).
  const signal = data ? (data.signals?.["/support"] ?? null) : undefined;
  const lastSignal = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (signal === undefined) return;
    const prev = lastSignal.current;
    lastSignal.current = signal;
    if (prev === undefined || !signal || signal === prev) return;
    if (prev && signal.split("|")[0] <= prev.split("|")[0]) return; // older event (e.g. ticket resolved) → no ring
    const ticketId = signal.split("|")[1];
    if (ticketId && location.pathname.endsWith(`/support/${ticketId}`)) return;
    playNotificationSound();
  }, [signal, location.pathname]);
  return data?.badges ?? {};
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { can, activeRole } = useAuth();
  const portal = usePortal();
  const badges = useContext(BadgesContext);
  const groups = visibleNavigation(can, activeRole?.key);
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={portal.path(to)}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold transition-colors",
                    isActive ? "bg-brand-bg text-brand-dark" : "text-ink-2 hover:bg-subtle hover:text-ink",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn("size-5 shrink-0", isActive ? "text-brand" : "text-muted")} />
                    <span className="truncate">{label}</span>
                    {!!badges[to] && (
                      <span className="ml-auto flex min-w-6 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-bold leading-6 text-white" aria-label={`${badges[to]} waiting`}>
                        {badges[to] > 99 ? "99+" : badges[to]}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { dashboardPath, employee } = usePortal();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link to={dashboardPath} onClick={onNavigate} aria-label="SafeRent dashboard" className="flex items-center gap-2">
          <Logo className="h-9" />
          {employee && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Employee</span>}
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <NavItems onNavigate={onNavigate} />
      </div>
      <SessionBadge />
      <div className="px-4 pb-4">
        <p className="px-1 text-xs text-muted">© {new Date().getFullYear()} {COMPANY_NAME}</p>
      </div>
    </div>
  );
}

function SessionBadge() {
  const { profile, roles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="space-y-2 border-t border-line px-4 pb-2 pt-4">
      {roles.length > 1 && (
        <label className="block">
          <span className="mb-1 block px-1 text-xs font-semibold uppercase tracking-wider text-muted">Using SafeRent as</span>
          <select
            aria-label="Switch role"
            value={activeRole?.key ?? ""}
            onChange={(e) => {
              setActiveRole(e.target.value);
              navigate(PATHS.dashboard);
            }}
            className="h-11 w-full cursor-pointer rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink focus:border-brand focus:shadow-focus focus:outline-none"
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-center gap-2 rounded-control bg-brand-bg px-3 py-2.5 text-xs font-medium text-brand-dark">
        <ShieldCheck className="size-4 shrink-0" />
        <span className="truncate">Verified {ROLE_LABELS[profile?.role ?? ""] ?? ""} session</span>
      </div>
    </div>
  );
}

export function Avatar({ name, image, size = "size-9" }: { name?: string | null; image?: string | null; size?: string }) {
  if (image) return <AuthImage path={image.replace(/^\/api/, "")} alt={name ?? "Profile photo"} className={cn(size, "shrink-0 rounded-full")} />;
  return <span className={cn(size, "flex shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white")}>{initials(name)}</span>;
}

/** Landlords and tenants: promotional wallet balance in the top bar → wallet history. */
function WalletChip() {
  const { roles } = useAuth();
  const location = useLocation();
  const hasWallet = roles.some((r) => r.key === "LANDLORD" || r.key === "TENANT");
  const { data } = useQuery(() => request<{ wallet: { balance: string } }>("/wallet"), [location.pathname], hasWallet);
  if (!hasWallet) return null;
  const balance = Number(data?.wallet.balance ?? 0);
  return (
    <Link to="/wallet" aria-label={`Wallet balance ₹${balance.toFixed(2)}`} className="flex h-10 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold text-ink hover:bg-subtle">
      <Wallet className="size-4 text-brand" />
      <span>₹{balance.toLocaleString("en-IN", { minimumFractionDigits: balance % 1 ? 2 : 0, maximumFractionDigits: 2 })}</span>
    </Link>
  );
}

function NotificationBell() {
  const { can } = useAuth();
  const { path } = usePortal();
  const location = useLocation();
  const allowed = can("notifications.view");
  const { data, reload } = useQuery(() => request<{ unread: number }>("/notifications", { query: { pageSize: 1, unread: true } }), [location.pathname], allowed);
  const unread = data?.unread ?? 0;

  // Check every 15 s while the tab is visible (and right away when it comes back).
  useEffect(() => {
    if (!allowed) return;
    const tick = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [allowed, reload]);

  // Sound: when the unread count goes up, and once after signing in if something is waiting.
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    const prev = last.current;
    last.current = unread;
    if (prev === null) {
      let played = false;
      try {
        played = sessionStorage.getItem("sr-notif-greeted") === "1";
        sessionStorage.setItem("sr-notif-greeted", "1");
      } catch {
        /* ignore */
      }
      if (!played && unread > 0) playNotificationSound();
      return;
    }
    if (unread > prev) playNotificationSound();
  }, [data, unread]);

  if (!allowed) return null;
  return (
    <Link to={path("/notifications")} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative flex size-11 items-center justify-center rounded-control text-ink-2 hover:bg-subtle">
      <Bell className="size-5" />
      {unread > 0 && <span className="absolute right-1.5 top-1.5 flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

function ProfileMenu() {
  const { profile, logout, activeRole } = useAuth();
  const navigate = useNavigate();
  const portal = usePortal();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOutNow = async () => {
    setOpen(false);
    await logout();
    navigate(portal.loginPath, { replace: true });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2.5 rounded-control px-1.5 hover:bg-subtle sm:px-2"
      >
        <Avatar name={profile?.fullName} image={profile?.profileImage} />
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-semibold text-ink">{profile?.fullName}</span>
          <span className="block text-xs text-muted">{activeRole?.name ?? ROLE_LABELS[profile?.role ?? ""]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted sm:block" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-control border border-line bg-surface py-1 shadow-card">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{profile?.fullName}</p>
            <p className="truncate text-xs text-muted">{profile?.email ?? profile?.phoneNumber}</p>
          </div>
          <MenuLink to={portal.path(PATHS.profile)} icon={<UserRound className="size-4" />} onClick={() => setOpen(false)}>
            Profile
          </MenuLink>
          <MenuLink to={portal.path(PATHS.settings)} icon={<Settings className="size-4" />} onClick={() => setOpen(false)}>
            Security
          </MenuLink>
          <button type="button" role="menuitem" onClick={() => void signOutNow()} className="flex min-h-11 w-full items-center gap-3 px-4 text-sm font-medium text-danger hover:bg-danger/5">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, children, onClick }: { to: string; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <Link role="menuitem" to={to} onClick={onClick} className="flex min-h-11 items-center gap-3 px-4 text-sm font-medium text-ink-2 hover:bg-subtle">
      {icon}
      {children}
    </Link>
  );
}

export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { dashboardPath } = usePortal();
  const { profile, can } = useAuth();
  const badges = useBadgePolling(!!profile);
  // Ticket agents: online for the support queue while the portal is open (and not set to Away).
  useSupportHeartbeat(!!profile && can("support.manage"));
  useEffect(() => installSoundUnlock(), []);
  const pending = Object.entries(badges).some(([k, n]) => k !== "/notifications" && n > 0);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <BadgesContext.Provider value={badges}>
    <div className="min-h-dvh overflow-x-hidden bg-canvas">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] bg-surface shadow-card">
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute right-2 top-3 flex size-10 items-center justify-center rounded-lg text-muted hover:bg-subtle">
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-3 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label={pending ? "Open navigation (items waiting)" : "Open navigation"} className="relative flex size-11 items-center justify-center rounded-control text-ink-2 hover:bg-subtle lg:hidden">
            <Menu className="size-5" />
            {pending && <span className="absolute right-2 top-2 size-2.5 rounded-full bg-danger" />}
          </button>
          <Link to={dashboardPath} className="lg:hidden" aria-label="SafeRent dashboard">
            <Logo className="h-8" />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <WalletChip />
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </main>
        <ReviewRequiredGate />
      </div>
    </div>
    </BadgesContext.Provider>
  );
}
