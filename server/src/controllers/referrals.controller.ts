import type { Prisma, ReferralType } from "@prisma/client";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterKycDecision, removeKycPhotos } from "./kyc.controller";
import { allowedOrigins } from "../config/env";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { requestMeta } from "../lib/audit";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { DEFAULT_CAMPAIGNS, type CodeKind } from "../lib/referrals";
import { publicName } from "../lib/reviews";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import {
  adminAdjust,
  campaigns,
  ensureCode,
  evaluateForUser,
  evaluateReferral,
  grantReward,
  invalidateCampaigns,
  lookupCode,
  redeemForPlan,
  reverseReward,
  rotateCode,
  stepsFor,
  walletSummary,
} from "../services/referral.service";

const origin = () => (allowedOrigins[0] ?? "http://localhost:5173").replace(/\/$/, "");
const linkFor = (code: string) => `${origin()}/ref/${code}`;
const TYPES = ["TENANT_TO_TENANT", "LANDLORD_TO_TENANT", "LANDLORD_TO_LANDLORD"] as const;
const STATUSES = ["REGISTERED", "PHONE_VERIFIED", "ONBOARDING_PENDING", "VERIFICATION_PENDING", "ELIGIBLE", "SUCCESSFUL", "EXPIRED", "REJECTED", "REVERSED"] as const;
const PENDING = ["REGISTERED", "PHONE_VERIFIED", "ONBOARDING_PENDING", "VERIFICATION_PENDING", "ELIGIBLE"] as const;

function rolesOf(req: Request): string[] {
  const u = me(req);
  return [...new Set([u.role, ...u.roles])];
}

/* ─────────────── Public link check ─────────────── */

/** GET /api/v1/referrals/codes/:code — no sign-in needed (the /ref page). Only the referrer's first name is shown. */
export async function checkCode(req: Request, res: Response): Promise<void> {
  await consumeRateLimit(`ref-lookup:${requestMeta(req).ip ?? "unknown"}`, RATE_LIMITS.REFERRAL_LOOKUP.limit, RATE_LIMITS.REFERRAL_LOOKUP.windowMs);
  const info = await lookupCode(String(req.params.code ?? "").toUpperCase());
  if (!info) fail("not-found", REASONS.NOT_FOUND, "This referral link is not valid or has expired. You can still sign up normally.");
  res.json({ valid: true, ...info });
}

/* ─────────────── My referrals ─────────────── */

