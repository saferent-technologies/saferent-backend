# SafeRent — Unified Property Management (API v1)

One backend, one database and one API for **Android, iOS and the Admin Panel**. There are no platform-specific endpoints; clients only send `X-Client-Platform` so the audit log records where a change came from.

```
Android ─┐
iOS ─────┼──  /api/v1  (Express + TypeScript)  ──  MySQL (Prisma)
Admin ───┘        │
                  ├── Firebase Authentication (ID tokens only — no data in Firebase)
                  ├── RBAC (roles + permissions + own / assigned / all scope)
                  ├── Properties · units · rooms & beds · utilities · policies · amenities · pricing
                  ├── Images & private documents (local storage behind an authorization check)
                  ├── Verification workflow · completeness score · status history · audit log
                  └── OpenAPI docs  (/api/v1/docs, docs/openapi.json)
```

---

## 1. Existing architecture analysis (what was reused)

| Area | Before this release | Decision |
|---|---|---|
| Backend | Node + TypeScript + Express 5, Prisma | **Kept.** New code lives in `server/src/properties/`. |
| Database | **MySQL** (Prisma). Firebase is used only for authentication. | **Kept MySQL.** The spec's Firestore structure is implemented as relational tables (same entities and boundaries). No Firestore collections are created, so `firestore.rules` denies everything. |
| Auth | Firebase email + password + email OTP (staff), phone OTP (customers), verified session bound to `auth_time` | **Unchanged.** Every v1 route still runs App Check → token → account → session → permission. |
| Roles | 11 roles incl. `PROPERTY_MANAGER`, `LANDLORD`, `TENANT`; 45 permissions; scopes OWN / ASSIGNED / ALL | **Reused as is.** Property routes use `properties.view / create / manage`, `listings.approve`, `documents.verify`, `inspections.manage`, `assignments.manage`. |
| One role per user | `users.role` | **Extended:** `user_roles` adds extra customer roles (e.g. Landlord + Tenant). See §6. |
| Property model | one flat `properties` table with one mixed `status` | **Replaced** by the structure below; leases, applications, maintenance, enquiries and visits keep pointing at `properties`. |
| Uploads | `server/uploads`, served only through authorized routes | **Kept**, now behind a `FileStorage` interface (swap to Firebase Storage / S3 later) and with file-signature checks. |
| API prefix | `/api` (unwrapped JSON) | `/api/v1` with the `{ success, message, data, meta }` envelope. `/api` stays as a backwards-compatible alias. The Admin Panel now uses `/api/v1`. |

## 2. Database schema (new / changed tables)

| Table | Purpose |
|---|---|
| `property_types` | Category, type, structure and the **field schema** used for validation and dynamic forms (synced from `properties/catalog.ts`). New types need no migration. |
| `amenities` | Amenity catalog (category-specific); custom amenities are stored per property. |
| `id_counters` | Transactional counters for readable IDs (`SR-PROP-000001` …). |
| `properties` | Common data + `code`, `category`, `property_type`, `listing_type`, location, building columns (`name`, `total_floors`, `total_units`), type-specific `attributes` JSON, **four separate statuses** (`active_status`, `publication_status`, `verification_status`; availability lives on units/beds), backend aggregates (`completeness_score`, `rent_from/to`, `available_count`, `occupied_count`), `version` for optimistic locking. |
| `property_units` | Flats, villas, houses, duplexes, farmhouses, commercial spaces, plots. Own `code` (`SR-UNIT-…` / `SR-VILLA-…`), own availability and active status. Unique unit number per property. |
| `duplex_floors` | Floor-wise details of a duplex. |
| `property_rooms`, `property_beds`, `bed_assignments` | PG / hostel: building → rooms (`SR-ROOM-…`) → beds (`SR-BED-…`). A bed has at most one current tenant (atomic conditional update); assignments are kept as history. |
| `property_utilities` | Electricity / water / other utilities for the property (`scope_key = PROPERTY`) or one unit. `YES / NO / NOT_APPLICABLE / NOT_DISCLOSED`. |
| `property_policies` | Guest policies and restrictions + structured `additional_rules`. |
| `property_amenities` | Amenities per property or unit (catalog key or `custom:<slug>`). |
| `property_pricing`, `pricing_charges` | Rent, deposit and terms (property or unit scope) + one row per charge with its billing type (`INCLUDED_IN_RENT / FIXED_MONTHLY / USAGE_BASED / ONE_TIME / NOT_APPLICABLE / NOT_DISCLOSED`). |
| `property_images` | Category, display order, unit / room / inspection link, moderation status. |
| `property_documents` | `SR-DOC-…`, type, verification status, verifier, rejection reason. Private. |
| `property_inspections` | Move-in / move-out (unique per lease and type), routine, verification; condition ratings, inventory, meter reading, keys, acknowledgements, photos. |
| `property_status_history` | Every active / publication / verification / availability change. |
| `property_audit_logs` | Append-only audit: event id, entity, action, old / new value, actor, role, **source platform**, request id. |
| `user_roles` | Additional roles per account. |
| `leases`, `rental_applications` | Now reference the `unit` / `bed`; leases get `SR-LEASE-…` codes. |

