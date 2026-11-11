import { Router } from "express";
import * as account from "../controllers/account.controller";
import * as admin from "../controllers/admin.controller";
import * as auth from "../controllers/auth.controller";
import * as finance from "../controllers/finance.controller";
import * as insights from "../controllers/insights.controller";
import * as ops from "../controllers/operations.controller";
import * as profile from "../controllers/profile.controller";
import * as assignments from "../controllers/properties.controller";
import * as rentals from "../controllers/rentals.controller";
import * as rent from "../controllers/rent.controller";
import * as invitations from "../controllers/invitations.controller";
import * as reviews from "../controllers/reviews.controller";
import * as referrals from "../controllers/referrals.controller";
import * as leaseExit from "../controllers/leaseExit.controller";
import * as pan from "../controllers/pan.controller";
import * as kyc from "../controllers/kyc.controller";
import * as payments from "../controllers/payments.controller";
import * as documents from "../controllers/documents.controller";
import * as roles from "../controllers/roles.controller";
import * as userOverview from "../controllers/userOverview.controller";
import * as users from "../controllers/users.controller";
import { uploadAvatar, uploadDocument, uploadImages, uploadSelfie } from "../lib/uploads";
import { verifyAppCheck } from "../middleware/appCheck";
import { authenticate, loadUser, protect as p, requireAnyPermission } from "../middleware/auth";
import * as browse from "../properties/controllers/browse.controller";
import * as details from "../properties/controllers/details.controller";
import * as inspections from "../properties/controllers/inspection.controller";
import * as media from "../properties/controllers/media.controller";
import * as pc from "../properties/controllers/property.controller";
import * as rooms from "../properties/controllers/room.controller";
import * as units from "../properties/controllers/unit.controller";
import { writeLimit } from "../middleware/writeLimit";

/**
 * SafeRent API. Every business route is wrapped in `p(...)`:
 *   App Check → Firebase ID token → active SafeRent account → verified session → permission(s)
 * Resource-level scope (own / assigned / all) is then applied inside each handler.
 * Express 5 forwards errors from async handlers to the error middleware automatically.
 */
export const api = Router();

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/* ─── Auth (login flows) ─── */
const signedIn = [verifyAppCheck, authenticate];
const account_ = [...signedIn, loadUser];
api.post("/auth/password-reset", verifyAppCheck, auth.requestPasswordReset);
api.post("/auth/logout", signedIn, auth.logout);
api.get("/auth/me", signedIn, auth.me);
api.post("/auth/phone/complete", signedIn, auth.completePhoneLogin);
api.post("/auth/register", signedIn, auth.register);
api.post("/auth/email-otp/request", account_, auth.requestEmailOtp);
api.post("/auth/email-otp/verify", account_, auth.verifyEmailOtp);
api.post("/auth/session/rebind", account_, auth.rebindSession);

/* ─── Own account ─── */
api.get("/profile", p("profile.manage"), profile.getProfile);
api.put("/profile", p("profile.manage"), profile.updateProfile);
api.post("/profile/image", p("profile.manage"), uploadAvatar, profile.uploadProfileImage);
api.get("/profile/image/:userId", p(), profile.getProfileImage);
api.get("/profile/pan", p("profile.manage"), pan.getMyPan);
api.put("/profile/pan", p("profile.manage"), pan.updateMyPan);
api.get("/me/activity", p(), admin.recentActivity);
api.get("/me/roles", p(), users.myRoles);
api.post("/me/roles", p(), users.addMyRole);
api.delete("/me/roles/:role", p(), users.removeMyRole);
api.post("/account/password", p(), account.changePassword);
api.post("/account/email", p(), account.requestEmailChange);
api.post("/account/phone/sync", p(), account.syncPhoneNumber);
api.get("/dashboard", p("dashboard.view"), insights.dashboard);
api.get("/notifications", p("notifications.view"), ops.listNotifications);
api.post("/notifications/read", p("notifications.view"), ops.markNotificationsRead);

