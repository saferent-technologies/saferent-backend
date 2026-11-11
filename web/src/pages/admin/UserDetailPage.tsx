import { ArrowLeft, Ban, CheckCircle2, LogOut, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
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
import { UserOverviewTab } from "./UserOverview";
import { useQuery } from "@/hooks/useQuery";
import { Avatar } from "@/layouts/DashboardLayout";
import { request } from "@/services/api";
import type { AuditLogEntry, Permissions, Scope, UserProfile } from "@/types/auth";
import { ALL_ROLES, ROLE_LABELS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp, labelize } from "@/utils/format";

interface UserDetail {
  user: UserProfile;
  permissions: Permissions;
  overrides: Array<{ permissionKey: string; granted: boolean; scope: Scope }>;
  session: { method: string; verifiedAt: string; expiresAt: string; revoked: boolean } | null;
  landlordKyc: { kycStatus: string; kycNote: string | null; kycReviewedAt: string | null } | null;
  can: { manage: boolean; assignRole: boolean; setPermissions: boolean; addRoles: string[]; removeRoles: string[] };
}

interface Catalog {
  permissions: Array<{ key: string; category: string; description: string; reserved?: boolean }>;
}

type Tab = "overview" | "data" | "permissions" | "activity";

export function UserDetailPage() {
  const { id = "" } = useParams();
  const { can: canDo } = useAuth();
  // Staff without users.view (e.g. Finance) land straight on the user's records.
  const [tab, setTab] = useState<Tab>(() => (canDo("users.view") ? "overview" : "data"));
  const { data, loading, error, reload } = useQuery(() => request<UserDetail>(`/users/${id}`), [id]);
  const { can } = useAuth();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error ?? "User not found."}</Alert>;
  const u = data.user;

  const act = (title: string, body: string, path: string, payload?: unknown, tone: "primary" | "danger" = "primary", reason = false) =>
    confirm({
      title,
      message: body,
      tone,
      confirmLabel: title,
      reason: reason ? { label: "Reason (recorded in the activity log)", required: true, minLength: 5 } : undefined,
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
          data.can.manage && (
            <>
              {u.accountStatus === "ACTIVE" ? (
                <Button variant="secondary" leftIcon={<Ban className="size-4" />} onClick={() => act("Deactivate account", `${u.fullName} will be signed out and won't be able to sign in.`, `/users/${u.id}/status`, { status: "DEACTIVATED" }, "danger", true)}>
                  Deactivate
                </Button>
              ) : (
                <Button variant="secondary" leftIcon={<CheckCircle2 className="size-4" />} onClick={() => act("Activate account", `${u.fullName} will be able to sign in again.`, `/users/${u.id}/status`, { status: "ACTIVE" })}>
                  Activate
                </Button>
              )}
              <Button variant="secondary" leftIcon={<LogOut className="size-4" />} onClick={() => act("Revoke sessions", `${u.fullName} will be signed out on every device.`, `/users/${u.id}/revoke-sessions`, undefined, "danger")}>
                Revoke sessions
              </Button>
            </>
          )
        }
      />
      {message && <Alert kind={message.kind} className="mb-4">{message.text}</Alert>}
      {data.landlordKyc && (
        <section className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Landlord identity verification <StatusBadge status={data.landlordKyc.kycStatus} /></p>
            <p className="text-sm text-muted">{data.landlordKyc.kycNote ?? "Check the landlord's government ID offline, then record the decision here. Verification unlocks referral rewards."}</p>
          </div>
          {can("users.manage") && data.landlordKyc.kycStatus !== "APPROVED" && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => confirm({ title: "Reject identity", message: "The landlord is told the reason.", tone: "danger", confirmLabel: "Reject", reason: { label: "Reason", required: true, minLength: 5 }, onConfirm: async (r) => { await request(`/users/${u.id}/kyc`, { method: "POST", body: { decision: "REJECTED", note: r } }); setMessage({ kind: "success", text: "Identity rejected." }); await reload(); } })}>Reject</Button>
              <Button onClick={() => confirm({ title: "Verify identity", message: `Confirm you have checked ${u.fullName}'s identity documents.`, confirmLabel: "Verify", onConfirm: async () => { await request(`/users/${u.id}/kyc`, { method: "POST", body: { decision: "APPROVED" } }); setMessage({ kind: "success", text: "Identity verified." }); await reload(); } })}>Verify identity</Button>
            </div>
          )}
        </section>
      )}
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
            </dl>
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
