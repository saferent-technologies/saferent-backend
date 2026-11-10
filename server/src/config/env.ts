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

  // Firebase App Check verification on API requests (enable in production)
  APP_CHECK_ENFORCE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

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

if (env.NODE_ENV === "production" && env.PAYMENT_MODE === "test") {
  console.error("\n❌ PAYMENT_MODE=test is not allowed in production. Set PAYMENT_MODE=disabled until a payment gateway is integrated.\n");
  process.exit(1);
}

export const allowedOrigins = env.APP_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
