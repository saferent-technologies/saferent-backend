import { BadgeCheck, Camera, CircleAlert, LogOut, Save, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { UploadButton } from "@/components/ui/UploadButton";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { Avatar } from "@/layouts/DashboardLayout";
import { request } from "@/services/api";
import type { Role, RoleInfo, UserProfile } from "@/types/auth";
import { PATHS } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { formatTimestamp } from "@/utils/format";
import { maskPhone } from "@/utils/mask";
import { PanSettingsCard } from "./PanSettingsCard";

type FieldDef = { key: string; label: string; type?: "text" | "number" | "date" | "tel" | "checkbox"; hint?: string };

/** Role-specific profile fields (stored in landlord_profiles, tenant_profiles, agent_profiles, service_provider_profiles). */
const ROLE_FIELDS: Partial<Record<Role, { title: string; fields: FieldDef[] }>> = {
  LANDLORD: {
    title: "Landlord details",
    fields: [
      { key: "businessName", label: "Business name (optional)" },
      { key: "address", label: "Address" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "pincode", label: "PIN code" },
    ],
  },
  TENANT: {
    title: "Tenant details",
    fields: [
      { key: "occupation", label: "Occupation", hint: "Shown to landlords when you apply." },
      { key: "employer", label: "Employer" },
      { key: "currentCity", label: "Current city" },
      { key: "familySize", label: "Family size", type: "number" },
      { key: "preferredMoveIn", label: "Preferred move-in", type: "date" },
      { key: "emergencyContactName", label: "Emergency contact name" },
      { key: "emergencyContactPhone", label: "Emergency contact phone", type: "tel" },
    ],
  },
  PROPERTY_AGENT: {
    title: "Agent details",
    fields: [
      { key: "agencyName", label: "Agency name" },
      { key: "licenseNumber", label: "RERA / licence number" },
      { key: "serviceAreas", label: "Service areas" },
      { key: "experienceYears", label: "Years of experience", type: "number" },
    ],
  },
  SERVICE_PROVIDER: {
    title: "Service details",
    fields: [
      { key: "businessName", label: "Business name" },
      { key: "categories", label: "Services offered", hint: "e.g. Plumbing, Electrical" },
      { key: "serviceAreas", label: "Service areas" },
      { key: "available", label: "Available for new jobs", type: "checkbox" },
    ],
  },
};

interface ProfileResponse {
  user: UserProfile;
  roleInfo: RoleInfo;
  roleProfile: Record<string, unknown> | null;
}

export function ProfilePage() {
  const { profile, session, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const { data, loading, reload } = useQuery(() => request<ProfileResponse>("/profile"), []);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleProfile, setRoleProfile] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setFullName(data.user.fullName);
    setEmail(data.user.email ?? "");
    const rp = { ...(data.roleProfile ?? {}) };
    if (typeof rp.preferredMoveIn === "string") rp.preferredMoveIn = rp.preferredMoveIn.slice(0, 10);
    setRoleProfile(rp);
  }, [data]);

  if (!profile) return null;
  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  const u = data?.user ?? profile;
  const staff = data?.roleInfo.isStaff ?? false;
  const roleFields = ROLE_FIELDS[u.role];

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const rp = roleFields ? Object.fromEntries(roleFields.fields.map((f) => [f.key, roleProfile[f.key] === "" ? null : roleProfile[f.key] ?? null])) : undefined;
      await request("/profile", { method: "PUT", body: { fullName, email: staff ? undefined : email, roleProfile: rp } });
      setMsg({ kind: "success", text: "Profile saved." });
      await Promise.all([reload(), refresh()]);
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Profile"
        description={`${data?.roleInfo.name ?? ""} account`}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Settings className="size-4" />} onClick={() => navigate(PATHS.settings)}>Security</Button>
            <Button variant="secondary" leftIcon={<LogOut className="size-4" />} onClick={async () => { await logout(); navigate(PATHS.login, { replace: true }); }}>Sign out</Button>
          </>
        }
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <div className="grid max-w-5xl gap-6 lg:grid-cols-3">
        <section className="card flex flex-col items-center p-6 text-center">
          <Avatar name={u.fullName} image={u.profileImage} size="size-24" />
          <div className="mt-3">
            <UploadButton path="/profile/image" field="file" multiple={false} label="Change photo" icon={<Camera className="size-4" />} onDone={() => { setMsg({ kind: "success", text: "Photo updated." }); void refresh(); void reload(); }} onError={(t) => setMsg({ kind: "error", text: t })} />
          </div>
          <h2 className="mt-4 break-words text-lg font-semibold">{u.fullName}</h2>
          <MyRoles onChanged={async () => { setMsg({ kind: "success", text: "Roles updated." }); await refresh(); }} onError={(t) => setMsg({ kind: "error", text: t })} />
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Badge tone="brand">{data?.roleInfo.name}</Badge>
            {u.isFounder && <Badge tone="brand">Founder</Badge>}
            <Badge tone={u.accountStatus === "ACTIVE" ? "success" : "danger"}>{u.accountStatus === "ACTIVE" ? "Active" : u.accountStatus}</Badge>
          </div>
          <dl className="mt-5 w-full space-y-2 text-left text-sm">
            <Row label="Phone" value={u.phoneNumber ? maskPhone(u.phoneNumber) : "Not set"} verified={u.phoneVerified} />
            <Row label="Email" value={u.email ?? "Not set"} verified={u.email ? u.emailVerified : undefined} />
            <Row label="Last sign-in" value={formatTimestamp(u.lastLoginAt)} />
            <Row label="Session" value={session ? `${session.method === "PHONE_OTP" ? "Phone OTP" : "Email OTP"} · until ${formatTimestamp(session.expiresAt)}` : "—"} />
            <Row label="Member since" value={formatTimestamp(u.createdAt)} />
          </dl>
        </section>

        <section className="card space-y-4 p-5 sm:p-6 lg:col-span-2">
          <h2 className="font-semibold">Personal details</h2>
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
          {staff ? (
            <Input label="Work email" value={u.email ?? ""} disabled hint="Change your sign-in email in Security settings." />
          ) : (
            <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Used for receipts and updates. Not used to sign in." />
          )}
          {roleFields && (
            <>
              <h2 className="pt-2 font-semibold">{roleFields.title}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {roleFields.fields.map((f) =>
                  f.type === "checkbox" ? (
                    <Checkbox key={f.key} label={f.label} checked={roleProfile[f.key] !== false} onChange={(e) => setRoleProfile((p) => ({ ...p, [f.key]: e.target.checked }))} />
                  ) : (
                    <Input
                      key={f.key}
                      label={f.label}
                      hint={f.hint}
                      type={f.type ?? "text"}
                      value={roleProfile[f.key] === null || roleProfile[f.key] === undefined ? "" : String(roleProfile[f.key])}
                      onChange={(e) => setRoleProfile((p) => ({ ...p, [f.key]: f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value }))}
                    />
                  ),
                )}
              </div>
            </>
          )}
          <div className="flex justify-end">
            <Button leftIcon={<Save className="size-4" />} loading={saving} disabled={fullName.trim().length < 2} onClick={() => void save()}>Save profile</Button>
          </div>
        </section>
        {u.role === "LANDLORD" && (
          <section className="card flex flex-wrap items-center justify-between gap-3 p-5 lg:col-span-3">
            <div>
              <h2 className="font-semibold">Owner verification</h2>
              <p className="text-sm text-muted">DigiLocker ID + live selfie + ownership proof. Your listings go live only after you're verified.</p>
            </div>
            <Button variant="secondary" onClick={() => navigate("/verify")}>Open verification</Button>
          </section>
        )}
        {u.role === "LANDLORD" && <PanSettingsCard />}
      </div>
    </>
  );
}