/* ─── Users, roles & permissions ─── */
// Finance / support roles can look users up too; what they see per user depends on their permissions.
api.get("/users", p(), requireAnyPermission("users.view", "payments.view", "rent.view", "wallet.adjust", "support.manage"), users.listUsers);
api.get("/users/lookup", p(), requireAnyPermission("users.view", "assignments.manage", "maintenance.manage", "support.manage"), users.lookupUsers);
api.post("/users", p("users.manage"), users.createUser);
api.get("/users/:id/overview", p(), requireAnyPermission("users.view", "payments.view", "rent.view", "wallet.adjust", "support.manage"), userOverview.userOverview);
api.get("/users/:id", p(), requireAnyPermission("users.view", "payments.view", "rent.view", "wallet.adjust", "support.manage"), users.getUser);
api.patch("/users/:id", p("users.manage"), users.updateUser);
api.post("/users/:id/status", p("users.manage"), users.setUserStatus);
api.post("/users/:id/revoke-sessions", p("users.manage"), users.revokeSessions);
api.post("/users/:id/role", p("roles.manage"), users.assignRole);
api.post("/users/:id/roles", p("users.manage"), users.addUserRole);
api.delete("/users/:id/roles/:role", p("users.manage"), users.removeUserRole);
api.put("/users/:id/permissions", p("roles.manage"), users.setUserPermissions);
api.get("/users/:id/activity", p("users.view"), users.userActivity);
api.get("/roles", p(), requireAnyPermission("users.view", "roles.manage"), roles.listRoles);
api.put("/roles/:role/permissions", p("roles.manage"), roles.setRolePermissions);
api.post("/roles/:role/reset", p("roles.manage"), roles.resetRole);

/* ─── Property catalog (shared by Android, iOS and the Admin Panel) ─── */
api.get("/property-types", p(), pc.listPropertyTypes);
api.get("/property-types/manage", p("property_types.manage"), pc.listManagedPropertyTypes);
api.patch("/property-types/:typeKey", p("property_types.manage"), pc.setPropertyTypeEnabled);
api.get("/amenities", p(), pc.listAmenities);
api.get("/settings/completeness-weights", p("settings.manage"), pc.getCompletenessWeights);
api.put("/settings/completeness-weights", p("settings.manage"), pc.putCompletenessWeights);

/* ─── Tenant search & listing pages ─── */
api.get("/browse", p("properties.browse"), browse.browseProperties);
api.get("/browse/:propertyId", p("properties.browse"), browse.browseProperty);
api.post("/browse/:propertyId/apply", p("applications.create"), rentals.applyForProperty);
api.post("/browse/:propertyId/enquire", p("enquiries.create"), ops.createEnquiry);

/* ─── Properties (scope: landlord = own, manager / agent = assigned, staff = all) ─── */
const write = writeLimit;
api.get("/properties/summary", p("properties.view"), pc.propertySummaryStats);
api.get("/properties/review-queue", p(), requireAnyPermission("listings.approve", "documents.verify"), pc.reviewQueue);
api.post("/properties", p("properties.create"), write, pc.createProperty);
api.get("/properties", p("properties.view"), pc.listProperties);
api.get("/properties/:propertyId", p("properties.view"), pc.getProperty);
api.patch("/properties/:propertyId", p("properties.manage"), write, pc.updateProperty);
api.delete("/properties/:propertyId", p("properties.manage"), write, pc.archiveProperty);
api.get("/properties/:propertyId/completeness", p("properties.view"), pc.getCompleteness);
api.post("/properties/:propertyId/submit", p("properties.manage"), write, pc.submitProperty);
api.post("/properties/:propertyId/review", p("listings.approve"), write, pc.reviewProperty);
api.post("/properties/:propertyId/publish", p(), requireAnyPermission("properties.manage", "listings.approve"), write, pc.publishProperty);
api.post("/properties/:propertyId/unpublish", p(), requireAnyPermission("properties.manage", "listings.approve"), write, pc.unpublishProperty);
api.post("/properties/:propertyId/status", p(), requireAnyPermission("properties.manage", "listings.approve"), write, pc.changeStatus);
api.post("/properties/:propertyId/transfer-ownership", p("properties.manage", "users.manage"), write, pc.transferOwnership);
api.get("/properties/:propertyId/status-history", p("properties.view"), pc.statusHistory);
api.get("/properties/:propertyId/audit", p("properties.view"), pc.auditHistory);

