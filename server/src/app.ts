import cors from "cors";
import express from "express";
import helmet from "helmet";
import { allowedOrigins, env } from "./config/env";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { api } from "./routes";
import { envelope, requestContext } from "./v1/envelope";
import { docsPage, openApiHandler } from "./v1/openapi";

export const app = express();

app.disable("x-powered-by");
// BigInt ids (audit logs) and Prisma Decimals serialize as strings.
app.set("json replacer", (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
app.set("trust proxy", env.TRUST_PROXY);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
    allowedHeaders: ["Authorization", "Content-Type", "X-Firebase-AppCheck", "X-Client-Platform", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  }),
);
app.use(
  express.json({
    limit: "200kb",
    // Payment webhooks are signed over the exact bytes received, so keep them for those routes.
    verify: (req, _res, buf) => {
      if ((req as { url?: string }).url?.includes("/webhooks/")) (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(requestContext);

const docsEnabled = env.API_DOCS ? env.API_DOCS === "true" : env.NODE_ENV !== "production";
if (docsEnabled) {
  app.get("/api/v1/openapi.json", openApiHandler(api));
  app.get("/api/v1/docs", docsPage);
}

/**
 * /api/v1 — the versioned API used by Android, iOS and the Admin Panel, with the
 *           { success, message, data, meta } envelope.
 * /api    — the same routes with the original (unwrapped) responses, kept for backwards compatibility.
 */
app.use("/api/v1", envelope, api, notFound);
app.use("/api", api);
app.use(notFound);
app.use(errorHandler);