/** GET /api/v1/referrals/me — codes, links, stats, history, wallet and free months (tenant and landlord). */
export async function myReferrals(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const roles = rolesOf(req);
  const map = await campaigns();
  const kinds = (["TENANT", "LANDLORD"] as CodeKind[]).filter((k) => roles.includes(k));
  const codes = [];
  for (const kind of kinds) {
    const type: ReferralType = kind === "TENANT" ? "TENANT_TO_TENANT" : "LANDLORD_TO_LANDLORD";
    const c = map.get(type)!;
    if (!c.enabled) continue;
    const { code, created } = await ensureCode(user.id, kind);
    if (created) await notify(user.id, "Your referral link is ready", kind === "TENANT" ? `Share it with friends — you get ₹${c.rewardAmount ?? 0} credit when they join and finish onboarding.` : "Share it with landlords — you get a free month of the top plan when they're verified.", "/referrals");
    const url = linkFor(code.code);
    codes.push({
      kind,
      code: code.code,
      url,
      expiresAt: code.expiresAt,
      opens: code.opens,
      reward: kind === "TENANT" ? `₹${c.rewardAmount ?? 0} per friend` : `${c.durationMonths ?? 1} free month(s) of the top landlord plan`,
      shareText: kind === "TENANT" ? `Join me on SafeRent — verified homes and simple rent. Sign up with my link: ${url}` : `List your property on SafeRent — verified tenants, rent tracking and more. Join with my link: ${url}`,
      terms: c.terms,
    });
  }

  const referrals = await prisma.referral.findMany({ where: { referrerId: user.id }, orderBy: { createdAt: "desc" }, take: 100, include: { entitlement: true } });
  const people = await prisma.user.findMany({ where: { id: { in: referrals.map((r) => r.referredUserId) } }, select: { id: true, fullName: true } });
  const credited = await prisma.promoWalletTransaction.findMany({ where: { userId: user.id, type: "REFERRAL_REWARD" }, select: { referralId: true, amount: true } });
  const history = await Promise.all(
    referrals.map(async (r) => ({
      id: r.id,
      code: r.code,
      type: r.type,
      person: publicName(people.find((p) => p.id === r.referredUserId)?.fullName),
      status: r.status,
      rewardStatus: r.rewardStatus,
      onHold: r.onHold,
      reason: r.rejectionReason,
      // Progress only while it's still on the way.
      steps: (PENDING as readonly string[]).includes(r.status) ? await stepsFor(r) : null,
      reward: r.entitlement ? { kind: "SUBSCRIPTION", plan: r.entitlement.planName, months: r.entitlement.months, status: r.entitlement.status, endsAt: r.entitlement.endsAt } : credited.find((c) => c.referralId === r.id) ? { kind: "CREDIT", amount: credited.find((c) => c.referralId === r.id)!.amount.toFixed(2) } : null,
      createdAt: r.createdAt,
      rewardedAt: r.rewardedAt,
    })),
  );
  const stat = (type: ReferralType) => {
    const rows = referrals.filter((r) => r.type === type);
    return {
      total: rows.length,
      successful: rows.filter((r) => r.status === "SUCCESSFUL").length,
      pending: rows.filter((r) => (PENDING as readonly string[]).includes(r.status)).length,
      rejected: rows.filter((r) => ["REJECTED", "EXPIRED", "REVERSED"].includes(r.status)).length,
      earned: type === "LANDLORD_TO_LANDLORD"
        ? rows.filter((r) => r.entitlement && r.entitlement.status !== "CANCELLED").reduce((n, r) => n + r.entitlement!.months, 0)
        : credited.filter((c) => rows.some((r) => r.id === c.referralId) && rows.find((r) => r.id === c.referralId)!.rewardStatus === "REWARD_CREDITED").reduce((n, c) => n + Number(c.amount), 0),
    };
  };
  const invitations = roles.includes("LANDLORD") ? await prisma.tenantInvitation.groupBy({ by: ["status"], where: { landlordId: user.id }, _count: { _all: true } }) : [];
  const entitlements = await prisma.subscriptionEntitlement.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 });

  res.json({
    codes,
    stats: {
      tenantToTenant: roles.includes("TENANT") ? { ...stat("TENANT_TO_TENANT"), rewardPerReferral: map.get("TENANT_TO_TENANT")!.rewardAmount } : null,
      landlordToTenant: roles.includes("LANDLORD") ? { ...stat("LANDLORD_TO_TENANT"), rewardPerReferral: map.get("LANDLORD_TO_TENANT")!.rewardAmount, invitations: Object.fromEntries(invitations.map((i) => [i.status, i._count._all])) } : null,
      landlordToLandlord: roles.includes("LANDLORD") ? { ...stat("LANDLORD_TO_LANDLORD"), monthsPerReferral: map.get("LANDLORD_TO_LANDLORD")!.durationMonths } : null,
    },
    history,
    wallet: await walletSummary(user.id),
    entitlements,
  });
}

/** POST /api/v1/referrals/codes/:kind/rotate — revoke my current link and make a new one. */
export async function rotateMyCode(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const kind = parseInput(z.enum(["TENANT", "LANDLORD"]), req.params.kind) as CodeKind;
  if (!rolesOf(req).includes(kind)) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have this role.");
  await consumeRateLimit(`ref-code:${user.id}`, RATE_LIMITS.REFERRAL_CODE.limit, RATE_LIMITS.REFERRAL_CODE.windowMs);
  const code = await rotateCode(user.id, kind);
  res.locals.message = "New referral link created. The old link no longer works.";
  res.json({ code: code.code, url: linkFor(code.code) });
}

