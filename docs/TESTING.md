# SafeRent — Testing

## Automated tests

```bash
npm test                 # server + web unit tests
npm run typecheck        # TypeScript for both packages
```

| Suite | File(s) | Covers |
|---|---|---|
| OTP crypto | `server/test/otp.test.ts` | 6 random digits, codes aren't static, only hashes are stored, hash bound to uid/challenge/pepper, malformed input |
| OTP challenge | `server/test/challenge.test.ts` | correct, incorrect, 5-attempt lockout, expired, replay, superseded challenge, different sign-in, 60-second resend cooldown |
| Policies | `server/test/policies.test.ts` | email domain (look-alike domains rejected), password policy, E.164 phone format, masking, rate-limit window, session binding |
| RBAC & escalation | `server/test/rbac.test.ts` | least privilege, reserved permissions, founder protection, rank rule, no self-escalation, only the founder grants Super Admin |
| Ownership & financial access | `server/test/access.test.ts` | landlord own-only, manager/agent assigned-only, tenants can't list or approve, providers see assigned jobs only, rent visible only to tenant/landlord/finance |
| Rent schedule | `server/test/rent.test.ts` | monthly dues, lease end, future leases, year boundaries |
| Role navigation | `web/src/test/navigation.test.ts` | each role sees only its own menu |
| Web validation | `web/src/test/validation.test.ts` | form schemas, phone helpers, masking |
| Error messages | `web/src/test/errors.test.ts` | no Firebase internals shown to users, blocking-function rejection, rate limits |
| OTP input | `web/src/test/OtpInput.test.tsx` | auto-advance, paste, backspace, ignores non-digits |
| Route protection | `web/src/test/guards.test.tsx` | signed out, unauthorized, OTP required, admin allowed, forced password change |

## Manual test plan

Run `npm run dev` with `EMAIL_PROVIDER=console` (OTP codes appear in the terminal). Use `npm run db:studio` to inspect or edit MySQL rows.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Correct email/password | Sign in as the bootstrap admin | OTP screen shows `a****@saferenttechnologies.com` |
| 2 | Incorrect password | Wrong password | "Incorrect email or password." |
| 3 | Unauthorized email | `someone@gmail.com` | Form error: use your company email |
| 4 | Correct email OTP | Enter the code from the terminal | Dashboard (or Settings on first login) |
| 5 | Incorrect email OTP | Wrong code | "That code is incorrect", attempts left count goes down |
| 6 | Expired email OTP | Wait 5 minutes | "This code has expired", resend offered |
| 7 | Resend OTP | Click resend before 60s, then after | Countdown first; after 60s a new code is sent and the old one no longer works |
| 8 | Correct phone OTP | Phone tab → test number → code | Dashboard |
| 9 | Incorrect phone OTP | Wrong code | "That code is incorrect" |
| 10 | Unauthorized phone | Another test number that isn't registered | "Not authorized"; the Firebase user is deleted automatically (Auth → Users) |
| 11 | Disabled account | Set `users.is_active = 0` (db:studio) | Sign-in refused; open sessions are signed out |
| 12 | Invalid custom claims | Remove the claim (`setCustomUserClaims(uid, null)`) | "Not authorized" |
| 13 | Route protection | Open `/dashboard` while signed out, and again after the password step but before the OTP | Redirected to `/login` and `/verify-otp` |
| 14 | Forgot password | Request a reset; use the link; reuse the link | Generic success; the reset works; the reused link shows "expired or invalid" |
| 15 | Logout | Profile menu → Sign out | Back at login with "You have been signed out"; `admin_sessions.revoked = 1` |
| 16 | Network/API failure | Stop the API or go offline → submit | "Can't reach the SafeRent server" |
| 17 | Session expiry | Set `admin_sessions.expires_at` to the past, then reload | Signed out with "Your session has expired" |
| 18 | Rate limit | Request OTP more than 5 times in an hour | "Too many attempts" |

## Responsive checklist

Chrome DevTools → Device toolbar. Check each width:
**360, 375, 390, 430, 768, 1024, 1280, 1440, 1920 px**

- [ ] No horizontal scrolling on any page
- [ ] The login card is full width on phones and centered on larger screens; the brand panel appears at ≥1024px
- [ ] The six OTP boxes fit on one row at 360px
- [ ] Inputs are at least 44px tall, and the text is 16px on phones (so iOS doesn't zoom)
- [ ] The dashboard sidebar becomes a drawer below 1024px; the profile menu still works
- [ ] Test real devices too: Android Chrome and iPhone Safari (check OTP autofill from Messages/Mail)

## Multi-role manual checks

| # | Scenario | Expected |
|---|---|---|
| R1 | A new phone number logs in | Registration page; only Landlord or Tenant can be chosen |
| R2 | Landlord opens another landlord's property URL | "Property not found" (404) |
| R3 | Tenant opens `/users`, `/finance` or `/roles` | Redirected to dashboard; the API also returns 403 |
| R4 | Admin tries to deactivate the founder or another Admin | "The founder account is protected" / "lower role" error |
| R5 | Finance admin requests a refund, then tries to approve it | "Must be approved by someone other than the requester" |
| R6 | Support opens `/api/rent` directly | 403 + an `authz.denied` entry in the security audit log |
| R7 | Manager not assigned to a property opens it | 404 |
| R8 | Service provider views a job before accepting | Requester phone hidden; shown after accepting |
| R9 | Super Admin grants `roles.manage` to an Admin | Refused: reserved permission |
| R10 | Landlord approves an application | Lease created, property RENTED, other applicants notified, first rent due generated |