/* units (flats, villas, houses, duplexes, commercial spaces, plots) */
api.post("/properties/:propertyId/units", p("properties.manage"), write, units.createUnit);
api.post("/properties/:propertyId/units/bulk", p("properties.manage"), write, units.createUnitsBulk);
api.get("/properties/:propertyId/units", p("properties.view"), units.listUnits);
api.get("/properties/:propertyId/units/:unitId", p("properties.view"), units.getUnit);
api.patch("/properties/:propertyId/units/:unitId", p("properties.manage"), write, units.updateUnit);
api.delete("/properties/:propertyId/units/:unitId", p("properties.manage"), write, units.archiveUnit);
api.put("/properties/:propertyId/units/:unitId/floors", p("properties.manage"), write, units.setDuplexFloors);
api.get("/properties/:propertyId/units/:unitId/utilities", p("properties.view"), details.getUtilities);
api.put("/properties/:propertyId/units/:unitId/utilities", p("properties.manage"), write, details.putUtilities);
api.get("/properties/:propertyId/units/:unitId/pricing", p("properties.view"), details.getPricing);
api.put("/properties/:propertyId/units/:unitId/pricing", p("properties.manage"), write, details.putPricing);

/* PG / hostel rooms and beds */
api.post("/properties/:propertyId/rooms", p("properties.manage"), write, rooms.createRoom);
api.get("/properties/:propertyId/rooms", p("properties.view"), rooms.listRooms);
api.patch("/properties/:propertyId/rooms/:roomId", p("properties.manage"), write, rooms.updateRoom);
api.post("/properties/:propertyId/rooms/:roomId/beds", p("properties.manage"), write, rooms.createBed);
api.patch("/properties/:propertyId/rooms/:roomId/beds/:bedId", p("properties.manage"), write, rooms.updateBed);
api.post("/properties/:propertyId/rooms/:roomId/beds/:bedId/assign", p("properties.manage"), write, rooms.assignBed);
api.post("/properties/:propertyId/rooms/:roomId/beds/:bedId/release", p("properties.manage"), write, rooms.releaseBed);

/* utilities, policies, amenities, pricing */
api.get("/properties/:propertyId/utilities", p("properties.view"), details.getUtilities);
api.put("/properties/:propertyId/utilities", p("properties.manage"), write, details.putUtilities);
api.get("/properties/:propertyId/policies", p("properties.view"), details.getPolicies);
api.put("/properties/:propertyId/policies", p("properties.manage"), write, details.putPolicies);
api.put("/properties/:propertyId/amenities", p("properties.manage"), write, details.putAmenities);
api.get("/properties/:propertyId/pricing", p("properties.view"), details.getPricing);
api.put("/properties/:propertyId/pricing", p("properties.manage"), write, details.putPricing);

/* images & private documents */
api.post("/properties/:propertyId/images", p("properties.manage"), write, uploadImages("property-images"), media.uploadImages);
api.patch("/properties/:propertyId/images/:imageId", p("properties.manage"), write, media.updateImage);
api.delete("/properties/:propertyId/images/:imageId", p("properties.manage"), write, media.deleteImage);
api.post("/properties/:propertyId/documents", p("properties.manage"), write, uploadDocument("property-documents"), documents.uploadDocument);
api.get("/properties/:propertyId/documents", p("properties.view"), documents.listDocuments);
api.patch("/documents/:docId", p("properties.manage"), write, documents.updateDocument);
api.post("/documents/:docId/replace", p("properties.manage"), write, uploadDocument("property-documents"), documents.replaceDocument);
api.get("/documents/:docId/versions", p("properties.manage"), documents.documentVersions);
api.post("/documents/:docId/archive", p("properties.manage"), write, documents.archiveDocument);
api.post("/documents/:docId/restore", p("properties.manage"), write, documents.restoreDocument);
api.get("/properties/:propertyId/document-requests", p("properties.manage"), documents.propertyDocumentRequests);
api.post("/document-requests/:id/respond", p("properties.manage"), documents.respondDocumentRequest);
/* Tenant: documents shared with me + requests (relationship checked from the active lease). */
api.get("/my/documents", p(), documents.myDocuments);
api.get("/my/document-requests", p(), documents.myDocumentRequests);
api.post("/leases/:id/document-requests", p("leases.view"), documents.requestDocument);
api.post("/document-requests/:id/cancel", p(), documents.cancelDocumentRequest);
api.post("/documents/:docId/verify", p("documents.verify"), write, media.verifyDocument);
api.get("/files/property-images/:imageId", p(), media.getImageFile);
api.get("/files/documents/:docId", p(), documents.getDocumentFile);
api.get("/files/maintenance-photos/:photoId", p("maintenance.view"), ops.getJobPhoto);

