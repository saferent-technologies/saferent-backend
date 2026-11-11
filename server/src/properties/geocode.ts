/** Google Geocoding response → SafeRent address fields (pure — unit tested). */

export interface GoogleComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GeocodedAddress {
  addressLine: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
  formattedAddress: string;
}

export function fromGoogle(components: GoogleComponent[], formattedAddress = ""): GeocodedAddress {
  const get = (...types: string[]) => {
    for (const t of types) {
      const c = components.find((x) => x.types.includes(t));
      if (c) return c.long_name;
    }
    return "";
  };
  const pin = get("postal_code").replace(/\s/g, "");
  const street = [get("subpremise"), get("premise"), get("street_number"), get("route"), get("sublocality_level_3"), get("sublocality_level_2")].filter(Boolean);
  const locality = get("sublocality_level_1", "sublocality", "neighborhood");
  const city = get("locality", "administrative_area_level_3", "administrative_area_level_2");
  const state = get("administrative_area_level_1");
  // Fallback: the parts of the formatted address before the locality / city.
  const fallback = formattedAddress
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x && x !== locality && x !== city && !x.includes(state) && x !== "India" && !/^\d{6}$/.test(x))
    .slice(0, 3);
  return {
    addressLine: [...new Set(street.length ? street : fallback)].join(", "),
    locality,
    city,
    state,
    pincode: /^\d{6}$/.test(pin) ? pin : "",
    formattedAddress,
  };
}
