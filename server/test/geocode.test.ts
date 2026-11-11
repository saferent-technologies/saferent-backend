import { describe, expect, it } from "vitest";
import { fromGoogle } from "../src/properties/geocode";

const c = (long_name: string, ...types: string[]) => ({ long_name, short_name: long_name, types });

describe("Google address mapping", () => {
  it("maps Google components to SafeRent fields", () => {
    const a = fromGoogle(
      [
        c("Flat 302", "subpremise"),
        c("Green Valley Apartments", "premise"),
        c("Road Number 5", "route"),
        c("Erragadda", "sublocality_level_1", "sublocality", "political"),
        c("Hyderabad", "locality", "political"),
        c("Hyderabad", "administrative_area_level_2", "political"),
        c("Telangana", "administrative_area_level_1", "political"),
        c("India", "country", "political"),
        c("500018", "postal_code"),
      ],
      "Flat 302, Green Valley Apartments, Road Number 5, Erragadda, Hyderabad, Telangana 500018, India",
    );
    expect(a).toEqual({
      addressLine: "Flat 302, Green Valley Apartments, Road Number 5",
      locality: "Erragadda",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500018",
      formattedAddress: "Flat 302, Green Valley Apartments, Road Number 5, Erragadda, Hyderabad, Telangana 500018, India",
    });
  });

  it("falls back to the formatted address when there is no street", () => {
    const a = fromGoogle(
      [c("Sanath Nagar", "sublocality_level_1"), c("Hyderabad", "locality"), c("Telangana", "administrative_area_level_1")],
      "8-3-228, Near Bus Stop, Sanath Nagar, Hyderabad, Telangana 500018, India",
    );
    expect(a.addressLine).toBe("8-3-228, Near Bus Stop");
    expect(a.pincode).toBe("");
  });
});
