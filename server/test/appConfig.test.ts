import { describe, expect, it } from "vitest";
import {
  allowedMimes,
  appConfigSchema,
  changedPaths,
  compareVersions,
  defaultConfig,
  documentUploadAllowed,
  featuresForPath,
  isPaymentPath,
  maintenanceActive,
  maxUploadBytes,
  normalizeStored,
  notificationAllowed,
  updateStatus,
  nextSectionVersion,
  withSectionVersions,
} from "../src/appConfig/schema";
import { assetProblem } from "../src/appConfig/assetCheck";

describe("app configuration", () => {
  it("has sensible, valid defaults", () => {
    const d = defaultConfig();
    expect(appConfigSchema.safeParse(d).success).toBe(true);
    expect(d.maintenance.enabled).toBe(false);
    expect(d.features.chat).toBe(false);
    expect(d.features.properties).toBe(true);
    expect(d.documents.allowedFormats).toEqual(["pdf", "jpg", "jpeg", "png"]);
    expect(d.payments.currency).toBe("INR");
  });

  it("rejects bad values", () => {
    const bad = (patch: (c: ReturnType<typeof defaultConfig>) => void) => {
      const c = defaultConfig();
      patch(c);
      return appConfigSchema.safeParse(c).success;
    };
    expect(bad((c) => (c.ui.primaryColor = "orange"))).toBe(false);
    expect(bad((c) => (c.legal.privacyPolicyUrl = "http://insecure.example"))).toBe(false);
    expect(bad((c) => (c.app.minimumSupportedVersion = "2.0.0"))).toBe(false); // newer than latest 1.0.0
    expect(bad((c) => (c.auth.otpExpiryMinutes = 60))).toBe(false);
    expect(bad((c) => (c.documents.maxFileSizeMB = 100))).toBe(false);
    expect(bad((c) => (c.payments.convenienceFee = { type: "PERCENT", value: 9, maxAmount: null }))).toBe(false);
    expect(bad((c) => Object.assign(c.payments, { upi: false, card: false, netbanking: false }))).toBe(false);
    expect(bad((c) => Object.assign(c.ui, { announcementEnabled: true, announcementTitle: "" }))).toBe(false);
    expect(bad((c) => (c.support.phone = "12"))).toBe(false);
    expect(bad((c) => ((c as unknown as Record<string, unknown>).secretKey = "x"))).toBe(false); // unknown section
    expect(bad((c) => (c.support.phone = "+919876543210"))).toBe(true);
  });

  it("fills missing fields and repairs a broken section from defaults", () => {
    const { config, repaired } = normalizeStored({ app: { latestVersion: "2.1.0" }, ui: { primaryColor: 42 } });
    expect(config.app.latestVersion).toBe("2.1.0");
    expect(config.app.name).toBe("SafeRent");
    expect(config.ui.primaryColor).toBe("#F97316");
    expect(repaired).toEqual(["ui"]);
    expect(normalizeStored(null).config).toEqual(defaultConfig());
  });

  it("lists changed leaf paths", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    b.maintenance.enabled = true;
    b.documents.allowedFormats = ["pdf"];
    expect(changedPaths(a, b)).toEqual(["documents.allowedFormats", "maintenance.enabled"]);
    expect(changedPaths(a, defaultConfig())).toEqual([]);
  });

  it("compares versions numerically and decides updates", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    const app = { ...defaultConfig().app, latestVersion: "1.5.0", minimumSupportedVersion: "1.2.0" };
    expect(updateStatus(app, "1.5.0")).toMatchObject({ updateAvailable: false, updateRequired: false });
    expect(updateStatus(app, "1.3.0")).toMatchObject({ updateAvailable: true, updateRequired: false });
    expect(updateStatus(app, "1.1.9")).toMatchObject({ updateAvailable: true, updateRequired: true });
    expect(updateStatus({ ...app, forceUpdate: true }, "1.4.0")).toMatchObject({ updateRequired: true });
    expect(updateStatus(app, "abc").validVersion).toBe(false);
  });

  it("maintenance respects a future start time", () => {
    const m = { ...defaultConfig().maintenance, enabled: true, startsAt: "2030-01-01T00:00:00.000Z" };
    expect(maintenanceActive(m, Date.parse("2029-12-31T00:00:00Z"))).toBe(false);
    expect(maintenanceActive(m, Date.parse("2030-01-02T00:00:00Z"))).toBe(true);
    expect(maintenanceActive({ ...m, enabled: false }, Date.parse("2030-01-02T00:00:00Z"))).toBe(false);
  });

  it("maps API paths to feature switches", () => {
    expect(featuresForPath("GET", "/properties/abc/documents")).toEqual(["properties", "documents"]);
    expect(featuresForPath("GET", "/my/documents")).toEqual(["documents"]);
    expect(featuresForPath("POST", "/rent/r1/pay")).toEqual(["rentManagement", "rentPayments"]);
    expect(featuresForPath("POST", "/wallet/topups")).toEqual(["rentPayments"]);
    expect(featuresForPath("GET", "/wallet")).toEqual([]);
    expect(featuresForPath("GET", "/referrals/me")).toEqual(["referrals"]);
    expect(featuresForPath("GET", "/leases/l1/agreement")).toEqual(["rentalAgreements"]);
    expect(featuresForPath("GET", "/dashboard")).toEqual([]);
    expect(isPaymentPath("POST", "/rent/r1/pay")).toBe(true);
    expect(isPaymentPath("GET", "/rent")).toBe(false);
  });

  it("documents, uploads and notifications follow their switches", () => {
    const c = defaultConfig();
    c.features.electricityBills = false;
    expect(documentUploadAllowed(c, "ELECTRICITY_BILL")).toBe(false);
    expect(documentUploadAllowed(c, "SALE_DEED")).toBe(true); // ownership proof always allowed
    c.features.documents = false;
    expect(documentUploadAllowed(c, "SALE_DEED")).toBe(false);
    c.documents.allowedFormats = ["pdf", "jpg", "jpeg"];
    expect(allowedMimes(c, "document")).toEqual(["application/pdf", "image/jpeg"]);
    expect(maxUploadBytes(c, "document")).toBe(10 * 1024 * 1024);
    c.notifications.maintenance = false;
    expect(notificationAllowed(c, "MAINTENANCE")).toBe(false);
    expect(notificationAllowed(c, "PAYMENT_SUCCESS")).toBe(true);
    expect(notificationAllowed(c, undefined)).toBe(true);
    c.features.notifications = false;
    expect(notificationAllowed(c, undefined)).toBe(false);
  });

  it("splash and onboarding: defaults, validation and migration", () => {
    const d = defaultConfig();
    expect(d.splash.enabled).toBe(true);
    expect(d.splash.title).toBe("SafeRent");
    expect(d.onboarding.enabled).toBe(false);
    expect(d.onboarding.screens).toEqual([]);

    const ok = (o: unknown) => appConfigSchema.shape.onboarding.safeParse(o).success;
    const screen = { id: "verified-owners", title: "Verified owners", description: "Owners are verified.", mediaType: "LOTTIE", lottieUrl: "https://cdn.example.com/a.json" };
    expect(ok({ enabled: true, screens: [screen] })).toBe(true);
    expect(ok({ enabled: true, screens: [] })).toBe(true); // can be switched on before screens are added (the app shows nothing until there are screens)
    expect(ok({ enabled: false, screens: [{ ...screen, lottieUrl: "" }] })).toBe(false); // media type without a link
    expect(ok({ enabled: false, screens: [{ ...screen, mediaType: "NONE", lottieUrl: "" }] })).toBe(true);
    expect(ok({ enabled: false, screens: [{ ...screen, lottieUrl: "http://insecure.example.com/a.json" }] })).toBe(false);
    expect(ok({ enabled: false, screens: [screen, screen] })).toBe(false); // duplicate ids
    expect(ok({ enabled: false, screens: Array.from({ length: 11 }, (_, i) => ({ ...screen, id: `s${i}` })) })).toBe(false);

    // An older config kept the splash image in ui.splashImageUrl: it moves to splash.lightLogoUrl.
    const { config } = normalizeStored({ ui: { splashImageUrl: "https://cdn.example.com/logo.png" } });
    expect(config.splash.lightLogoUrl).toBe("https://cdn.example.com/logo.png");
    expect("splashImageUrl" in config.ui).toBe(false);
  });

  it("accepts uploaded app assets or https links for splash / onboarding media", () => {
    const asset = "/api/v1/app/assets/0b6f2c1e-6d3a-4f7e-9a51-1c2d3e4f5a6b.json";
    expect(appConfigSchema.shape.splash.safeParse({ lottieUrl: asset }).success).toBe(true);
    expect(appConfigSchema.shape.splash.safeParse({ lightLogoUrl: "https://cdn.example.com/l.png" }).success).toBe(true);
    expect(appConfigSchema.shape.splash.safeParse({ lightLogoUrl: "/api/v1/files/property-images/x" }).success).toBe(false);
    expect(appConfigSchema.shape.splash.safeParse({ darkLogoUrl: "/api/v1/app/assets/../../.env" }).success).toBe(false);
  });

  it("checks app asset content", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(assetProblem("image/png", 1000, png)).toBeNull();
    expect(assetProblem("image/png", 1000, mp4)).not.toBeNull(); // renamed file
    expect(assetProblem("video/mp4", 1000, mp4)).toBeNull();
    expect(assetProblem("video/mp4", 1000, png)).not.toBeNull();
    expect(assetProblem("application/json", 100, new Uint8Array(), JSON.stringify({ v: "5.7.4", fr: 30, layers: [] }))).toBeNull();
    expect(assetProblem("application/json", 100, new Uint8Array(), JSON.stringify({ hello: "world" }))).not.toBeNull();
    expect(assetProblem("application/json", 100, new Uint8Array(), "<script>")).not.toBeNull();
    expect(assetProblem("image/png", 6 * 1024 * 1024, png)).toContain("5 MB");
    expect(assetProblem("text/html", 10, png)).not.toBeNull();
  });

  it("bumps splash / onboarding versions 1.0 → 1.9 → 2.0, only when that section changes", () => {
    expect(nextSectionVersion("1.0")).toBe("1.1");
    expect(nextSectionVersion("1.8")).toBe("1.9");
    expect(nextSectionVersion("1.9")).toBe("2.0");
    expect(nextSectionVersion("12.9")).toBe("13.0");

    const before = defaultConfig();
    expect(before.splash.version).toBe("1.0");
    expect(before.onboarding.version).toBe("1.0");

    const same = withSectionVersions(before, structuredClone(before));
    expect(same.splash.version).toBe("1.0");

    const next = structuredClone(before);
    next.splash.title = "Welcome";
    next.features.chat = true; // other sections don't touch these versions
    const a = withSectionVersions(before, next);
    expect(a.splash.version).toBe("1.1");
    expect(a.onboarding.version).toBe("1.0");

    // The editor can't set the number itself, and a rollback to older content still goes up.
    const forged = structuredClone(a);
    forged.splash.version = "9.9";
    forged.splash.title = "SafeRent";
    expect(withSectionVersions(a, forged).splash.version).toBe("1.2");

    // Configs saved with the earlier plain numbers keep working.
    expect(normalizeStored({ splash: { version: 3 } }).config.splash.version).toBe("3.0");
  });

  it("splash has light and dark logos, and SVG is not supported", () => {
    const splash = appConfigSchema.shape.splash;
    expect(splash.parse({}).lightLogoUrl).toBe("");
    expect(splash.parse({}).darkLogoUrl).toBe("");
    expect(splash.safeParse({ lightLogoUrl: "https://cdn.example.com/light.png", darkLogoUrl: "https://cdn.example.com/dark.webp" }).success).toBe(true);
    expect(splash.safeParse({ darkLogoUrl: "https://cdn.example.com/dark.svg" }).success).toBe(false);
    expect(assetProblem("image/svg+xml", 100, new Uint8Array(), "<svg/>")).not.toBeNull();

    // Saved before: logoUrl → lightLogoUrl; saved SVG links are cleared instead of breaking the section.
    const a = normalizeStored({ splash: { title: "Hi", logoUrl: "https://cdn.example.com/logo.png" } });
    expect(a.config.splash).toMatchObject({ title: "Hi", lightLogoUrl: "https://cdn.example.com/logo.png", darkLogoUrl: "" });
    expect(a.repaired).not.toContain("splash");
    const b = normalizeStored({
      splash: { title: "Hi", logoUrl: "https://cdn.example.com/logo.svg" },
      onboarding: { enabled: true, screens: [{ id: "s1", title: "T", mediaType: "IMAGE", imageUrl: "https://cdn.example.com/a.svg" }] },
    });
    expect(b.config.splash).toMatchObject({ title: "Hi", lightLogoUrl: "" });
    expect(b.config.onboarding.screens[0]).toMatchObject({ mediaType: "NONE", imageUrl: "" });
    expect(b.repaired).toEqual([]);
  });

  it("onboarding media: one URL field per type, and older mediaUrl saves migrate", () => {
    const parse = (screen: Record<string, unknown>) => appConfigSchema.shape.onboarding.parse({ screens: [{ id: "s1", title: "T", ...screen }] }).screens[0];

    // Only the field matching the media type is kept; the others are cleared.
    const img = parse({ mediaType: "IMAGE", imageUrl: "https://cdn.example.com/a.png", videoUrl: "https://cdn.example.com/v.mp4" });
    expect(img).toMatchObject({ mediaType: "IMAGE", imageUrl: "https://cdn.example.com/a.png", videoUrl: "", lottieUrl: "" });

    // A video screen needs videoUrl (not imageUrl).
    expect(appConfigSchema.shape.onboarding.safeParse({ screens: [{ id: "s1", title: "T", mediaType: "VIDEO", imageUrl: "https://cdn.example.com/a.png" }] }).success).toBe(false);

    // No media → all three empty.
    expect(parse({ mediaType: "NONE", lottieUrl: "https://cdn.example.com/a.json" })).toMatchObject({ imageUrl: "", videoUrl: "", lottieUrl: "" });

    // Saved before the split: mediaUrl moves to the right field.
    const { config } = normalizeStored({ onboarding: { screens: [{ id: "s1", title: "T", mediaType: "LOTTIE", mediaUrl: "https://cdn.example.com/x.json" }] } });
    expect(config.onboarding.screens[0]).toMatchObject({ lottieUrl: "https://cdn.example.com/x.json", imageUrl: "", videoUrl: "" });
    expect("mediaUrl" in config.onboarding.screens[0]).toBe(false);
  });

  it("onboarding button texts have defaults and a screen can override its own", () => {
    const o = appConfigSchema.shape.onboarding.parse({ screens: [{ id: "a", title: "A" }, { id: "b", title: "B", buttonText: "Let's go" }] });
    expect(o.nextButtonText).toBe("Next");
    expect(o.finishButtonText).toBe("Get started");
    expect(o.skipButtonText).toBe("Skip");
    expect(o.screens[0].buttonText).toBe("");
    expect(o.screens[1].buttonText).toBe("Let's go");
    expect(appConfigSchema.shape.onboarding.safeParse({ finishButtonText: "" }).success).toBe(false);
    expect(appConfigSchema.shape.onboarding.safeParse({ screens: [{ id: "a", title: "A", buttonText: "x".repeat(31) }] }).success).toBe(false);
  });
});