/* inspections & assignments */
api.post("/properties/:propertyId/inspections", p(), requireAnyPermission("inspections.manage", "properties.manage"), write, inspections.createInspection);
api.get("/properties/:propertyId/inspections", p("properties.view"), inspections.listInspections);
api.patch("/properties/:propertyId/inspections/:inspectionId", p(), requireAnyPermission("inspections.manage", "properties.manage"), write, inspections.updateInspection);
api.post("/properties/:propertyId/inspections/:inspectionId/acknowledge", p(), write, inspections.acknowledgeInspection);
api.post("/properties/:propertyId/assignments", p("assignments.manage"), write, assignments.addAssignment);
api.delete("/properties/:propertyId/assignments/:assignmentId", p("assignments.manage"), write, assignments.removeAssignment);

/* ─── Moderation ─── */
api.post("/moderation/images/:imageId", p("listings.approve"), media.moderateImage);
api.post("/fraud-reports", p("fraud.report"), ops.createFraudReport);
api.get("/fraud-reports", p("fraud.manage"), ops.listFraudReports);
api.patch("/fraud-reports/:id", p("fraud.manage"), ops.updateFraudReport);

/* ─── Rentals ─── */
api.get("/applications", p("applications.view"), rentals.listApplications);
api.post("/applications/:id/decision", p("applications.manage"), rentals.decideApplication);
api.post("/applications/:id/withdraw", p("applications.create"), rentals.withdrawApplication);
/* Tenant invitation links: landlord creates → tenant opens /invite/:token, signs in, accepts. */
api.post("/properties/:propertyId/invitations", p("leases.manage"), invitations.createInvitation);
api.get("/invitations", p("leases.manage"), invitations.listInvitations);
api.post("/invitations/:id/revoke", p("leases.manage"), invitations.revokeInvitation);
api.post("/invitations/:id/link", p("leases.manage"), invitations.renewInvitationLink);
api.get("/invitations/token/:token", p(), invitations.viewInvitation);
api.post("/invitations/token/:token/accept", p(), invitations.acceptInvitation);
api.post("/invitations/token/:token/reject", p(), invitations.rejectInvitation);
/* Referrals & promotional wallet. The link check is public (the /ref page runs before sign-up). */
api.get("/referrals/codes/:code", verifyAppCheck, referrals.checkCode);
api.get("/referrals/me", p(), referrals.myReferrals);
api.post("/referrals/codes/:kind/rotate", p(), referrals.rotateMyCode);
/* Payment gateway webhooks: no login — verified by the gateway's signature over the raw body. */
api.post("/webhooks/razorpay", payments.razorpayWebhook);
/* Add money to wallet (only gateways an admin switched ON and that are configured). */
api.get("/wallet/gateways", p(), payments.availableGateways);
api.post("/wallet/topups", p(), payments.createTopup);
api.post("/wallet/topups/:id/verify", p(), payments.verifyTopup);
api.post("/wallet/topups/:id/cancel", p(), payments.cancelTopup);
api.get("/admin/payment-gateways", p("settings.manage"), payments.adminGateways);
api.put("/admin/payment-gateways/:provider", p("settings.manage"), payments.adminSaveGateway);
api.get("/admin/wallet-topups", p(), requireAnyPermission("settings.manage", "wallet.adjust"), payments.adminTopups);
api.get("/wallet", p(), referrals.myWallet);
api.get("/wallet/transactions", p(), referrals.myWalletTransactions);
api.post("/wallet/redeem", p(), referrals.redeem);
api.post("/users/:id/kyc", p("users.manage"), referrals.decideKyc);
api.get("/kyc/me", p("profile.manage"), kyc.myKyc);
api.post("/kyc/digilocker/start", p("profile.manage"), kyc.startDigiLocker);
api.post("/kyc/digilocker/complete", p("profile.manage"), kyc.completeDigiLocker);
api.post("/kyc/selfie", p("profile.manage"), uploadSelfie, kyc.uploadSelfie);
api.post("/kyc/submit", p("profile.manage"), kyc.submitKyc);
api.get("/kyc/files/:userId/:kind", p(), kyc.kycFile);
api.get("/admin/kyc", p("users.manage"), kyc.kycQueue);
api.get("/admin/kyc/:userId", p("users.manage"), kyc.kycDetail);
api.get("/admin/referrals/summary", p("referrals.manage"), referrals.adminSummary);
api.get("/admin/referrals", p("referrals.manage"), referrals.adminList);
api.get("/admin/referrals/:id", p("referrals.manage"), referrals.adminGet);
api.post("/admin/referrals/:id/action", p("referrals.manage"), referrals.adminAction);
api.get("/admin/referral-events", p("referrals.manage"), referrals.adminEvents);
api.get("/admin/referral-campaigns", p("referrals.manage"), referrals.adminCampaigns);
api.put("/admin/referral-campaigns/:type", p("settings.manage"), referrals.adminSaveCampaign);
api.get("/admin/wallets", p("wallet.adjust"), referrals.adminWalletUsers);
api.get("/admin/wallets/adjustments", p("wallet.adjust"), referrals.adminWalletAdjustments);
api.get("/admin/wallets/:userId", p("wallet.adjust"), referrals.adminWalletDetail);
api.post("/admin/wallets/adjust", p("wallet.adjust"), referrals.adminWalletAdjust);

