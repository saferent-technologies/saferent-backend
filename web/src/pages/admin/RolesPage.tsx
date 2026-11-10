import { Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Scope } from "@/types/auth";
import { errorMessage } from "@/utils/errors";

interface RoleRow {
  key: string;
  name: string;
  description: string;
  rank: number;
  isStaff: boolean;
  userCount: number;
  permissions: Record<string, Scope>;
}
interface RolesResponse {
  roles: RoleRow[];
  permissions: Array<{ key: string; category: string; description: string; reserved?: boolean }>;
}

const SCOPE_TONE: Record<Scope, "success" | "brand" | "neutral"> = { ALL: "success", ASSIGNED: "brand", OWN: "neutral" };

export function RolesPage() {
  const { data, loading, error, reload } = useQuery(() => request<RolesResponse>("/roles"), []);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error || !data) return <Alert kind="error">{error}</Alert>;

  return (
    <>
      <PageHeader title="Roles & permissions" description="Each role's default permissions and scope. ALL = every record, ASSIGNED = assigned records, OWN = the user's own records." />
      {notice && <Alert kind="success" className="mb-4">{notice}</Alert>}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.roles.map((r) => (
          <section key={r.key} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-ink">{r.name}</h2>
                <p className="text-xs text-muted">{r.isStaff ? "Staff · email + OTP" : "Phone OTP"} · {r.userCount} user{r.userCount === 1 ? "" : "s"}</p>
              </div>
              <Badge tone="brand">{Object.keys(r.permissions).length} perms</Badge>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{r.description}</p>
            {r.key !== "SUPER_ADMIN" && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<RotateCcw className="size-4" />}
                  onClick={() =>
                    confirm({
                      title: `Reset ${r.name}`,
                      message: "Restore SafeRent's default permissions for this role?",
                      confirmLabel: "Reset",
                      onConfirm: async () => {
                        await request(`/roles/${r.key}/reset`, { method: "POST" });
                        setNotice(`${r.name} reset to defaults.`);
                        await reload();
                      },
                    })
                  }
                >
                  Reset
                </Button>
              </div>
            )}
          </section>
        ))}
      </div>

      <h2 className="mb-3 text-base font-semibold text-ink">Permission matrix</h2>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-subtle/60">
            <tr>
              <th scope="col" className="sticky left-0 bg-subtle px-3 py-2 font-semibold text-muted">Permission</th>
              {data.roles.map((r) => (
                <th key={r.key} scope="col" className="px-2 py-2 text-center font-semibold text-muted">{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.permissions.map((p) => (
              <tr key={p.key}>
                <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-mono font-medium text-ink" title={p.description}>
                  {p.key} {p.reserved && <Badge tone="danger">reserved</Badge>}
                </th>
                {data.roles.map((r) => {
                  const scope = r.permissions[p.key];
                  return (
                    <td key={r.key} className="px-2 py-2 text-center">
                      {scope ? <Badge tone={SCOPE_TONE[scope]}>{scope}</Badge> : <span className="text-line">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditRoleModal role={editing} catalog={data.permissions} onClose={() => setEditing(null)} onSaved={async () => { setNotice(`${editing.name} permissions saved.`); setEditing(null); await reload(); }} />}
      {dialog}
    </>
  );
}

function EditRoleModal({ role, catalog, onClose, onSaved }: { role: RoleRow; catalog: RolesResponse["permissions"]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [perms, setPerms] = useState<Record<string, Scope>>(role.permissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = useMemo(() => catalog.filter((p) => !p.reserved), [catalog]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await request(`/roles/${role.key}/permissions`, { method: "PUT", body: { permissions: Object.entries(perms).map(([permissionKey, scope]) => ({ permissionKey, scope })) } });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${role.name}`} description="Changes apply to every user with this role within 30 seconds. All changes are logged.">
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto rounded-control border border-line">
        {editable.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 p-2.5">
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs font-semibold">{p.key}</span>
              <span className="block truncate text-xs text-muted">{p.description}</span>
            </span>
            <select
              aria-label={p.key}
              value={perms[p.key] ?? ""}
              onChange={(e) =>
                setPerms((prev) => {
                  const next = { ...prev };
                  if (e.target.value) next[p.key] = e.target.value as Scope;
                  else delete next[p.key];
                  return next;
                })
              }
              className="h-9 shrink-0 rounded-lg border border-line bg-surface px-2 text-xs focus:border-brand focus:outline-none"
            >
              <option value="">None</option>
              <option value="OWN">Own</option>
              <option value="ASSIGNED">Assigned</option>
              <option value="ALL">All</option>
            </select>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}
