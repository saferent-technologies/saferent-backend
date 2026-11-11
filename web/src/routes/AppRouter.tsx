import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { PropertyTypesPage } from "@/pages/admin/PropertyTypesPage";
import { RolesPage } from "@/pages/admin/RolesPage";
import { UserDetailPage } from "@/pages/admin/UserDetailPage";
import { UsersPage } from "@/pages/admin/UsersPage";
import { AuthActionPage } from "@/pages/auth/AuthActionPage";
import { ForgotPasswordPage } from "@/pages/auth/ForgotPasswordPage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { VerifyOtpPage } from "@/pages/auth/VerifyOtpPage";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { FinancePage } from "@/pages/finance/FinancePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { MaintenancePage } from "@/pages/operations/MaintenancePage";
import { AuditPage, EnquiriesPage, NotificationsPage, PlatformPage, ReportsPage } from "@/pages/operations/MiscPages";
import { ModerationPage } from "@/pages/operations/ModerationPage";
import { SupportPage, TicketPage } from "@/pages/operations/SupportPages";
import { ProfilePage } from "@/pages/profile/ProfilePage";
import { PropertiesPage } from "@/pages/properties/PropertiesPage";
import { PropertyDetailPage } from "@/pages/properties/PropertyDetailPage";
import { PropertyFormPage } from "@/pages/properties/PropertyFormPage";
import { BrowsePage, ListingPage } from "@/pages/rentals/BrowsePage";
import { InvitePage } from "@/pages/rentals/InvitePage";
import { MyDocumentsPage } from "@/pages/rentals/MyDocumentsPage";
import { MyReviewsPage, ReviewModerationPage } from "@/pages/reviews/ReviewsPages";
import { AdminReferralsPage, AdminWalletsPage, MyReferralsPage, PaymentGatewaysPage, RefLandingPage, WalletPage } from "@/pages/referrals/ReferralPages";
import { VerifyPage } from "@/pages/kyc/VerifyPage";
import { DigiLockerReturnPage } from "@/pages/kyc/DigiLockerReturnPage";
import { OwnerVerificationPage } from "@/pages/admin/OwnerVerificationPage";
import { ApplicationsPage, LeasesPage, RentPage } from "@/pages/rentals/RentalsPages";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { PATHS } from "@/utils/constants";
import { GuestRoute, ProtectedRoute, RegistrationRoute, RequirePermission, RequireRole, SecondFactorRoute } from "./guards";

/** Page visible only with ANY of the permissions (UX — the API enforces again). */
const gate = (anyOf: string[], element: ReactNode) => <RequirePermission anyOf={anyOf}>{element}</RequirePermission>;

const router = createBrowserRouter([
  { path: "/", element: <Navigate to={PATHS.dashboard} replace /> },
  {
    element: <GuestRoute />,
    children: [
      { path: PATHS.login, element: <LoginPage /> },
      { path: PATHS.forgotPassword, element: <ForgotPasswordPage /> },
    ],
  },
  { element: <SecondFactorRoute />, children: [{ path: PATHS.verifyOtp, element: <VerifyOtpPage /> }] },
  { element: <RegistrationRoute />, children: [{ path: PATHS.register, element: <RegisterPage /> }] },
  { path: PATHS.authAction, element: <AuthActionPage /> },
  // Shared referral link: works signed in or out (stores the code for registration).
  { path: "/ref/:code", element: <RefLandingPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { path: PATHS.dashboard, element: gate(["dashboard.view"], <DashboardPage />) },
          { path: PATHS.profile, element: <ProfilePage /> },
          // Tenant invitation link (any signed-in account; the API checks it was sent to this phone).
          { path: "/invite/:token", element: <InvitePage /> },
          { path: "/my-documents", element: <RequireRole anyOf={["TENANT"]}><MyDocumentsPage /></RequireRole> },
          { path: "/reviews", element: <RequireRole anyOf={["LANDLORD", "TENANT"]}><MyReviewsPage /></RequireRole> },
          { path: "/referrals", element: <RequireRole anyOf={["LANDLORD", "TENANT"]}><MyReferralsPage /></RequireRole> },
          { path: "/admin/referrals", element: gate(["referrals.manage"], <AdminReferralsPage />) },
          { path: "/verify", element: <RequireRole anyOf={["LANDLORD"]}><VerifyPage /></RequireRole> },
          { path: "/kyc/digilocker/return", element: <RequireRole anyOf={["LANDLORD"]}><DigiLockerReturnPage /></RequireRole> },
          { path: "/admin/kyc", element: gate(["users.manage"], <OwnerVerificationPage />) },
          { path: "/wallet", element: <RequireRole anyOf={["LANDLORD", "TENANT"]}><WalletPage /></RequireRole> },
          { path: "/admin/wallets", element: gate(["wallet.adjust"], <AdminWalletsPage />) },
          { path: "/admin/payment-gateways", element: gate(["settings.manage", "wallet.adjust"], <PaymentGatewaysPage />) },
          { path: "/review-moderation", element: gate(["reviews.moderate"], <ReviewModerationPage />) },
          { path: PATHS.settings, element: <SettingsPage /> },
          { path: "/notifications", element: gate(["notifications.view"], <NotificationsPage />) },

          { path: "/browse", element: gate(["properties.browse"], <BrowsePage />) },
          { path: "/browse/:id", element: gate(["properties.browse"], <ListingPage />) },
          { path: "/properties", element: gate(["properties.view"], <PropertiesPage />) },
          { path: "/properties/new", element: gate(["properties.create"], <PropertyFormPage />) },
          { path: "/properties/:id", element: gate(["properties.view"], <PropertyDetailPage />) },
          { path: "/properties/:id/edit", element: gate(["properties.manage"], <PropertyFormPage />) },
          { path: "/applications", element: gate(["applications.view"], <ApplicationsPage />) },
          { path: "/leases", element: gate(["leases.view"], <LeasesPage />) },
          { path: "/enquiries", element: gate(["enquiries.manage", "visits.manage"], <EnquiriesPage />) },
          { path: "/maintenance", element: gate(["maintenance.view"], <MaintenancePage />) },

          { path: "/rent", element: gate(["rent.view"], <RentPage />) },
          { path: "/finance", element: gate(["payments.view", "invoices.manage", "refunds.manage", "commissions.manage", "finance.reports"], <FinancePage />) },

          { path: "/moderation", element: gate(["listings.approve", "documents.verify", "fraud.manage"], <ModerationPage />) },
          { path: "/support", element: gate(["support.create", "support.manage"], <SupportPage />) },
          { path: "/support/:id", element: gate(["support.create", "support.manage"], <TicketPage />) },
          { path: "/reports", element: gate(["reports.view"], <ReportsPage />) },

          { path: "/users", element: gate(["users.view", "payments.view", "rent.view", "wallet.adjust", "support.manage"], <UsersPage />) },
          { path: "/users/:id", element: gate(["users.view", "payments.view", "rent.view", "wallet.adjust", "support.manage"], <UserDetailPage />) },
          { path: "/roles", element: gate(["roles.manage"], <RolesPage />) },
          { path: "/property-types", element: gate(["property_types.manage"], <PropertyTypesPage />) },
          { path: "/audit", element: gate(["audit_logs.view"], <AuditPage />) },
          { path: "/platform", element: gate(["settings.manage", "subscriptions.manage"], <PlatformPage />) },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
