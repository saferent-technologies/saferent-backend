import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

/**
 * Invitation link tokens are stored hashed (lookup) AND encrypted (so the invited tenant can open the
 * invitation from "My invitations" without the shared link). AES-256-GCM; the key is derived from the
 * server secret (DOCUMENT_MASTER_KEY, else OTP_PEPPER), so a database copy alone can't reveal tokens.
 */
function key(): Buffer {
  return createHash("sha256").update(`saferent-invite-token:${env.DOCUMENT_MASTER_KEY || env.OTP_PEPPER}`).digest();
}

export function encryptInviteToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptInviteToken(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    const [v, iv, tag, body] = enc.split(".");
    if (v !== "v1" || !iv || !tag || !body) return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
