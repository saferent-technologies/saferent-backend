import type { FormEvent } from "react";
import { findCountry, maxNationalLength, sanitizeNationalNumber } from "./phone";

/**
 * Props for a national phone number <input>: digits only, max length for the selected country.
 * onInput runs before React Hook Form's onChange, so the form always receives the cleaned value.
 */
export function phoneNumberInputProps(countryIso: string) {
  const maxLength = maxNationalLength(findCountry(countryIso));
  return {
    type: "tel" as const,
    inputMode: "numeric" as const,
    pattern: "[0-9]*",
    maxLength,
    placeholder: "9".repeat(1) + "8765432109".slice(0, maxLength - 1),
    onInput: (event: FormEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const cleaned = sanitizeNationalNumber(input.value, maxLength);
      if (input.value !== cleaned) input.value = cleaned;
    },
  };
}
