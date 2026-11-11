# SafeRent — Roles, Permissions & Data Access (RBAC)

SafeRent uses **centralised role-based access control with per-record scopes**.

- **Where it's defined:** the catalog lives in code, in `server/src/rbac/catalog.ts`.
- **Where it's stored:** the server copies it into MySQL at startup, into the tables `roles`, `permissions` and `role_permissions`.
- **What a Super Admin can change:** role permissions (Roles & permissions screen) and individual user overrides (User → Permissions).

## How a request is authorized

```
Browser ─▶ App Check ─▶ Firebase ID token ─▶ active SafeRent account ─▶ verified session ─▶ permission ─▶ scope filter
           (optional)   (authenticate)        (loadUser: MySQL role)    (requireSession)    (requirePermission)  (rbac/access.ts)
```

1. **Roles (MySQL is the source of truth).** Each account has a primary role (`users.role`) and may hold additional customer roles (`user_roles`: Landlord, Tenant, Property Agent, Service Provider), e.g. a landlord who also rents a home. Staff accounts never stack customer roles. A Firebase custom claim `role` (primary role) is kept in sync for information only. The API always reads roles from MySQL.
2. **Effective permissions.** The union of the permissions of every role held, plus individual overrides: grants add a permission, revokes remove one. Reserved permissions stay with `SUPER_ADMIN` only.
3. **Scope.** Every permission comes with a scope:
   - **ALL**: every record.
   - **ASSIGNED** (ASG): records assigned to the user through `property_assignments`, or maintenance jobs assigned to them.
   - **OWN**: records the user owns or is a party to.
4. **Resource-level filters.** `server/src/rbac/access.ts` turns permission + scope into a database `where` filter, so a query can only ever return rows the user may see.
   - A landlord asking for another landlord's property gets **404**, not the data.
5. **Frontend.** Hiding menu items and pages is UX only. Every endpoint enforces the same rules again.

## Role → permission matrix (defaults)

**ALL** = every record · **ASG** = assigned records · **own** = own records · — = no access · 🔒 = reserved (Super Admin only, can never be granted)

