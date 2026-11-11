import { Building2, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { DataTable, EmptyState, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { AuthImage } from "@/components/ui/AuthImage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { formatMoney, labelize, toOptions } from "@/utils/format";
import { ACTIVE_STATUSES, imagePath, rentRange, type PropertySummary } from "./types";

const FILTERS = ["publicationStatus", "activeStatus", "category"];
type View = "" | "DRAFT" | "PENDING_VERIFICATION" | "REJECTED" | "APPROVED" | "PUBLISHED";

export function PropertiesPage() {
  const navigate = useNavigate();
  const { can, activeRole } = useAuth();
  const filters = useMemo(() => FILTERS, []);
  const list = useListParams(filters);
  const { data, loading, error, reload } = useQuery(() => request<Paged<PropertySummary>>("/properties", { query: list.query }), [list.query]);
  const { confirm, dialog } = useConfirm();
  const deleteDraft = (p: PropertySummary) =>
    confirm({
      title: "Delete draft",
      message: `"${p.title ?? p.code}" and its photos and documents will be deleted permanently. This can't be undone.`,
      tone: "danger",
      confirmLabel: "Delete",
      onConfirm: async () => {
        await request(`/properties/${p.id}`, { method: "DELETE" });
        await reload();
      },
    });
  const role = activeRole?.key;
  const title = role === "LANDLORD" ? "My properties" : role === "PROPERTY_MANAGER" ? "Assigned properties" : role === "PROPERTY_AGENT" ? "My listings" : "Properties";
  const open = (p: PropertySummary) => navigate(p.publicationStatus === "DRAFT" && can("properties.manage") ? `/properties/${p.id}/edit?step=${Math.max(3, p.wizardStep)}` : `/properties/${p.id}`);

  const thumb = (p: PropertySummary) =>
    p.coverImageId ? (
      <AuthImage path={imagePath(p.coverImageId)} alt="" className="size-12 shrink-0 rounded-lg" />
    ) : (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted"><Building2 className="size-5" /></span>
    );

  return (
    <>
      <PageHeader
        title={title}
        description="Search by SafeRent ID, title, locality, city or PIN code."
        actions={can("properties.create") && <Button leftIcon={<Plus className="size-4" />} onClick={() => navigate("/properties/new")}>Add property</Button>}
      />
      <div className="mb-4 overflow-x-auto">
        <Tabs<View>
          idPrefix="props"
          className="min-w-[40rem] max-w-4xl"
          value={(list.filters.publicationStatus as View) ?? ""}
          onChange={(v) => list.setFilter("publicationStatus", v)}
          items={[
            { value: "", label: "All" },
            { value: "DRAFT", label: "Drafts" },
            { value: "PENDING_VERIFICATION", label: "Pending" },
            { value: "REJECTED", label: "Needs changes" },
            { value: "APPROVED", label: "Approved" },
            { value: "PUBLISHED", label: "Published" },
          ]}
        />
      </div>
      <ListToolbar
        search={list.q}
        onSearch={list.setSearch}
        placeholder="Search properties"
        filters={[
          { name: "activeStatus", label: "Active status", options: toOptions(ACTIVE_STATUSES) },
          { name: "category", label: "Category", options: toOptions(["RESIDENTIAL", "COMMERCIAL", "LAND"]) },
        ]}
        values={list.filters}
        onFilter={list.setFilter}
      />
      {data && data.total === 0 && !list.q && !Object.values(list.filters).some(Boolean) ? (
        <EmptyState
          text={role === "LANDLORD" ? "You haven't added a property yet." : "No properties are available to you yet."}
          action={can("properties.create") && <Button onClick={() => navigate("/properties/new")}>Add your first property</Button>}
        />
      ) : (
        <DataTable
          rows={data?.items}
          loading={loading}
          error={error}
          rowKey={(p) => p.id}
          onRowClick={open}
          empty="No properties match these filters."
          columns={[
            {
              key: "title",
              header: "Property",
              render: (p) => (
                <span className="flex items-center gap-3">
                  {thumb(p)}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.title ?? `${p.propertyTypeLabel} draft`}</span>
                    <span className="block truncate text-xs text-muted">{p.code} · {[p.locality, p.city].filter(Boolean).join(", ") || "No address yet"}</span>
                  </span>
                </span>
              ),
            },
            { key: "type", header: "Type", render: (p) => `${p.propertyTypeLabel} · ${labelize(p.listingType)}`, className: "hidden lg:table-cell" },
            { key: "rent", header: "Rent", render: (p) => rentRange(p.rentFrom, p.rentTo, formatMoney) },
            { key: "units", header: "Available", render: (p) => `${p.availableCount} / ${p.availableCount + p.occupiedCount}`, className: "hidden xl:table-cell" },
            { key: "score", header: "Complete", render: (p) => `${p.completenessScore}%`, className: "hidden md:table-cell" },
            {
              key: "status",
              header: "Status",
              render: (p) => (
                <span className="flex flex-wrap gap-1">
                  <StatusBadge status={p.publicationStatus} />
                  {p.activeStatus !== "ACTIVE" && <StatusBadge status={p.activeStatus} />}
                  {p.verificationStatus === "VERIFIED" && <Badge tone="success">Verified</Badge>}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (p) =>
                p.publicationStatus === "DRAFT" && can("properties.manage") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete draft ${p.code}`}
                    leftIcon={<Trash2 className="size-4 text-danger" />}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDraft(p);
                    }}
                  >
                    Delete
                  </Button>
                ) : null,
            },
          ]}
          mobile={(p) => (
            <div className="flex items-center gap-3">
              {thumb(p)}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.title ?? `${p.propertyTypeLabel} draft`}</p>
                <p className="truncate text-xs text-muted">{p.code} · {rentRange(p.rentFrom, p.rentTo, formatMoney)} · {p.completenessScore}%</p>
              </div>
              <StatusBadge status={p.publicationStatus} />
              {p.publicationStatus === "DRAFT" && can("properties.manage") && (
                <button
                  type="button"
                  aria-label={`Delete draft ${p.code}`}
                  className="flex size-10 items-center justify-center rounded-lg text-danger hover:bg-danger/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDraft(p);
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          )}
        />
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {dialog}
    </>
  );
}
