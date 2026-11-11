/**
 * Razorpay helpers (pure — unit tested in test/razorpay.test.ts) and a tiny REST client.
 * Docs: https://razorpay.com/docs/payments/server-integration/nodejs/
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const toPaise = (rupees: number) => Math.round(rupees * 100);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

/** Webhook: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook_secret). Must use the raw bytes. */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

export function isTestKey(keyId: string | undefined): boolean {
  return !!keyId && keyId.startsWith("rzp_test_");
}

/**
 * Is this Razorpay payment good to credit? Captured (money taken), the right order, the exact amount
 * and currency. "authorized" means the bank approved but it isn't captured yet — wait for the webhook.
 */
export function paymentOutcome(
  payment: { status: string; order_id: string | null; amount: number; currency: string },
  expected: { orderId: string; amountPaise: number; currency: string },
): "PAID" | "PENDING" | "FAILED" | "MISMATCH" {
  if (payment.order_id !== expected.orderId || payment.amount !== expected.amountPaise || payment.currency !== expected.currency) return "MISMATCH";
  if (payment.status === "captured") return "PAID";
  if (payment.status === "authorized" || payment.status === "created") return "PENDING";
  return "FAILED";
}

/* ─── REST client (server only) ─── */

export interface RazorpayCreds {
  keyId: string;
  keySecret: string;
}

async function call<T>(creds: RazorpayCreds, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${json.error?.description ?? "request failed"}`);
  return json;
}

export function createOrder(creds: RazorpayCreds, p: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
  return call<{ id: string; amount: number; currency: string; status: string }>(creds, "POST", "/orders", { amount: p.amountPaise, currency: "INR", receipt: p.receipt, notes: p.notes, payment_capture: 1 });
}

export function fetchPayment(creds: RazorpayCreds, paymentId: string) {
  return call<{ id: string; status: string; order_id: string | null; amount: number; currency: string; method: string | null; error_description?: string | null }>(creds, "GET", `/payments/${encodeURIComponent(paymentId)}`);
}