function Row({ label, value, verified }: { label: string; value: string; verified?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 text-right font-medium text-ink">
        <span className="break-all">{value}</span>
        {verified === true && <BadgeCheck aria-label="Verified" className="size-4 shrink-0 text-success" />}
        {verified === false && <CircleAlert aria-label="Not verified" className="size-4 shrink-0 text-warning" />}
      </dd>
    </div>
  );
}

/** Multi-role: a landlord can also rent (TENANT), a tenant can also list property (LANDLORD). */
function MyRoles({ onChanged, onError }: { onChanged: () => Promise<void>; onError: (t: string) => void }) {
  const { data, reload } = useQuery(() => request<{ roles: Array<{ key: string; name: string; primary: boolean }>; canAdd: string[] }>("/me/roles"), []);
  const [busy, setBusy] = useState(false);
  if (!data || (data.canAdd.length === 0 && data.roles.length < 2)) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      await onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 w-full rounded-control bg-subtle p-3 text-left text-sm">
      <p className="mb-2 font-semibold">Your roles</p>
      <ul className="space-y-1">
        {data.roles.map((r) => (
          <li key={r.key} className="flex items-center justify-between">
            <span>{r.name}{r.primary ? " (primary)" : ""}</span>
            {!r.primary && <button type="button" disabled={busy} className="text-xs font-semibold text-danger" onClick={() => void run(() => request(`/me/roles/${r.key}`, { method: "DELETE" }))}>Remove</button>}
          </li>
        ))}
      </ul>
      {data.canAdd.map((r) => (
        <Button key={r} size="sm" variant="secondary" className="mt-2 w-full" loading={busy} onClick={() => void run(() => request("/me/roles", { method: "POST", body: { role: r } }))}>
          {r === "TENANT" ? "I also want to rent a home" : r === "LANDLORD" ? "I also want to list my property" : `Add ${r}`}
        </Button>
      ))}
    </div>
  );
}
