export const CONTACT_EMAIL = "nixus@gmail.com";

export function contactMailto(subject?: string): string {
  if (subject === undefined) return `mailto:${CONTACT_EMAIL}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
