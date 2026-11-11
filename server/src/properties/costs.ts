/**
 * Tenant-facing financial transparency (pure — unit tested).
 *
 * Every charge is shown in exactly one group:
 *   includedInRent · fixed (extra, recurring) · usageBased · oneTime · notDisclosed · notApplicable
 * An estimated monthly cost is returned ONLY when the rent and every recurring charge are disclosed,
 * and it is always labelled as an estimate that excludes usage-based charges.
 */

export type Billing = "INCLUDED_IN_RENT" | "FIXED_MONTHLY" | "USAGE_BASED" | "ONE_TIME" | "NOT_APPLICABLE" | "NOT_DISCLOSED";
export type Frequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY" | "ONE_TIME";

export interface ChargeLike {
  kind: string;
  label: string;
  billing: Billing;
  amount?: string | number | { toString(): string } | null;
  frequency?: Frequency | null;
  notes?: string | null;
}

export interface PricingLike {
  monthlyRent?: string | number | { toString(): string } | null;
  securityDeposit?: string | number | { toString(): string } | null;
  advanceRentMonths?: number | null;
  agreementCharges?: string | number | { toString(): string } | null;
  agreementChargesPaidBy?: string | null;
}

export interface UtilityLike {
  electricityBillingType?: string | null;
  electricityRatePerUnit?: string | number | { toString(): string } | null;
  waterChargesType?: string | null;
  waterChargesAmount?: string | number | { toString(): string } | null;
  internetAvailable?: string | null;
  internetCharges?: string | number | { toString(): string } | null;
}

/** Charges a tenant must know about before an estimate is meaningful. */
export const RECURRING_KINDS = ["MAINTENANCE", "ELECTRICITY", "WATER"] as const;

const MONTHS: Record<Frequency, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12, ONE_TIME: 0 };

/** Amount as integer paise (avoids floating-point money errors). */
export function toPaise(value: ChargeLike["amount"]): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const fromPaise = (paise: number): string => (paise / 100).toFixed(2);

export interface CostLine {
  kind: string;
  label: string;
  amount: string | null;
  frequency: Frequency | null;
  /** Fixed recurring charges converted to a per-month amount. */
  monthlyEquivalent: string | null;
  notes: string | null;
}

export interface CostBreakdown {
  currency: "INR";
  monthlyRent: string | null;
  securityDeposit: string | null;
  includedInRent: CostLine[];
  fixed: CostLine[];
  usageBased: CostLine[];
  oneTime: CostLine[];
  notDisclosed: CostLine[];
  notApplicable: CostLine[];
  estimate: {
    monthly: string;
    isEstimate: true;
    basis: string;
    excludes: string[];
  } | null;
  estimateUnavailableReason: string | null;
}

const LABELS: Record<string, string> = {
  MAINTENANCE: "Maintenance",
  ELECTRICITY: "Electricity",
  WATER: "Water",
  GAS: "Gas",
  PARKING: "Parking",
  INTERNET: "Internet",
  OTHER: "Other",
};

/** Charges derived from utility details when no explicit pricing charge of that kind exists. */
function chargesFromUtilities(u: UtilityLike | null | undefined): ChargeLike[] {
  if (!u) return [];
  const out: ChargeLike[] = [];
  const e = u.electricityBillingType;
  if (e) {
    const billing: Billing =
      e === "INCLUDED_IN_RENT" ? "INCLUDED_IN_RENT" : e === "ACTUAL_BILL" ? "USAGE_BASED" : e === "FIXED" ? "USAGE_BASED" : e === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "NOT_DISCLOSED";
    const rate = toPaise(u.electricityRatePerUnit);
    out.push({ kind: "ELECTRICITY", label: "Electricity", billing, notes: rate !== null && billing === "USAGE_BASED" ? `₹${fromPaise(rate)} per unit` : null });
  }
  if (u.waterChargesType) {
    out.push({ kind: "WATER", label: "Water", billing: u.waterChargesType as Billing, amount: u.waterChargesAmount ?? null, frequency: u.waterChargesType === "FIXED_MONTHLY" ? "MONTHLY" : null });
  }
  if (u.internetAvailable === "YES" && toPaise(u.internetCharges) !== null) {
    out.push({ kind: "INTERNET", label: "Internet", billing: "FIXED_MONTHLY", amount: u.internetCharges, frequency: "MONTHLY" });
  }
  return out;
}

