import { CheckCircle2, Home, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { formatDate, formatMoney } from "@/utils/format";
import { clearPendingInvite } from "@/routes/pendingInvite";

interface InvitationView {
  code: string;
  status: string;
  expiresAt: string;
  canAccept: boolean;
  message: string | null;
  recipientName: string;
  property: { name: string; code: string; address: string; type: string };
  target: string | null;
  landlordName: string | null;
  monthlyRent: string;
  securityDeposit: string;
  maintenanceCharges: string | null;
  otherCharges: Array<{ label: string; amount: string }> | null;
  startDate: string;
  endDate: string;
  rentDueDay: number;
  noticePeriodDays: number | null;
  lockInMonths: number | null;
  additionalTerms: string | null;
  leaseId: string | null;
}

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 0 : n % 10]}`;

/** /invite/:token — the invited tenant reviews the rental and accepts or declines. */
export function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { confirm, dialog } = useConfirm();
  const { data, loading, error, reload } = useQuery(() => request<{ invitation: InvitationView }>(`/invitations/token/${encodeURIComponent(token)}`), [token]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // The link has been opened while signed in — no need to come back to it after sign-in.
  useEffect(() => clearPendingInvite(), []);

  const accept = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await request(`/invitations/token/${encodeURIComponent(token)}/accept`, { method: "POST" });
      await refresh().catch(() => undefined); // picks up the Tenant role when it was just added
      setMsg({ kind: "success", text: "You're in! Your lease is active." });
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Rental invitation" />
        <Alert kind="error">{error ?? "This invitation link is not valid."}</Alert>
      </div>
    );
  }
  const inv = data.invitation;
  const rows: Array<[string, string]> = [
    ["Monthly rent", formatMoney(inv.monthlyRent)],
    ["Security deposit", formatMoney(inv.securityDeposit)],
    ...(inv.maintenanceCharges ? [["Maintenance", `${formatMoney(inv.maintenanceCharges)} / month`] as [string, string]] : []),
    ...(inv.otherCharges ?? []).map((c) => [c.label, formatMoney(c.amount)] as [string, string]),
    ["Rent due", `${ordinal(inv.rentDueDay)} of every month`],
    ["Lease", `${formatDate(inv.startDate)} – ${formatDate(inv.endDate)}`],
    ...(inv.noticePeriodDays !== null ? [["Notice period", `${inv.noticePeriodDays} days`] as [string, string]] : []),
    ...(inv.lockInMonths !== null ? [["Lock-in", `${inv.lockInMonths} months`] as [string, string]] : []),
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Rental invitation" description={`${inv.landlordName ?? "Your landlord"} invited ${inv.recipientName} to rent on SafeRent.`} />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <section className="card space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand-bg text-brand-dark"><Home className="size-5" /></span>
          <div className="min-w-0">
            <p className="text-lg font-semibold">{inv.target ? `${inv.target} · ` : ""}{inv.property.name}</p>
            <p className="text-sm text-muted">{inv.property.type}{inv.property.address ? ` · ${inv.property.address}` : ""}</p>
          </div>
          <Badge tone={inv.status === "PENDING" ? "brand" : inv.status === "ACCEPTED" ? "success" : "neutral"} className="ml-auto">{inv.code}</Badge>
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, val]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-medium">{val}</dd>
            </div>
          ))}
        </dl>
        {inv.additionalTerms && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Additional terms</h3>
            <p className="whitespace-pre-line text-sm text-ink-2">{inv.additionalTerms}</p>
          </div>
        )}
        {inv.status === "ACCEPTED" && inv.leaseId ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-success/10 p-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="size-5" /> Accepted — your lease is active.</span>
            <Button onClick={() => navigate("/leases")}>Go to my lease</Button>
          </div>
        ) : !inv.canAccept ? (
          <Alert kind="warning">{inv.message ?? "This invitation is no longer open."}</Alert>
        ) : (
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              leftIcon={<XCircle className="size-4 text-danger" />}
              onClick={() =>
                confirm({
                  title: "Decline invitation",
                  message: "Your landlord will be told you declined.",
                  tone: "danger",
                  confirmLabel: "Decline",
                  onConfirm: async () => {
                    await request(`/invitations/token/${encodeURIComponent(token)}/reject`, { method: "POST" });
                    setMsg({ kind: "success", text: "Invitation declined." });
                    await reload();
                  },
                })
              }
            >
              Decline
            </Button>
            <Button
              loading={busy}
              leftIcon={<CheckCircle2 className="size-4" />}
              onClick={() =>
                confirm({
                  title: "Accept and start the lease",
                  message: `You agree to rent ${inv.target ? `${inv.target}, ` : ""}${inv.property.name} for ${formatMoney(inv.monthlyRent)} a month from ${formatDate(inv.startDate)}.`,
                  confirmLabel: "Accept",
                  onConfirm: accept,
                })
              }
            >
              Accept invitation
            </Button>
          </div>
        )}
      </section>
      {dialog}
    </div>
  );
}
