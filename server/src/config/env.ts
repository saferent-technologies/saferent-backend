import { z } from "zod";

/**
 * All configuration comes from server/.env (never committed). The server refuses to start
 * if something required is missing or invalid, with a clear message.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // MySQL connection string, e.g. mysql://saferent:password@localhost:3306/saferent
  DATABASE_URL: z.string().startsWith("mysql://", "DATABASE_URL must start with mysql://"),

  // Allowed browser origin(s) for CORS, comma separated
  APP_ORIGIN: z.string().default("http://localhost:5173"),

  // Firebase project + Admin SDK credentials (service account JSON file path)
  FIREBASE_PROJECT_ID: z.string().min(1),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1, "Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path"),

  // Secret used to hash OTPs (min 32 chars). Generate: openssl rand -base64 48
  OTP_PEPPER: z.string().min(32, "OTP_PEPPER must be at least 32 characters"),

  // Email: "console" prints emails in the terminal (development); "smtp" sends real emails
  EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("SafeRent Security <security@saferenttechnologies.com>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Online rent payment: "test" marks payments as paid instantly (clearly flagged as TEST — development only);
  // "disabled" hides online payment (finance records offline payments). Integrate a real gateway (e.g. Razorpay) before going live.
  PAYMENT_MODE: z.enum(["test", "disabled"]).default("test"),
  /** Razorpay (wallet top-ups). Key secret and webhook secret stay on the server only. */
  RAZORPAY_KEY_ID: z.string().trim().optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().optional(),
  /** Paytm / Instamojo — keys can be added now; their checkout is not wired yet. */
  PAYTM_MID: z.string().trim().optional(),
  PAYTM_MERCHANT_KEY: z.string().trim().optional(),
  INSTAMOJO_API_KEY: z.string().trim().optional(),
  INSTAMOJO_AUTH_TOKEN: z.string().trim().optional(),

  /**
   * Owner identity verification via DigiLocker (Setu). "mock" is a fake DigiLocker for local testing
   * (never allowed in production). Default: setu when its keys are set, else mock in development.
   */
  KYC_PROVIDER: z.enum(["setu", "mock", "off"]).optional(),
  SETU_DG_CLIENT_ID: z.string().trim().optional(),
  SETU_DG_CLIENT_SECRET: z.string().trim().optional(),
  SETU_DG_PRODUCT_INSTANCE_ID: z.string().trim().optional(),
  /** true = Setu sandbox (dg-sandbox.setu.co), false = production (dg.setu.co). */
  SETU_DG_SANDBOX: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Firebase App Check verification on API requests (enable in production)
  APP_CHECK_ENFORCE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Google Maps Geocoding API key (server-side only; restrict it to the Geocoding API). Optional —
  // without it the address fields are filled in manually.
  GOOGLE_MAPS_API_KEY: z.string().trim().optional(),
  // Hard cap on Google lookups per day for the whole platform (300/day ≈ 9,000/month — inside Google's
  // 10,000 free Geocoding requests per month). Above the cap the address is entered manually.
  GOOGLE_MAPS_DAILY_LIMIT: z.coerce.number().int().min(0).default(300),

  // Serve the OpenAPI docs at /api/v1/docs (default: on, except in production)
  API_DOCS: z.enum(["true", "false"]).optional(),

  // Set to 1 when running behind a reverse proxy / load balancer (for correct client IPs)
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("\n❌ Invalid server configuration (server/.env):");
  for (const issue of parsed.error.issues) {
    console.error(`   • ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("   Copy server/.env.example to server/.env and fill it in.\n");
  process.exit(1);
}

export const env = parsed.data;

if (env.EMAIL_PROVIDER === "smtp" && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS)) {
  console.error("\n❌ EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER and SMTP_PASS in server/.env\n");
  process.exit(1);
}

if (env.NODE_ENV === "production" && env.KYC_PROVIDER === "mock") {
  console.error("\n❌ KYC_PROVIDER=mock is for local testing only. Use setu (with SETU_DG_* keys) or off in production.\n");
  process.exit(1);
}

if (env.NODE_ENV === "production" && env.PAYMENT_MODE === "test") {
  console.error("\n❌ PAYMENT_MODE=test is not allowed in production. Set PAYMENT_MODE=disabled until a payment gateway is integrated.\n");
  process.exit(1);
}

export const allowedOrigins = env.APP_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
