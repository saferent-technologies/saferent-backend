import { createHash, verify as rsaVerify, type X509Certificate } from "node:crypto";

/*
 * Strict, dependency-free XML reader + Canonical XML 1.0 (inclusive / exclusive, the same for the documents
 * accepted here) + enveloped XML-DSig check, made for UIDAI Offline eKYC files.
 *
 * Safety by restriction: anything this reader doesn't need is REJECTED instead of being half-handled:
 * DOCTYPE / entities, comments, processing instructions (other than the XML declaration), CDATA,
 * namespace prefixes. The fields used afterwards are read from the same parsed tree that was
 * canonicalized and verified, so what is checked is exactly what is read.
 */

export class XmlError extends Error {}

export interface XmlElement {
  name: string;
  attrs: Array<{ name: string; value: string }>;
  children: Array<XmlElement | string>;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*/;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos|[^;]*);/g, (_m, e: string) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    throw new XmlError("Unsupported XML entity.");
  });
}

/** Parses the whole document; returns the root element. */
export function parseXml(input: string): XmlElement {
  let s = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  s = s.replace(/^\s*<\?xml\s[^?]*\?>/, "");
  if (/<!|<\?/.test(s)) throw new XmlError("Unsupported XML content (DOCTYPE, comment, CDATA or processing instruction).");
  let i = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    const text = s.slice(i, lt < 0 ? s.length : lt);
    if (text) {
      if (stack.length) stack[stack.length - 1].children.push(decodeEntities(text));
      else if (text.trim()) throw new XmlError("Text outside the root element.");
    }
    if (lt < 0) break;
    i = lt + 1;
    if (s[i] === "/") {
      const m = NAME.exec(s.slice(i + 1));
      if (!m) throw new XmlError("Malformed closing tag.");
      const open = stack.pop();
      if (!open || open.name !== m[0]) throw new XmlError("Mismatched tags.");
      i += 1 + m[0].length;
      while (s[i] === " " || s[i] === "\n" || s[i] === "\t") i++;
      if (s[i] !== ">") throw new XmlError("Malformed closing tag.");
      i++;
      if (!stack.length) {
        if (s.slice(i).trim()) throw new XmlError("Content after the root element.");
        break;
      }
      continue;
    }
    const m = NAME.exec(s.slice(i));
    if (!m) throw new XmlError("Malformed tag.");
    const el: XmlElement = { name: m[0], attrs: [], children: [] };
    if (el.name.includes(":")) throw new XmlError("Namespace prefixes aren't supported.");
    i += m[0].length;
    for (;;) {
      while (s[i] === " " || s[i] === "\n" || s[i] === "\t") i++;
      if (s[i] === ">" || (s[i] === "/" && s[i + 1] === ">")) break;
      const an = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(s.slice(i));
      if (!an) throw new XmlError("Malformed attribute.");
      i += an[0].length;
      while (s[i] === " " || s[i] === "\n" || s[i] === "\t") i++;
      if (s[i] !== "=") throw new XmlError("Malformed attribute.");
      i++;
      while (s[i] === " " || s[i] === "\n" || s[i] === "\t") i++;
      const q = s[i];
      if (q !== '"' && q !== "'") throw new XmlError("Malformed attribute.");
      const end = s.indexOf(q, i + 1);
      if (end < 0) throw new XmlError("Malformed attribute.");
      const raw = s.slice(i + 1, end);
      if (raw.includes("<")) throw new XmlError("Malformed attribute.");
      // Attribute-value normalization: literal whitespace → space; character references kept.
      const value = decodeEntities(raw.replace(/[\t\n]/g, " "));
      if (an[0].includes(":") && an[0] !== "xmlns" && !an[0].startsWith("xmlns:")) throw new XmlError("Namespace prefixes aren't supported.");
      if (an[0].startsWith("xmlns:")) throw new XmlError("Namespace prefixes aren't supported.");
      if (el.attrs.some((a) => a.name === an[0])) throw new XmlError("Duplicate attribute.");
      el.attrs.push({ name: an[0], value });
      i = end + 1;
    }
    const selfClosing = s[i] === "/";
    i += selfClosing ? 2 : 1;
    if (stack.length) stack[stack.length - 1].children.push(el);
    else if (root) throw new XmlError("More than one root element.");
    else root = el;
    if (!selfClosing) stack.push(el);
    else if (!stack.length) {
      if (s.slice(i).trim()) throw new XmlError("Content after the root element.");
      break;
    }
  }
  if (stack.length || !root) throw new XmlError("The XML is incomplete.");
  return root;
}

const escText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
const escAttr = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");

/**
 * Canonical XML of `el`. `inheritedNs` = the default namespace in scope from its ancestors ("" = none).
 * `skip` = an element to leave out (enveloped signature).
 */
