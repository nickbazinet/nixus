import type { AccountView } from "@/actions/gate";

/** What the header's account pill shows: a short name, initials, and the picture if there is one. */
export interface HeaderIdentity {
  readonly name: string;
  readonly initials: string;
  readonly avatarSrc: string | null;
}

function initial(value: string | null | undefined): string {
  return value?.trim().charAt(0).toUpperCase() ?? "";
}

export function headerIdentity(view: AccountView): HeaderIdentity | null {
  const first = view.profile?.fields.first_name ?? null;
  const last = view.profile?.fields.last_name ?? null;
  const emailName = view.email?.split("@")[0] ?? null;
  const name = first ?? emailName;
  if (name === null || name === "") return null;

  return {
    name,
    initials: first === null ? initial(emailName) : `${initial(first)}${initial(last)}`,
    avatarSrc: view.avatar ? `data:${view.avatar.mime_type};base64,${view.avatar.data}` : null,
  };
}
