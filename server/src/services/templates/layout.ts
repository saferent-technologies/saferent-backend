/** Minimal, email-client-safe HTML layout using the SafeRent palette (inline styles only). */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function emailLayout(params: { title: string; bodyHtml: string; footerNote?: string }): string {
  const { title, bodyHtml, footerNote } = params;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1F2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F9FAFB;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#F97316;padding:20px 28px;">
                <span style="font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;">SafeRent</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#1F2937;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#FFF7ED;border-top:1px solid #E5E7EB;font-size:12px;line-height:18px;color:#6B7280;">
                ${footerNote ? `${escapeHtml(footerNote)}<br />` : ""}
                SafeRent Technologies · This is an automated security message. Never share this email with anyone.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buttonHtml(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#F97316;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;">${escapeHtml(label)}</a></p>`;
}
