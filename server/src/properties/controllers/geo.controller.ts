import type { Request, Response } from "express";
import { z } from "zod";
import { RATE_LIMITS, REASONS } from "../../config/constants";
import { env } from "../../config/env";
import { fail } from "../../lib/errors";
import { consumeRateLimit } from "../../lib/rateLimit";
import { parseInput } from "../../lib/validation";
import { me } from "../../middleware/auth";
import { fromGoogle, type GoogleComponent } from "../geocode";

const reverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * GET /api/v1/geo/reverse?lat=&lng= — device coordinates → address, using Google Maps.
 * The API key never leaves the server. When unavailable (no key / daily cap reached) clients let the user type the address.
 */
export async function reverseGeocode(req: Request, res: Response): Promise<void> {
  if (!env.GOOGLE_MAPS_API_KEY) fail("unavailable", REASONS.SERVICE_NOT_CONFIGURED, "Google Maps address lookup is not set up yet.");
  const { lat, lng } = parseInput(reverseSchema, req.query);
  await consumeRateLimit(`geocode:${me(req).id}`, RATE_LIMITS.GEOCODE.limit, RATE_LIMITS.GEOCODE.windowMs);
  // Platform-wide daily cap keeps usage inside Google's free monthly quota.
  await consumeRateLimit(`geocode:global:${new Date().toISOString().slice(0, 10)}`, env.GOOGLE_MAPS_DAILY_LIMIT, 24 * 60 * 60 * 1000).catch(() =>
    fail("unavailable", REASONS.SERVICE_NOT_CONFIGURED, "Today's Google Maps address lookups are used up."),
  );

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("language", "en");
  url.searchParams.set("region", "in");
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY!);

  let body: { status: string; error_message?: string; results?: Array<{ address_components: GoogleComponent[]; formatted_address: string; types: string[] }> };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    body = (await response.json()) as typeof body;
  } catch (error) {
    console.error("[geocode] request failed", error);
    fail("unavailable", REASONS.SERVICE_NOT_CONFIGURED, "Couldn't reach Google Maps. Try again.");
  }
  if (body.status === "ZERO_RESULTS" || !body.results?.length) fail("not-found", REASONS.NOT_FOUND, "No address was found for this location.");
  if (body.status !== "OK") {
    console.error(`[geocode] Google returned ${body.status}: ${body.error_message ?? ""}`);
    fail("unavailable", REASONS.SERVICE_NOT_CONFIGURED, "Google Maps address lookup is not available right now.");
  }
  // Prefer the most specific result (street address / premise) over area-level results.
  const best = body.results.find((r) => r.types.some((t) => ["street_address", "premise", "subpremise"].includes(t))) ?? body.results[0]!;
  res.json({ address: { ...fromGoogle(best.address_components, best.formatted_address), latitude: lat.toFixed(6), longitude: lng.toFixed(6), provider: "google" } });
}
