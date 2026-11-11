/** Writes docs/openapi.json (for Android / iOS developers):  npm --prefix server run openapi */
import { writeFileSync } from "node:fs";
import path from "node:path";
import "../config/env";
import { api } from "../routes";
import { buildOpenApi } from "../v1/openapi";

const out = path.resolve(process.cwd(), "..", "docs", "openapi.json");
writeFileSync(out, `${JSON.stringify(buildOpenApi(api, "http://localhost:4000/api/v1"), null, 2)}\n`);
console.log(`✅ OpenAPI written to ${out}`);
process.exit(0);