## 3. Created and modified files

**Server — new:** `src/properties/` (`catalog.ts`, `fields.ts`, `schemas.ts`, `completeness.ts`, `costs.ts`, `workflow.ts`, `ids.ts`, `diff.ts`, `bedCapacity.ts`, `service.ts`, `presenters.ts`, `sync.ts`, `controllers/{property,unit,room,details,media,inspection,browse}.controller.ts`), `src/v1/{envelope,openapi}.ts`, `src/middleware/writeLimit.ts`, `src/lib/upload-sniff.ts`, `src/scripts/export-openapi.ts`, `scripts/test-db-reset.cjs`, tests `test/properties.*.test.ts`, `test/multirole.test.ts`, `test/envelope.test.ts`, `test/integration/properties.api.test.ts`.
**Server — modified:** `prisma/schema.prisma`, `src/app.ts`, `src/server.ts`, `src/routes/index.ts`, `src/rbac/{policy,service}.ts`, `src/middleware/auth.ts`, `src/types/express.d.ts`, `src/lib/{uploads,validation}.ts`, `src/config/{env,constants}.ts`, controllers `auth`, `users`, `rentals`, `operations`, `insights`, `rent`, `properties` (now assignments only), `src/bootstrap/bootstrap.ts`, `vitest.config.ts`, `package.json`, `.env.example`.
**Web — new / rewritten:** `pages/properties/{types.ts, components.tsx, PropertiesPage.tsx, PropertyFormPage.tsx (12-step wizard), PropertyDetailPage.tsx}`, `pages/rentals/BrowsePage.tsx`.
**Web — modified:** `services/api.ts` (v1 + envelope), `contexts/AuthContext.tsx` (roles, active role), `layouts/DashboardLayout.tsx` (role switcher), `pages/dashboard/DashboardPage.tsx` (property portfolio), `pages/operations/{ModerationPage,MiscPages}.tsx`, `pages/admin/UserDetailPage.tsx`, `pages/profile/ProfilePage.tsx`, `components/ui/StatusBadge.tsx`, `types/auth.ts`.
**Root:** `firestore.rules`, `storage.rules`, `docs/PROPERTIES.md`, `docs/openapi.json`.

## 4. API endpoints (all under `/api/v1`)

Full, always-current list with request schemas: **`GET /api/v1/docs`** (Swagger UI) or `docs/openapi.json` (`npm run openapi`). `:propertyId` accepts the UUID or the code (`SR-PROP-000001`).

| Area | Endpoints |
|---|---|
| Catalog | `GET /property-types` (categories, types, **field schemas**, enums, wizard steps) · `GET /amenities` |
| Properties | `POST /properties` · `GET /properties` · `GET /properties/summary` · `GET /properties/review-queue` · `GET /properties/:id` · `PATCH /properties/:id` · `DELETE /properties/:id` (archive) · `GET /properties/:id/completeness` |
| Workflow | `POST …/submit` · `POST …/review` (approve / reject) · `POST …/publish` · `POST …/unpublish` · `POST …/status` · `POST …/transfer-ownership` · `GET …/status-history` · `GET …/audit` |
| Units | `POST …/units` · `POST …/units/bulk` · `GET …/units` · `GET/PATCH/DELETE …/units/:unitId` · `PUT …/units/:unitId/floors` · `GET/PUT …/units/:unitId/utilities` · `GET/PUT …/units/:unitId/pricing` |
| Rooms & beds | `POST/GET …/rooms` · `PATCH …/rooms/:roomId` · `POST …/rooms/:roomId/beds` · `PATCH …/beds/:bedId` · `POST …/beds/:bedId/assign` · `POST …/beds/:bedId/release` |
| Details | `GET/PUT …/utilities` · `GET/PUT …/policies` · `PUT …/amenities` · `GET/PUT …/pricing` |
| Media | `POST …/images` (multipart) · `PATCH/DELETE …/images/:imageId` · `POST …/documents` (multipart) · `GET …/documents` · `POST /documents/:docId/verify` · `GET /files/property-images/:imageId` · `GET /files/documents/:docId` |
| Inspections | `POST/GET …/inspections` · `PATCH …/inspections/:id` · `POST …/inspections/:id/acknowledge` |
| Team | `POST/DELETE …/assignments` |
| Search (tenants) | `GET /browse` (availability, rent, type, city…) · `GET /browse/:id` (full disclosure + cost breakdown) · `POST /browse/:id/apply` (unit / bed) · `POST /browse/:id/enquire` |
| Roles | `GET/POST /me/roles` · `DELETE /me/roles/:role` · `POST /users/:id/roles` · `DELETE /users/:id/roles/:role` |
| Settings | `GET/PUT /settings/completeness-weights` (Super Admin) |

