import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { DataTable, EmptyState, Pagination } from "@/components/data/DataTable";
import { ListToolbar } from "@/components/data/ListToolbar";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { AuthImage } from "@/components/ui/AuthImage";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { useAuth } from "@/hooks/useAuth";
import { useListParams } from "@/hooks/useListParams";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import type { Paged } from "@/types/auth";
import { formatTimestamp, labelize, toOptions } from "@/utils/format";
import { imagePath } from "../properties/types";

interface Queue {
  properties: Array<{ id: string; code: string; title: string | null; city: string | null; propertyTypeLabel: string; completenessScore: number; submittedAt: string | null; owner: { fullName: string } | null }>;
  images: Array<{ id: string; category: string; createdAt: string; property: { id: string; code: string; title: string | null } }>;
  documents: Array<{ id: string; code: string; docType: string; originalName: string; createdAt: string; property: { id: string; code: string; title: string | null } }>;
}

type Tab = "listings" | "images" | "documents" | "fraud";

export function ModerationPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabs = (
    [
      { value: "listings", label: "Listings", perm: "listings.approve" },
      { value: "images", label: "Images", perm: "listings.approve" },
      { value: "documents", label: "Documents", perm: "documents.verify" },
      { value: "fraud", label: "Fraud reports", perm: "fraud.manage" },
    ] as const
  ).filter((t) => can(t.perm));
  const tab: Tab = tabs.find((t) => t.value === params.get("tab"))?.value ?? tabs[0]?.value ?? "listings";
  const { data, loading, error, reload } = useQuery(() => request<Queue>("/properties/review-queue"), [], tab !== "fraud");
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const moderateImage = (imageId: string, decision: "APPROVE" | "REJECT") =>
    request(`/moderation/images/${imageId}`, { method: "POST", body: { decision } }).then(() => {
      setMsg(`Image ${decision === "APPROVE" ? "approved" : "rejected"}.`);
      return reload();
    });

  return (
    <>
      <PageHeader title="Moderation" description="Review listings, photos and ownership documents before tenants see them." />
      <Tabs<Tab> idPrefix="mod" className="mb-5 max-w-2xl" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={tabs.map((t) => ({ value: t.value, label: t.label + (data && t.value !== "fraud" ? ` (${data[t.value === "listings" ? "properties" : t.value].length})` : "") }))} />
      {msg && <Alert kind="success" className="mb-4">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {tab !== "fraud" && loading && !data && <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>}

      {tab === "listings" && data && (
        <DataTable
          rows={data.properties}
          rowKey={(l) => l.id}
          empty="No properties waiting for verification. 🎉"
          columns={[
            { key: "title", header: "Property", render: (l) => <Link to={`/properties/${l.id}`} className="font-semibold hover:text-brand"><span className="block">{l.title ?? l.code}</span><span className="text-xs font-normal text-muted">{l.code} · {l.propertyTypeLabel}{l.city ? ` · ${l.city}` : ""}</span></Link> },
            { key: "owner", header: "Owner", render: (l) => l.owner?.fullName ?? "—" },
            { key: "score", header: "Completeness", render: (l) => `${l.completenessScore}%` },
            { key: "updated", header: "Submitted", render: (l) => formatTimestamp(l.submittedAt), className: "hidden lg:table-cell" },
            { key: "actions", header: "", className: "text-right", render: (l) => <Button size="sm" onClick={() => navigate(`/properties/${l.id}`)}>Review</Button> },
          ]}
        />
      )}

      {tab === "images" && data && (data.images.length === 0 ? (
        <EmptyState text="No photos waiting for review." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.images.map((img) => (
            <li key={img.id} className="card overflow-hidden">
              <AuthImage path={imagePath(img.id)} alt={`Photo of ${img.property.title ?? img.property.code}`} className="aspect-[4/3] w-full" />
              <div className="space-y-2 p-3">
                <Link to={`/properties/${img.property.id}`} className="block truncate text-sm font-semibold hover:text-brand">{img.property.title ?? img.property.code}</Link>
                <p className="text-xs text-muted">{labelize(img.category)}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void moderateImage(img.id, "APPROVE")}>Approve</Button>
                  <Button size="sm" variant="secondary" onClick={() => confirm({ title: "Reject photo", message: "This photo won't be shown to tenants.", tone: "danger", confirmLabel: "Reject", onConfirm: () => moderateImage(img.id, "REJECT") })}>Reject</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ))}

      {tab === "documents" && data && (
        <DataTable
          rows={data.documents}
          rowKey={(d) => d.id}
          empty="No documents waiting for verification."
          columns={[
            { key: "doc", header: "Document", render: (d) => <span><span className="block font-semibold">{d.originalName}</span><span className="text-xs text-muted">{labelize(d.docType)}</span></span> },
            { key: "property", header: "Property", render: (d) => d.property.title ?? d.property.code },
            { key: "date", header: "Uploaded", render: (d) => formatTimestamp(d.createdAt), className: "hidden lg:table-cell" },
            { key: "actions", header: "", className: "text-right", render: (d) => <Button size="sm" onClick={() => navigate(`/properties/${d.property.id}?tab=documents`)}>Open & verify</Button> },
          ]}
        />
      )}

      {tab === "fraud" && <FraudTab />}
      {dialog}
    </>
  );
}

interface FraudReport {
  id: string;
  reason: string;
  details: string;
  status: string;
  createdAt: string;
  property: { id: string; code: string; title: string | null; activeStatus: string; publicationStatus: string } | null;
}

function FraudTab() {
  const list = useListParams(["status"]);
  const { data, loading, error, reload } = useQuery(() => request<Paged<FraudReport>>("/fraud-reports", { query: list.query }), [list.query]);
  const { confirm, dialog } = useConfirm();
  const update = (r: FraudReport, status: string, suspend = false) =>
    confirm({
      title: `${labelize(status)}${suspend ? " & suspend listing" : ""}`,
      message: suspend ? "The listing will be taken offline immediately." : "Update this report.",
      tone: suspend ? "danger" : "primary",
      confirmLabel: "Save",
      reason: { label: "Resolution notes", required: status !== "INVESTIGATING" },
      onConfirm: async (resolution) => {
        await request(`/fraud-reports/${r.id}`, { method: "PATCH", body: { status, resolution: resolution || undefined, suspendListing: suspend } });
        await reload();
      },
    });
  return (
    <>
      <ListToolbar filters={[{ name: "status", label: "Status", options: toOptions(["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"]) }]} values={list.filters} onFilter={list.setFilter} />
      <DataTable
        rows={data?.items}
        loading={loading}
        error={error}
        rowKey={(r) => r.id}
        empty="No fraud reports."
        columns={[
          { key: "reason", header: "Report", render: (r) => <span><span className="block font-semibold">{labelize(r.reason)}</span><span className="line-clamp-2 text-xs text-muted">{r.details}</span></span> },
          { key: "property", header: "Listing", render: (r) => (r.property ? <Link to={`/properties/${r.property.id}`} className="hover:text-brand">{r.property.title ?? r.property.code}</Link> : "—") },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (r) =>
              ["OPEN", "INVESTIGATING"].includes(r.status) ? (
                <span className="flex flex-wrap justify-end gap-2">
                  {r.status === "OPEN" && <Button size="sm" variant="secondary" onClick={() => update(r, "INVESTIGATING")}>Investigate</Button>}
                  {r.property && <Button size="sm" variant="danger" onClick={() => update(r, "RESOLVED", true)}>Suspend listing</Button>}
                  <Button size="sm" variant="ghost" onClick={() => update(r, "DISMISSED")}>Dismiss</Button>
                </span>
              ) : null,
          },
        ]}
      />
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={list.setPage} />}
      {dialog}
    </>
  );
}
