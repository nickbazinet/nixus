import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { queryKeys } from "@/lib/constants";
import { parseAppError } from "@/lib/appError";
import { clearProfileScopedState } from "@/lib/datasetSwitch";
import { useActiveProfile } from "@/hooks/useDatasets";
import type { AuthState } from "@/lib/types";

/**
 * What the completed sign-in should do locally, mirroring Rust's internally-tagged
 * `LoginIntent`. Both entry points run the identical Cognito flow — only the
 * post-callback branch differs — so this is the whole difference between them.
 *
 * `source_dataset_id` is the only value either entry point sends, and it is a
 * local dataset id: no financial, car, or profile data crosses this boundary.
 */
export type LoginIntent =
  | { kind: "Login" }
  | { kind: "Migrate"; source_dataset_id: string };

/** Mirrors `ai::hosted_state::CACHE_TTL`, which is what actually bounds a status re-read. */
const HOSTED_AI_STATUS_TTL_MS = 5 * 60 * 1000;

/**
 * The session read itself, split from the hook so a second reader can share the cache entry without
 * also registering a second `auth:callback-received` listener. Two listeners would each invalidate
 * on every callback — harmless but duplicated, and the kind of thing that quietly doubles again.
 */
function authSessionQueryOptions(enabled: boolean) {
  return {
    queryKey: queryKeys.auth.session,
    queryFn: () => invoke<AuthState>("get_auth_session"),
    enabled,
    // get_auth_session performs the Cognito refresh POST when the stored token has
    // expired, so a stale entry would re-POST on every window focus and reconnect.
    staleTime: Infinity,
  };
}

/**
 * Reads the machine-wide Cognito session and keeps every reader of it fresh.
 *
 * `enabled` gates the query and nothing else. It exists for the always-mounted account menu, which
 * may not read the session while a *local* profile is open — that read opens the OS secure store
 * and can POST a Cognito refresh for a profile that has no account at all. The callback listener
 * stays registered while disabled, so a cloud sign-in completed elsewhere still invalidates the
 * caches this hook owns.
 */
export function useAuthSession({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlisten = await listen("auth:callback-received", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
        // The callback may have landed on a different dataset (Story 35.2) or a
        // brand-new one (Story 35.3), and the signed-in badge is derived from the
        // pair, so the active profile is re-read alongside the session.
        queryClient.invalidateQueries({ queryKey: queryKeys.activeProfile });
        // `removeQueries`, never `invalidateQueries`: invalidation keeps the
        // previous account's profile rendered while refetching, which is a
        // visible cross-account leak.
        queryClient.removeQueries({ queryKey: queryKeys.profile });
        queryClient.removeQueries({
          queryKey: queryKeys.tfsaAccumulatedLimit,
        });
        // Same reasoning: an invalidated `true` keeps a Premium badge on screen
        // under the account that just signed in, which may not be entitled to it.
        queryClient.removeQueries({ queryKey: queryKeys.cloudAiPremium });
      });

      if (cleaned) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    };

    setup();

    return () => {
      cleaned = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [queryClient]);

  return useQuery(authSessionQueryOptions(enabled));
}

/**
 * Whether the signed-in cloud account carries hosted-AI premium access — the one boolean Rust will
 * answer with. The request limit, the charged count and the period stay Rust-internal, so no surface
 * built on this can grow into a usage display.
 *
 * `enabled` is the whole gate and is the caller's to supply, for the same reason `useAuthSession`'s
 * is: the command resolves a call-time Cognito token, so reading it under a local profile would open
 * the OS secure store for a profile that has no account at all.
 *
 * Rust answers fail-closed, so there is no error state to render — `data === true` is the only thing
 * that may make a premium claim, and every other outcome is the same silent non-claim.
 *
 * `staleTime` matches Rust's own status TTL: shorter would only add IPC round-trips that resolve
 * from that same cache, each one re-opening the keyring to mint a call-time token.
 *
 * `retry: false` for the same cost reason, and because there is nothing to retry *for*: Rust already
 * answers fail-closed, so a rejection is a local IPC fault rather than a transient upstream one, and
 * TanStack's default three attempts would re-open the OS secure store on each.
 */
