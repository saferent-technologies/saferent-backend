/** Shared building blocks for the property screens (dynamic forms, disclosure values, completeness, costs). */
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { cn } from "@/utils/cn";
import { formatMoney, labelize } from "@/utils/format";
import type { CompletenessSection, CostBreakdown, CostLine, Disclosure, FieldDef } from "./types";

export const DISCLOSURE_LABEL: Record<Disclosure, string> = {
  YES: "Yes",
  NO: "No",
  NOT_APPLICABLE: "Not applicable",
  NOT_DISCLOSED: "Not disclosed",
};

const optionLabel = (v: string) => (v in DISCLOSURE_LABEL ? DISCLOSURE_LABEL[v as Disclosure] : v.includes("+") || /^\d/.test(v) ? v : labelize(v));

export type Values = Record<string, unknown>;

/** Converts a form value back to what the API expects (numbers for numeric fields, null for empty). */
export function toApiValue(def: FieldDef, raw: unknown): unknown {
  if (raw === "" || raw === undefined) return null;
  if (def.type === "integer") return Number.parseInt(String(raw), 10);
  if (def.type === "decimal" || def.type === "money") return String(raw);
  return raw;
}

export function toApiValues(defs: FieldDef[], values: Values): Values {
  const out: Values = {};
  for (const def of defs) if (def.key in values) out[def.key] = toApiValue(def, values[def.key]);
  return out;
}