/* ─────────────── Wallet ─────────────── */

/** GET /api/v1/wallet — promotional balance (credits are never cash). */
export async function myWallet(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const roles = rolesOf(req);
  const plans = await prisma.subscriptionPlan.findMany({ where: { active: true, audience: { in: roles as never[] } }, orderBy: { priceMonthly: "asc" }, select: { id: true, name: true, audience: true, priceMonthly: true, features: true } });
  res.json({ wallet: await walletSummary(user.id), redeemablePlans: plans });
}

/** GET /api/v1/wallet/transactions — the ledger. Read-only: nobody can edit ledger rows. */
export async function myWalletTransactions(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const p = pagination(req);
  const where = { userId: user.id };
  const [items, total] = await Promise.all([
    prisma.promoWalletTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, select: { id: true, type: true, bucket: true, amount: true, balanceAfter: true, currency: true, status: true, rewardType: true, referralId: true, expiresAt: true, note: true, createdAt: true } }),
    prisma.promoWalletTransaction.count({ where }),
  ]);
  res.json(paged(items.map((t) => ({ ...t, transactionType: t.type, amount: t.amount.toFixed(2), balanceAfter: t.balanceAfter.toFixed(2), referenceId: t.referralId })), total, p));
}

const redeemSchema = z.object({ planId: z.string().uuid(), requestId: z.string().uuid().optional() }).strict();

/** POST /api/v1/wallet/redeem — one month of a SafeRent plan paid with credit (web). */
export async function redeem(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await consumeRateLimit(`wallet-redeem:${user.id}`, RATE_LIMITS.WALLET_REDEEM.limit, RATE_LIMITS.WALLET_REDEEM.windowMs);
  const input = parseInput(redeemSchema, req.body);
  const r = await redeemForPlan(user.id, rolesOf(req), input.planId, input.requestId ?? randomUUID());
  if (!r.ok) fail("failed-precondition", REASONS.INVALID_STATE, r.message);
  res.locals.message = r.duplicate ? "Already redeemed." : `${r.plan} activated with your credit.`;
  res.json(r);
}

/* ─────────────── Landlord identity verification (KYC) ─────────────── */

const kycSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional() }).strict().refine((v) => v.decision === "APPROVED" || (v.note ?? "").length >= 5, { message: "Give a reason (at least 5 characters).", path: ["note"] });