/* Two-way rental reviews (party of the lease is checked from the lease itself). */
api.get("/reviews/pending", p(), reviews.pendingReviews);
api.get("/reviews/mine", p(), reviews.myReviews);
api.get("/reviews/users/:userId", p(), reviews.userReviews);
api.put("/reviews/:id/response", p(), reviews.respondToReview);
api.post("/reviews/:id/report", p(), reviews.reportReview);
api.get("/leases/:id/review", p(), reviews.leaseReviewStatus);
api.post("/leases/:id/review", p(), reviews.submitReview);
api.get("/properties/:propertyId/reviews", p(), reviews.propertyReviews);
api.get("/moderation/reviews", p("reviews.moderate"), reviews.moderationListReviews);
api.get("/moderation/reviews/:id", p("reviews.moderate"), reviews.moderationGetReview);
api.post("/moderation/reviews/:id", p("reviews.moderate"), reviews.moderateReview);
api.get("/moderation/review-reports", p("reviews.moderate"), reviews.moderationListReports);
api.post("/moderation/review-reports/:id", p("reviews.moderate"), reviews.resolveReviewReport);
api.get("/leases", p("leases.view"), rentals.listLeases);
/* Mutual lease close: one side asks, the other accepts / declines. */
api.get("/leases/:id/pan", p("leases.view"), pan.leasePan);
api.post("/leases/:id/pan/request", p("leases.view"), pan.requestPan);
api.post("/leases/:id/pan/decide", p("leases.view"), pan.decidePan);
api.post("/leases/:id/pan/revoke", p("leases.view"), pan.revokePan);
api.get("/leases/:id/exit", p("leases.view"), leaseExit.getExit);
api.post("/leases/:id/exit", p("leases.view"), leaseExit.requestExit);
api.post("/leases/:id/exit/accept", p("leases.view"), leaseExit.acceptExit);
api.post("/leases/:id/exit/decline", p("leases.view"), leaseExit.declineExit);
api.post("/leases/:id/exit/cancel", p("leases.view"), leaseExit.cancelExit);
api.get("/leases/:id", p("leases.view"), rentals.getLease);
api.get("/leases/:id/agreement", p("leases.view"), rentals.leaseAgreement);
api.post("/leases/:id/terminate", p("leases.manage"), rentals.terminateLease);
api.patch("/leases/:id/terms", p("leases.manage"), rentals.updateLeaseTerms);
api.get("/enquiries", p(), requireAnyPermission("enquiries.manage", "enquiries.create"), ops.listEnquiries);
api.patch("/enquiries/:id", p("enquiries.manage"), ops.updateEnquiry);
api.get("/visits", p(), requireAnyPermission("visits.manage", "enquiries.create"), ops.listVisits);
api.post("/visits", p("visits.manage"), ops.scheduleVisit);
api.patch("/visits/:id", p("visits.manage"), ops.updateVisit);

