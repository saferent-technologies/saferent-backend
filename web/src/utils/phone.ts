export interface CountryCode {
  iso: string;
  name: string;
  dialCode: string;
  flag: string;
  /** Allowed national-number lengths (digits only, without the country code) */
  lengths: number[];
}

export const COUNTRY_CODES: CountryCode[] = [
  { iso: "IN", name: "India", dialCode: "+91", flag: "🇮🇳", lengths: [10] },
  { iso: "AE", name: "United Arab Emirates", dialCode: "+971", flag: "🇦🇪", lengths: [9] },
  { iso: "SA", name: "Saudi Arabia", dialCode: "+966", flag: "🇸🇦", lengths: [9] },
  { iso: "QA", name: "Qatar", dialCode: "+974", flag: "🇶🇦", lengths: [8] },
  { iso: "KW", name: "Kuwait", dialCode: "+965", flag: "🇰🇼", lengths: [8] },
  { iso: "OM", name: "Oman", dialCode: "+968", flag: "🇴🇲", lengths: [8] },
  { iso: "SG", name: "Singapore", dialCode: "+65", flag: "🇸🇬", lengths: [8] },
  { iso: "US", name: "United States", dialCode: "+1", flag: "🇺🇸", lengths: [10] },
  { iso: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦", lengths: [10] },
  { iso: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧", lengths: [10] },
  { iso: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺", lengths: [9] },
];

export const DEFAULT_COUNTRY = COUNTRY_CODES[0];

export function findCountry(iso: string): CountryCode {
  return COUNTRY_CODES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Builds an E.164 number (+919876543210). Strips a leading trunk 0 that users often type. */
export function toE164(country: CountryCode, nationalNumber: string): string {
  return `${country.dialCode}${digitsOnly(nationalNumber).replace(/^0+/, "")}`;
}

export function isValidNationalNumber(country: CountryCode, nationalNumber: string): boolean {
  const digits = digitsOnly(nationalNumber).replace(/^0+/, "");
  return country.lengths.includes(digits.length);
}

/** Longest national number allowed for the country (e.g. 10 for India). */
export function maxNationalLength(country: CountryCode): number {
  return Math.max(...country.lengths);
}

/** Keeps digits only, drops a leading trunk 0 and limits the length (used while typing). */
export function sanitizeNationalNumber(value: string, maxLength: number): string {
  return digitsOnly(value).replace(/^0+/, "").slice(0, maxLength);
}
