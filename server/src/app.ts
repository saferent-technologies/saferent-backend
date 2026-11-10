import cors from "cors";
import express from "express";
import helmet from "helmet";
import { allowedOrigins, env } from "./config/env";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { api } from "./routes";

export const app = express();

app.disable("x-powered-by");
// BigInt ids (audit logs) and Prisma Decimals serialize as strings.
app.set("json replacer", (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
app.set("trust proxy", env.TRUST_PROXY);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
    allowedHeaders: ["Authorization", "Content-Type", "X-Firebase-AppCheck"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: "100kb" }));

app.use("/api", api);
app.use(notFound);
app.use(errorHandler);