export function c14n(el: XmlElement, inheritedNs = "", skip?: XmlElement, renderedNs = ""): string {
  const own = el.attrs.find((a) => a.name === "xmlns");
  const ns = own ? own.value : inheritedNs;
  let out = `<${el.name}`;
  // The default namespace is written where it differs from what the nearest written ancestor declared.
  if (ns !== renderedNs) out += ` xmlns="${escAttr(ns)}"`;
  const attrs = el.attrs.filter((a) => a.name !== "xmlns").sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const a of attrs) out += ` ${a.name}="${escAttr(a.value)}"`;
  out += ">";
  for (const c of el.children) {
    if (typeof c === "string") out += escText(c);
    else if (c !== skip) out += c14n(c, ns, skip, ns);
  }
  return `${out}</${el.name}>`;
}

export const child = (el: XmlElement | undefined, name: string): XmlElement | undefined => el?.children.find((c): c is XmlElement => typeof c !== "string" && c.name === name);
export const attr = (el: XmlElement | undefined, name: string): string | undefined => el?.attrs.find((a) => a.name === name)?.value;
export const text = (el: XmlElement | undefined): string => (el ? el.children.filter((c): c is string => typeof c === "string").join("") : "");

const DSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N_ALGS = new Set([
  "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  "http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments",
  "http://www.w3.org/2001/10/xml-exc-c14n#",
  "http://www.w3.org/2001/10/xml-exc-c14n#WithComments",
]);
const DIGESTS: Record<string, string> = { "http://www.w3.org/2000/09/xmldsig#sha1": "sha1", "http://www.w3.org/2001/04/xmlenc#sha256": "sha256" };
const SIGS: Record<string, string> = { "http://www.w3.org/2000/09/xmldsig#rsa-sha1": "sha1", "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256": "sha256" };

/**
 * Verifies an enveloped XML-DSig over the whole document (Reference URI="") with one of the PINNED
 * certificates. The certificate inside the file (KeyInfo) is ignored. Throws XmlError when it fails.
 */
export function verifyEnvelopedSignature(root: XmlElement, pinned: X509Certificate[]): void {
  const sig = child(root, "Signature");
  if (!sig || attr(sig, "xmlns") !== DSIG) throw new XmlError("The file isn't signed.");
  if (root.children.filter((c) => typeof c !== "string" && c.name === "Signature").length !== 1) throw new XmlError("Unexpected signatures.");
  const signedInfo = child(sig, "SignedInfo");
  const sigValue = text(child(sig, "SignatureValue")).replace(/\s+/g, "");
  if (!signedInfo || !sigValue) throw new XmlError("The signature is incomplete.");
  const c14nAlg = attr(child(signedInfo, "CanonicalizationMethod"), "Algorithm") ?? "";
  if (!C14N_ALGS.has(c14nAlg)) throw new XmlError("Unsupported signature canonicalization.");
  const sigHash = SIGS[attr(child(signedInfo, "SignatureMethod"), "Algorithm") ?? ""];
  if (!sigHash) throw new XmlError("Unsupported signature algorithm.");
  const refs = signedInfo.children.filter((c): c is XmlElement => typeof c !== "string" && c.name === "Reference");
  if (refs.length !== 1 || attr(refs[0], "URI") !== "") throw new XmlError("The signature doesn't cover the whole file.");
  const transforms = (child(refs[0], "Transforms")?.children ?? []).filter((c): c is XmlElement => typeof c !== "string").map((t) => attr(t, "Algorithm") ?? "");
  if (!transforms.includes("http://www.w3.org/2000/09/xmldsig#enveloped-signature") || transforms.some((t) => t !== "http://www.w3.org/2000/09/xmldsig#enveloped-signature" && !C14N_ALGS.has(t))) {
    throw new XmlError("Unsupported signature transforms.");
  }
  const digestHash = DIGESTS[attr(child(refs[0], "DigestMethod"), "Algorithm") ?? ""];
  if (!digestHash) throw new XmlError("Unsupported digest algorithm.");
  const expected = text(child(refs[0], "DigestValue")).replace(/\s+/g, "");

  // 1) The document (minus the signature) must match the signed digest.
  const docDigest = createHash(digestHash).update(c14n(root, "", sig), "utf8").digest("base64");
  if (docDigest !== expected) throw new XmlError("The file was changed after UIDAI signed it.");
  // 2) SignedInfo must be signed by one of the pinned UIDAI certificates.
  const signed = Buffer.from(c14n(signedInfo, DSIG), "utf8");
  const signature = Buffer.from(sigValue, "base64");
  const ok = pinned.some((cert) => {
    try {
      return rsaVerify(sigHash, signed, cert.publicKey, signature);
    } catch {
      return false;
    }
  });
  if (!ok) throw new XmlError("The file isn't signed by UIDAI.");
}
