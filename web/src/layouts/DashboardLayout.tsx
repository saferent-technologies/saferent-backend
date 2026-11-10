import { Bell, ChevronDown, LogOut, Menu, Settings, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { visibleNavigation } from "@/routes/navigation";
import { request } from "@/services/api";
import { AuthImage } from "@/components/ui/AuthImage";
import { cn } from "@/utils/cn";
import { COMPANY_NAME, PATHS, ROLE_LABELS } from "@/utils/constants";
import { initials } from "@/utils/format";

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { can, profile } = useAuth();
  const groups = visibleNavigation(can, profile?.role);
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link to={PATHS.dashboard} onClick={onNavigate} aria-label="SafeRent dashboard">
          <Logo className="h-9" />
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
  const { profile } = useAuth();
  return (
    <div className="border-t border-line px-4 pb-2 pt-4">
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

function NotificationBell() {
  const { can } = useAuth();
  const location = useLocation();
  const { data } = useQuery(() => request<{ unread: number }>("/notifications", { query: { pageSize: 1, unread: true } }), [location.pathname], can("notifications.view"));
  if (!can("notifications.view")) return null;
  const unread = data?.unread ?? 0;
  return (
    <Link to="/notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative flex size-11 items-center justify-center rounded-control text-ink-2 hover:bg-subtle">
      <Bell className="size-5" />
      {unread > 0 && <span className="absolute right-1.5 top-1.5 flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

function ProfileMenu() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
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
    navigate(PATHS.login, { replace: true });
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
          <span className="block text-xs text-muted">{ROLE_LABELS[profile?.role ?? ""]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted sm:block" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-control border border-line bg-surface py-1 shadow-card">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{profile?.fullName}</p>
            <p className="truncate text-xs text-muted">{profile?.email ?? profile?.phoneNumber}</p>
          </div>
          <MenuLink to={PATHS.profile} icon={<UserRound className="size-4" />} onClick={() => setOpen(false)}>
            Profile
          </MenuLink>
          <MenuLink to={PATHS.settings} icon={<Settings className="size-4" />} onClick={() => setOpen(false)}>
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

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
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
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="flex size-11 items-center justify-center rounded-control text-ink-2 hover:bg-subtle lg:hidden">
            <Menu className="size-5" />
          </button>
          <Link to={PATHS.dashboard} className="lg:hidden" aria-label="SafeRent dashboard">
            <Logo className="h-8" />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