/** POST /api/v1/users/:id/kyc — staff verify a landlord's identity (users.manage). Unlocks referral rewards. */
export async function decideKyc(req: Request, res: Response): Promise<void> {
  const actor = me(req);
  const id = idParam(req);
  if (id === actor.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can't verify your own identity.");
  const profile = found(await prisma.landlordProfile.findUnique({ where: { userId: id } }), "Landlord profile");
  const { decision, note } = parseInput(kycSchema, req.body);
  const photos = await prisma.$transaction(async (tx) => {
    // Owner verification: needs DigiLocker + selfie to approve; clears the submission; drops the DigiLocker photo.
    const files = await afterKycDecision(tx, id, decision);
    await tx.landlordProfile.update({ where: { userId: id }, data: { kycStatus: decision, kycNote: note ?? null, kycReviewedById: actor.id, kycReviewedAt: new Date() } });
    await logActivity(req, decision === "APPROVED" ? "landlord.kyc_approve" : "landlord.kyc_reject", "user", id, { from: profile.kycStatus, to: decision, note }, tx);
    return files;
  });
  await removeKycPhotos(photos);
  await notify(
    id,
    decision === "APPROVED" ? "Owner verified ✅" : "Owner verification needs attention",
    decision === "APPROVED" ? "SafeRent has verified your identity. Your properties can now be approved." : `We couldn't verify you: ${note}. Please fix it and submit again.`,
    "/verify",
  );
  await evaluateForUser(id);
  res.locals.message = decision === "APPROVED" ? "Identity verified" : "Identity verification rejected";
  res.json({ kycStatus: decision });
}

/* ─────────────── Admin (referrals.manage) ─────────────── */

/** GET /api/v1/admin/referrals/summary */
export async function adminSummary(_req: Request, res: Response): Promise<void> {
  const [byType, byStatus, credits, months, codes] = await Promise.all([
    prisma.referral.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.referral.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.promoWalletTransaction.aggregate({ where: { type: "REFERRAL_REWARD" }, _sum: { amount: true } }),
    prisma.subscriptionEntitlement.aggregate({ where: { status: { not: "CANCELLED" } }, _sum: { months: true } }),
    prisma.referralCode.aggregate({ _sum: { opens: true } }),
  ]);
  const count = (s: string[]) => byStatus.filter((x) => s.includes(x.status)).reduce((n, x) => n + x._count._all, 0);
  const total = byType.reduce((n, x) => n + x._count._all, 0);
  const successful = count(["SUCCESSFUL"]);
  res.json({
    total,
    byType: Object.fromEntries(byType.map((x) => [x.type, x._count._all])),
    successful,
    pending: count([...PENDING]),
    rejected: count(["REJECTED", "EXPIRED", "REVERSED"]),
    onHold: await prisma.referral.count({ where: { onHold: true, status: { in: [...PENDING] } } }),
    creditsIssued: (credits._sum.amount ?? 0).toString(),
    freeMonthsGranted: months._sum.months ?? 0,
    linkOpens: codes._sum.opens ?? 0,
    conversionRate: total ? Math.round((successful / total) * 1000) / 10 : 0,
  });
}

/** GET /api/v1/admin/referrals?type=&status=&q=&onHold= */
export async function adminList(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const type = enumQuery(req, "type", TYPES);
  const status = enumQuery(req, "status", STATUSES);
  const and: Prisma.ReferralWhereInput[] = [];
  if (type) and.push({ type });
  if (status) and.push({ status });
  if (req.query.onHold === "true") and.push({ onHold: true });
  if (p.q) {
    const people = await prisma.user.findMany({ where: { OR: [{ fullName: { contains: p.q } }, { phoneNumber: { contains: p.q } }, { email: { contains: p.q } }] }, select: { id: true }, take: 50 });
    const ids = people.map((u) => u.id);
    and.push({ OR: [{ code: p.q }, { referrerId: { in: ids } }, { referredUserId: { in: ids } }] });
  }
  const where: Prisma.ReferralWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([prisma.referral.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.referral.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.referrerId, r.referredUserId]) } }, select: { id: true, fullName: true, phoneNumber: true } });
  const u = (id: string) => users.find((x) => x.id === id) ?? null;
  res.json(paged(rows.map((r) => ({ ...r, referrer: u(r.referrerId), referred: u(r.referredUserId) })), total, p));
}

/** GET /api/v1/admin/referrals/:id — with eligibility steps, events, ledger rows and entitlement. */
export async function adminGet(req: Request, res: Response): Promise<void> {
  const r = found(await prisma.referral.findUnique({ where: { id: idParam(req) }, include: { events: { orderBy: { createdAt: "desc" } }, entitlement: true } }), "Referral");
  const [users, ledger, steps] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [r.referrerId, r.referredUserId, ...r.events.map((e) => e.actorId ?? "")].filter(Boolean) } }, select: { id: true, fullName: true, phoneNumber: true, accountStatus: true } }),
    prisma.promoWalletTransaction.findMany({ where: { referralId: r.id }, orderBy: { createdAt: "asc" } }),
    stepsFor(r),
  ]);
  const u = (id: string | null) => users.find((x) => x.id === id) ?? null;
  res.json({ referral: { ...r, referrer: u(r.referrerId), referred: u(r.referredUserId) }, steps, ledger, events: r.events.map((e) => ({ ...e, actor: u(e.actorId)?.fullName ?? null })) });
}

const actionSchema = z.object({ action: z.enum(["HOLD", "RELEASE", "REJECT", "REVERSE", "RECHECK"]), reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500) }).strict();

/**
 * POST /api/v1/admin/referrals/:id/action — hold / release / reject / reverse / re-check. Every action is
 * logged with its reason. Ledger rows are never edited: a reversal is a new, opposite ledger row.
 */
