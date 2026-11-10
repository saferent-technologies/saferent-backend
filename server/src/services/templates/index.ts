import { buttonHtml, emailLayout, escapeHtml, type RenderedEmail } from "./layout";

const p = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#374151;">${html}</p>`;

export function otpEmail(params: { code: string; minutes: number }): RenderedEmail {
  const { code, minutes } = params;
  const title = "Your SafeRent verification code";
  const bodyHtml = [
    p("Use this code to finish signing in to the SafeRent Super Admin portal:"),
    `<p style="margin:20px 0;font-size:34px;font-weight:800;letter-spacing:10px;color:#EA580C;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${escapeHtml(code)}</p>`,
    p(`This code expires in <strong>${minutes} minutes</strong> and can be used once.`),
    p("If you did not try to sign in, change your password immediately and contact your security team."),
  ].join("");
  return {
    subject: `${code} is your SafeRent verification code`,
    html: emailLayout({ title, bodyHtml }),
    text: `Your SafeRent verification code is ${code}. It expires in ${minutes} minutes and can be used once. If you did not try to sign in, change your password immediately.`,
  };
}

export function passwordResetEmail(params: { link: string }): RenderedEmail {
  const title = "Reset your SafeRent password";
  const bodyHtml = [
    p("We received a request to reset the password for your SafeRent Super Admin account."),
    buttonHtml(params.link, "Reset password"),
    p("This link expires after a short time and can be used once. If you didn't request a reset, you can ignore this email."),
  ].join("");
  return {
    subject: "Reset your SafeRent password",
    html: emailLayout({ title, bodyHtml }),
    text: `Reset your SafeRent password: ${params.link}\nIf you didn't request this, ignore this email.`,
  };
}

export function emailChangeVerificationEmail(params: { link: string; newEmail: string }): RenderedEmail {
  const title = "Confirm your new email address";
  const bodyHtml = [
    p(`Confirm that <strong>${escapeHtml(params.newEmail)}</strong> should become the sign-in email for your SafeRent Super Admin account.`),
    buttonHtml(params.link, "Confirm new email"),
    p("If you didn't request this change, ignore this email."),
  ].join("");
  return {
    subject: "Confirm your new SafeRent email address",
    html: emailLayout({ title, bodyHtml }),
    text: `Confirm your new SafeRent email address: ${params.link}`,
  };
}

export function emailChangeNoticeEmail(params: { newEmailMasked: string }): RenderedEmail {
  const title = "Email change requested";
  const bodyHtml = [
    p(`A request was made to change your SafeRent sign-in email to <strong>${escapeHtml(params.newEmailMasked)}</strong>.`),
    p("If this wasn't you, sign in and change your password immediately, and contact your security team."),
  ].join("");
  return {
    subject: "SafeRent security notice: email change requested",
    html: emailLayout({ title, bodyHtml }),
    text: `A request was made to change your SafeRent sign-in email to ${params.newEmailMasked}. If this wasn't you, change your password immediately.`,
  };
}

export function staffInviteEmail(params: { link: string; name: string; roleName: string }): RenderedEmail {
  const title = "You've been invited to SafeRent";
  const bodyHtml = [
    p(`Hi ${escapeHtml(params.name)}, a SafeRent administrator created a <strong>${escapeHtml(params.roleName)}</strong> account for you.`),
    p("Set your password to activate it. You'll confirm each sign-in with a code sent to this email."),
    buttonHtml(params.link, "Set your password"),
    p("This link expires soon. If you weren't expecting this, you can ignore this email."),
  ].join("");
  return {
    subject: "Your SafeRent account is ready",
    html: emailLayout({ title, bodyHtml }),
    text: `Hi ${params.name}, a SafeRent ${params.roleName} account was created for you. Set your password: ${params.link}`,
  };
}
