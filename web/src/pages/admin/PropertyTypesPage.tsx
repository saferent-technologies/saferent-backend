import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { cn } from "@/utils/cn";
import { errorMessage } from "@/utils/errors";
import { labelize } from "@/utils/format";

interface TypeRow {
  key: string;
  label: string;
  category: string;
  structure: string;
  enabled: boolean;
  propertyCount: number;
}

const STRUCTURE_LABEL: Record<string, string> = {
  MULTI_UNIT: "Many units",
  ROOMS_BEDS: "Rooms & beds",
  VILLA: "Single villa or villa community",
  SINGLE_UNIT: "Single property",
};

/** Admin Panel → Property types: turn each type on or off for new listings (property_types.manage). */
export function PropertyTypesPage() {
  const { data, loading, error, setData } = useQuery(() => request<{ items: TypeRow[] }>("/property-types/manage"), []);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const toggle = async (row: TypeRow) => {
    const enabled = !row.enabled;
    setSaving(row.key);
    setMsg(null);
    try {
      await request(`/property-types/${row.key}`, { method: "PATCH", body: { enabled } });
      setData((cur) => (cur ? { items: cur.items.map((r) => (r.key === row.key ? { ...r, enabled } : r)) } : cur));
      setMsg({ kind: "success", text: `${row.label} ${enabled ? "is now open for new listings" : "is turned off for new listings"}.` });
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setSaving(null);
    }
  };

  const categories = [...new Set((data?.items ?? []).map((r) => r.category))];

  return (
    <>
      <PageHeader
        title="Property types"
        description="Choose which property types can be added. Turning a type off only stops new listings — existing ones keep working. Applies to the Admin Panel, Android and iOS."
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {loading && !data && <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>}
      {error && <Alert kind="error">{error}</Alert>}
      <div className="space-y-6">
        {categories.map((cat) => (
          <section key={cat} className="card p-5 sm:p-6">
            <h2 className="mb-3 font-semibold">{labelize(cat)}</h2>
            <ul className="divide-y divide-line">
              {data!.items
                .filter((r) => r.category === cat)
                .map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{r.label}</p>
                      <p className="text-xs text-muted">
                        {STRUCTURE_LABEL[r.structure] ?? labelize(r.structure)} · {r.propertyCount} {r.propertyCount === 1 ? "property" : "properties"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn("text-sm font-medium", r.enabled ? "text-success" : "text-muted")}>{r.enabled ? "Enabled" : "Disabled"}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.enabled}
                        aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.label}`}
                        disabled={saving === r.key}
                        onClick={() => void toggle(r)}
                        className={cn(
                          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                          r.enabled ? "bg-brand" : "bg-line",
                        )}
                      >
                        <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", r.enabled ? "translate-x-6" : "translate-x-1")} />
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