| Permission | Super Admin | Admin | Finance | Prop. Mgr | Support | Moderator | Viewer | Landlord | Tenant | Agent | Provider |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| _General_ | | | | | | | | | | | |
| `dashboard.view` | **ALL** | own | own | own | own | own | own | own | own | own | own |
| `profile.manage` | **ALL** | own | own | own | own | own | own | own | own | own | own |
| `notifications.view` | **ALL** | own | own | own | own | own | own | own | own | own | own |
| _Administration_ | | | | | | | | | | | |
| `users.view` | **ALL** | **ALL** | — | — | — | — | — | — | — | — | — |
| `users.manage` | **ALL** | **ALL** | — | — | — | — | — | — | — | — | — |
| `roles.manage` 🔒 | **ALL** | — | — | — | — | — | — | — | — | — | — |
| `settings.manage` 🔒 | **ALL** | — | — | — | — | — | — | — | — | — | — |
| `subscriptions.manage` | **ALL** | — | — | — | — | — | — | — | — | — | — |
| `audit_logs.view` | **ALL** | **ALL** | — | — | — | — | — | — | — | — | — |
| `reports.view` | **ALL** | **ALL** | **ALL** | ASG | — | — | **ALL** | own | — | — | — |
| _Properties_ | | | | | | | | | | | |
| `properties.browse` | **ALL** | **ALL** | — | — | — | — | — | **ALL** | **ALL** | **ALL** | — |
| `properties.view` | **ALL** | **ALL** | **ALL** | ASG | **ALL** | **ALL** | **ALL** | own | — | ASG | — |
| `properties.create` | **ALL** | **ALL** | — | — | — | — | — | own | — | ASG | — |
| `properties.manage` | **ALL** | **ALL** | — | ASG | — | — | — | own | — | ASG | — |
| `assignments.manage` | **ALL** | **ALL** | — | — | — | — | — | — | — | — | — |
| `inspections.manage` | **ALL** | **ALL** | — | ASG | — | — | — | — | — | — | — |
| _Moderation_ | | | | | | | | | | | |
| `listings.approve` | **ALL** | **ALL** | — | — | — | **ALL** | — | — | — | — | — |
| `documents.verify` | **ALL** | **ALL** | — | ASG | — | **ALL** | — | — | — | — | — |
| `fraud.report` | **ALL** | own | own | own | own | own | — | own | own | own | own |
| `fraud.manage` | **ALL** | **ALL** | — | — | — | **ALL** | — | — | — | — | — |
| _Rentals_ | | | | | | | | | | | |
| `applications.create` | **ALL** | — | — | — | — | — | — | — | own | — | — |
| `applications.view` | **ALL** | **ALL** | — | ASG | — | — | — | own | own | — | — |
| `applications.manage` | **ALL** | **ALL** | — | ASG | — | — | — | own | — | — | — |
| `leases.view` | **ALL** | **ALL** | **ALL** | ASG | — | — | — | own | own | — | — |
| `leases.manage` | **ALL** | **ALL** | — | ASG | — | — | — | own | — | — | — |
| `enquiries.create` | **ALL** | — | — | — | — | — | — | — | own | — | — |
| `enquiries.manage` | **ALL** | **ALL** | — | — | — | — | — | own | — | ASG | — |
| `visits.manage` | **ALL** | **ALL** | — | — | — | — | — | — | — | ASG | — |
| _Finance_ | | | | | | | | | | | |
| `rent.view` | **ALL** | — | **ALL** | — | — | — | — | own | own | — | — |
| `rent.pay` | **ALL** | — | — | — | — | — | — | — | own | — | — |
| `rent.collect` | **ALL** | — | **ALL** | — | — | — | — | — | — | — | — |
| `payments.view` | **ALL** | — | **ALL** | — | — | — | — | — | — | — | — |
| `payments.manage` | **ALL** | — | **ALL** | — | — | — | — | — | — | — | — |
| `invoices.manage` | **ALL** | — | **ALL** | — | — | — | — | — | — | — | — |
| `refunds.manage` | **ALL** | — | **ALL** | — | — | — | — | — | — | — | — |
| `commissions.manage` | **ALL** | — | **ALL** | — | — | — | — | — | — | — | — |
| `finance.reports` | **ALL** | — | **ALL** | — | — | — | — | — | — | — | — |
| _Maintenance_ | | | | | | | | | | | |
| `maintenance.create` | **ALL** | — | — | — | — | — | — | own | own | — | — |
| `maintenance.view` | **ALL** | **ALL** | — | ASG | — | — | — | own | own | — | ASG |
| `maintenance.manage` | **ALL** | **ALL** | — | ASG | — | — | — | own | — | — | — |
| `maintenance.work` | **ALL** | — | — | — | — | — | — | — | — | — | ASG |
| _Support_ | | | | | | | | | | | |
| `support.create` | **ALL** | own | own | own | own | own | — | own | own | own | own |
| `support.manage` | **ALL** | **ALL** | — | — | **ALL** | — | — | — | — | — | — |

_This table is generated from `server/src/rbac/catalog.ts`. Super Admins can adjust role defaults in the app; every change is logged and can be reset to these defaults._

## Roles at a glance

| Role | Signs in with | Created by | Highlights |
|---|---|---|---|
| **Super Admin** | Company email + email OTP | Bootstrap (founder) / founder | Everything. Only role with `roles.manage` and `settings.manage`. |
| **Admin** | Company email + OTP | Super Admin | Users (lower roles only), properties, moderation, support, reports. **No finance.** Cannot touch the founder. |
| **Finance Admin** | Company email + OTP | Super Admin / Admin | Rent collection, transactions, reconciliation, invoices, refunds, commission, revenue reports. Cannot manage users, roles or security settings. |
| **Property Manager** | Company email + OTP | Super Admin / Admin | **Assigned properties only**: inspections, verification, applications (tenant assignment), leases, maintenance. |
| **Support** | Company email + OTP | Super Admin / Admin | All tickets and complaints, internal notes, assignment. Read-only property context. **No financial access.** |
| **Moderator** | Company email + OTP | Super Admin / Admin | Listing approval or rejection, image moderation, document verification, fraud reports. **No financial access.** |
| **Viewer** | Company email + OTP | Super Admin / Admin | Read-only dashboard, reports and property records. No create, edit or delete. |
| **Landlord** | Phone OTP | **Self sign-up** | Own properties, photos, documents, applications, leases, rent income, maintenance, property reports. |
| **Tenant** | Phone OTP | **Self sign-up** | Browse and apply, own lease, rent dues and payments, receipts, maintenance, complaints, notifications. |
| **Property Agent** | Phone OTP | Super Admin / Admin | Assigned listings, add listings for registered landlords, enquiries, follow-ups, visits. No financial data. |
| **Service Provider** | Phone OTP | Super Admin / Admin | Assigned maintenance jobs only: accept or decline, status, photos, service charge. |

## Escalation & founder protection (enforced in `server/src/rbac/policy.ts`, unit tested)

