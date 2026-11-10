import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";
import type { RenderedEmail } from "./templates/layout";

let transporter: Transporter | null = null;

function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

/**
 * Sends a transactional email.
 *  - EMAIL_PROVIDER=console (development): prints the email in the server terminal.
 *  - EMAIL_PROVIDER=smtp (production): sends via any SMTP provider
 *    (Google Workspace, Zoho, Amazon SES, Resend SMTP, Brevo…).
 */
export async function sendEmail(to: string, email: RenderedEmail): Promise<void> {
  if (env.EMAIL_PROVIDER === "console") {
    console.log(
      `\n📧 ─── EMAIL (development: not actually sent) ───\n   To: ${to}\n   Subject: ${email.subject}\n   ${email.text.replace(/\n/g, "\n   ")}\n──────────────────────────────────────────────\n`,
    );
    return;
  }
  await smtp().sendMail({ from: env.EMAIL_FROM, to, subject: email.subject, html: email.html, text: email.text });
}
