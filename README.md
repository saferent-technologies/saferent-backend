# SafeRent — Property Rental Management Platform

Multi-role rental platform for **SafeRent** by SafeRent Technologies: 7 staff roles plus landlords, tenants, agents and service providers. Each role has its own dashboard, permissions and data scope.

| Part | Stack |
|---|---|
| `web/` | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, React Hook Form, Zod, Lucide icons |
| `server/` | Node.js, Express 5, TypeScript, Prisma ORM, **MySQL** |
| Authentication | **Firebase Authentication only** (email/password + phone OTP), Admin SDK on the server |

## Roles

Super Admin · Admin · Finance Admin · Property Manager · Support · Moderator · Viewer · Landlord · Tenant · Property Agent · Service Provider.
The complete role → permission matrix and data-access rules are in **[docs/RBAC.md](docs/RBAC.md)**.

## How login works

1. **Email (staff):**
   - **Firebase** checks the password.
   - The **API** checks the Super Admin role and that the account is active (Firebase custom claim **and** the MySQL row).
   - The API emails a **6-digit OTP**. Only a hash is stored. Expiry 5 min, resend after 60 s, 5 attempts.
   - The API verifies the code and creates a session bound to that sign-in.
2. **Phone (landlords, tenants, agents, service providers — and staff with a registered phone):**
   - **Firebase** sends and verifies the SMS code.
   - Existing account: the API checks the number matches it, then creates the session.
   - New number: the user registers as a **Landlord** or **Tenant**.
3. Every protected API call re-checks the token, the account status, the verified session, the **permission**, and the **record scope** (own / assigned / all).

## Structure

```
.
├── docs/            SETUP.md (start here), RBAC.md (roles & permissions), SECURITY.md, TESTING.md
├── server/          ── BACKEND (Express + MySQL) ──
│   ├── prisma/schema.prisma      37 MySQL tables (users, roles, properties, leases, rent, finance, maintenance, support…)
│   └── src/
│       ├── rbac/                 roles & permissions catalog, escalation policies, scope filters
│       ├── routes/               every endpoint + the permission it requires
│       ├── controllers/          auth, users, roles, properties, rentals, rent, finance, operations, insights…
│       ├── middleware/           authenticate, loadUser, requireSession, requirePermission, App Check, errors
│       ├── lib/                  otp, rate limits, sessions, validation, audit, prisma, firebaseAdmin
│       ├── services/             email (console / SMTP) + templates
│       └── bootstrap/            one-time Super Admin creation
└── web/             ── FRONTEND (React) ──
    └── src/  authentication/ components/ contexts/ firebase/ hooks/ layouts/ pages/ routes/ services/ styles/ types/ utils/ validations/
```

## Quick start

```bash
npm run install:all
cp server/.env.example server/.env     # MySQL URL, OTP secret
npm run db:migrate                     # create tables
npm run bootstrap:super-admin          # founder account (once)
npm run dev                            # API :4000 + web :5173
```

Full step-by-step guide: **[docs/SETUP.md](docs/SETUP.md)**

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the API and the web app together |
| `npm run db:migrate` | Create or update MySQL tables |
| `npm run db:studio` | Browse the database in the browser |
| `npm run bootstrap:super-admin` | Create the founder Super Admin (runs once) |
| `npm test` | Unit tests (server and web) |
| `npm run typecheck` | TypeScript checks |
| `npm run build` | Production build |

## Brand

All colors are defined in `web/src/styles/index.css` (`@theme`): primary orange `#F97316`, hover `#EA580C`, charcoal `#1F2937`.