export function costBreakdown(pricing: PricingLike | null | undefined, charges: ChargeLike[], utility?: UtilityLike | null): CostBreakdown {
  const explicitKinds = new Set(charges.map((c) => c.kind));
  const all = [...charges, ...chargesFromUtilities(utility).filter((c) => !explicitKinds.has(c.kind))];

  const result: CostBreakdown = {
    currency: "INR",
    monthlyRent: toPaise(pricing?.monthlyRent) !== null ? fromPaise(toPaise(pricing?.monthlyRent)!) : null,
    securityDeposit: toPaise(pricing?.securityDeposit) !== null ? fromPaise(toPaise(pricing?.securityDeposit)!) : null,
    includedInRent: [],
    fixed: [],
    usageBased: [],
    oneTime: [],
    notDisclosed: [],
    notApplicable: [],
    estimate: null,
    estimateUnavailableReason: null,
  };

  let monthlyFixed = 0;
  for (const c of all) {
    const paise = toPaise(c.amount);
    const frequency = c.billing === "ONE_TIME" ? "ONE_TIME" : (c.frequency ?? (c.billing === "FIXED_MONTHLY" ? "MONTHLY" : null));
    const months = frequency ? MONTHS[frequency] : 0;
    const monthly = c.billing === "FIXED_MONTHLY" && paise !== null && months > 0 ? Math.round(paise / months) : null;
    const line: CostLine = {
      kind: c.kind,
      label: c.label || LABELS[c.kind] || c.kind,
      amount: paise !== null ? fromPaise(paise) : null,
      frequency: frequency as Frequency | null,
      monthlyEquivalent: monthly !== null ? fromPaise(monthly) : null,
      notes: c.notes ?? null,
    };
    switch (c.billing) {
      case "INCLUDED_IN_RENT":
        result.includedInRent.push(line);
        break;
      case "FIXED_MONTHLY":
        result.fixed.push(line);
        if (monthly !== null) monthlyFixed += monthly;
        break;
      case "USAGE_BASED":
        result.usageBased.push(line);
        break;
      case "ONE_TIME":
        result.oneTime.push(line);
        break;
      case "NOT_APPLICABLE":
        result.notApplicable.push(line);
        break;
      default:
        result.notDisclosed.push(line);
    }
  }

  // Recurring charges that are not mentioned at all are treated as NOT disclosed (never as "no charge").
  const mentioned = new Set(all.map((c) => c.kind));
  for (const kind of RECURRING_KINDS) {
    if (!mentioned.has(kind)) result.notDisclosed.push({ kind, label: LABELS[kind], amount: null, frequency: null, monthlyEquivalent: null, notes: null });
  }

  const rent = toPaise(pricing?.monthlyRent);
  const undisclosedRecurring = result.notDisclosed.filter((l) => (RECURRING_KINDS as readonly string[]).includes(l.kind)).map((l) => l.label);
  if (rent === null) {
    result.estimateUnavailableReason = "Monthly rent is not disclosed.";
  } else if (undisclosedRecurring.length > 0) {
    result.estimateUnavailableReason = `Not enough information: ${undisclosedRecurring.join(", ")} not disclosed.`;
  } else {
    result.estimate = {
      monthly: fromPaise(rent + monthlyFixed),
      isEstimate: true,
      basis: "Rent + fixed recurring charges (converted to a monthly amount).",
      excludes: result.usageBased.map((l) => `${l.label} (usage-based)`),
    };
  }
  return result;
}
