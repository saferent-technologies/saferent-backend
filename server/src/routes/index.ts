import { Router } from "express";
import * as account from "../controllers/account.controller";
import * as admin from "../controllers/admin.controller";
import * as auth from "../controllers/auth.controller";
import * as finance from "../controllers/finance.controller";
import * as insights from "../controllers/insights.controller";
import * as ops from "../controllers/operations.controller";
import * as profile from "../controllers/profile.controller";
import * as props from "../controllers/properties.controller";
import * as rentals from "../controllers/rentals.controller";
import * as rent from "../controllers/rent.controller";
import * as roles from "../controllers/roles.controller";
import * as users from "../controllers/users.controller";
import { uploadAvatar, uploadDocument, uploadImages } from "../lib/uploads";
import { verifyAppCheck } from "../middleware/appCheck";
import { authenticate, loadUser, protect as p, requireAnyPermission } from "../middleware/auth";

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
api.get("/me/activity", p(), admin.recentActivity);
api.post("/account/password", p(), account.changePassword);
api.post("/account/email", p(), account.requestEmailChange);
api.post("/account/phone/sync", p(), account.syncPhoneNumber);
api.get("/dashboard", p("dashboard.view"), insights.dashboard);
api.get("/notifications", p("notifications.view"), ops.listNotifications);
api.post("/notifications/read", p("notifications.view"), ops.markNotificationsRead);

/* ─── Users, roles & permissions ─── */
api.get("/users", p("users.view"), users.listUsers);
api.get("/users/lookup", p(), requireAnyPermission("users.view", "assignments.manage", "maintenance.manage", "support.manage"), users.lookupUsers);
api.post("/users", p("users.manage"), users.createUser);
api.get("/users/:id", p("users.view"), users.getUser);
api.patch("/users/:id", p("users.manage"), users.updateUser);
api.post("/users/:id/status", p("users.manage"), users.setUserStatus);
api.post("/users/:id/revoke-sessions", p("users.manage"), users.revokeSessions);
api.post("/users/:id/role", p("roles.manage"), users.assignRole);
api.put("/users/:id/permissions", p("roles.manage"), users.setUserPermissions);
api.get("/users/:id/activity", p("users.view"), users.userActivity);
api.get("/roles", p(), requireAnyPermission("users.view", "roles.manage"), roles.listRoles);
api.put("/roles/:role/permissions", p("roles.manage"), roles.setRolePermissions);
api.post("/roles/:role/reset", p("roles.manage"), roles.resetRole);

/* ─── Properties ─── */
api.get("/browse", p("properties.browse"), props.browseProperties);
api.get("/browse/:id", p("properties.browse"), props.browseProperty);
api.post("/browse/:id/apply", p("applications.create"), rentals.applyForProperty);
api.post("/browse/:id/enquire", p("enquiries.create"), ops.createEnquiry);
api.get("/properties", p("properties.view"), props.listProperties);
api.post("/properties", p("properties.create"), props.createProperty);
api.get("/properties/:id", p("properties.view"), props.getProperty);
api.patch("/properties/:id", p("properties.manage"), props.updateProperty);
api.post("/properties/:id/submit", p("properties.manage"), props.submitProperty);
api.post("/properties/:id/availability", p("properties.manage"), props.setAvailability);
api.post("/properties/:id/deactivate", p("properties.manage"), props.deactivateProperty);
api.post("/properties/:id/images", p("properties.manage"), uploadImages("property-images"), props.uploadImages);
api.delete("/properties/:id/images/:imageId", p("properties.manage"), props.deleteImage);
api.post("/properties/:id/documents", p("properties.manage"), uploadDocument("property-documents"), props.uploadDocument);
api.post("/properties/:id/assignments", p("assignments.manage"), props.addAssignment);
api.delete("/properties/:id/assignments/:assignmentId", p("assignments.manage"), props.removeAssignment);
api.post("/properties/:id/inspections", p("inspections.manage"), props.scheduleInspection);
api.patch("/properties/:id/inspections/:inspectionId", p("inspections.manage"), props.updateInspection);
api.post("/documents/:docId/verify", p("documents.verify"), props.verifyDocument);
api.get("/files/property-images/:imageId", p(), props.getImageFile);
api.get("/files/documents/:docId", p(), props.getDocumentFile);
api.get("/files/maintenance-photos/:photoId", p("maintenance.view"), ops.getJobPhoto);

/* ─── Moderation ─── */
api.get("/moderation/queue", p(), requireAnyPermission("listings.approve", "documents.verify"), props.moderationQueue);
api.post("/moderation/listings/:id", p("listings.approve"), props.moderateListing);
api.post("/moderation/images/:imageId", p("listings.approve"), props.moderateImage);
api.post("/fraud-reports", p("fraud.report"), ops.createFraudReport);
api.get("/fraud-reports", p("fraud.manage"), ops.listFraudReports);
api.patch("/fraud-reports/:id", p("fraud.manage"), ops.updateFraudReport);

/* ─── Rentals ─── */
api.get("/applications", p("applications.view"), rentals.listApplications);
api.post("/applications/:id/decision", p("applications.manage"), rentals.decideApplication);
api.post("/applications/:id/withdraw", p("applications.create"), rentals.withdrawApplication);
api.get("/leases", p("leases.view"), rentals.listLeases);
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
