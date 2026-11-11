import type { PaymentProvider, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { allowedOrigins, env } from "../config/env";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { createOrder, fetchPayment, isTestKey, paymentOutcome, toPaise, verifyPaymentSignature, verifyWebhookSignature, type RazorpayCreds } from "../lib/razorpay";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { ID_PREFIX } from "../properties/catalog";
import { nextCode } from "../properties/ids";
import { creditWallet } from "../services/referral.service";

/*
 * Wallet top-ups ("Add money") through payment gateways.
 *  - A gateway's button shows only when an admin has switched it ON, its keys are in server/.env and its
 *    integration is implemented (Razorpay today; Paytm / Instamojo are listed but not wired yet).
 *  - Money is credited only after the server confirms it: checkout signature + Razorpay API check, or a
 *    signed webhook. Each top-up credits once (conditional update + unique ledger key + unique payment id).
 *  - Added money is a closed-loop balance: SafeRent services only — no withdrawal, transfer or rent.
 */

const PROVIDERS: Record<PaymentProvider, { label: string; implemented: boolean; configured: () => boolean; mode: () => "TEST" | "LIVE" | null; webhook: () => boolean }> = {
  RAZORPAY: {
    label: "Razorpay",
    implemented: true,
    configured: () => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    mode: () => (env.RAZORPAY_KEY_ID ? (isTestKey(env.RAZORPAY_KEY_ID) ? "TEST" : "LIVE") : null),
    webhook: () => !!env.RAZORPAY_WEBHOOK_SECRET,
  },
  PAYTM: { label: "Paytm", implemented: false, configured: () => !!(env.PAYTM_MID && env.PAYTM_MERCHANT_KEY), mode: () => null, webhook: () => false },
  INSTAMOJO: { label: "Instamojo", implemented: false, configured: () => !!(env.INSTAMOJO_API_KEY && env.INSTAMOJO_AUTH_TOKEN), mode: () => null, webhook: () => false },
};
const PROVIDER_KEYS = Object.keys(PROVIDERS) as PaymentProvider[];

const rzp = (): RazorpayCreds => ({ keyId: env.RAZORPAY_KEY_ID!, keySecret: env.RAZORPAY_KEY_SECRET! });

async function gatewayRows() {
  const rows = await prisma.paymentGateway.findMany();
  return PROVIDER_KEYS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const def = PROVIDERS[provider];
    const configured = def.configured();
    return {
      provider,
      label: def.label,
      enabled: row?.enabled ?? false,
      implemented: def.implemented,
      configured,
      mode: def.mode(),
      webhookConfigured: def.webhook(),
      minAmount: Number(row?.minAmount ?? 10),
      maxAmount: Number(row?.maxAmount ?? 10000),
      available: (row?.enabled ?? false) && def.implemented && configured,
    };
  });
}

/* ─────────────── User: add money ─────────────── */

/** GET /api/v1/wallet/gateways — the "Add money" buttons to show (only gateways that are ON and ready). */
export async function availableGateways(_req: Request, res: Response): Promise<void> {
  const rows = await gatewayRows();
  res.json({ items: rows.filter((r) => r.available).map((r) => ({ provider: r.provider, label: r.label, minAmount: r.minAmount, maxAmount: r.maxAmount, testMode: r.mode === "TEST" })) });
}

const topupSchema = z
  .object({
    provider: z.enum(["RAZORPAY", "PAYTM", "INSTAMOJO"]),
    amount: z.coerce.number().positive("Enter an amount.").refine((n) => Math.round(n * 100) === n * 100, "Up to 2 decimals."),
  })
  .strict();

function customer(req: Request): boolean {
  const u = me(req);
  return [u.role, ...u.roles].some((r) => r === "LANDLORD" || r === "TENANT");
}

/** POST /api/v1/wallet/topups — start adding money. Returns what the app needs to open the checkout. */
export async function createTopup(req: Request, res: Response): Promise<void> {
  const user = me(req);
  if (!customer(req)) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only landlord and tenant accounts have a wallet.");
  await consumeRateLimit(`wallet-topup:${user.id}`, RATE_LIMITS.WALLET_TOPUP.limit, RATE_LIMITS.WALLET_TOPUP.windowMs);
  const input = parseInput(topupSchema, req.body);
  const g = (await gatewayRows()).find((r) => r.provider === input.provider)!;
  if (!g.available) fail("failed-precondition", REASONS.PAYMENTS_NOT_CONFIGURED, `${g.label} isn't available right now.`);
  if (input.amount < g.minAmount || input.amount > g.maxAmount) fail("invalid-argument", REASONS.INVALID_INPUT, `Add between ₹${g.minAmount} and ₹${g.maxAmount}.`);

  const topup = await prisma.$transaction(async (tx) =>
    tx.walletTopup.create({ data: { code: await nextCode(tx, ID_PREFIX.TOPUP), userId: user.id, provider: input.provider, amount: input.amount.toFixed(2), testMode: g.mode === "TEST" } }),
  );
  // Only Razorpay is wired today (gatewayRows() never marks the others available).
  let order: Awaited<ReturnType<typeof createOrder>>;
  try {
    order = await createOrder(rzp(), { amountPaise: toPaise(input.amount), receipt: topup.code, notes: { topupId: topup.id, userId: user.id, purpose: "SafeRent wallet top-up" } });
  } catch (err) {
    await prisma.walletTopup.update({ where: { id: topup.id }, data: { status: "FAILED", failureReason: "Could not start the payment." } });
    console.error("[payments] create order failed", err);
    fail("unavailable", REASONS.PAYMENTS_NOT_CONFIGURED, "Couldn't start the payment. Please try again in a minute.");
  }
  await prisma.walletTopup.update({ where: { id: topup.id }, data: { providerOrderId: order.id } });
  res.status(201).json({
    topupId: topup.id,
    code: topup.code,
    provider: "RAZORPAY",
    testMode: g.mode === "TEST",
    // Public checkout details only — the key secret never leaves the server.
    checkout: {
      key: env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: "SafeRent",
      description: `Add ₹${input.amount.toFixed(2)} to wallet (${topup.code})`,
      prefill: { name: user.fullName, contact: user.phoneNumber ?? undefined, email: user.email ?? undefined },
    },
  });
}

