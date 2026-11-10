import { KeyRound, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { COMPANY_NAME } from "@/utils/constants";

const highlights = [
  { icon: ShieldCheck, title: "Two-step verification", text: "Every sign-in is confirmed with a one-time code." },
  { icon: KeyRound, title: "Role-based access", text: "Only authorized Super Admins can enter." },
  { icon: Users, title: "Full audit trail", text: "Security events are recorded automatically." },
];

/**
 * Mobile/tablet: a single centered card.
 * Desktop (≥1024px): branded illustration panel on the left, card on the right.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full overflow-x-hidden bg-canvas">
      <aside className="relative hidden w-[44%] max-w-[640px] flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-dark p-10 text-white lg:flex xl:p-14">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 size-[28rem] rounded-full bg-white/5" />

        <div className="relative inline-flex w-fit rounded-2xl bg-white px-4 py-3 shadow-card">
          <Logo className="h-9" />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">Secure administration for the SafeRent platform.</h2>
          <ul className="mt-8 space-y-5">
            {highlights.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-white/80">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/70">
          © {new Date().getFullYear()} {COMPANY_NAME}
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8 sm:py-12">
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  );
}

/** White login card with logo and heading. */
export function AuthCard({ title, subtitle, children, showLogo = true }: { title: string; subtitle?: ReactNode; children: ReactNode; showLogo?: boolean }) {
  return (
    <div className="card w-full p-5 sm:p-8">
      {showLogo && (
        <div className="mb-6 flex justify-center lg:hidden">
          <Logo className="h-14 sm:h-16" />
        </div>
      )}
      <div className="mb-6 text-center lg:text-left">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted sm:text-base">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