## 5. Request / response examples

Create a draft (owner comes from the token — never from the body):
```http
POST /api/v1/properties
Authorization: Bearer <Firebase ID token>
X-Client-Platform: ANDROID
Content-Type: application/json

{ "propertyTypeKey": "APARTMENT", "listingType": "RENT", "title": "Green Valley Apartments" }
```
```json
{ "success": true, "message": "Property created successfully",
  "data": { "property": { "id": "8f6c…", "code": "SR-PROP-000001", "publicationStatus": "DRAFT", "activeStatus": "ACTIVE", "verificationStatus": "UNVERIFIED", "completenessScore": 0, "version": 1, "…": "…" } },
  "meta": null }
```

Building details are sent once; flats are added without repeating them:
```http
PATCH /api/v1/properties/SR-PROP-000001
{ "version": 1, "city": "Hyderabad", "locality": "Madhapur", "building": { "name": "Green Valley Apartments", "totalFloors": 5, "totalUnits": 40, "liftAvailable": "YES", "parkingAvailable": "NOT_DISCLOSED" } }

POST /api/v1/properties/SR-PROP-000001/units/bulk
{ "units": [
  { "unitNumber": "101", "floorNumber": 1, "bhkType": "1BHK", "bedrooms": 1, "bathrooms": 1, "furnishing": "SEMI_FURNISHED", "availabilityStatus": "AVAILABLE", "pricing": { "monthlyRent": 15000, "securityDeposit": 45000 } },
  { "unitNumber": "102", "floorNumber": 1, "bhkType": "2BHK", "bedrooms": 2, "bathrooms": 2, "furnishing": "SEMI_FURNISHED", "availabilityStatus": "AVAILABLE" } ] }
```

Itemised charges (never one unclear amount):
```http
PUT /api/v1/properties/SR-PROP-000001/pricing
{ "securityDeposit": 66000, "rentDueDay": 5, "noticePeriodDays": 30, "lockInPeriodMonths": 6, "agreementChargesPaidBy": "SHARED",
  "charges": [ { "kind": "MAINTENANCE", "billing": "FIXED_MONTHLY", "amount": 2500 },
               { "kind": "ELECTRICITY", "billing": "USAGE_BASED" },
               { "kind": "PARKING", "billing": "NOT_DISCLOSED" } ] }
```
The response includes `breakdown`: `includedInRent`, `fixed` (with monthly equivalents), `usageBased`, `oneTime`, `notDisclosed`, and an `estimate` **only** when rent and every recurring charge are disclosed (always labelled `isEstimate: true`).

Errors:
```json
{ "success": false, "message": "You don't have permission to access this property.", "errorCode": "FORBIDDEN", "reason": "PERMISSION_DENIED", "data": null }
{ "success": false, "message": "Complete the required details before submitting.", "errorCode": "INVALID_STATE", "reason": "INVALID_STATE", "details": { "problems": ["Add at least one photo."] }, "data": null }
{ "success": false, "message": "This property was changed by someone else. Reload and try again.", "errorCode": "CONFLICT", "reason": "VERSION_CONFLICT", "data": null }
```

## 6. Role-permission matrix (property management)

| Capability | Super Admin | Admin | Property Manager | Landlord | Agent | Moderator | Tenant |
|---|---|---|---|---|---|---|---|
| View properties | all | all | assigned | own | assigned | all | — (browse published only) |
| Create property | ✓ (any) | ✓ (for a landlord) | — | ✓ own | ✓ for a landlord | — | — |
| Edit details / units / rooms / pricing / utilities / policies | all | all | assigned | own | assigned | — | — |
| Upload images / documents | all | all | assigned | own | assigned | — | — |
| Verify documents | all | all | assigned | — | — | all | — |
| Approve / reject (verify) property | ✓ (not own) | ✓ (not own) | — | — | — | ✓ | — |
| Publish / unpublish (after approval) | ✓ | ✓ | assigned | own | assigned | ✓ | — |
| Suspend / lift suspension | ✓ | ✓ | — | — | — | ✓ | — |
| Archive / restore | archive all, restore | archive all, restore | archive assigned | archive own | archive assigned | — | — |
| Assign managers / agents | ✓ | ✓ | — | — | — | — | — |
| Transfer ownership | ✓ | ✓ | **never** | — | — | — | — |
| Status history / audit trail | all | all | assigned | own | assigned | all | — |
| Apply for a unit / bed | — | — | — | (if also Tenant) | — | — | ✓ |