export function useCloudAiPremium({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.cloudAiPremium,
    queryFn: () => invoke<boolean>("get_cloud_ai_premium"),
    enabled,
    staleTime: HOSTED_AI_STATUS_TTL_MS,
    retry: false,
  });
}

/**
 * The entitlement answer plus whether it is an answer yet.
 *
 * `resolving` exists because `premium: false` is two different facts wearing one boolean: "this
 * account is not entitled" and "nobody has asked yet". Collapsing them made a premium user's first
 * paint indistinguishable from a non-premium one, so availability gates briefly rendered
 * personal-key setup UI at accounts that need no key — and, on Project Advice, accepted a click and
 * discarded it.
 *
 * Still no quota figure: the limit, the charged count and the period stay Rust-internal (AD-9). This
 * carries the same one boolean plus a local render-state flag that never crosses IPC.
 */
export interface PremiumEntitlementState {
  /** Fail-closed: only `true` may make a premium claim. */
  readonly premium: boolean;
  /** No decision yet. Never render a "not premium" consequence while this is true. */
  readonly resolving: boolean;
}

/**
 * Whether a premium indicator may render right now — the single derivation of that answer, shared by
 * every surface that shows one.
 *
 * Shared rather than duplicated because the entitlement now paints in two places. Two components
 * each assembling `profile -> session -> entitlement` is two chances to disagree, and the
 * disagreement a reviewer would never spot is the dangerous direction: a gold account icon that keeps
 * claiming premium after the account menu has already stopped claiming it.
 *
 * `is_signed_in` is required on top of the profile kind and the session status, and it is the part
 * that is easy to miss: the session is machine-wide, so a cloud-linked profile plus *somebody* being
 * logged in is not the same claim as this profile's own account being logged in. Rust compares the
 * session's subject to the profile's and answers with that boolean (AD-10), so it is the only local
 * check that closes the subject-mismatch row of the matrix — without it a second cloud profile would
 * show the first one's entitlement.
 *
 * `isLoading`, never `isPending`: a gated query sits at `pending` forever without ever fetching, so
 * `isPending` would report a local profile as permanently undecided. Each link is only counted as
 * resolving while the link before it has actually enabled it.
 *
 * Costs no extra IPC. Every read here is an existing shared query key, so additional callers attach
 * as observers of caches the shell already holds rather than issuing their own commands.
 */
export function usePremiumEntitlementState(): PremiumEntitlementState {
  const profile = useActiveProfile();
  const isEligibleProfile =
    profile.data?.kind === "cloud-linked" && profile.data.is_signed_in;
  const session = useQuery(authSessionQueryOptions(isEligibleProfile));
  const isSessionLoggedIn = session.data?.status === "LoggedIn";
  const premium = useCloudAiPremium({
    enabled: isEligibleProfile && isSessionLoggedIn,
  });

  return {
    premium: premium.data === true,
    resolving:
      profile.isLoading ||
      (isEligibleProfile && session.isLoading) ||
      (isEligibleProfile && isSessionLoggedIn && premium.isLoading),
  };
}

/**
 * The bare fail-closed boolean, for surfaces that only paint a premium indicator and have no
 * "not premium" consequence to get wrong. Readers that gate an action or render setup UI must use
 * `usePremiumEntitlementState` instead, so they can hold off while the answer is still in flight.
 */
export function usePremiumEntitlement(): boolean {
  return usePremiumEntitlementState().premium;
}

/**
 * Which Nixus Cloud page the browser opens on, mirroring Rust's `AuthorizeEntry`.
 *
 * One authorize-URL variant, never a second flow: both entries run the same PKCE
 * attempt, the same loopback listener and the same callback, and differ only in
 * the path segment the Hosted UI lands on.
 */
export type AuthorizeEntry = "SignIn" | "SignUp";

/** The whole payload `start_login` receives: a Hosted UI entry, and what to do with the tokens. */
export interface SignInRequest {
  intent: LoginIntent;
  entry: AuthorizeEntry;
}

