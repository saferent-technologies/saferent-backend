import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env";
import { REASONS } from "../config/constants";
import { fail } from "./errors";

/*
 * Envelope encryption for the ID documents vault.
 *   file  --AES-256-GCM(data key, random IV)-->  ciphertext on disk
 *   data key (32 random bytes, one per file) --wrapped by the key-encryption key--> stored in the DB
 * Deleting the wrapped key (and the file) crypto-shreds the document.
 *
 * KeyWrapper is the KMS seam: today "local:v1" wraps with DOCUMENT_MASTER_KEY (AES-256-GCM). To move to
 * Cloud KMS / AWS KMS, add a wrapper with the same two calls and a new id; old rows keep their id.
 */

export interface KeyWrapper {
  id: string;
  wrap(dataKey: Buffer): string;
  unwrap(wrapped: string): Buffer;
}

function localWrapper(): KeyWrapper | null {
  const raw = env.DOCUMENT_MASTER_KEY;
  if (!raw) return null;
  const kek = Buffer.from(raw, "base64");
  if (kek.length !== 32) throw new Error("DOCUMENT_MASTER_KEY must be base64 of exactly 32 bytes.");
  return {
    id: "local:v1",
    wrap(dataKey) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", kek, iv);
      const ct = Buffer.concat([c.update(dataKey), c.final()]);
      return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
    },
    unwrap(wrapped) {
      const [iv, tag, ct] = wrapped.split(".").map((p) => Buffer.from(p, "base64"));
      const d = createDecipheriv("aes-256-gcm", kek, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]);
    },
  };
}

let cached: KeyWrapper | null | undefined;
export function keyWrapper(): KeyWrapper {
  if (cached === undefined) cached = localWrapper();
  if (!cached) fail("unavailable", REASONS.VAULT_NOT_CONFIGURED, "The document vault isn't set up yet. Please try again later.");
  return cached!;
}

export function encryptFile(plain: Buffer): { ciphertext: Buffer; iv: string; tag: string; wrappedKey: string; keyId: string } {
  const w = keyWrapper();
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([c.update(plain), c.final()]);
  const out = { ciphertext, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), wrappedKey: w.wrap(dataKey), keyId: w.id };
  dataKey.fill(0);
  return out;
}

export function decryptFile(ciphertext: Buffer, meta: { iv: string; tag: string; wrappedKey: string; keyId: string }): Buffer {
  const w = keyWrapper();
  if (meta.keyId !== w.id) throw new Error("Unknown document key id");
  const dataKey = w.unwrap(meta.wrappedKey);
  try {
    const d = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(meta.iv, "base64"));
    d.setAuthTag(Buffer.from(meta.tag, "base64"));
    return Buffer.concat([d.update(ciphertext), d.final()]);
  } finally {
    dataKey.fill(0);
  }
}
