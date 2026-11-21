import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { readZip, ZipError } from "./zipReader";
import { attr, child, parseXml, text, verifyEnvelopedSignature, XmlError } from "./xmlDsig";

/*
 * UIDAI Aadhaar Paperless Offline e-KYC (the ZIP the resident downloads from myaadhaar.uidai.gov.in,
 * protected with a 4-digit share code). We open it with the share code, verify the XML signature against
 * UIDAI's PINNED certificate(s) (UIDAI_OFFLINE_CERT_PATH, never the key inside the file), reject stale
 * files, and read name / DOB / gender / address / photo. Only the last 4 digits of the Aadhaar number
 * (the first 4 characters of referenceId) are kept; the share code is never stored or logged.
 * Production use needs SafeRent registered with UIDAI as an OVSE (Offline Verification Seeking Entity).
 */

export class AadhaarOfflineError extends Error {
  constructor(
    public status: "invalid-argument" | "failed-precondition",
    message: string,
  ) {
    super(message);
  }
}

export interface AadhaarOfflineIdentity {
  name: string;
  dob: string | null; // YYYY-MM-DD (or YYYY when only the year is known)
  gender: string | null;
  aadhaarLast4: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  photo: Buffer | null; // JPEG
  generatedAt: Date;
}

let fileCerts: X509Certificate[] | undefined;
let uploadedCerts: X509Certificate[] = [];
let uploadedLoaded = false;

/** Parses PEM (one or more certificates) or a single DER certificate. Throws when it isn't one. */
export function parseCertificates(raw: Buffer): X509Certificate[] {
  const blocks = raw.toString("latin1").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  return blocks ? blocks.map((b) => new X509Certificate(b)) : [new X509Certificate(raw)];
}

/** Certificates from UIDAI_OFFLINE_CERT_PATH (read once). */
function certsFromFile(): X509Certificate[] {
  if (fileCerts !== undefined) return fileCerts;
  const file = env.UIDAI_OFFLINE_CERT_PATH;
  if (!file) return (fileCerts = []);
  try {
    fileCerts = parseCertificates(readFileSync(file));
  } catch (err) {
    console.error("[aadhaar-offline] could not load UIDAI_OFFLINE_CERT_PATH", (err as Error).message);
    fileCerts = [];
  }
  return fileCerts;
}

/** Re-reads the certificates uploaded in the Super Admin portal (after an upload / delete, and once at first use). */
export async function reloadUploadedUidaiCerts(): Promise<void> {
  const rows = await prisma.uidaiCertificate.findMany({ select: { pem: true } });
  const out: X509Certificate[] = [];
  for (const r of rows) {
    try {
      out.push(...parseCertificates(Buffer.from(r.pem, "latin1")));
    } catch {
      /* a broken row is skipped */
    }
  }
  uploadedCerts = out;
  uploadedLoaded = true;
}

/** Make sure the uploaded certificates are loaded (cheap after the first call). */
export async function ensureUidaiCerts(): Promise<void> {
  if (!uploadedLoaded) await reloadUploadedUidaiCerts().catch((err) => console.error("[aadhaar-offline] could not load uploaded certificates", (err as Error).message));
}

/** Pinned UIDAI signing certificates: the server file + the ones uploaded by Super Admin. */
export function uidaiCertificates(): X509Certificate[] | null {
  const all = [...certsFromFile(), ...uploadedCerts];
  return all.length ? all : null;
}

export const serverFileCertificates = () => certsFromFile();

export const aadhaarOfflineAvailable = () => !!uidaiCertificates()?.length;

/** referenceId = last 4 of Aadhaar + YYYYMMDDHHMMSSsss (generation time, IST). */
function parseReference(ref: string): { last4: string; at: Date } | null {
  const m = /^(\d{4})(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{0,3})/.exec(ref);
  if (!m) return null;
  const at = new Date(`${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}.${(m[8] || "0").padEnd(3, "0")}+05:30`);
  return Number.isNaN(at.getTime()) ? null : { last4: m[1], at };
}