export async function adminAction(req: Request, res: Response): Promise<void> {
  const actor = me(req);
  const r = found(await prisma.referral.findUnique({ where: { id: idParam(req) } }), "Referral");
  if ([r.referrerId, r.referredUserId].includes(actor.id)) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can't act on your own referral.");
  const { action, reason } = parseInput(actionSchema, req.body);
  const log = (extra?: Record<string, unknown>) => Promise.all([
    prisma.referralEvent.create({ data: { referralId: r.id, event: `ADMIN_${action}`, data: { reason, ...extra } as Prisma.InputJsonValue, actorId: actor.id } }),
    logActivity(req, `referral.${action.toLowerCase()}`, "referral", r.id, { reason, from: r.status, ...extra }),
  ]);
  const open = (PENDING as readonly string[]).includes(r.status);
  switch (action) {
    case "HOLD":
      if (!open) fail("failed-precondition", REASONS.INVALID_STATE, "Only referrals still in progress can be held.");
      await prisma.referral.update({ where: { id: r.id }, data: { onHold: true, holdReason: reason } });
      await log();
      break;
    case "RELEASE":
      if (!r.onHold) fail("failed-precondition", REASONS.INVALID_STATE, "This referral isn't on hold.");
      await prisma.referral.update({ where: { id: r.id }, data: { onHold: false, holdReason: null } });
      await log();
      await evaluateReferral(r.id, actor.id);
      break;
    case "REJECT": {
      if (!open) fail("failed-precondition", REASONS.INVALID_STATE, r.rewardStatus === "REWARD_CREDITED" ? "Already rewarded — use Reverse." : "This referral is already closed.");
      const done = await prisma.referral.updateMany({ where: { id: r.id, status: { in: [...PENDING] } }, data: { status: "REJECTED", rewardStatus: "NOT_DUE", rejectionReason: reason } });
      if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This referral just changed. Refresh and try again.");
      await log();
      await notify(r.referrerId, "Referral not approved", `Referral ${r.code} was rejected: ${reason}`, "/referrals");
      break;
    }
    case "REVERSE": {
      if (r.rewardStatus !== "REWARD_CREDITED") fail("failed-precondition", REASONS.INVALID_STATE, "Only paid rewards can be reversed.");
      const out = await reverseReward(r.id, reason, actor.id);
      await logActivity(req, "referral.reverse", "referral", r.id, { reason, ...out });
      break;
    }
    case "RECHECK":
      await log();
      await evaluateReferral(r.id, actor.id);
      if (r.status === "ELIGIBLE") await grantReward(r.id, actor.id);
      break;
  }
  res.locals.message = "Done";
  res.json({ ok: true });
}

/** GET /api/v1/admin/referral-events — the referral audit trail. */
export async function adminEvents(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const where: Prisma.ReferralEventWhereInput = typeof req.query.event === "string" && req.query.event ? { event: req.query.event } : {};
  const [items, total] = await Promise.all([prisma.referralEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.referralEvent.count({ where })]);
  res.json(paged(items, total, p));
}

/** GET /api/v1/admin/referral-campaigns */
export async function adminCampaigns(_req: Request, res: Response): Promise<void> {
  const map = await campaigns();
  res.json({ items: [...map.values()], defaults: DEFAULT_CAMPAIGNS });
}

const campaignSchema = z
  .object({
    enabled: z.boolean(),
    rewardAmount: z.coerce.number().min(0).max(10_000).nullable().optional(),
    durationMonths: z.coerce.number().int().min(1).max(12).nullable().optional(),
    maxRewardsPerUser: z.coerce.number().int().min(1).max(10_000).nullable(),
    startsAt: z.coerce.date().nullable(),
    endsAt: z.coerce.date().nullable(),
    codeExpiryDays: z.coerce.number().int().min(1).max(3650).nullable(),
    rewardExpiryDays: z.coerce.number().int().min(1).max(3650).nullable(),
    tenantEligibility: z.enum(["PROFILE_COMPLETE", "ACTIVE_LEASE"]).nullable().optional(),
    terms: z.string().trim().max(5000).nullable(),
  })
  .strict()
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { message: "End must be after start.", path: ["endsAt"] });

