import { useEffect, useId, useState, type ReactNode } from "react";
import { COUNTRY_CODES, DEFAULT_COUNTRY, findCountry, maxNationalLength, sanitizeNationalNumber, toE164 } from "@/utils/phone";
import { CountrySelect } from "./CountrySelect";

/** Splits a stored E.164 number back into country + national number (longest dial code wins). */
function split(e164: string): { iso: string; national: string } {
  if (!e164.startsWith("+")) return { iso: DEFAULT_COUNTRY.iso, national: sanitizeNationalNumber(e164, 15) };
  const match = [...COUNTRY_CODES].sort((a, b) => b.dialCode.length - a.dialCode.length).find((c) => e164.startsWith(c.dialCode));
  return match ? { iso: match.iso, national: e164.slice(match.dialCode.length) } : { iso: DEFAULT_COUNTRY.iso, national: "" };
}

/**
 * Phone input with the country code chosen from a list (India by default) — nobody has to type "+91".
 * `value` / `onChange` use the full E.164 number (e.g. +919876543210), or "" when empty.
 */
export function PhoneField({ label, value, onChange, error, hint }: { label: string; value: string; onChange: (e164: string) => void; error?: string; hint?: ReactNode }) {
  const id = useId();
  const initial = split(value);
  const [iso, setIso] = useState(initial.iso);
  const [national, setNational] = useState(initial.national);
  const country = findCountry(iso);
  const max = maxNationalLength(country);

  useEffect(() => {
    // Keep in sync when the parent resets the value.
    if (value === "" && national !== "") setNational("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (nextIso: string, nextNational: string) => onChange(nextNational ? toE164(findCountry(nextIso), nextNational) : "");

  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">{label}</label>
      <div className="flex gap-2">
        <CountrySelect
          className="w-[7.5rem] sm:w-36"
          value={iso}
          onChange={(e) => {
            setIso(e.target.value);
            const trimmed = sanitizeNationalNumber(national, maxNationalLength(findCountry(e.target.value)));
            setNational(trimmed);
            emit(e.target.value, trimmed);
          }}
        />
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={max}
          placeholder={"9876543210".slice(0, max)}
          aria-invalid={error ? true : undefined}
          className={`h-12 w-full rounded-control border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:shadow-focus focus:outline-none sm:text-sm ${error ? "border-danger" : "border-line"}`}
          value={national}
          onChange={(e) => {
            const cleaned = sanitizeNationalNumber(e.target.value, max);
            setNational(cleaned);
            emit(iso, cleaned);
          }}
        />
      </div>
      {error ? <p role="alert" className="mt-1.5 text-sm text-danger">{error}</p> : hint ? <p className="mt-1.5 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