/**
 * Starts the one unchanged Cognito flow, carrying the entry and the intent the caller chose.
 *
 * Both are explicit at every call site rather than defaulted here: "log in", "create an account" and
 * "migrate this profile" are different user actions with different outcomes, and a silent default is
 * how the wrong branch — or the wrong Hosted UI page — would ship unnoticed.
 */
export function useSignIn() {
  return useMutation({
    mutationFn: ({ intent, entry }: SignInRequest) =>
      invoke<void>("start_login", { intent, entry }),
  });
}

/**
 * Opens the persisted session's own cloud profile, with no browser round-trip.
 *
 * The counterpart to `useSignIn`, not a variant of it: `start_login` leaves the app and resolves
 * minutes later through the loopback callback, whereas this completes inside the click. Rust
 * re-resolves the stored session, resolves the identity from its id token, and find-or-creates,
 * activates and latches the picker gate on the matching cloud-linked dataset — so this mutation
 * sends no argument at all, and the Cognito subject never crosses IPC in either direction.
 *
 * `clearProfileScopedState`, never key-by-key invalidation: every cached row and profile-scoped
 * `localStorage` entry belongs to whichever profile was open before this activation, and
 * invalidation would keep serving them while refetching — a cross-account leak rather than a stale
 * render. Swept synchronously here, rather than leaving it to the `dataset:switched` listener, so
 * the previous profile's storage is provably gone before `mutateAsync` resolves and the caller
 * navigates.
 *
 * Navigation and error toasting stay with the caller, matching `selectDatasetMutationOptions`.
 *
 * `onError` re-resolves the session, and **only** for an `auth`-typed rejection. The picker derives
 * its Continue offer from a cached `LoggedIn`, so a session that expires past refresh or is revoked
 * between that render and the click leaves the launch screen's one filled primary offering an account
 * Rust has just refused — a dead end no amount of clicking resolves. Every `AppError::Auth` on this
 * path says the same thing (`continuable_id_token`'s refusal, an unreadable session, a dataset owned
 * by another account): the cached identity is wrong, so it is dropped and re-read.
 *
 * `resetQueries`, not `invalidateQueries`: invalidation keeps the stale `LoggedIn` rendered while it
 * refetches, which is exactly the withdrawn offer staying clickable. Resetting clears it first, so
 * the CTA goes inert for the round-trip and then settles into the browser sign-in composition.
 *
 * A non-auth rejection deliberately leaves the cache alone. The session was never in question, so
 * Continue is still the right action and stays retryable — demoting the screen to a browser sign-in
 * would send the user through an OAuth round-trip to fix a local fault about their profile.
 *
 * Split out of the hook for the same reason its dataset sibling is: the picker unmounts on
 * navigation, which makes the sweep unobservable from an E2E test, so it is only assertable against
 * a real QueryClient.
 */
export function continueCloudSessionMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: () => invoke<void>("continue_cloud_session"),
    onSuccess: () => clearProfileScopedState(queryClient),
    onError: (error: unknown) => {
      if (parseAppError(error).type !== "auth") return;
      void queryClient.resetQueries({ queryKey: queryKeys.auth.session });
    },
  };
}

export function useContinueCloudSession() {
  return useMutation(continueCloudSessionMutationOptions(useQueryClient()));
}

/**
 * `clearProfileScopedState` — the canonical switch sweep — rather than key-by-key invalidation: the
 * profile that was open is no longer authorized to be open, so every cached row and profile-scoped
 * `localStorage` entry belongs to an account that has just left, and invalidation would keep serving
 * them while refetching.
 *
 * Swept strictly before the navigation, which is what leaves `/profile` rather than replacing its
 * content in place. Rust's `sign_out` re-arms the launch-picker gate, so `/picker` is the only
 * destination the root `beforeLoad` will hold; a navigation that cannot complete still leaves nothing
 * of the signed-out account behind.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => invoke<void>("sign_out"),
    onSuccess: async () => {
      clearProfileScopedState(queryClient);
      await navigate({ to: "/picker" });
    },
  });
}