/** PUT /api/v1/admin/referral-campaigns/:type — Super Admin (settings.manage). Logged with before / after. */
export async function adminSaveCampaign(req: Request, res: Response): Promise<void> {
  const type = parseInput(z.enum(TYPES), req.params.type) as ReferralType;
  const input = parseInput(campaignSchema, req.body);
  if (type === "LANDLORD_TO_LANDLORD" && !input.durationMonths) fail("invalid-argument", REASONS.INVALID_INPUT, "Set the free subscription duration.");
  if (type !== "LANDLORD_TO_LANDLORD" && !(input.rewardAmount && input.rewardAmount > 0)) fail("invalid-argument", REASONS.INVALID_INPUT, "Set the reward amount.");
  const before = (await campaigns()).get(type);
  const data = {
    enabled: input.enabled,
    rewardAmount: type === "LANDLORD_TO_LANDLORD" ? null : input.rewardAmount!.toFixed(2),
    durationMonths: type === "LANDLORD_TO_LANDLORD" ? input.durationMonths! : null,
    maxRewardsPerUser: input.maxRewardsPerUser,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    codeExpiryDays: input.codeExpiryDays,
    rewardExpiryDays: input.rewardExpiryDays,
    tenantEligibility: type === "TENANT_TO_TENANT" ? (input.tenantEligibility ?? "PROFILE_COMPLETE") : null,
    terms: input.terms,
    updatedById: me(req).id,
  };
  await prisma.$transaction(async (tx) => {
    await tx.referralCampaign.upsert({ where: { type }, create: { type, ...data }, update: data });
    await logActivity(req, "referral.campaign_update", "referral_campaign", type, { before, after: data }, tx);
  });
  invalidateCampaigns();
  res.locals.message = "Campaign saved";
  res.json({ ok: true });
}

/* ─────────────── Admin wallet adjustments (wallet.adjust) ─────────────── */

const CUSTOMER_ROLES = ["LANDLORD", "TENANT"] as const;
const customerWhere: Prisma.UserWhereInput = { OR: [{ role: { in: [...CUSTOMER_ROLES] } }, { extraRoles: { some: { role: { in: [...CUSTOMER_ROLES] } } } }] };

/** GET /api/v1/admin/wallets?q=&role= — landlords and tenants with their balances (to pick users). */
export async function adminWalletUsers(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const role = enumQuery(req, "role", CUSTOMER_ROLES);
  const where: Prisma.UserWhereInput = {
    AND: [
      customerWhere,
      role ? { OR: [{ role }, { extraRoles: { some: { role } } }] } : {},
      p.q ? { OR: [{ fullName: { contains: p.q } }, { phoneNumber: { contains: p.q } }, { email: { contains: p.q } }] } : {},
    ],
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { fullName: "asc" }, skip: p.skip, take: p.take, select: { id: true, fullName: true, phoneNumber: true, email: true, role: true, accountStatus: true, extraRoles: { select: { role: true } } } }),
    prisma.user.count({ where }),
  ]);
  const wallets = await prisma.promoWallet.findMany({ where: { userId: { in: users.map((u) => u.id) } } });
  res.json(
    paged(
      users.map(({ extraRoles, ...u }) => ({ ...u, roles: [u.role, ...extraRoles.map((r) => r.role)], balance: (wallets.find((w) => w.userId === u.id)?.balance ?? 0).toString(), cashBalance: (wallets.find((w) => w.userId === u.id)?.cashBalance ?? 0).toString() })),
      total,
      p,
    ),
  );
}

