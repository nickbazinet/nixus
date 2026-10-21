import { HardDrive, KeyRound, Code2, MonitorDown, type LucideIcon } from "lucide-react";

/**
 * Trust claims for `<TrustStrip />`.
 *
 * This section occupies the slot where every competitor puts social proof —
 * star ratings, review counts, press logos. Nixus is pre-alpha and has none of
 * that, and inventing it would undermine the one thing the product is actually
 * selling. So the slot carries four claims that are verifiable today instead:
 * where the data lives, what Nixus never asks for, that the code is readable,
 * and which platforms ship. Each one is checkable by the visitor, which is a
 * stronger trust signal for this audience than a number they cannot audit.
 *
 * Replace this file's contents with real social proof only when it exists.
 */

export type TrustClaimId = "local" | "noLogins" | "openSource" | "platforms";

export type TrustClaim = {
  readonly id: TrustClaimId;
  readonly icon: LucideIcon;
};

export const trustClaims: readonly TrustClaim[] = [
  { id: "local", icon: HardDrive },
  { id: "noLogins", icon: KeyRound },
  { id: "openSource", icon: Code2 },
  { id: "platforms", icon: MonitorDown },
] as const;
