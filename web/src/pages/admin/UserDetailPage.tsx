import { ArrowLeft, Ban, CheckCircle2, Eraser, LogOut, RotateCcw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { useAuth } from "@/hooks/useAuth";
import { usePortal } from "@/routes/portal";
import { UserOverviewTab } from "./UserOverview";
import { useQuery } from "@/hooks/useQuery";
import { Avatar } from "@/layouts/DashboardLayout";
import { request } from "@/services/api";
import type { AuditLogEntry, Permissions, Scope, UserDeletion, UserProfile } from "@/types/auth";
import { ALL_ROLES, ROLE_LABELS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp, labelize } from "@/utils/format";

interface UserDetail {
  user: UserProfile & { deletion?: UserDeletion | null; gender?: string | null; dateOfBirth?: string | null; city?: string | null; state?: string | null; isProfileCompleted?: boolean };
  ownerDetails?: {
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    alternatePhone: string | null;
    preferredLanguage: string | null;
    preferredContactMethod: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactRelation: string | null;
  } | null;
  profileResets?: Array<{ at: string; by: { id: string; fullName: string | null }; reason: string | null; cleared: string[] }>;
  permissions: Permissions;
  overrides: Array<{ permissionKey: string; granted: boolean; scope: Scope }>;
  session: { method: string; verifiedAt: string; expiresAt: string; revoked: boolean } | null;
  landlordKyc: {
    kycStatus: string;
    kycNote: string | null;
    kycReviewedAt: string | null;
    reviewedBy?: string | null;
    manual?: boolean;
    digilockerDone?: boolean;
    selfieDone?: boolean;
    canRevoke?: boolean;
    canRestore?: boolean;
    history?: Array<{ action: string; at: string; by: { id: string; fullName: string | null }; reason: string | null; unpublishedListings: number | null }>;
  } | null;
  can: { manage: boolean; resetProfile?: boolean; deactivate: boolean; delete: boolean; restore?: boolean; assignRole: boolean; setPermissions: boolean; addRoles: string[]; removeRoles: string[] };
}

interface Catalog {
  permissions: Array<{ key: string; category: string; description: string; reserved?: boolean }>;
}

type Tab = "overview" | "data" | "permissions" | "activity";

const LANGUAGE_LABEL: Record<string, string> = { en: "English", te: "Telugu", hi: "Hindi", ta: "Tamil", kn: "Kannada", ml: "Malayalam", mr: "Marathi", bn: "Bengali", gu: "Gujarati", ur: "Urdu", or: "Odia", pa: "Punjabi" };

export function UserDetailPage() {
  const { id = "" } = useParams();
  const { can: canDo } = useAuth();
  // Staff without users.view (e.g. Finance) land straight on the user's records.
  const [tab, setTab] = useState<Tab>(() => (canDo("users.view") ? "overview" : "data"));
  const { data, loading, error, reload } = useQuery(() => request<UserDetail>(`/users/${id}`), [id]);
  const { can } = useAuth();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();
  const navigate = useNavigate();
  const portal = usePortal();

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "User not found."}</Alert>;
  const u = data.user;

  const act = (title: string, body: string, path: string, payload?: unknown, tone: "primary" | "danger" = "primary", reason: boolean | string = false) =>
    confirm({
      title,
      message: body,
      tone,
      confirmLabel: title,
      reason: reason ? { label: typeof reason === "string" ? reason : "Reason (recorded in the activity log)", required: true, minLength: 5 } : undefined,
      onConfirm: async (r) => {
        await request(path, { method: "POST", body: reason ? { ...(payload as object), reason: r } : payload });
        setMessage({ kind: "success", text: `${title} — done.` });
        await reload();
      },
    });

  return (
    <>
      <Link to="/users" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
        <ArrowLeft className="size-4" /> All users
      </Link>
      <PageHeader
        title={u.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {ROLE_LABELS[u.role]}
            <StatusBadge status={u.accountStatus} />
            {u.isFounder && <Badge tone="brand"><ShieldCheck className="size-3.5" /> Founder (protected)</Badge>}
          </span>
        }
        actions={
          (data.can.manage || data.can.deactivate || data.can.delete || data.can.restore) && (
            <>
              {!data.can.deactivate ? null : u.accountStatus === "ACTIVE" ? (
                <Button variant="secondary" leftIcon={<Ban className="size-4" />} onClick={() => act("Deactivate account", `${u.fullName} won't be able to use SafeRent — the app will show "Account deactivated" with your reason. Activating again restores access instantly.`, `/users/${u.id}/status`, { status: "DEACTIVATED" }, "danger", "Reason (shown to the user when they sign in, and recorded)")}>
                  Deactivate
                </Button>
              ) : (
                <Button variant="secondary" leftIcon={<CheckCircle2 className="size-4" />} onClick={() => act("Activate account", `${u.fullName} will be able to sign in again.`, `/users/${u.id}/status`, { status: "ACTIVE" }, "primary", true)}>
                  Activate
                </Button>
              )}
              {data.can.resetProfile && (
                <Button
                  variant="secondary"
                  leftIcon={<Eraser className="size-4" />}
                  onClick={() =>
                    act(
                      "Reset user details",
                      `${u.fullName}'s gender, date of birth, city and state will be removed and the app will ask for them again. Name, phone, email, roles, properties, leases, payments, reviews and all history stay as they are.`,
                      `/users/${u.id}/reset-profile`,
                      {},
                      "danger",
                      "Reason (recorded with your name and the time)",
                    )
                  }
                >
                  Reset details
                </Button>
              )}
              {data.can.manage && (
                <Button variant="secondary" leftIcon={<LogOut className="size-4" />} onClick={() => act("Force sign-out", `Security action: ${u.fullName} will be signed out on every device and must verify their phone again. Use this for a compromised account — deactivate / delete don't sign anyone out.`, `/users/${u.id}/revoke-sessions`, undefined, "danger")}>
                  Force sign-out
                </Button>
              )}
              {data.can.restore && (
                <Button
                  leftIcon={<RotateCcw className="size-4" />}
                  onClick={() => act("Restore account", `${u.fullName} will be active again with all their data and can sign in.`, `/users/${u.id}/restore`, {}, "primary", true)}
                >
                  Restore
                </Button>
              )}
              {data.can.delete && (
                <Button
                  variant="danger"
                  leftIcon={<Trash2 className="size-4" />}
                  onClick={() =>
                    confirm({
                      title: "Delete account",
                      message: `${u.fullName} won't be able to use SafeRent — the app will show "Account deleted" with your reason. All their data (profile, properties, leases, payments, reviews, activity) is kept, and Restore brings the account back instantly.`,
                      tone: "danger",
                      confirmLabel: "Delete account",
                      reason: { label: "Reason (shown to the user in the app and recorded)", required: true, minLength: 5 },
                      onConfirm: async (r) => {
                        await request(`/users/${u.id}`, { method: "DELETE", body: { reason: r } });
                        navigate(portal.path("/users"), { replace: true });
                      },
                    })
                  }
                >
                  Delete
                </Button>
              )}
            </>
          )
        }
      />
      {message && <Alert kind={message.kind} className="mb-4">{message.text}</Alert>}
      {u.deletion && (
        <div className="mb-4 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm">
          <p className="font-semibold text-danger">This account was deleted</p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Former name</dt><dd className="font-medium">{u.deletion.formerName ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">Former contact</dt><dd className="font-medium">{[u.deletion.formerPhone, u.deletion.formerEmail].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt className="text-xs text-muted">Deleted on</dt><dd className="font-medium">{formatTimestamp(u.deletion.deletedAt)}</dd></div>
            <div><dt className="text-xs text-muted">Deleted by</dt><dd className="font-medium">{u.deletion.deletedBy?.fullName ?? "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted">Reason</dt><dd className="whitespace-pre-wrap font-medium">{u.deletion.reason ?? "—"}</dd></div>
          </dl>
        </div>
      )}
      {data.landlordKyc && <LandlordKycCard kyc={data.landlordKyc} user={u} confirm={confirm} onDone={async (text) => { setMessage({ kind: "success", text }); await reload(); }} canDecide={can("users.manage")} canManual={can("kyc.verify_manual")} />}
      {u.isFounder && <Alert kind="info" className="mb-4">The founder account cannot be demoted, deactivated or have its permissions changed.</Alert>}

      <Tabs<Tab>
        idPrefix="user"
        className="mb-5 max-w-lg"
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "data", label: "All data" },
          ...(canDo("users.view") ? [{ value: "permissions" as Tab, label: "Permissions" }, { value: "activity" as Tab, label: "Activity" }] : []),
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card flex flex-col items-center p-6 text-center">
            <Avatar name={u.fullName} image={u.profileImage} size="size-20" />
            <p className="mt-3 font-semibold">{u.fullName}</p>
            <p className="text-sm text-muted">{u.email ?? "No email"}</p>
            <p className="text-sm text-muted">{u.phoneNumber ?? "No phone"}</p>
          </section>
          <section className="card p-5 sm:p-6 lg:col-span-2">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Created" value={formatTimestamp(u.createdAt)} />
              <Item label="Last sign-in" value={formatTimestamp(u.lastLoginAt)} />
              <Item label="Email verified" value={u.emailVerified ? "Yes" : "No"} />
              <Item label="Phone verified" value={u.phoneVerified ? "Yes" : "No"} />
              <Item label="Current session" value={data.session && !data.session.revoked ? `${labelize(data.session.method)} · until ${formatTimestamp(data.session.expiresAt)}` : "None"} />
              <Item label="Gender" value={u.gender ? labelize(u.gender) : "Not given"} />
              <Item label="Date of birth" value={u.dateOfBirth ?? "Not given"} />
              <Item label="City / State" value={[u.city, u.state].filter(Boolean).join(", ") || "Not given"} />
              <Item label="Profile details" value={u.isProfileCompleted ? "Complete" : "Not complete"} />
            </dl>
            {data.ownerDetails && (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="mb-2 text-sm font-semibold text-ink">Owner details</h3>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <Item label="Communication address" value={[data.ownerDetails.address, data.ownerDetails.city, data.ownerDetails.state, data.ownerDetails.pincode].filter(Boolean).join(", ") || "Not given"} />
                  <Item label="Alternate number" value={data.ownerDetails.alternatePhone ?? "Not given"} />
                  <Item label="Preferred language" value={LANGUAGE_LABEL[data.ownerDetails.preferredLanguage ?? ""] ?? "Not given"} />
                  <Item label="Preferred contact" value={data.ownerDetails.preferredContactMethod ? labelize(data.ownerDetails.preferredContactMethod) : "Not given"} />
                  <Item label="Emergency contact" value={data.ownerDetails.emergencyContactName ? `${data.ownerDetails.emergencyContactName}${data.ownerDetails.emergencyContactRelation ? ` (${data.ownerDetails.emergencyContactRelation})` : ""} · ${data.ownerDetails.emergencyContactPhone ?? ""}` : "Not given"} />
                </dl>
              </div>
            )}
            {!!data.profileResets?.length && (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="mb-2 text-sm font-semibold text-ink">Details reset history</h3>
                <ul className="space-y-2 text-sm">
                  {data.profileResets.map((r) => (
                    <li key={r.at} className="rounded-control bg-subtle p-3">
                      <p className="font-medium">{formatTimestamp(r.at)} by {r.by.fullName ?? "a staff member"}</p>
                      <p className="text-muted">Reason: {r.reason ?? "Not given"}</p>
                      {r.cleared.length > 0 && <p className="text-xs text-muted">Removed: {r.cleared.map((f) => (f === "dateOfBirth" ? "date of birth" : f)).join(", ")}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">All roles</h3>
              <div className="flex flex-wrap items-center gap-2">
                {(u.roles ?? [u.role]).map((r) => (
                  <Badge key={r} tone={r === u.role ? "brand" : "neutral"}>
                    {ROLE_LABELS[r]}{r === u.role ? " (primary)" : ""}
                    {data.can.removeRoles.includes(r) && (
                      <button type="button" aria-label={`Remove ${ROLE_LABELS[r]}`} className="ml-1" onClick={() => confirm({ title: `Remove ${ROLE_LABELS[r]} role`, message: `${u.fullName} will lose ${ROLE_LABELS[r]} access.`, tone: "danger", confirmLabel: "Remove", onConfirm: async () => { await request(`/users/${u.id}/roles/${r}`, { method: "DELETE" }); setMessage({ kind: "success", text: "Role removed." }); await reload(); } })}>×</button>
                    )}
                  </Badge>
                ))}
                {data.can.addRoles.map((r) => (
                  <Button key={r} size="sm" variant="ghost" onClick={() => confirm({ title: `Add ${ROLE_LABELS[r]} role`, message: `${u.fullName} keeps their current role and can also use SafeRent as a ${ROLE_LABELS[r]}.`, confirmLabel: "Add role", onConfirm: async () => { await request(`/users/${u.id}/roles`, { method: "POST", body: { role: r } }); setMessage({ kind: "success", text: "Role added." }); await reload(); } })}>
                    + {ROLE_LABELS[r]}
                  </Button>
                ))}
              </div>
            </div>
            {data.can.assignRole && <RoleChanger user={u} onChanged={async () => { setMessage({ kind: "success", text: "Role updated. The user must sign in again." }); await reload(); }} />}
          </section>
        </div>
      )}
      {tab === "permissions" && <PermissionsEditor detail={data} onSaved={async () => { setMessage({ kind: "success", text: "Permissions saved." }); await reload(); }} />}
      {tab === "activity" && <ActivityTab userId={u.id} />}
      {tab === "data" && <UserOverviewTab userId={u.id} />}
      {dialog}
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function RoleChanger({ user, onChanged }: { user: UserProfile; onChanged: () => Promise<void> }) {
  const { profile } = useAuth();
  const [role, setRole] = useState<string>(user.role);
  const { confirm, dialog } = useConfirm();
  const options = ALL_ROLES.filter((r) => r !== "SUPER_ADMIN" || profile?.isFounder).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="mb-3 text-sm font-semibold text-ink">Change role</h3>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <Select aria-label="Role" options={options} value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        <Button
          disabled={role === user.role}
          onClick={() =>
            confirm({
              title: "Change role",
              message: `${user.fullName} will become a ${ROLE_LABELS[role]}. Their individual permission overrides are cleared and they'll be signed out.`,
              confirmLabel: "Change role",
              onConfirm: async () => {
                await request(`/users/${user.id}/role`, { method: "POST", body: { role } });
                await onChanged();
              },
            })
          }
        >
          Save role
        </Button>
      </div>
      {dialog}
    </div>
  );
}

function PermissionsEditor({ detail, onSaved }: { detail: UserDetail; onSaved: () => Promise<void> }) {
  const { data: catalog } = useQuery(() => request<Catalog>("/roles"), []);
  const [overrides, setOverrides] = useState(detail.overrides);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOverrides(detail.overrides), [detail.overrides]);

  const grouped = useMemo(() => {
    const map = new Map<string, Catalog["permissions"]>();
    for (const p of catalog?.permissions ?? []) map.set(p.category, [...(map.get(p.category) ?? []), p]);
    return [...map.entries()];
  }, [catalog]);

  const overrideFor = (key: string) => overrides.find((o) => o.permissionKey === key);
  const setOverride = (key: string, value: "" | "grant" | "revoke", scope: Scope = "ALL") => {
    setOverrides((prev) => {
      const rest = prev.filter((o) => o.permissionKey !== key);
      return value === "" ? rest : [...rest, { permissionKey: key, granted: value === "grant", scope }];
    });
  };
  const editable = detail.can.setPermissions;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await request(`/users/${detail.user.id}/permissions`, { method: "PUT", body: { overrides } });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6">
      <p className="mb-4 text-sm text-muted">
        Effective permissions come from the <strong>{ROLE_LABELS[detail.user.role]}</strong> role plus individual overrides. Reserved permissions (roles, platform settings) can never be granted.
      </p>
      {error && <Alert kind="error" className="mb-4">{error}</Alert>}
      <div className="space-y-6">
        {grouped.map(([category, perms]) => (
          <div key={category}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{category}</h3>
            <ul className="divide-y divide-line rounded-control border border-line">
              {perms.map((p) => {
                const effective = detail.permissions[p.key];
                const o = overrideFor(p.key);
                return (
                  <li key={p.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-ink">{p.key}</p>
                      <p className="text-xs text-muted">{p.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {effective ? <Badge tone="success">{effective.join(", ")}</Badge> : <Badge tone="neutral">No access</Badge>}
                      {editable && !p.reserved && (
                        <select
                          aria-label={`Override for ${p.key}`}
                          value={o ? (o.granted ? `grant:${o.scope}` : "revoke") : ""}
                          onChange={(e) => {
                            const [kind, scope] = e.target.value.split(":");
                            setOverride(p.key, kind as "" | "grant" | "revoke", (scope as Scope) ?? "ALL");
                          }}
                          className="h-9 rounded-lg border border-line bg-surface px-2 text-xs focus:border-brand focus:outline-none"
                        >
                          <option value="">Role default</option>
                          <option value="grant:OWN">Grant (own)</option>
                          <option value="grant:ASSIGNED">Grant (assigned)</option>
                          <option value="grant:ALL">Grant (all)</option>
                          <option value="revoke">Revoke</option>
                        </select>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {editable && (
        <div className="mt-6 flex justify-end">
          <Button leftIcon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
            Save permissions
          </Button>
        </div>
      )}
    </section>
  );
}

function ActivityTab({ userId }: { userId: string }) {
  const { data, loading, error } = useQuery(
    () => request<{ security: AuditLogEntry[]; actions: Array<{ id: string; action: string; targetType: string; createdAt: string; actorId: string }> }>(`/users/${userId}/activity`),
    [userId],
  );
  if (loading && !data) return <Spinner className="text-brand" />;
  if (error) return <Alert kind="error">{error}</Alert>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Security events</h3>
        <ul className="divide-y divide-line text-sm">
          {data?.security.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-2">
              <span>
                {labelize(e.action)} {e.outcome === "failure" && <Badge tone="danger">Failed</Badge>}
              </span>
              <span className="shrink-0 text-xs text-muted">{formatTimestamp(e.createdAt)}</span>
            </li>
          ))}
          {!data?.security.length && <li className="py-2 text-muted">No events.</li>}
        </ul>
      </section>
      <section className="card p-5">
        <h3 className="mb-3 font-semibold">Admin actions</h3>
        <ul className="divide-y divide-line text-sm">
          {data?.actions.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 py-2">
              <span>
                {labelize(a.action)} {a.actorId === userId ? <Badge tone="brand">by this user</Badge> : <Badge>on this user</Badge>}
              </span>
              <span className="shrink-0 text-xs text-muted">{formatTimestamp(a.createdAt)}</span>
            </li>
          ))}
          {!data?.actions.length && <li className="py-2 text-muted">No actions.</li>}
        </ul>
      </section>
    </div>
  );
}

/** Owner (landlord) identity verification: status, checklist and the staff decisions. */
const KYC_ACTION_LABEL: Record<string, string> = { APPROVE: "Verified", REJECT: "Rejected", MANUAL_APPROVE: "Verified manually", REVOKE: "Verification removed", RESTORE: "Verification restored" };

function LandlordKycCard({
  kyc,
  user,
  confirm,
  onDone,
  canDecide,
  canManual,
}: {
  kyc: NonNullable<UserDetail["landlordKyc"]>;
  user: UserProfile;
  confirm: ReturnType<typeof useConfirm>["confirm"];
  onDone: (text: string) => Promise<void>;
  canDecide: boolean;
  canManual: boolean;
}) {
  const approved = kyc.kycStatus === "APPROVED";
  const ready = !!kyc.digilockerDone && !!kyc.selfieDone;
  const step = (done: boolean | undefined, label: string) => (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${done ? "text-success" : "text-muted"}`}>
      {done ? <CheckCircle2 className="size-3.5" /> : <span className="inline-block size-3.5 rounded-full border border-line" />} {label}
    </span>
  );
  return (
    <section className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          Landlord identity verification <StatusBadge status={kyc.kycStatus} />
          {approved && kyc.manual && <Badge tone="warning">Verified manually</Badge>}
        </p>
        {!approved && (
          <p className="mt-1 flex flex-wrap gap-3">
            {step(kyc.digilockerDone, "DigiLocker")}
            {step(kyc.selfieDone, "Selfie")}
          </p>
        )}
        <p className="mt-1 text-sm text-muted">
          {kyc.kycNote ?? (approved ? "Verified." : "The landlord verifies with DigiLocker and a selfie in the app. If that isn't possible, you can verify them manually after checking their ID.")}
        </p>
        {kyc.kycReviewedAt && (
          <p className="mt-0.5 text-xs text-muted">
            {approved ? "Verified" : "Reviewed"} {kyc.reviewedBy ? `by ${kyc.reviewedBy} ` : ""}on {formatTimestamp(kyc.kycReviewedAt)}
          </p>
        )}
        {!!kyc.history?.length && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer font-medium text-brand-dark">Verification history ({kyc.history.length})</summary>
            <ul className="mt-2 space-y-1.5">
              {kyc.history.map((h) => (
                <li key={`${h.action}-${h.at}`} className="rounded-control bg-subtle p-2">
                  <span className="font-medium">{KYC_ACTION_LABEL[h.action] ?? h.action}</span> · {formatTimestamp(h.at)} by {h.by.fullName ?? "a staff member"}
                  {h.reason && <span className="block text-muted">Reason: {h.reason}</span>}
                  {!!h.unpublishedListings && <span className="block text-xs text-muted">{h.unpublishedListings} listing(s) taken off</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {canDecide && user.accountStatus === "ACTIVE" && (kyc.canRevoke || kyc.canRestore) && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {kyc.canRevoke && (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  confirm({
                    title: "Remove verification",
                    message: `${user.fullName} will no longer be "Owner verified". Their live listings stay live. You can restore it later.`,
                    tone: "danger",
                    confirmLabel: "Remove",
                    reason: { label: "Reason (shown to the landlord and recorded)", required: true, minLength: 5 },
                    onConfirm: async (r) => {
                      await request(`/users/${user.id}/kyc/revoke`, { method: "POST", body: { reason: r } });
                      await onDone("Verification removed.");
                    },
                  })
                }
              >
                Remove verification
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  confirm({
                    title: "Remove verification and take listings off",
                    message: `${user.fullName} will no longer be "Owner verified" and all their live listings are taken off (tenants can't see them). Restoring later does not put the listings back; the owner publishes them again.`,
                    tone: "danger",
                    confirmLabel: "Remove and take off",
                    reason: { label: "Reason (shown to the landlord and recorded)", required: true, minLength: 5 },
                    onConfirm: async (r) => {
                      await request(`/users/${user.id}/kyc/revoke`, { method: "POST", body: { reason: r, unpublishListings: true } });
                      await onDone("Verification removed and listings taken off.");
                    },
                  })
                }
              >
                Remove + take listings off
              </Button>
            </>
          )}
          {kyc.canRestore && (
            <Button
              leftIcon={<RotateCcw className="size-4" />}
              onClick={() =>
                confirm({
                  title: "Restore verification",
                  message: `${user.fullName} will be "Owner verified" again, as before the removal. Listings taken off are not put back automatically.`,
                  confirmLabel: "Restore",
                  reason: { label: "Reason (recorded)", required: true, minLength: 5 },
                  onConfirm: async (r) => {
                    await request(`/users/${user.id}/kyc/restore`, { method: "POST", body: { reason: r } });
                    await onDone("Verification restored.");
                  },
                })
              }
            >
              Restore verification
            </Button>
          )}
        </div>
      )}
      {!approved && (canDecide || canManual) && user.accountStatus === "ACTIVE" && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {canDecide && (
            <Button
              variant="secondary"
              onClick={() =>
                confirm({
                  title: "Reject identity",
                  message: "The landlord is told the reason and can submit again.",
                  tone: "danger",
                  confirmLabel: "Reject",
                  reason: { label: "Reason (shown to the landlord)", required: true, minLength: 5 },
                  onConfirm: async (r) => {
                    await request(`/users/${user.id}/kyc`, { method: "POST", body: { decision: "REJECTED", note: r } });
                    await onDone("Identity rejected.");
                  },
                })
              }
            >
              Reject
            </Button>
          )}
          {canDecide && ready && (
            <Button
              onClick={() =>
                confirm({
                  title: "Verify identity",
                  message: `Confirm the DigiLocker details and the selfie match ${user.fullName}.`,
                  confirmLabel: "Verify",
                  onConfirm: async () => {
                    await request(`/users/${user.id}/kyc`, { method: "POST", body: { decision: "APPROVED" } });
                    await onDone("Identity verified.");
                  },
                })
              }
            >
              Verify identity
            </Button>
          )}
          {canManual && (
            <Button
              variant={ready ? "secondary" : "primary"}
              leftIcon={<ShieldCheck className="size-4" />}
              onClick={() =>
                confirm({
                  title: "Verify manually",
                  message: `${user.fullName} will be marked as a verified owner without DigiLocker / selfie. Only do this after checking their government ID and ownership yourself. Your name and reason are recorded.`,
                  confirmLabel: "Verify manually",
                  reason: { label: "Reason (e.g. ID checked in person at office)", required: true, minLength: 5 },
                  onConfirm: async (r) => {
                    await request(`/users/${user.id}/kyc/manual-verify`, { method: "POST", body: { reason: r } });
                    await onDone("Landlord verified manually.");
                  },
                })
              }
            >
              Verify manually
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