/* ─── Rent & finance (financial permissions only) ─── */
api.get("/rent", p("rent.view"), rent.listRent);
api.post("/rent/generate", p("rent.collect"), rent.generateDues);
api.post("/rent/:id/pay", p("rent.pay"), rent.payRent);
api.post("/rent/:id/record", p("rent.collect"), rent.recordRent);
api.post("/rent/:id/waive", p("rent.collect"), rent.waiveRent);
api.get("/rent/:id/receipt", p("rent.view"), rent.rentReceipt);
api.get("/finance/transactions", p("payments.view"), finance.listTransactions);
api.post("/finance/transactions/:id/reconcile", p("payments.manage"), finance.reconcileTransaction);
api.post("/finance/transactions/:id/commission", p("commissions.manage"), finance.settleCommission);
api.get("/finance/invoices", p("invoices.manage"), finance.listInvoices);
api.post("/finance/invoices", p("invoices.manage"), finance.createInvoice);
api.post("/finance/invoices/:id/action", p("invoices.manage"), finance.invoiceAction);
api.get("/finance/refunds", p("refunds.manage"), finance.listRefunds);
api.post("/finance/refunds", p("refunds.manage"), finance.requestRefund);
api.post("/finance/refunds/:id/decision", p("refunds.manage"), finance.decideRefund);
api.get("/finance/commission", p("commissions.manage"), finance.getCommission);
api.put("/finance/commission", p("commissions.manage"), finance.setCommission);
api.get("/finance/reports", p("finance.reports"), finance.financeReport);

/* ─── Maintenance ─── */
api.get("/maintenance", p("maintenance.view"), ops.listMaintenance);
api.post("/maintenance", p("maintenance.create"), ops.createMaintenance);
api.post("/maintenance/:id/assign", p("maintenance.manage"), ops.assignProvider);
api.post("/maintenance/:id/respond", p("maintenance.work"), ops.respondToJob);
api.post("/maintenance/:id/work", p("maintenance.work"), ops.updateJob);
api.post("/maintenance/:id/photos", p("maintenance.work"), uploadImages("maintenance-photos"), ops.uploadJobPhotos);
api.post("/maintenance/:id/close", p("maintenance.view"), ops.closeMaintenance);

/* ─── Support ─── */
api.get("/support/tickets", p(), requireAnyPermission("support.create", "support.manage"), ops.listTickets);
api.post("/support/tickets", p("support.create"), ops.createTicket);
api.get("/support/tickets/:id", p(), requireAnyPermission("support.create", "support.manage"), ops.getTicket);
api.post("/support/tickets/:id/messages", p(), requireAnyPermission("support.create", "support.manage"), ops.addTicketMessage);
api.patch("/support/tickets/:id", p("support.manage"), ops.updateTicket);

/* ─── Reports, settings, subscriptions, audit ─── */
api.get("/reports/overview", p("reports.view"), insights.overviewReport);
api.get("/reports/properties", p("reports.view"), insights.propertyReport);
api.get("/settings", p("settings.manage"), insights.getSettings);
api.put("/settings", p("settings.manage"), insights.updateSettings);
api.get("/subscriptions/plans", p("subscriptions.manage"), insights.listPlans);
api.post("/subscriptions/plans", p("subscriptions.manage"), insights.createPlan);
api.patch("/subscriptions/plans/:id", p("subscriptions.manage"), insights.updatePlan);
api.get("/audit/security", p("audit_logs.view"), insights.securityLogs);
api.get("/audit/activity", p("audit_logs.view"), insights.activityLogs);