**Multi-role.** `users.role` is the primary role; `user_roles` adds customer roles (`LANDLORD`, `TENANT`, `PROPERTY_AGENT`, `SERVICE_PROVIDER`). Effective permissions are the union of all roles + individual overrides. Reserved permissions are only ever held by `SUPER_ADMIN`. Customers can add Landlord / Tenant to themselves (`POST /me/roles`); other combinations need `users.manage` and the rank rules. Staff accounts never hold customer roles. The Admin Panel shows a role switcher and per-role dashboards.

**Rules enforced on the server:** identity always comes from the verified Firebase token; owner id, role, code and status are never accepted from a client; every query is filtered by the caller's scope (records outside it return 404 to prevent IDOR); reviewers can't verify their own properties or documents; all writes are rate-limited per user.

## 7. Firestore / Storage security rules

All data is in MySQL behind the API; clients never touch Firestore or Firebase Storage. `firestore.rules` and `storage.rules` deny all access. If you enable those products, deploy them with `firebase deploy --only firestore:rules,storage` (add the `firestore` / `storage` sections to `firebase.json`).

## 8. Admin Panel integration

- **Landlord dashboard:** property portfolio (total, drafts, pending verification, needs changes, approved, published), available / occupied units, rent expected / collected / overdue, notifications, **Add property**.
- **Properties list:** tabs by publication status, search by code / title / city, completeness and availability columns. Drafts open in the wizard.
- **12-step wizard** (`/properties/new`, `/properties/:id/edit?step=N`): category → type → basic → building (dynamic fields) → units / rooms & beds → utilities → policies → amenities → pricing (with live tenant view) → photos & documents → inspection → review & submit. Save draft / continue later on every step.
- **Property page:** completeness breakdown, status actions (publish, deactivate, suspend, archive), units / rooms / beds (assign / release), utilities & terms, photos, private documents (verify / reject), inspections (move-in / move-out reports), team, status history and audit trail.
- **Moderation:** verification queue (properties, documents, photos) using the same v1 endpoints.
- **Tenant search:** every disclosure shown as Yes / No / Not applicable / **Not disclosed** (never shown as No), per-unit cost breakdown, apply for a specific unit or bed.

## 9–10. Test and build results

See `docs/TESTING.md`. Unit tests (145) cover catalog/field validation, utility / policy / pricing validation, completeness, cost transparency, workflow transitions, ID generation (including concurrency), multi-role RBAC and scope filters, the response envelope and upload signatures. `test/integration/properties.api.test.ts` covers all 20 required scenarios end-to-end against a real MySQL test database.

## 11. Environment variables

Unchanged from `server/.env.example`, plus optional `API_DOCS` (Swagger on / off) and `TEST_DATABASE_URL` (integration tests — a separate database whose name contains `test`).

## 12. Deployment

1. `npm run install:all`
2. `npm run db:migrate` (development) or `npm --prefix server run db:deploy` (production) — creates the new tables.
3. Start the API: catalogs (roles, permissions, property types, amenities, completeness weights) are synced on startup.
4. `npm run build` — server `dist/` and web `dist/`.
5. Production: `NODE_ENV=production`, `APP_CHECK_ENFORCE=true`, `TRUST_PROXY=1` behind a proxy, `API_DOCS=false` unless the docs should be public, HTTPS only, uploads directory on persistent storage (or switch the `FileStorage` driver).

## 13. Remaining tasks and known limitations

- **Mobile apps** are not part of this repository; they should use `/api/v1` and `GET /property-types` to render the same forms.
- **File storage** is local disk. For multiple API servers, implement the `FileStorage` interface for Firebase Storage / S3.
- **Audit immutability** is enforced by the API (no update / delete routes). For database-level immutability, add MySQL triggers or a write-only DB user for `property_audit_logs`.
- **Bed assignment** from the property page takes a tenant id; normally beds are assigned automatically when an application is approved.
- **Completeness weights** changes apply to each property on its next change (scores are stored, not recomputed in bulk).
- Online rent payment remains in TEST mode (`PAYMENT_MODE`) until a real gateway is integrated.
