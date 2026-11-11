/**
 * Browser location helpers for the property form.
 * - Coordinates come from the browser's Geolocation API (the user must allow it).
 * - Only the browser's Geolocation API is used (free, no API key). The address is typed by the user.
 */



/** Indian states and union territories — the State field always holds one of these plain names. */
export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

const ALIASES: Record<string, string> = {
  "national capital territory of delhi": "Delhi",
  "nct of delhi": "Delhi",
  "new delhi": "Delhi",
  orissa: "Odisha",
  pondicherry: "Puducherry",
  uttaranchal: "Uttarakhand",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
};

/** "Telangana State" / "State of Telangana" / "TELANGANA" → "Telangana". */
export function normalizeState(raw: string | undefined | null): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\bstate( of)?\b/gi, "").replace(/\s+/g, " ").trim();
  const key = cleaned.toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  return INDIAN_STATES.find((s) => s.toLowerCase() === key) ?? INDIAN_STATES.find((s) => key.includes(s.toLowerCase())) ?? cleaned;
}

export function currentPosition(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      reject(new Error("Location is only available on a secure (https or localhost) page."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "Location permission was denied. Allow location for this site in your browser settings, or enter the address manually."
              : e.code === e.TIMEOUT
                ? "Getting your location took too long. Try again or enter the address manually."
                : "Your location is not available right now. Enter the address manually.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

