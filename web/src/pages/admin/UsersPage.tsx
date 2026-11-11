import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PhoneField } from "@/components/ui/PhoneField";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { Avatar } from "@/layouts/DashboardLayout";
import { request } from "@/services/api";
import type { Paged, UserProfile } from "@/types/auth";
import { ALL_ROLES, ROLE_LABELS, STAFF_ROLES } from "@/utils/constants";
import { errorMessage } from "@/utils/errors";
import { formatDate, toOptions } from "@/utils/format";

const ROLE_OPTIONS = ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export function UsersPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useListParams(["role", "status"]);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useQuery(() => request<Paged<UserProfile>>("/users", { query: list.query }), [list.query]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Every SafeRent account — staff, landlords, tenants, agents and service providers."
        actions={
          can("users.manage") && (
            <Button leftIcon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
              Add user
            </Button>
          )
        }
      />
      <ListToolbar
        search={list.q}
        onSearch={list.setSearch}
        placeholder="Search name, email or phone"
        filters={[
          { name: "role", label: "Role", options: ROLE_OPTIONS },
          { name: "status", label: "Status", options: toOptions(["ACTIVE", "SUSPENDED", "DEACTIVATED"]) },
        ]}
        values={list.filters}
        onFilter={list.setFilter}
      />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(u) => u.id}
        onRowClick={(u) => navigate(`/users/${u.id}`)}
        empty="No users match these filters."
        columns={[
          {
            key: "name",
            header: "User",
            render: (u) => (
              <span className="flex items-center gap-3">
                <Avatar name={u.fullName} image={u.profileImage} size="size-8" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{u.fullName}</span>
                  <span className="block truncate text-xs text-muted">{u.email ?? u.phoneNumber}</span>
                </span>
              </span>
            ),
          },
          { key: "role", header: "Role", render: (u) => <span className="flex items-center gap-1.5">{ROLE_LABELS[u.role]}{u.isFounder && <Badge tone="brand">Founder</Badge>}</span> },
          { key: "status", header: "Status", render: (u) => <StatusBadge status={u.accountStatus} /> },
          { key: "last", header: "Last sign-in", render: (u) => formatDate(u.lastLoginAt), className: "hidden lg:table-cell" },
        ]}
        mobile={(u) => (
          <div className="flex items-center gap-3">
            <Avatar name={u.fullName} image={u.profileImage} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{u.fullName}</p>
              <p className="truncate text-xs text-muted">{ROLE_LABELS[u.role]} · {u.email ?? u.phoneNumber}</p>
            </div>
            <StatusBadge status={u.accountStatus} />
          </div>
        )}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      <CreateUserModal open={creating} onClose={() => setCreating(false)} onCreated={() => void reload()} />
    </>
  );
}

const createSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the full name."),
    role: z.string().min(1, "Choose a role."),
    email: z.string().trim().optional(),
    phoneNumber: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    const staff = (STAFF_ROLES as readonly string[]).includes(v.role);
    if (staff && !/^[^@\s]+@saferenttechnologies\.com$/i.test(v.email ?? "")) ctx.addIssue({ code: "custom", path: ["email"], message: "Use an @saferenttechnologies.com email." });
    if (!staff && v.role && !/^\+[1-9]\d{7,14}$/.test(v.phoneNumber ?? "")) ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "Enter a valid phone number." });
  });
type CreateValues = z.infer<typeof createSchema>;

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { profile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { fullName: "", role: "", email: "", phoneNumber: "" } });
  const role = watch("role");
  const staff = (STAFF_ROLES as readonly string[]).includes(role);
  // The API enforces the same rule: only lower roles, and only the founder can create Super Admins.
  const allowedRoles = ROLE_OPTIONS.filter((o) => (o.value === "SUPER_ADMIN" ? profile?.isFounder : profile?.isFounder || o.value !== profile?.role));

  const close = () => {
    reset();
    setError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await request("/users", { method: "POST", body: { fullName: v.fullName, role: v.role, email: staff ? v.email : undefined, phoneNumber: v.phoneNumber || undefined } });
      onCreated();
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Modal open={open} onClose={close} title="Add user" description="Staff receive an email to set their password. Others sign in with their phone number.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <Input label="Full name" error={errors.fullName?.message} {...register("fullName")} />
        <Select label="Role" placeholder="Choose a role" options={allowedRoles} error={errors.role?.message} {...register("role")} />
        {role && staff && <Input label="Work email" type="email" placeholder="name@saferenttechnologies.com" error={errors.email?.message} {...register("email")} />}
        {role && <PhoneField label={staff ? "Phone (optional)" : "Phone number"} value={watch("phoneNumber") ?? ""} onChange={(v) => setValue("phoneNumber", v, { shouldValidate: !!errors.phoneNumber })} error={errors.phoneNumber?.message} />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Create account
          </Button>
        </div>
      </form>
    </Modal>
  );
}
