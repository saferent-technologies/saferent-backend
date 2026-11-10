/** a****@saferenttechnologies.com */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "****";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}****@${domain}`;
}

/** +91******3210 */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return "****";
  return `${phone.slice(0, 3)}${"*".repeat(phone.length - 7)}${phone.slice(-4)}`;
}