/** Marks a top-up paid and credits the wallet — exactly once. */
async function settlePaid(topupId: string, payment: { id: string; method: string | null }): Promise<boolean> {
  let credited = false;
  const topup = await prisma.walletTopup.findUnique({ where: { id: topupId } });
  if (!topup || topup.status === "PAID") return false;
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.walletTopup.updateMany({ where: { id: topup.id, status: { in: ["CREATED", "PENDING", "FAILED"] } }, data: { status: "PAID", providerPaymentId: payment.id, method: payment.method, paidAt: new Date(), failureReason: null } });
      if (!claimed.count) return;
      await creditWallet(tx, { userId: topup.userId, amount: Number(topup.amount), key: `topup:${topup.id}`, type: "TOPUP", bucket: "CASH", note: `Added via ${PROVIDERS[topup.provider].label} (${topup.code})${topup.testMode ? " — TEST" : ""}`, actorId: topup.userId });
      credited = true;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false; // already credited / payment reused
    throw err;
  }
  if (credited) await notify(topup.userId, `₹${Number(topup.amount).toFixed(2)} added to your wallet`, `Payment ${payment.id} received${topup.testMode ? " (test mode — no real money)" : ""}.`, "/wallet");
  return credited;
}

const verifySchema = z.object({ razorpay_payment_id: z.string().min(5).max(64), razorpay_order_id: z.string().min(5).max(64), razorpay_signature: z.string().min(10).max(256) }).strict();

/**
 * POST /api/v1/wallet/topups/:id/verify — called by the app after checkout. The signature is checked AND
 * the payment is fetched from Razorpay; only a captured payment of the exact order and amount credits.
 */
export async function verifyTopup(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const topup = found(await prisma.walletTopup.findFirst({ where: { id: idParam(req), userId: user.id } }), "Top-up");
  if (topup.status === "PAID") {
    res.json({ status: "PAID" });
    return;
  }
  const input = parseInput(verifySchema, req.body);
  if (!topup.providerOrderId || input.razorpay_order_id !== topup.providerOrderId || !verifyPaymentSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, env.RAZORPAY_KEY_SECRET ?? "")) {
    fail("permission-denied", REASONS.PERMISSION_DENIED, "We couldn't verify this payment. If money was deducted, it will be credited automatically once Razorpay confirms it.");
  }
  const payment = await fetchPayment(rzp(), input.razorpay_payment_id);
  const outcome = paymentOutcome(payment, { orderId: topup.providerOrderId, amountPaise: toPaise(Number(topup.amount)), currency: topup.currency });
  if (outcome === "PAID") await settlePaid(topup.id, { id: payment.id, method: payment.method });
  else if (outcome === "PENDING") await prisma.walletTopup.updateMany({ where: { id: topup.id, status: "CREATED" }, data: { status: "PENDING", providerPaymentId: payment.id } });
  else await prisma.walletTopup.updateMany({ where: { id: topup.id, status: { in: ["CREATED", "PENDING"] } }, data: { status: "FAILED", failureReason: outcome === "MISMATCH" ? "Payment details didn't match the order." : (payment.error_description ?? "Payment failed.").slice(0, 255) } });
  const fresh = await prisma.walletTopup.findUniqueOrThrow({ where: { id: topup.id } });
  res.locals.message = fresh.status === "PAID" ? "Money added to your wallet." : fresh.status === "PENDING" ? "Payment is being confirmed. Your wallet updates automatically." : "Payment failed.";
  res.json({ status: fresh.status, failureReason: fresh.failureReason });
}

/** POST /api/v1/wallet/topups/:id/cancel — the user closed the checkout without paying. */
export async function cancelTopup(req: Request, res: Response): Promise<void> {
  const topup = found(await prisma.walletTopup.findFirst({ where: { id: idParam(req), userId: me(req).id } }), "Top-up");
  await prisma.walletTopup.updateMany({ where: { id: topup.id, status: "CREATED" }, data: { status: "FAILED", failureReason: "Cancelled before payment." } });
  res.json({ ok: true });
}

