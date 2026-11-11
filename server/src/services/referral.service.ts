import { Prisma, type Referral, type ReferralType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { notify } from "../lib/notify";
import {
  DEFAULT_CAMPAIGNS,
  allDone,
  allocate,
  campaignOpen,
  checkAttribution,
  expiredLots,
  highestPlan,
  isWellFormedCode,
  kindOfCode,
  landlordSteps,
  newReferralCode,
  progressStatus,
  promoPeriod,
  reversalKey,
  rewardKey,
  tenantSteps,
  type Campaign,
  type CodeKind,
  type Step,
} from "../lib/referrals";
import { publicName } from "../lib/reviews";
import { ID_PREFIX } from "../properties/catalog";
import { nextCode } from "../properties/ids";

/*
 * Referral engine. Everything that decides attribution, eligibility or rewards runs here, on the server,
 * from database facts. Hooks in registration, invitations, profile, KYC, document and property review
 * call evaluateForUser(); it is safe to call any number of times (idempotent).
 */

type Tx = Prisma.TransactionClient;
const TERMINAL = ["SUCCESSFUL", "EXPIRED", "REJECTED", "REVERSED"] as const;
const HOLD_VELOCITY = 10; // more referrals than this in 24 h → held for manual review

/* ─── Campaigns ─── */

let campaignCache: { at: number; map: Map<ReferralType, Campaign & { terms: string | null }> } | null = null;

export function invalidateCampaigns(): void {
  campaignCache = null;
}

export async function campaigns(): Promise<Map<ReferralType, Campaign & { terms: string | null }>> {
  if (campaignCache && Date.now() - campaignCache.at < 60_000) return campaignCache.map;
  const rows = await prisma.referralCampaign.findMany();
  const map = new Map<ReferralType, Campaign & { terms: string | null }>();
  for (const type of Object.keys(DEFAULT_CAMPAIGNS) as ReferralType[]) {
    const row = rows.find((r) => r.type === type);
    const d = DEFAULT_CAMPAIGNS[type];
    map.set(type, {
      type,
      enabled: row?.enabled ?? d.enabled,
      rewardAmount: row ? (row.rewardAmount === null ? null : Number(row.rewardAmount)) : d.rewardAmount,
      durationMonths: row ? row.durationMonths : d.durationMonths,
      maxRewardsPerUser: row ? row.maxRewardsPerUser : d.maxRewardsPerUser,
      startsAt: row?.startsAt ?? d.startsAt,
      endsAt: row?.endsAt ?? d.endsAt,
      codeExpiryDays: row ? row.codeExpiryDays : d.codeExpiryDays,
      rewardExpiryDays: row ? row.rewardExpiryDays : d.rewardExpiryDays,
      tenantEligibility: ((row?.tenantEligibility as Campaign["tenantEligibility"]) ?? d.tenantEligibility) || undefined,
      terms: row?.terms ?? null,
    });
  }
  campaignCache = { at: Date.now(), map };
  return map;
}

const campaignForKind = (kind: CodeKind): ReferralType => (kind === "TENANT" ? "TENANT_TO_TENANT" : "LANDLORD_TO_LANDLORD");

/* ─── Codes ─── */

/** The user's active code of this kind, creating one if needed. */
export async function ensureCode(userId: string, kind: CodeKind) {
  const now = new Date();
  const existing = await prisma.referralCode.findFirst({ where: { userId, kind, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { createdAt: "desc" } });
  if (existing) return { code: existing, created: false };
  const c = (await campaigns()).get(campaignForKind(kind))!;
  for (let i = 0; i < 5; i++) {
    try {
      const code = await prisma.referralCode.create({ data: { code: newReferralCode(kind), userId, kind, expiresAt: c.codeExpiryDays ? new Date(now.getTime() + c.codeExpiryDays * 86_400_000) : null } });
      await prisma.referralEvent.create({ data: { codeId: code.id, event: "LINK_GENERATED", actorId: userId } });
      return { code, created: true };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  throw new Error("Could not generate a unique referral code");
}

/** Revoke → old links stop working, a fresh code is issued. */
export async function rotateCode(userId: string, kind: CodeKind) {
  await prisma.referralCode.updateMany({ where: { userId, kind, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
  return (await ensureCode(userId, kind)).code;
}

/** Public check for /ref/:code. Counts the open; reveals only the referrer's first name. */
export async function lookupCode(code: string) {
  if (!isWellFormedCode(code)) return null;
  const row = await prisma.referralCode.findUnique({ where: { code } });
  if (!row || row.status !== "ACTIVE" || (row.expiresAt && row.expiresAt <= new Date())) return null;
  const owner = await prisma.user.findUnique({ where: { id: row.userId }, select: { fullName: true, accountStatus: true } });
  if (!owner || owner.accountStatus !== "ACTIVE") return null;
  const campaign = (await campaigns()).get(campaignForKind(row.kind))!;
  if (!campaignOpen(campaign)) return null;
  await prisma.referralCode.update({ where: { id: row.id }, data: { opens: { increment: 1 } } });
  await prisma.referralEvent.create({ data: { codeId: row.id, event: "LINK_OPENED" } });
  return { code: row.code, kind: row.kind, referrerName: owner.fullName.split(/\s+/)[0] ?? "A SafeRent user", joinAs: row.kind, terms: campaign.terms };
}

/* ─── Attribution ─── */

async function event(db: Tx | typeof prisma, referralId: string, ev: string, data?: Record<string, unknown>, actorId?: string | null) {
  await db.referralEvent.create({ data: { referralId, event: ev, data: (data ?? undefined) as Prisma.InputJsonValue | undefined, actorId: actorId ?? null } });
}

/**
 * Called once, right after a new account is created through /auth/register. Attribution is created
 * here (never later) and locked: unique (type, referredUser) means no second referrer can claim them.
 */
export async function attributeOnRegistration(newUser: { id: string; role: string; fullName: string }, code: string | undefined): Promise<void> {
  if (!code || !isWellFormedCode(code)) return;
  const row = await prisma.referralCode.findUnique({ where: { code } });
  const referrer = row ? await prisma.user.findUnique({ where: { id: row.userId }, select: { id: true, role: true, accountStatus: true, extraRoles: { select: { role: true } } } }) : null;
  const kind = row?.kind ?? kindOfCode(code);
  const campaign = (await campaigns()).get(campaignForKind(kind)) ?? null;
  const referrerRoles = referrer ? [referrer.role, ...referrer.extraRoles.map((r) => r.role)] : [];
  const result = checkAttribution(row ? { status: row.status, expiresAt: row.expiresAt, ownerId: row.userId, kind: row.kind } : null, {
    newUserId: newUser.id,
    newUserRole: newUser.role,
    referrerActive: referrer?.accountStatus === "ACTIVE",
    referrerHasRole: referrerRoles.includes(kind),
    campaign,
  });
  if (!result.ok || !row) {
    if (row) await prisma.referralEvent.create({ data: { codeId: row.id, event: "ATTRIBUTION_REFUSED", data: { reason: result.ok ? "INVALID" : result.reason } } });
    return;
  }
  const recent = await prisma.referral.count({ where: { referrerId: row.userId, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
  try {
    const referral = await prisma.$transaction(async (tx) => {
      const created = await tx.referral.create({
        data: {
          code: await nextCode(tx, ID_PREFIX.REFERRAL),
          type: result.type,
          referrerId: row.userId,
          referredUserId: newUser.id,
          referralCodeId: row.id,
          status: "REGISTERED",
          onHold: recent >= HOLD_VELOCITY,
          holdReason: recent >= HOLD_VELOCITY ? `Unusual activity: ${recent + 1} sign-ups in 24 hours. Held for review.` : null,
        },
      });
      await event(tx, created.id, "REGISTERED", { via: code });
      if (created.onHold) await event(tx, created.id, "HELD", { reason: created.holdReason });
      return created;
    });
    await notify(row.userId, "Someone joined with your link", `${publicName(newUser.fullName)} signed up with your SafeRent referral link. We'll let you know when your reward is unlocked.`, "/referrals");
    await evaluateReferral(referral.id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // already attributed
    throw err;
  }
}

/**
 * LANDLORD_TO_TENANT: created when a tenant accepts a landlord's invitation (lease ACTIVE). One per tenant
 * ever, so re-inviting the same person never pays twice; never for invitations that weren't accepted.
 */
export async function recordInvitationReferral(inv: { id: string; landlordId: string }, tenantId: string, leaseId: string): Promise<void> {
  if (inv.landlordId === tenantId) return;
  const campaign = (await campaigns()).get("LANDLORD_TO_TENANT")!;
  if (!campaignOpen(campaign)) return;
  const landlord = await prisma.user.findUnique({ where: { id: inv.landlordId }, select: { accountStatus: true } });
  if (landlord?.accountStatus !== "ACTIVE") return;
  try {
    const referral = await prisma.$transaction(async (tx) => {
      const created = await tx.referral.create({
        data: { code: await nextCode(tx, ID_PREFIX.REFERRAL), type: "LANDLORD_TO_TENANT", referrerId: inv.landlordId, referredUserId: tenantId, invitationId: inv.id, leaseId, status: "REGISTERED" },
      });
      await event(tx, created.id, "INVITATION_ACCEPTED", { invitationId: inv.id, leaseId });
      return created;
    });
    await evaluateReferral(referral.id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // this tenant already earned a landlord a reward
    throw err;
  }
}

/* ─── Eligibility ─── */

export async function stepsFor(r: Pick<Referral, "type" | "referrerId" | "referredUserId" | "leaseId">): Promise<Step[]> {
  if (r.type === "TENANT_TO_TENANT") {
    const [u, profile, leases] = await Promise.all([
      prisma.user.findUnique({ where: { id: r.referredUserId }, select: { phoneVerified: true } }),
      prisma.tenantProfile.findUnique({ where: { userId: r.referredUserId }, select: { occupation: true, currentCity: true } }),
      prisma.lease.count({ where: { tenantId: r.referredUserId, status: "ACTIVE" } }),
    ]);
    const rule = (await campaigns()).get("TENANT_TO_TENANT")!.tenantEligibility;
    return tenantSteps({ phoneVerified: !!u?.phoneVerified, occupation: profile?.occupation ?? null, currentCity: profile?.currentCity ?? null, hasActiveLease: leases > 0 }, rule);
  }
  if (r.type === "LANDLORD_TO_TENANT") {
    const [lease, landlord] = await Promise.all([
      r.leaseId ? prisma.lease.findUnique({ where: { id: r.leaseId }, select: { status: true } }) : null,
      prisma.landlordProfile.findUnique({ where: { userId: r.referrerId }, select: { kycStatus: true } }),
    ]);
    return [
      { key: "accepted", label: "Tenant accepted your invitation", done: true },
      { key: "lease", label: "Rental agreement active", done: lease?.status === "ACTIVE" },
      { key: "identity", label: "Your identity verified by SafeRent", done: landlord?.kycStatus === "APPROVED" },
    ];
  }
  const [u, profile, docs, props] = await Promise.all([
    prisma.user.findUnique({ where: { id: r.referredUserId }, select: { phoneVerified: true } }),
    prisma.landlordProfile.findUnique({ where: { userId: r.referredUserId }, select: { kycStatus: true } }),
    prisma.propertyDocument.count({ where: { status: "APPROVED", property: { ownerId: r.referredUserId } } }),
    prisma.property.count({ where: { ownerId: r.referredUserId, verificationStatus: "VERIFIED" } }),
  ]);
  return landlordSteps({ phoneVerified: !!u?.phoneVerified, kycApproved: profile?.kycStatus === "APPROVED", approvedDocuments: docs, verifiedProperties: props });
}

/** Re-checks one referral and pays the reward when everything is done. Idempotent. */
export async function evaluateReferral(referralId: string, actorId: string | null = null): Promise<void> {
  const r = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!r || (TERMINAL as readonly string[]).includes(r.status)) return;
  if (r.type === "LANDLORD_TO_TENANT" && r.leaseId) {
    const lease = await prisma.lease.findUnique({ where: { id: r.leaseId }, select: { status: true } });
    if (lease && lease.status !== "ACTIVE") {
      // The lease ended before the reward could be paid: nothing to reward.
      await prisma.referral.updateMany({ where: { id: r.id, status: { notIn: [...TERMINAL] } }, data: { status: "EXPIRED", rejectionReason: "The rental ended before the reward was unlocked." } });
      await event(prisma, r.id, "EXPIRED", { reason: "lease ended" }, actorId);
      return;
    }
  }
  const steps = await stepsFor(r);
  const status = r.type === "LANDLORD_TO_TENANT" ? (allDone(steps) ? "ELIGIBLE" : "VERIFICATION_PENDING") : progressStatus(steps);
  if (status !== r.status) {
    await prisma.referral.updateMany({ where: { id: r.id, status: r.status }, data: { status, ...(status === "ELIGIBLE" ? { eligibleAt: new Date(), rewardStatus: "REWARD_PENDING" } : {}) } });
    await event(prisma, r.id, status, { steps: steps.filter((s) => !s.done).map((s) => s.key) }, actorId);
  }
  if (status === "ELIGIBLE" && !r.onHold) await grantReward(r.id, actorId);
}

/** Runs every hook-triggered re-check for a person (as the referred user, and as a landlord referrer). */
export async function evaluateForUser(userId: string): Promise<void> {
  try {
    const rows = await prisma.referral.findMany({
      where: { status: { notIn: [...TERMINAL] }, OR: [{ referredUserId: userId }, { referrerId: userId, type: "LANDLORD_TO_TENANT" }] },
      select: { id: true },
      take: 200,
    });
    for (const r of rows) await evaluateReferral(r.id);
  } catch (err) {
    // Rewards must never break the action that triggered them (lease, profile, KYC …).
    console.error("[referrals] evaluate failed", err);
  }
}

/* ─── Rewards ─── */

export async function creditWallet(tx: Tx, p: { userId: string; amount: number; key: string; type: "REFERRAL_REWARD" | "REVERSAL" | "EXPIRY" | "REDEMPTION" | "ADMIN_CREDIT" | "ADMIN_DEBIT" | "TOPUP"; bucket?: "PROMO" | "CASH"; rewardType?: string; referralId?: string; expiresAt?: Date | null; note?: string; actorId?: string | null; asLot?: boolean }) {
  const bucket = p.bucket ?? "PROMO";
  // The ledger row is written first: its unique idempotency key makes a repeat fail before money moves.
  const amount = new Prisma.Decimal(p.amount.toFixed(2));
  await tx.promoWallet.upsert({ where: { userId: p.userId }, create: { userId: p.userId }, update: {} });
  const txn = await tx.promoWalletTransaction.create({
    data: {
      userId: p.userId,
      type: p.type,
      bucket,
      amount,
      balanceAfter: 0,
      rewardType: p.rewardType ?? null,
      referralId: p.referralId ?? null,
      remaining: p.asLot && bucket === "PROMO" ? amount : null,
      expiresAt: p.expiresAt ?? null,
      idempotencyKey: p.key,
      note: p.note ?? null,
      createdById: p.actorId ?? null,
      status: p.type === "REFERRAL_REWARD" || p.type === "ADMIN_CREDIT" || p.type === "TOPUP" ? "CREDITED" : "COMPLETED",
    },
  });
  const wallet = await tx.promoWallet.update({
    where: { userId: p.userId },
    data: bucket === "CASH" ? { cashBalance: { increment: amount } } : { balance: { increment: amount }, ...(p.amount > 0 && p.type === "REFERRAL_REWARD" ? { lifetimeEarned: { increment: amount } } : {}) },
  });
  if (wallet.balance.lessThan(0) || wallet.cashBalance.lessThan(0)) throw new Error("Wallet balance cannot go below zero");
  // balance_after = total wallet balance (promotional + added money) after this entry.
  await tx.promoWalletTransaction.update({ where: { id: txn.id }, data: { balanceAfter: wallet.balance.plus(wallet.cashBalance) } });
  return txn;
}

/**
 * Pays an ELIGIBLE referral exactly once: the referral is claimed with a conditional update and the
 * ledger key is unique, so concurrent calls and retries can't pay twice.
 */
export async function grantReward(referralId: string, actorId: string | null = null): Promise<void> {
  const r = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!r || r.status !== "ELIGIBLE" || r.onHold || r.rewardStatus === "REWARD_CREDITED") return;
  const campaign = (await campaigns()).get(r.type)!;
  const paidSoFar = await prisma.referral.count({ where: { referrerId: r.referrerId, type: r.type, rewardStatus: "REWARD_CREDITED" } });
  if (campaign.maxRewardsPerUser !== null && paidSoFar >= campaign.maxRewardsPerUser) {
    await prisma.referral.updateMany({ where: { id: r.id, status: "ELIGIBLE" }, data: { status: "REJECTED", rewardStatus: "NOT_DUE", rejectionReason: `Referral limit reached (${campaign.maxRewardsPerUser}).` } });
    await event(prisma, r.id, "REJECTED", { reason: "limit" }, actorId);
    await notify(r.referrerId, "Referral limit reached", "You've reached the maximum referral rewards for this campaign.", "/referrals");
    return;
  }

  if (r.type === "LANDLORD_TO_LANDLORD") {
    const plan = highestPlan(await prisma.subscriptionPlan.findMany({ where: { active: true, audience: "LANDLORD" } }));
    if (!plan) {
      await event(prisma, r.id, "REWARD_WAITING", { reason: "No active landlord subscription plan is configured." }, actorId);
      return; // stays ELIGIBLE / REWARD_PENDING; admin can retry once a plan exists
    }
    const months = campaign.durationMonths ?? 1;
    let granted: { status: string; endsAt: Date | null } | null = null;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.referral.updateMany({ where: { id: r.id, status: "ELIGIBLE", onHold: false, rewardStatus: { not: "REWARD_CREDITED" } }, data: { status: "SUCCESSFUL", rewardStatus: "REWARD_CREDITED", successfulAt: new Date(), rewardedAt: new Date() } });
      if (!claimed.count) return;
      const active = await tx.subscription.findMany({ where: { userId: r.referrerId, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, select: { endsAt: true } });
      const period = promoPeriod(active, months);
      let subscriptionId: string | null = null;
      if (period.mode !== "NEXT_BILLING") {
        const sub = await tx.subscription.create({ data: { userId: r.referrerId, planId: plan.id, status: "ACTIVE", startsAt: period.startsAt!, endsAt: period.endsAt, source: "REFERRAL_REWARD" } });
        subscriptionId = sub.id;
      }
      const status = period.mode === "NEXT_BILLING" ? "NEXT_BILLING" : period.mode === "EXTENSION" ? "SCHEDULED" : "ACTIVE";
      await tx.subscriptionEntitlement.create({ data: { userId: r.referrerId, planId: plan.id, planName: plan.name, months, referralId: r.id, subscriptionId, status, startsAt: period.startsAt, endsAt: period.endsAt } });
      await event(tx, r.id, "REWARD_CREDITED", { reward: `${months} month(s) ${plan.name}`, mode: period.mode, endsAt: period.endsAt }, actorId);
      granted = { status, endsAt: period.endsAt };
    });
    if (granted) {
      const g = granted as { status: string; endsAt: Date | null };
      await notify(r.referrerId, "Free subscription unlocked 🎉", g.endsAt ? `Your referred landlord is verified. You have ${plan.name} free until ${g.endsAt.toDateString()}.` : `Your referred landlord is verified. ${months} free month(s) of ${plan.name} will be applied to your next billing cycle.`, "/referrals");
    }
    return;
  }

  const amount = campaign.rewardAmount ?? 0;
  if (amount <= 0) return;
  let paid = false;
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.referral.updateMany({ where: { id: r.id, status: "ELIGIBLE", onHold: false, rewardStatus: { not: "REWARD_CREDITED" } }, data: { status: "SUCCESSFUL", rewardStatus: "REWARD_CREDITED", successfulAt: new Date(), rewardedAt: new Date() } });
      if (!claimed.count) return;
      await creditWallet(tx, {
        userId: r.referrerId,
        amount,
        key: rewardKey(r.id),
        type: "REFERRAL_REWARD",
        rewardType: r.type === "TENANT_TO_TENANT" ? "TENANT_REFERRAL" : "TENANT_ONBOARDING",
        referralId: r.id,
        expiresAt: campaign.rewardExpiryDays ? new Date(Date.now() + campaign.rewardExpiryDays * 86_400_000) : null,
        note: `Referral ${r.code}`,
        actorId,
        asLot: true,
      });
      await event(tx, r.id, "REWARD_CREDITED", { amount }, actorId);
      paid = true;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // already paid
    throw err;
  }
  if (paid) await notify(r.referrerId, `₹${amount} reward credited 🎉`, `Your referral ${r.code} is complete. ₹${amount} promotional credit was added to your SafeRent wallet.`, "/referrals");
}

/** Takes back a paid reward (admin, with reason). Only unspent credit can be taken back; spent credit is noted. */
export async function reverseReward(referralId: string, reason: string, actorId: string): Promise<{ reversedAmount: number; alreadyUsed: number }> {
  const r = await prisma.referral.findUnique({ where: { id: referralId }, include: { entitlement: true } });
  if (!r) throw new Error("Referral not found");
  let out = { reversedAmount: 0, alreadyUsed: 0 };
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.referral.updateMany({ where: { id: r.id, rewardStatus: "REWARD_CREDITED" }, data: { status: "REVERSED", rewardStatus: "REVERSED", rejectionReason: reason } });
    if (!claimed.count) throw new Error("This reward was not paid, or was already reversed.");
    const lot = await tx.promoWalletTransaction.findUnique({ where: { idempotencyKey: rewardKey(r.id) } });
    if (lot && lot.remaining && lot.remaining.greaterThan(0)) {
      const take = Number(lot.remaining);
      const lotUpdate = await tx.promoWalletTransaction.updateMany({ where: { id: lot.id, remaining: lot.remaining }, data: { remaining: 0 } });
      if (!lotUpdate.count) throw new Error("Wallet changed at the same time. Try again.");
      await creditWallet(tx, { userId: r.referrerId, amount: -take, key: reversalKey(r.id), type: "REVERSAL", referralId: r.id, note: reason.slice(0, 255), actorId });
      out = { reversedAmount: take, alreadyUsed: Number(lot.amount) - take };
    } else if (lot) {
      out = { reversedAmount: 0, alreadyUsed: Number(lot.amount) };
    }
    if (r.entitlement && r.entitlement.status !== "CANCELLED") {
      await tx.subscriptionEntitlement.update({ where: { id: r.entitlement.id }, data: { status: "CANCELLED" } });
      if (r.entitlement.subscriptionId) await tx.subscription.update({ where: { id: r.entitlement.subscriptionId }, data: { status: "CANCELLED", endsAt: new Date() } });
    }
    await event(tx, r.id, "REVERSED", { reason, ...out }, actorId);
  });
  await notify(r.referrerId, "Referral reward reversed", `The reward for referral ${r.code} was reversed: ${reason}`, "/referrals");
  return out;
}

/* ─── Wallet ─── */

/** Writes off expired, unspent credit (oldest first). Runs before every wallet read. */
export async function expireCredits(userId: string): Promise<void> {
  const lots = await prisma.promoWalletTransaction.findMany({ where: { userId, remaining: { gt: 0 }, expiresAt: { lte: new Date() } } });
  for (const lot of expiredLots(lots.map((l) => ({ id: l.id, remaining: Number(l.remaining), expiresAt: l.expiresAt, createdAt: l.createdAt })))) {
    const row = lots.find((l) => l.id === lot.id)!;
    try {
      await prisma.$transaction(async (tx) => {
        const u = await tx.promoWalletTransaction.updateMany({ where: { id: row.id, remaining: row.remaining }, data: { remaining: 0 } });
        if (!u.count) return;
        await creditWallet(tx, { userId, amount: -lot.remaining, key: `expiry:${row.id}`, type: "EXPIRY", referralId: row.referralId ?? undefined, note: "Promotional credit expired" });
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
}

export async function walletSummary(userId: string) {
  await expireCredits(userId);
  const [wallet, nextExpiry] = await Promise.all([
    prisma.promoWallet.findUnique({ where: { userId } }),
    prisma.promoWalletTransaction.findFirst({ where: { userId, remaining: { gt: 0 }, expiresAt: { not: null } }, orderBy: { expiresAt: "asc" }, select: { remaining: true, expiresAt: true } }),
  ]);
  const promo = wallet?.balance ?? new Prisma.Decimal(0);
  const cash = wallet?.cashBalance ?? new Prisma.Decimal(0);
  return {
    // Total spendable; split below.
    balance: promo.plus(cash).toFixed(2),
    promoBalance: promo.toFixed(2),
    cashBalance: cash.toFixed(2),
    lifetimeEarned: (wallet?.lifetimeEarned ?? new Prisma.Decimal(0)).toFixed(2),
    currency: "INR",
    nextExpiry: nextExpiry ? { amount: nextExpiry.remaining!.toFixed(2), on: nextExpiry.expiresAt } : null,
    rules: [
      "Wallet balance can be used for SafeRent services such as subscription plans.",
      "It can't be withdrawn, transferred to another person or used to pay rent.",
      "Promotional credit is used first and expires on the date shown; money you add doesn't expire.",
    ],
  };
}

/**
 * Redeems credit for one month of a SafeRent plan. The full plan price must be covered (no partial cash
 * top-up here). `requestId` makes a retried request safe.
 */
export async function redeemForPlan(userId: string, roles: string[], planId: string, requestId: string) {
  await expireCredits(userId);
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active || !roles.includes(plan.audience)) return { ok: false as const, message: "This plan isn't available for your account." };
  const price = Number(plan.priceMonthly);
  const key = `redeem:${userId}:${requestId}`;
  const seen = await prisma.promoWalletTransaction.findFirst({ where: { idempotencyKey: { in: [`${key}:promo`, `${key}:cash`] } } });
  if (seen) return { ok: true as const, duplicate: true, plan: plan.name };
  // Promotional credit first (it can expire), then added money.
  const [lots, wallet] = await Promise.all([prisma.promoWalletTransaction.findMany({ where: { userId, remaining: { gt: 0 } } }), prisma.promoWallet.findUnique({ where: { userId } })]);
  const lotView = lots.map((l) => ({ id: l.id, remaining: Number(l.remaining), expiresAt: l.expiresAt, createdAt: l.createdAt }));
  const promoAvailable = lotView.filter((l) => !l.expiresAt || l.expiresAt > new Date()).reduce((n, l) => n + l.remaining, 0);
  const fromPromo = Math.min(price, Math.round(promoAvailable * 100) / 100);
  const fromCash = Math.round((price - fromPromo) * 100) / 100;
  if (fromCash > Number(wallet?.cashBalance ?? 0)) return { ok: false as const, message: `Not enough balance: ${plan.name} costs ₹${price.toFixed(2)}.` };
  const alloc = fromPromo > 0 ? allocate(lotView, fromPromo) : [];
  if (!alloc) return { ok: false as const, message: "Your balance just changed. Try again." };
  let endsAt: Date | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      for (const a of alloc) {
        const lot = lots.find((l) => l.id === a.id)!;
        const u = await tx.promoWalletTransaction.updateMany({ where: { id: lot.id, remaining: lot.remaining }, data: { remaining: { decrement: a.take } } });
        if (!u.count) throw new Error("Wallet changed at the same time. Try again.");
      }
      if (fromPromo > 0) await creditWallet(tx, { userId, amount: -fromPromo, key: `${key}:promo`, type: "REDEMPTION", bucket: "PROMO", note: `1 month ${plan.name}`, actorId: userId });
      if (fromCash > 0) await creditWallet(tx, { userId, amount: -fromCash, key: `${key}:cash`, type: "REDEMPTION", bucket: "CASH", note: `1 month ${plan.name}`, actorId: userId });
      const active = await tx.subscription.findMany({ where: { userId, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, select: { endsAt: true } });
      const period = promoPeriod(active.filter((s) => s.endsAt !== null), 1);
      await tx.subscription.create({ data: { userId, planId: plan.id, status: "ACTIVE", startsAt: period.startsAt!, endsAt: period.endsAt, source: "CREDIT_REDEMPTION" } });
      endsAt = period.endsAt;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: true as const, duplicate: true, plan: plan.name };
    throw err;
  }
  await notify(userId, "Subscription activated", `${plan.name} is active until ${(endsAt as Date | null)?.toDateString() ?? ""}, paid from your wallet.`, "/wallet");
  return { ok: true as const, duplicate: false, plan: plan.name, endsAt };
}

/* ─── Admin adjustments (wallet.adjust) ─── */

export type AdjustResult = { userId: string; ok: true; balance: string } | { userId: string; ok: false; message: string };

/**
 * Adds or deducts promotional balance for one user. It's a new ledger row (ADMIN_CREDIT / ADMIN_DEBIT)
 * with the reason and the admin — existing rows are never edited. Deductions use the oldest-expiring
 * credit first and can't take the balance below zero. `key` makes a retried request safe.
 */
export async function adminAdjust(p: { userId: string; direction: "CREDIT" | "DEBIT"; amount: number; reason: string; actorId: string; key: string; expiresInDays?: number | null; bucket?: "PROMO" | "CASH" }): Promise<AdjustResult> {
  await expireCredits(p.userId);
  const bucket = p.bucket ?? "PROMO";
  if (await prisma.promoWalletTransaction.findUnique({ where: { idempotencyKey: p.key } })) {
    const w = await prisma.promoWallet.findUnique({ where: { userId: p.userId } });
    return { userId: p.userId, ok: true, balance: (w?.balance ?? new Prisma.Decimal(0)).plus(w?.cashBalance ?? 0).toFixed(2) };
  }
  try {
    if (bucket === "CASH") {
      // Added-money balance (e.g. refund of a failed service, correction of a top-up). Can't go below zero.
      if (p.direction === "DEBIT") {
        const w = await prisma.promoWallet.findUnique({ where: { userId: p.userId } });
        if (Number(w?.cashBalance ?? 0) < p.amount) return { userId: p.userId, ok: false, message: `Added-money balance is only ₹${(w?.cashBalance ?? new Prisma.Decimal(0)).toFixed(2)}.` };
      }
      await prisma.$transaction((tx) =>
        creditWallet(tx, { userId: p.userId, amount: p.direction === "CREDIT" ? p.amount : -p.amount, key: p.key, type: p.direction === "CREDIT" ? "ADMIN_CREDIT" : "ADMIN_DEBIT", bucket: "CASH", rewardType: "ADMIN_ADJUSTMENT", note: p.reason.slice(0, 255), actorId: p.actorId }),
      );
    } else if (p.direction === "CREDIT") {
      await prisma.$transaction((tx) =>
        creditWallet(tx, { userId: p.userId, amount: p.amount, key: p.key, type: "ADMIN_CREDIT", rewardType: "ADMIN_ADJUSTMENT", note: p.reason.slice(0, 255), actorId: p.actorId, asLot: true, expiresAt: p.expiresInDays ? new Date(Date.now() + p.expiresInDays * 86_400_000) : null }),
      );
    } else {
      const lots = await prisma.promoWalletTransaction.findMany({ where: { userId: p.userId, remaining: { gt: 0 } } });
      const alloc = allocate(lots.map((l) => ({ id: l.id, remaining: Number(l.remaining), expiresAt: l.expiresAt, createdAt: l.createdAt })), p.amount);
      if (!alloc) {
        const w = await prisma.promoWallet.findUnique({ where: { userId: p.userId } });
        return { userId: p.userId, ok: false, message: `Promotional balance is only ₹${(w?.balance ?? new Prisma.Decimal(0)).toFixed(2)}.` };
      }
      await prisma.$transaction(async (tx) => {
        for (const a of alloc) {
          const lot = lots.find((l) => l.id === a.id)!;
          const u = await tx.promoWalletTransaction.updateMany({ where: { id: lot.id, remaining: lot.remaining }, data: { remaining: { decrement: a.take } } });
          if (!u.count) throw new Error("Wallet changed at the same time. Try again.");
        }
        await creditWallet(tx, { userId: p.userId, amount: -p.amount, key: p.key, type: "ADMIN_DEBIT", rewardType: "ADMIN_ADJUSTMENT", note: p.reason.slice(0, 255), actorId: p.actorId });
      });
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const w = await prisma.promoWallet.findUnique({ where: { userId: p.userId } });
      return { userId: p.userId, ok: true, balance: (w?.balance ?? new Prisma.Decimal(0)).toFixed(2) };
    }
    return { userId: p.userId, ok: false, message: err instanceof Error ? err.message : "Failed" };
  }
  const w = await prisma.promoWallet.findUnique({ where: { userId: p.userId } });
  const total = (w?.balance ?? new Prisma.Decimal(0)).plus(w?.cashBalance ?? 0);
  await notify(p.userId, p.direction === "CREDIT" ? `₹${p.amount.toFixed(2)} added to your wallet` : `₹${p.amount.toFixed(2)} deducted from your wallet`, `SafeRent ${p.direction === "CREDIT" ? "added" : "deducted"} promotional balance: ${p.reason}`, "/wallet");
  return { userId: p.userId, ok: true, balance: total.toFixed(2) };
}