export function DynamicField({ def, value, onChange, error }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const required = def.required || (def.requiredWhen ? `Required when ${labelize(def.requiredWhen.field)} is ${def.requiredWhen.equals}` : undefined);
  const label = `${def.label}${def.required ? " *" : ""}`;
  const hint = def.help ?? (typeof required === "string" ? required : undefined);
  const str = value === null || value === undefined ? "" : String(value);
  switch (def.type) {
    case "select":
    case "disclosure":
      return <Select label={label} hint={hint} error={error} placeholder="Choose…" options={(def.options ?? []).map((o) => ({ value: o, label: optionLabel(o) }))} value={str} onChange={(e) => onChange(e.target.value)} />;
    case "textarea":
      return <Textarea label={label} hint={hint} error={error} value={str} maxLength={def.maxLength} onChange={(e) => onChange(e.target.value)} />;
    case "integer":
    case "decimal":
    case "money":
      return <Input label={label} hint={hint} error={error} type="number" inputMode={def.type === "integer" ? "numeric" : "decimal"} step={def.type === "integer" ? 1 : "any"} min={def.min} max={def.max} value={str} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input label={label} hint={hint} error={error} type="date" value={str.slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
    case "boolean":
      return <Select label={label} hint={hint} error={error} placeholder="Choose…" options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} value={str} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")} />;
    default:
      return <Input label={label} hint={hint} error={error} value={str} maxLength={def.maxLength} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function DynamicFields({ defs, values, onChange, columns = 2 }: { defs: FieldDef[]; values: Values; onChange: (key: string, v: unknown) => void; columns?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-4", columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
      {defs.map((def) => {
        if (def.requiredWhen && values[def.requiredWhen.field] !== def.requiredWhen.equals && !values[def.key]) return null;
        return <DynamicField key={def.key} def={def} value={values[def.key]} onChange={(v) => onChange(def.key, v)} />;
      })}
    </div>
  );
}

export function DisclosureSelect({ label, value, onChange, hint }: { label: string; value: string | null | undefined; onChange: (v: Disclosure) => void; hint?: string }) {
  return <Select label={label} hint={hint} options={(Object.keys(DISCLOSURE_LABEL) as Disclosure[]).map((d) => ({ value: d, label: DISCLOSURE_LABEL[d] }))} value={value ?? "NOT_DISCLOSED"} onChange={(e) => onChange(e.target.value as Disclosure)} />;
}

/** Shows a disclosure / enum value; NOT_DISCLOSED is highlighted and never shown as "No". */
export function ValueText({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted">—</span>;
  if (value === "NOT_DISCLOSED") return <span className="font-medium text-warning">Not disclosed</span>;
  if (value === "NOT_APPLICABLE") return <span className="text-muted">Not applicable</span>;
  if (value === "YES") return <span className="font-medium text-success">Yes</span>;
  if (value === "NO") return <span className="font-medium">No</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  return <span>{typeof value === "string" && /^[A-Z_]+$/.test(value) ? labelize(value) : String(value)}</span>;
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className="font-medium text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CompletenessMeter({ score, sections, note, compact = false }: { score: number; sections?: CompletenessSection[]; note?: string; compact?: boolean }) {
  const tone = score >= 80 ? "bg-success" : score >= 50 ? "bg-warning" : "bg-danger";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">Information completeness</span>
        <span className="font-bold">{score}%</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Completeness">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${score}%` }} />
      </div>
      {note && <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Info className="mt-px size-3.5 shrink-0" />{note}</p>}
      {!compact && sections && (
        <ul className="mt-4 space-y-2">
          {sections.map((s) => (
            <li key={s.key} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  {s.ratio >= 1 ? <CircleCheck className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
                  {s.label}
                </span>
                <span className="text-xs text-muted">{Math.round(s.points * 10) / 10} / {s.weight}</span>
              </div>
              {s.missing.length > 0 && <p className="ml-5.5 text-xs text-muted">Missing: {s.missing.join(", ")}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Lines({ title, lines, tone, render }: { title: string; lines: CostLine[]; tone: "success" | "neutral" | "warning" | "brand"; render: (l: CostLine) => ReactNode }) {
  if (!lines.length) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {title} <Badge tone={tone}>{lines.length}</Badge>
      </p>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={`${l.kind}-${l.label}`} className="flex justify-between gap-3">
            <span>{l.label}{l.notes ? <span className="text-xs text-muted"> · {l.notes}</span> : null}</span>
            <span className="text-right font-medium">{render(l)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tenant-facing cost transparency: what is included, extra, usage-based, one-time or not disclosed. */
/** `chargesOnly`: for flats / PG, rent and deposit are per unit, so only the common charges are shown. */
export function CostBreakdownView({ breakdown, chargesOnly = false }: { breakdown: CostBreakdown | null | undefined; chargesOnly?: boolean }) {
  if (!breakdown) return <p className="text-sm text-muted">Pricing not added yet.</p>;
  const freq = (l: CostLine) => (l.frequency && l.frequency !== "MONTHLY" && l.frequency !== "ONE_TIME" ? ` / ${labelize(l.frequency)}` : l.frequency === "MONTHLY" ? " / month" : "");
  return (
    <div className="space-y-4">
      {!chargesOnly && (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-control bg-brand-bg px-3 py-2">
          <p className="text-xs text-muted">Monthly rent</p>
          <p className="text-lg font-bold text-brand-dark">{breakdown.monthlyRent ? formatMoney(breakdown.monthlyRent) : "Not disclosed"}</p>
        </div>
        <div className="rounded-control bg-subtle px-3 py-2">
          <p className="text-xs text-muted">Security deposit</p>
          <p className="text-lg font-bold">{breakdown.securityDeposit ? formatMoney(breakdown.securityDeposit) : "Not disclosed"}</p>
        </div>
      </div>
      )}
      <Lines title="Included in rent" lines={breakdown.includedInRent} tone="success" render={() => "Included"} />
      <Lines title="Extra fixed charges" lines={breakdown.fixed} tone="brand" render={(l) => `${formatMoney(l.amount)}${freq(l)}${l.monthlyEquivalent && l.frequency !== "MONTHLY" ? ` (≈ ${formatMoney(l.monthlyEquivalent)}/mo)` : ""}`} />
      <Lines title="Usage-based (actual usage)" lines={breakdown.usageBased} tone="neutral" render={() => "As per usage"} />
      <Lines title="One-time charges" lines={breakdown.oneTime} tone="neutral" render={(l) => formatMoney(l.amount)} />
      <Lines title="Not disclosed" lines={breakdown.notDisclosed} tone="warning" render={() => <span className="text-warning">Ask the landlord</span>} />
      {!chargesOnly && (
      <div className="rounded-control border border-dashed border-line px-3 py-2.5 text-sm">
        {breakdown.estimate ? (
          <>
            <p>
              <span className="font-semibold">Estimated monthly cost: {formatMoney(breakdown.estimate.monthly)}</span> <Badge tone="warning">Estimate</Badge>
            </p>
            <p className="mt-1 text-xs text-muted">{breakdown.estimate.basis}{breakdown.estimate.excludes.length ? ` Excludes ${breakdown.estimate.excludes.join(", ")}.` : ""}</p>
          </>
        ) : (
          <p className="text-xs text-muted">No estimate: {breakdown.estimateUnavailableReason}</p>
        )}
      </div>
      )}
    </div>
  );
}