/** "15-08-1990" → "1990-08-15"; "1990" stays "1990". */
function isoDob(dob: string | undefined): string | null {
  if (!dob) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dob.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}$/.test(dob.trim()) ? dob.trim() : null;
}

export function readAadhaarOffline(zip: Buffer, shareCode: string): AadhaarOfflineIdentity {
  const certs = uidaiCertificates();
  if (!certs?.length) throw new AadhaarOfflineError("failed-precondition", "Aadhaar offline verification isn't set up yet. Please use PAN or passport for now.");
  if (!/^\d{4}$/.test(shareCode)) throw new AadhaarOfflineError("invalid-argument", "Enter the 4-digit share code you set while downloading the file.");

  let entries;
  try {
    entries = readZip(zip, shareCode, 5 * 1024 * 1024);
  } catch (err) {
    if (err instanceof ZipError) {
      if (err.code === "BAD_PASSWORD") throw new AadhaarOfflineError("invalid-argument", "The share code is wrong. Enter the 4-digit code you set on the UIDAI website.");
      if (err.code === "NOT_ZIP") throw new AadhaarOfflineError("invalid-argument", "Upload the ZIP file you downloaded from the UIDAI website (Offline eKYC).");
      throw new AadhaarOfflineError("invalid-argument", "This ZIP file can't be read. Download a new Offline eKYC file and try again.");
    }
    throw err;
  }
  const xmlEntry = entries.find((e) => e.name.toLowerCase().endsWith(".xml"));
  if (!xmlEntry || entries.length !== 1) throw new AadhaarOfflineError("invalid-argument", "This isn't a UIDAI Offline eKYC file.");

  let root;
  try {
    root = parseXml(xmlEntry.data.toString("utf8"));
    if (root.name !== "OfflinePaperlessKyc") throw new XmlError("Not an Offline eKYC file.");
    verifyEnvelopedSignature(root, certs);
  } catch (err) {
    if (err instanceof XmlError) {
      const notSigned = /signed|changed|signature/i.test(err.message);
      throw new AadhaarOfflineError("invalid-argument", notSigned ? "This file isn't signed by UIDAI or was changed. Download a fresh Offline eKYC file from the UIDAI website." : "This isn't a valid UIDAI Offline eKYC file.");
    }
    throw err;
  }

  const ref = parseReference(attr(root, "referenceId") ?? "");
  if (!ref) throw new AadhaarOfflineError("invalid-argument", "This isn't a valid UIDAI Offline eKYC file.");
  const ageMs = Date.now() - ref.at.getTime();
  const maxDays = env.AADHAAR_OFFLINE_MAX_AGE_DAYS;
  if (ageMs > maxDays * 86_400_000) throw new AadhaarOfflineError("invalid-argument", `This file is older than ${maxDays} days. Download a fresh Offline eKYC file from the UIDAI website and upload it.`);
  if (ageMs < -86_400_000) throw new AadhaarOfflineError("invalid-argument", "This file's date isn't valid.");

  const data = child(root, "UidData");
  const poi = child(data, "Poi");
  const poa = child(data, "Poa");
  const name = (attr(poi, "name") ?? "").trim();
  if (!name) throw new AadhaarOfflineError("invalid-argument", "This file has no name in it.");
  const photoB64 = text(child(data, "Pht")).replace(/\s+/g, "");
  const photo = photoB64 ? Buffer.from(photoB64, "base64") : null;
  return {
    name: name.slice(0, 150),
    dob: isoDob(attr(poi, "dob")),
    gender: attr(poi, "gender")?.trim().slice(0, 10) || null,
    aadhaarLast4: ref.last4,
    city: (attr(poa, "dist") || attr(poa, "vtc") || attr(poa, "subdist") || "").trim().slice(0, 80) || null,
    state: (attr(poa, "state") ?? "").trim().slice(0, 80) || null,
    pincode: (attr(poa, "pc") ?? "").trim().slice(0, 10) || null,
    photo: photo && photo[0] === 0xff && photo[1] === 0xd8 ? photo : null,
    generatedAt: ref.at,
  };
}