- **Founder account** (`users.is_founder = 1`, created by the bootstrap: Shaik Shabeer, admin@saferenttechnologies.com):
  - nobody can deactivate it, demote it or change its permissions;
  - the founder cannot demote themselves.
- **Self-escalation:** nobody can change their own role or permissions.
- **Rank rule:** `users.manage` only works on accounts with a **lower** rank. Ranks are:
  - Super Admin 100
  - Admin 80
  - Finance 60
  - Property Manager 50
  - Support and Moderator 40
  - Viewer 20
  - Agent and Provider 15
  - Landlord and Tenant 10
- **Super Admin role:** only the **founder** can grant it or remove it.
- **Reserved permissions** (`roles.manage`, `settings.manage`) can never be granted to another role or user. They are also stripped when permissions are resolved.
- **Grants:** an actor can only grant a permission and scope they hold themselves.
- **Role changes:** changing a role clears that user's individual overrides and signs them out everywhere.
- **Self sign-up:** only Landlord or Tenant can be chosen. Staff, agent and provider accounts are created by an administrator.

## Personal data between parties

| Situation | What is shared |
|---|---|
| Tenant browsing listings | Property details and approved photos. **No owner name or contact.** |
| Landlord reviewing an application | Applicant's name, occupation, family size, message. **No phone or email.** |
| Active lease | Landlord ↔ tenant names, phone and email (to each other only). |
| Ended or terminated lease | Names only. |
| Service provider on a job | Address and requester's name. **Phone only after accepting the job.** |
| Support ticket | Support staff see the requester's contact details. Internal notes are hidden from customers. |
| Ownership documents | Owner, assigned manager and verifiers only. Never public. Downloaded through an authorised endpoint. |

## Financial data security

- **Separate permissions:**
  - `rent.view`, `rent.pay`, `rent.collect`
  - `payments.view`, `payments.manage`
  - `invoices.manage`, `refunds.manage`, `commissions.manage`, `finance.reports`
- **Who can see financial records:**
  - Tenants (own): their own rent records only.
  - Landlords (own): rent for their own properties only.
  - Finance (all): all records.
  - Admin, Support, Moderator, Viewer, Agent and Provider: **no** financial permissions by default.
- **Four-eyes refunds:** the requester cannot approve their own refund. The founder is the only exception.
- **Logging:**
  - Every refund, waiver (adjustment), offline collection, reconciliation, commission change and invoice action is written to `admin_activity_logs`.
  - The same actions are also written to `security_audit_logs` as `finance.*`.
- **Online rent payment (`PAYMENT_MODE`):**
  - `test` (development only) marks rent as paid immediately and flags the transaction **TEST**. No money moves.
  - `disabled` turns online payment off. Finance records offline collections instead.
  - The server refuses to start with `test` in production. Integrate a gateway such as Razorpay before collecting real money.

## Database tables (MySQL)

Spec name → table: identical unless noted.

| Area | Tables |
|---|---|
| Identity & RBAC | `users`, `roles`, `permissions`, `role_permissions`, `user_permissions` (individual overrides) |
| Profiles | `landlord_profiles`, `tenant_profiles`, `agent_profiles`, `service_provider_profiles` |
| Properties | `properties`, `property_images`, `property_documents`, `property_assignments`, `property_inspections` |
| Rentals | `rental_applications`, `leases`, `enquiries`, `property_visits` |
| Finance | `rent_payments`, `transactions`, `invoices`, `refunds`, `subscription_plans`, `subscriptions`, `platform_settings` |
| Operations | `maintenance_requests`, `maintenance_photos`, `support_tickets`, `ticket_messages`, `fraud_reports`, `notifications` |
| Security | `security_audit_logs`, `admin_activity_logs`, `auth_sessions`, `otp_challenges`, `rate_limits`, `system_locks` |

**Ownership columns:**
- `properties.owner_id`
- `leases.landlord_id` / `tenant_id`
- `rent_payments.landlord_id` / `tenant_id`. These are denormalised so finance queries can be scoped without joins.
- `maintenance_requests.landlord_id` / `raised_by_id` / `assigned_provider_id`
- `support_tickets.raised_by_id` / `assigned_to_id`

All of these are indexed for the scope filters.

## API endpoints by module

Every endpoint below requires a verified session plus the listed permission.

