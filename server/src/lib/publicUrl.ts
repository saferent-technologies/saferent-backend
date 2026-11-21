import { env } from "../config/env";

/** Absolute public URL for an API path (PUBLIC_API_ORIGIN → APP_LINK_ORIGIN → first APP_ORIGIN). */
export function publicApiUrl(path: string): string {
  const origin = (env.PUBLIC_API_ORIGIN ?? env.APP_LINK_ORIGIN ?? env.APP_ORIGIN.split(",")[0]).trim().replace(/\/+$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
