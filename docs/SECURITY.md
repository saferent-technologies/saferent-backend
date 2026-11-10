# SafeRent — Security Design

> Roles, permissions and per-record data access are documented in [RBAC.md](RBAC.md).

## Login flows

Architecture: Firebase Authentication handles sign-in only. The Express API (`server/`) verifies every
Firebase ID token with the Admin SDK (`checkRevoked: true`). Roles, OTPs, sessions, rate limits and audit
logs are stored in MySQL. The browser never talks to the database.

### Email
1. **Browser:** the email must end in `@saferenttechnologies.com`. This is an eligibility filter only, never proof of authorization.
2. **Firebase Auth:** email/password sign-in.
3. **`POST /api/auth/email-otp/request`:**
   - Checks the SUPER_ADMIN claim, the MySQL `users` row and `is_active`.
   - Checks that the account signed in with a password, that the sign-in is recent, and that the Auth email matches the stored email.
   - Generates a 6-digit code with `crypto.randomInt` and stores only an **HMAC-SHA256** hash. The hash is keyed with a secret pepper and bound to the uid and challengeId.
   - Rules: expires in 5 minutes, 60-second resend cooldown, at most 5 sends per hour.
   - A new code **overwrites** the user's single `otp_challenges` row, which invalidates any previous challenge.
4. **`POST /api/auth/email-otp/verify`:** runs entirely on the server.
   - Allows at most 5 attempts per challenge and compares codes in constant time.
   - Consumes the code with an atomic conditional update, so the same code can't succeed twice, even in parallel.
   - Creates the `admin_sessions` row **bound to this sign-in's `auth_time`**.

### Phone
1. Firebase Phone Auth sends and verifies the SMS code (reCAPTCHA plus the SMS region policy).
2. If the number is unknown, Firebase may create a bare account. The API refuses it and **deletes that Firebase account immediately**, because accounts are only ever created by the bootstrap.
3. **`POST /api/auth/phone/complete`** checks:
   - the claim, the MySQL row and `is_active`
   - that the sign-in provider is `phone`
   - that `phone_number` matches the **registered** admin phone
   It then creates the bound session.

## The verified session
- **What it is:** the `admin_sessions` row (`auth_time`, `expires_at` = 12h, `revoked`).
- **How it's checked:** every protected endpoint (`requireVerifiedSession`) requires all of these:
  - `request.auth.token.role == 'SUPER_ADMIN'`
  - `session.authTime == token.auth_time`
  - the session is not expired and not revoked
- **Why it's bound to sign-in time:** signing in again, even with the correct password, produces a new `auth_time`. The second factor then has to be completed again.
- **Re-authentication:** before a sensitive change, the user confirms their password. That gives the token a new `auth_time`. The browser proves it held the verified session by sending its *previous* ID token to `/api/auth/session/rebind`. That token is verified, checked for revocation, must belong to the same uid and must match the session.

## Where each rule is enforced

| Control | Browser | Express API | MySQL |
|---|---|---|---|
| Email domain | ✓ (UX) | ✓ | |
| SUPER_ADMIN claim | ✓ (UX) | ✓ (verified ID token) | |
| Role + active account | | ✓ | source of truth |
| OTP generation, hashing and checks | | ✓ | hash only |
| Second-factor session | route guards (UX) | ✓ on every protected route | `admin_sessions` |
| No public registration | | ✓ deletes unknown Firebase users | |
| Rate limits | | ✓ (`SELECT … FOR UPDATE`) | `rate_limits` |
| Audit logs (append-only) | read via API | ✓ writes | `audit_logs` |
| App Check | ✓ token | ✓ when `APP_CHECK_ENFORCE=true` | |
| Security headers / CORS | | helmet + an origin allow-list | |

## Password changes, email and phone
- **Password:**
  - Requires a verified session plus re-authentication within the last 5 minutes.
  - The server applies the policy, sets the password, **revokes all refresh tokens**, clears `mustChangePassword` and revokes the session.
- **Email:**
  - Requires a verified session plus re-authentication.
  - The server sends a Firebase *verify-and-change* link to the new address and a notice to the old address.
  - `users.email` only changes on the next `/api/auth/me` call, and only if it matches `pending_email`.
- **Phone:**
  - Requires re-authentication, then an SMS code to the new number.
  - `syncPhoneNumber` (which needs a verified session) records the new number as the authorized phone.

## Secrets
- `OTP_PEPPER`, the SMTP password and `DATABASE_URL` live only in `server/.env`, which is git-ignored. In production, use your host's secret manager.
- The Firebase service account (`server/service-account.json`) exists only on the server. It is git-ignored and never sent to the browser.
- ⚠️ An older commit in this repository contains a `service-account.json`. **Revoke that key** in Google Cloud → IAM → Service accounts → Keys.

## Known limitations and recommendations
1. **The custom email OTP is enforced by SafeRent, not by Firebase Auth itself.** Someone who steals the password but not the mailbox:
   - **can't** read any data
   - **can't** call any SafeRent admin function
   - **can't** get past the dashboard
   They can still use Firebase's own client APIs to change that account's password or Firebase Auth email. That would lock out the real admin, but it gives them no access. A changed Auth email is detected (`ACCOUNT_MISMATCH`) and access is refused. Mitigations:
   - Use long, unique passwords (policy enforced).
   - Watch the audit logs.
   - Consider adding Firebase's built-in **TOTP MFA** (Identity Platform) later as an extra factor.
2. **SMS can be intercepted (SIM swap).** Phone login is single-factor by design (spec §7). Keep the email flow as the primary method for high-risk work, and keep the SMS region policy narrow.
3. **Rate limits use MySQL counters.** For large-scale abuse protection, add Cloud Armor or reCAPTCHA scoring in front of Hosting.
4. **Housekeeping:** expired `rate_limits` and `otp_challenges` rows are harmless. A nightly `DELETE … WHERE expires_at < NOW()` keeps the tables small. Decide on an audit log retention period.

## Operational checklist before go-live
- [ ] Test phone numbers removed; SMS region policy set to the countries you need
- [ ] `EMAIL_PROVIDER=smtp` with a verified sender domain (SPF/DKIM)
- [ ] `APP_CHECK_ENFORCE=true`; API served over HTTPS; `APP_ORIGIN` set to the real domain only
- [ ] Dedicated MySQL user with least privilege; backups enabled
- [ ] Old service-account key from git history revoked
- [ ] Bootstrap temporary password changed (the app forces this)
