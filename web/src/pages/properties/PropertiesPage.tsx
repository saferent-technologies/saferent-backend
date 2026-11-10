import { Building2, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { DataTable, EmptyState, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { formatMoney, labelize, toOptions } from "@/utils/format";
import { imagePath, PROPERTY_STATUSES, type Property } from "./types";

export function PropertiesPage() {
  const navigate = useNavigate();
  const { can, profile } = useAuth();
  const list = useListParams(["status"]);
  const { data, loading, error } = useQuery(() => request<Paged<Property>>("/properties", { query: list.query }), [list.query]);
  const title = profile?.role === "LANDLORD" ? "My properties" : profile?.role === "PROPERTY_MANAGER" ? "Assigned properties" : profile?.role === "PROPERTY_AGENT" ? "My listings" : "Properties";

  const thumb = (p: Property) =>
    p.images[0] ? (
      <AuthImage path={imagePath(p.images[0].id)} alt="" className="size-12 shrink-0 rounded-lg" />
    ) : (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted">
        <Building2 className="size-5" />
      </span>
    );

  return (
    <>
      <PageHeader
        title={title}
        description="Search by title, locality, city or PIN code."
        actions={can("properties.create") && <Button leftIcon={<Plus className="size-4" />} onClick={() => navigate("/properties/new")}>Add property</Button>}
      />
      <ListToolbar search={list.q} onSearch={list.setSearch} placeholder="Search properties" filters={[{ name: "status", label: "Status", options: toOptions(PROPERTY_STATUSES) }]} values={list.filters} onFilter={list.setFilter} />
      {data && data.total === 0 && !list.q && !list.filters.status ? (
        <EmptyState
          text={profile?.role === "LANDLORD" ? "You haven't added a property yet." : "No properties are available to you yet."}
          action={can("properties.create") && <Button onClick={() => navigate("/properties/new")}>Add your first property</Button>}
        />
      ) : (
        <DataTable
          rows={data?.items}
          loading={loading}
          error={error}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/properties/${p.id}`)}
          empty="No properties match these filters."
          columns={[
            {
              key: "title",
              header: "Property",
              render: (p) => (
                <span className="flex items-center gap-3">
                  {thumb(p)}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.title}</span>
                    <span className="block truncate text-xs text-muted">{[p.locality, p.city].filter(Boolean).join(", ")}</span>
                  </span>
                </span>
              ),
            },
            { key: "type", header: "Type", render: (p) => labelize(p.propertyType), className: "hidden lg:table-cell" },
            { key: "rent", header: "Rent", render: (p) => formatMoney(p.monthlyRent) },
            { key: "status", header: "Status", render: (p) => <span className="flex flex-wrap gap-1"><StatusBadge status={p.status} />{p.verified && <Badge tone="success">Verified</Badge>}</span> },
            { key: "apps", header: "Applications", render: (p) => p._count?.applications ?? 0, className: "hidden xl:table-cell" },
          ]}
          mobile={(p) => (
            <div className="flex items-center gap-3">
              {thumb(p)}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.title}</p>
                <p className="truncate text-xs text-muted">{p.city} · {formatMoney(p.monthlyRent)}/mo</p>
              </div>
              <StatusBadge status={p.status} />
            </div>
          )}
        />
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
    </>
  );
}