| Module | Endpoints |
|---|---|
| Users | `GET/POST /api/users`, `GET/PATCH /api/users/:id`, `POST /api/users/:id/status`, `POST /api/users/:id/revoke-sessions`, `POST /api/users/:id/role` (roles.manage), `PUT /api/users/:id/permissions` (roles.manage), `GET /api/users/:id/activity` |
| Roles | `GET /api/roles`, `PUT /api/roles/:role/permissions`, `POST /api/roles/:role/reset` |
| Properties | `GET /api/browse`, `GET /api/browse/:id`, `POST /api/browse/:id/apply`, `POST /api/browse/:id/enquire`, `GET/POST /api/properties`, `GET/PATCH /api/properties/:id`, `POST …/submit`, `…/availability`, `…/deactivate`, `…/images`, `…/documents`, `…/assignments`, `…/inspections` |
| Moderation | `GET /api/moderation/queue`, `POST /api/moderation/listings/:id`, `POST /api/moderation/images/:id`, `POST /api/documents/:id/verify`, `GET/POST/PATCH /api/fraud-reports` |
| Rentals | `GET /api/applications`, `POST /api/applications/:id/decision`, `POST …/withdraw`, `GET /api/leases`, `GET /api/leases/:id`, `GET …/agreement`, `POST …/terminate`, `PATCH …/terms` |
| Rent & finance | `GET /api/rent`, `POST /api/rent/:id/pay`, `…/record`, `…/waive`, `GET …/receipt`, `POST /api/rent/generate`, `/api/finance/transactions`, `/api/finance/invoices`, `/api/finance/refunds`, `/api/finance/commission`, `/api/finance/reports` |
| Maintenance | `GET/POST /api/maintenance`, `POST …/assign`, `…/respond`, `…/work`, `…/photos`, `…/close` |
| Support | `GET/POST /api/support/tickets`, `GET/PATCH /api/support/tickets/:id`, `POST …/messages` |
| Agents | `GET /api/enquiries`, `PATCH /api/enquiries/:id`, `GET/POST /api/visits`, `PATCH /api/visits/:id` |
| Other | `GET /api/dashboard` (role-specific), `GET/PUT /api/profile`, `POST /api/profile/image`, `GET /api/notifications`, `GET /api/reports/*`, `GET/PUT /api/settings`, `/api/subscriptions/plans`, `GET /api/audit/*` |

## Multi-role accounts

| Action | Who | Endpoint |
|---|---|---|
| See my roles / roles I can add | anyone signed in | `GET /api/v1/me/roles` |
| Add Landlord or Tenant to my own account | customers (not staff) | `POST /api/v1/me/roles` |
| Remove an additional role from my account | the account owner (blocked while I still own properties / have active leases) | `DELETE /api/v1/me/roles/:role` |
| Add / remove additional roles for another user | `users.manage` + rank rules (lower ranks only; founder exempt) | `POST /api/v1/users/:id/roles`, `DELETE /api/v1/users/:id/roles/:role` |

The Admin Panel shows a **"Using SafeRent as"** switcher for multi-role accounts; it only changes the dashboard and menu labels — permissions are always the union.

Property-management permissions and the per-role matrix are in **[PROPERTIES.md](PROPERTIES.md#6-role-permission-matrix-property-management)**.

## What changed in this release

- **Login flows:**
  - Staff email + password + email OTP: unchanged, but now open to all 7 staff roles (not only Super Admin).
  - Phone OTP: unchanged for existing accounts. New phone numbers go to `/register` to become a Landlord or Tenant.
  - No duplicate Firebase accounts. Registration reuses the Firebase user that just verified the phone. Admin-created users reuse an existing Firebase user when there is one.
- **Database:** `users` gained `full_name`, `account_status`, `is_founder`, `profile_image` and `created_by_id`. Added 31 new tables (37 in total).
- **Backend:**
  - New RBAC core: `rbac/catalog.ts`, `rbac/policy.ts`, `rbac/access.ts`, `rbac/service.ts`.
  - New middleware: `loadUser`, `requireSession`, `requirePermission` and `protect()`.
  - 13 controllers, 113 endpoints.
- **Frontend:**
  - Permission-driven navigation (`routes/navigation.ts`).
  - 11 role dashboards.
  - Screens for users, roles, permissions, properties, browsing, applications, leases, rent, finance, maintenance, support, moderation, enquiries, notifications, reports, audit logs, platform settings and profile.
  - Shared table, pagination, filters and confirmation dialogs. Responsive from 360 px.
- **Tests:**
  - `server/test/rbac.test.ts`: role escalation, founder protection, reserved permissions, least privilege.
  - `server/test/access.test.ts`: ownership restrictions and financial data access.
  - `server/test/rent.test.ts`: rent schedule.
  - `web/src/test/navigation.test.ts`: per-role menus.
