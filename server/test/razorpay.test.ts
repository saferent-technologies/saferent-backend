import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isTestKey, paymentOutcome, toPaise, verifyPaymentSignature, verifyWebhookSignature } from "../src/lib/razorpay";

const secret = "test_secret_123";
const sign = (s: string, k = secret) => createHmac("sha256", k).update(s).digest("hex");

describe("Razorpay signatures", () => {
  it("accepts a correct checkout signature", () => {
    expect(verifyPaymentSignature("order_1", "pay_1", sign("order_1|pay_1"), secret)).toBe(true);
  });
  it("rejects a forged or mismatched signature", () => {
    expect(verifyPaymentSignature("order_1", "pay_2", sign("order_1|pay_1"), secret)).toBe(false);
    expect(verifyPaymentSignature("order_1", "pay_1", sign("order_1|pay_1", "other"), secret)).toBe(false);
    expect(verifyPaymentSignature("order_1", "pay_1", "", secret)).toBe(false);
    expect(verifyPaymentSignature("order_1", "pay_1", "abc", secret)).toBe(false);
  });
  it("verifies webhooks over the raw body only", () => {
    const body = '{"event":"payment.captured","payload":{}}';
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(body + " "), sign(body), secret)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body), undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), "")).toBe(false);
  });
});

describe("payment outcome", () => {
  const expected = { orderId: "order_1", amountPaise: 50000, currency: "INR" };
  it("credits only a captured payment of the exact order and amount", () => {
    expect(paymentOutcome({ status: "captured", order_id: "order_1", amount: 50000, currency: "INR" }, expected)).toBe("PAID");
    expect(paymentOutcome({ status: "captured", order_id: "order_1", amount: 100, currency: "INR" }, expected)).toBe("MISMATCH");
    expect(paymentOutcome({ status: "captured", order_id: "order_X", amount: 50000, currency: "INR" }, expected)).toBe("MISMATCH");
  });
  it("waits on authorized, fails on failed", () => {
    expect(paymentOutcome({ status: "authorized", order_id: "order_1", amount: 50000, currency: "INR" }, expected)).toBe("PENDING");
    expect(paymentOutcome({ status: "failed", order_id: "order_1", amount: 50000, currency: "INR" }, expected)).toBe("FAILED");
  });
  it("converts rupees to paise and detects test keys", () => {
    expect(toPaise(499.99)).toBe(49999);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(isTestKey("rzp_test_abc")).toBe(true);
    expect(isTestKey("rzp_live_abc")).toBe(false);
  });
});