/**
 * POST /api/v1/webhooks/razorpay — server-to-server confirmation (no login). Verified with the webhook
 * secret over the raw body. Credits payments the app never reported (closed app, lost network).
 */
export async function razorpayWebhook(req: Request, res: Response): Promise<void> {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw || !verifyWebhookSignature(raw, req.get("x-razorpay-signature"), env.RAZORPAY_WEBHOOK_SECRET ?? "")) {
    res.status(400).json({ ok: false });
    return;
  }
  const body = req.body as { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string | null; amount: number; currency: string; status: string; method: string | null; error_description?: string | null } } } };
  const p = body.payload?.payment?.entity;
  if (p?.order_id) {
    const topup = await prisma.walletTopup.findUnique({ where: { providerOrderId: p.order_id } });
    if (topup) {
      const outcome = paymentOutcome(p, { orderId: p.order_id, amountPaise: toPaise(Number(topup.amount)), currency: topup.currency });
      if ((body.event === "payment.captured" || body.event === "order.paid") && outcome === "PAID") await settlePaid(topup.id, { id: p.id, method: p.method });
      else if (body.event === "payment.failed") await prisma.walletTopup.updateMany({ where: { id: topup.id, status: { in: ["CREATED", "PENDING"] } }, data: { status: "FAILED", failureReason: (p.error_description ?? "Payment failed.").slice(0, 255) } });
    }
  }
  // Always 200 for a valid signature so Razorpay doesn't retry events we've handled or don't need.
  res.json({ ok: true });
}

/* ─────────────── Admin ─────────────── */

/** GET /api/v1/admin/payment-gateways — status of each gateway (keys present? implemented? ON?). */
export async function adminGateways(_req: Request, res: Response): Promise<void> {
  const origin = (allowedOrigins[0] ?? "").replace(/\/$/, "");
  res.json({ items: await gatewayRows(), webhookUrl: `<your API address>/api/v1/webhooks/razorpay`, appOrigin: origin });
}

const gatewaySchema = z
  .object({ enabled: z.boolean(), minAmount: z.coerce.number().min(1).max(100_000), maxAmount: z.coerce.number().min(1).max(500_000) })
  .strict()
  .refine((v) => v.maxAmount >= v.minAmount, { message: "Maximum must be at least the minimum.", path: ["maxAmount"] });

/** PUT /api/v1/admin/payment-gateways/:provider — switch a gateway ON/OFF and set limits (settings.manage). */
export async function adminSaveGateway(req: Request, res: Response): Promise<void> {
  const provider = parseInput(z.enum(["RAZORPAY", "PAYTM", "INSTAMOJO"]), req.params.provider) as PaymentProvider;
  const input = parseInput(gatewaySchema, req.body);
  const def = PROVIDERS[provider];
  if (input.enabled && !def.implemented) fail("failed-precondition", REASONS.INVALID_STATE, `${def.label} checkout isn't built yet. Use Razorpay for now.`);
  if (input.enabled && !def.configured()) fail("failed-precondition", REASONS.PAYMENTS_NOT_CONFIGURED, `Add the ${def.label} keys to server/.env and restart the server first.`);
  const before = await prisma.paymentGateway.findUnique({ where: { provider } });
  const data = { enabled: input.enabled, minAmount: input.minAmount.toFixed(2), maxAmount: input.maxAmount.toFixed(2), updatedById: me(req).id };
  await prisma.$transaction(async (tx) => {
    await tx.paymentGateway.upsert({ where: { provider }, create: { provider, ...data }, update: data });
    await logActivity(req, "payment_gateway.update", "payment_gateway", provider, { before, after: data }, tx);
  });
  res.locals.message = `${def.label} ${input.enabled ? "is ON" : "is OFF"}`;
  res.json({ ok: true });
}

/** GET /api/v1/admin/wallet-topups?status=&q= — every add-money attempt. */
export async function adminTopups(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const status = enumQuery(req, "status", ["CREATED", "PENDING", "PAID", "FAILED"] as const);
  const and: Prisma.WalletTopupWhereInput[] = [];
  if (status) and.push({ status });
  if (p.q) {
    const people = await prisma.user.findMany({ where: { OR: [{ fullName: { contains: p.q } }, { phoneNumber: { contains: p.q } }] }, select: { id: true }, take: 50 });
    and.push({ OR: [{ code: p.q }, { providerOrderId: p.q }, { providerPaymentId: p.q }, { userId: { in: people.map((u) => u.id) } }] });
  }
  const where: Prisma.WalletTopupWhereInput = and.length ? { AND: and } : {};
  const [items, total, sum] = await Promise.all([
    prisma.walletTopup.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.walletTopup.count({ where }),
    prisma.walletTopup.aggregate({ where: { status: "PAID", testMode: false }, _sum: { amount: true } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.userId) } }, select: { id: true, fullName: true, phoneNumber: true } });
  res.json({ ...paged(items.map((t) => ({ ...t, amount: t.amount.toFixed(2), user: users.find((u) => u.id === t.userId) ?? null })), total, p), livePaidTotal: (sum._sum.amount ?? 0).toString() });
}