/** GET /api/v1/admin/wallets/:userId — one user's balance and full ledger. */
export async function adminWalletDetail(req: Request, res: Response): Promise<void> {
  const userId = idParam(req, "userId");
  const user = found(await prisma.user.findFirst({ where: { AND: [{ id: userId }, customerWhere] }, select: { id: true, fullName: true, phoneNumber: true } }), "User");
  const p = pagination(req);
  const where = { userId };
  const [items, total, wallet] = await Promise.all([
    prisma.promoWalletTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.promoWalletTransaction.count({ where }),
    walletSummary(userId),
  ]);
  const actors = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.createdById ?? "").filter(Boolean) } }, select: { id: true, fullName: true } });
  res.json({ user, wallet, ...paged(items.map((t) => ({ ...t, amount: t.amount.toFixed(2), balanceAfter: t.balanceAfter.toFixed(2), by: actors.find((a) => a.id === t.createdById)?.fullName ?? null })), total, p) });
}

const adjustSchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1, "Select at least one user.").max(50, "Up to 50 users at a time."),
    direction: z.enum(["CREDIT", "DEBIT"]),
    /** PROMO = promotional credit (default), CASH = added-money balance. */
    bucket: z.enum(["PROMO", "CASH"]).default("PROMO"),
    amount: z.coerce.number().positive("Enter an amount.").max(100_000, "Up to ₹1,00,000 per adjustment.").refine((n) => Math.round(n * 100) === n * 100, "Up to 2 decimals."),
    reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(255),
    expiresInDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
    requestId: z.string().uuid(),
  })
  .strict();

/**
 * POST /api/v1/admin/wallets/adjust — add or deduct promotional balance for selected landlords / tenants.
 * Each user gets a new ledger row with the reason; the admin can't adjust their own wallet. A repeated
 * request (same requestId) changes nothing.
 */
export async function adminWalletAdjust(req: Request, res: Response): Promise<void> {
  const actor = me(req);
  const input = parseInput(adjustSchema, req.body);
  const ids = [...new Set(input.userIds)];
  if (ids.includes(actor.id)) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can't adjust your own wallet.");
  const valid = await prisma.user.findMany({ where: { AND: [{ id: { in: ids } }, customerWhere] }, select: { id: true } });
  const results = [];
  for (const userId of ids) {
    if (!valid.some((v) => v.id === userId)) {
      results.push({ userId, ok: false, message: "Only landlord and tenant accounts have a wallet." });
      continue;
    }
    const r = await adminAdjust({ userId, direction: input.direction, amount: input.amount, reason: input.reason, actorId: actor.id, key: `admin:${input.requestId}:${userId}`, bucket: input.bucket, expiresInDays: input.direction === "CREDIT" && input.bucket === "PROMO" ? (input.expiresInDays ?? null) : null });
    if (r.ok) await logActivity(req, input.direction === "CREDIT" ? "wallet.admin_credit" : "wallet.admin_debit", "user", userId, { amount: input.amount, bucket: input.bucket, reason: input.reason, balanceAfter: r.balance });
    results.push(r);
  }
  const okCount = results.filter((r) => r.ok).length;
  res.locals.message = `${input.direction === "CREDIT" ? "Added to" : "Deducted from"} ${okCount} of ${ids.length} wallet(s).`;
  res.json({ results });
}

/** GET /api/v1/admin/wallets/adjustments — recent admin credits / debits across users. */
export async function adminWalletAdjustments(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const where: Prisma.PromoWalletTransactionWhereInput = { type: { in: ["ADMIN_CREDIT", "ADMIN_DEBIT"] } };
  const [items, total] = await Promise.all([prisma.promoWalletTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.promoWalletTransaction.count({ where })]);
  const people = await prisma.user.findMany({ where: { id: { in: items.flatMap((i) => [i.userId, i.createdById ?? ""]).filter(Boolean) } }, select: { id: true, fullName: true } });
  const name = (id: string | null) => people.find((x) => x.id === id)?.fullName ?? null;
  res.json(paged(items.map((t) => ({ id: t.id, type: t.type, bucket: t.bucket, amount: t.amount.toFixed(2), balanceAfter: t.balanceAfter.toFixed(2), note: t.note, createdAt: t.createdAt, user: name(t.userId), userId: t.userId, by: name(t.createdById) })), total, p));
}
