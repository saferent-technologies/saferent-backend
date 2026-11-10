# SafeRent — Local Setup Guide (Firebase Auth + MySQL)

**How SafeRent is built:**
- **Firebase** does sign-in only (email/password and phone OTP).
- Everything else (admin accounts, roles, OTP codes, sessions and audit logs) lives in **MySQL**.
- **Express API** (`server/`) is the backend. **React app** (`web/`) is the frontend.

No Blaze plan and no Cloud Functions are needed.

Run every command from the project root (the folder with `package.json`) in the VS Code terminal.

---

## 1. Install packages

```bash
npm run install:all
```

## 2. MySQL

Use the MySQL you already have, or install it: `brew install mysql && brew services start mysql`.
Create the database:

```bash
mysql -u root -p -e "CREATE DATABASE saferent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

## 3. Firebase (authentication only)

In the Firebase console, open project **saferent-768a3**:

1. **Build → Authentication → Get started → Sign-in method**
   - **Email/Password** → Enable → Save
   - **Phone** → Enable → under *Phone numbers for testing*, add your number with code `123456` → Save
     (test numbers need no SMS; real SMS may require the Blaze plan)
2. **Authentication → Settings → Authorized domains**: keep `localhost`.
3. **Project settings → Service accounts → Generate new private key**.
   Save the downloaded file as **`server/service-account.json`**.
   ⚠️ This file is a secret. It's already in `.gitignore`. Never share it or commit it.

The web app's Firebase config is already in `web/.env.local`.

## 4. Server configuration

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

| Key | Value |
|---|---|
| `DATABASE_URL` | `mysql://root:YOUR_MYSQL_PASSWORD@localhost:3306/saferent` |
| `OTP_PEPPER` | output of `openssl rand -base64 48` |
| `EMAIL_PROVIDER` | `console` = OTP codes are printed in the terminal (good for development) |
| `PAYMENT_MODE` | `test` = "Pay rent" works without real money (development only) |

## 5. Create the tables

```bash
npm run db:migrate
```

When it asks for a migration name, type `init`. This creates every table, including:
- `users`, `roles`, `permissions`
- `properties`, `leases`, `rent_payments`
- `audit_logs` and more

It also creates the RBAC, property, rental, finance and operations tables (37 in total). Roles, permissions and default settings are filled in automatically when the API starts.

To see the data in a browser: `npm run db:studio`.

## 6. Create the founder Super Admin (one time only)

```bash
npm run bootstrap:super-admin
```

It asks for:
- **Email**: press Enter for `admin@saferenttechnologies.com`
- **Name**: press Enter for `Shaik Shabeer`
- **Phone**: press Enter for `+917995153536` (add it as a Firebase **test number** to log in without SMS)
- **Temporary password**: at least 12 characters, with upper case, lower case, a number and a symbol, e.g. `Safe@Rent2026!`

The script then:
1. Creates the Firebase user.
2. Sets the `SUPER_ADMIN` custom claim.
3. Inserts the MySQL row as the protected **founder** (`is_founder = 1`) with `must_change_password = 1`.
4. Locks itself so it can never run twice.

> If Firebase says the email/phone already exists (e.g. from an earlier test), delete that user in
> **Authentication → Users** and run again.

## 7. Run 🚀

```bash
npm run dev
```

This starts both parts:
- **API**: http://localhost:4000 (yellow logs)
- **Web app**: http://localhost:5173 (cyan logs). Open this one in your browser.

**Email login:**
1. Enter your email and password.
2. The 6-digit code appears in the **terminal** (`📧 EMAIL … verification code is 123456`).
3. Enter it. On the first login you'll be asked to set a new password.

**Phone login:** enter your test number, then `123456`.

**Try the other roles:**
- **Landlord / Tenant:** add another test phone number in Firebase, log in with it, and choose Landlord or Tenant on the registration page.
- **Staff, agents, service providers:** as the founder, open **Users → Add user**.
  - Staff get a "set your password" email. With `EMAIL_PROVIDER=console` it appears in the terminal.
  - Agents and providers sign in with their phone number.

---

## Sending real emails (later)

In `server/.env` set `EMAIL_PROVIDER=smtp` and fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`. Examples:
- Google Workspace: `smtp.gmail.com`, port 587, with an app password
- Zoho: `smtp.zoho.in`
- Resend: `smtp.resend.com`, user `resend`
- Amazon SES

The sender in `EMAIL_FROM` must be allowed by your provider.

For password-reset and email-change links to open SafeRent's own pages: **Authentication → Templates → ✏️ → Customize action URL** → `http://localhost:5173/auth/action` (use your real domain in production).

## Production checklist

- Deploy the API (`npm run build`, then `npm --prefix server start`) behind HTTPS. Set `NODE_ENV=production`, `APP_ORIGIN=https://your-admin-domain` and `TRUST_PROXY=1` when behind a proxy.
- Run `npm --prefix server run db:deploy` to apply migrations in production.
- Build the web app with `VITE_API_URL=https://your-api-domain` and host `web/dist` (e.g. `npx firebase deploy --only hosting`).
- Firebase **App Check**: create a reCAPTCHA Enterprise key, set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, then set `APP_CHECK_ENFORCE=true` on the server.
- **Authentication → Settings**: set the SMS region policy to India only; remove test phone numbers.
- Use a dedicated MySQL user with access only to the `saferent` database.

## Troubleshooting

| Message | Fix |
|---|---|
| `Invalid server configuration (server/.env)` | Fill in the listed keys in `server/.env` |
| `Could not connect to MySQL` | Start MySQL; check the user and password in `DATABASE_URL` |
| `Can't reach the SafeRent server` in the browser | The API isn't running. Use `npm run dev` (not only the web app) |
| `This account is not authorized` | Run the bootstrap (step 6) and log in with that email or phone |
| `Your session has expired` right after login | The clock on your Mac is wrong, or `server/service-account.json` belongs to another project |
| `auth/operation-not-allowed` | Enable the sign-in method (step 3) |
