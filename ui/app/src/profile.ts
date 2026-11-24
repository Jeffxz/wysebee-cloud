/**
 * The person's profile (`GET`/`PUT /api/v1/profile`, their row in Wysebee Cloud): their name
 * and picture on their messages in Home and on the rail, and the name Wysebee uses. Changed
 * on the Profile page, here or in Wysebee Desktop. A tiny store, as on the desktop.
 */
import { useSyncExternalStore } from "react";
import { fetchProfile, saveProfile, type Profile } from "./api";
import type { AccountStatus } from "./account";

let profile: Profile | null = null;
let loadStarted = false;
const listeners = new Set<() => void>();

function set(next: Profile) {
  profile = next;
  for (const l of listeners) l();
}

/** Read the profile once; later callers share that first read. A failed read (offline)
 * leaves none, and is tried again by `reloadProfile`. */
export function loadProfile(): void {
  if (loadStarted) return;
  loadStarted = true;
  reloadProfile();
}

/** Read it again. */
export function reloadProfile(): void {
  fetchProfile().then(set, () => {});
}

/** Save a change; the store follows the server's answer. Rejects with its error. */
export async function updateProfile(change: { display_name?: string; avatar?: string | null }): Promise<Profile> {
  const next = await saveProfile(change);
  set(next);
  return next;
}

export function useProfile(): Profile | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => profile,
  );
}

/** What the person is called: the name they chose, else their account's name or
 * username; "" when signed out with none. */
export function personNameOf(p: Profile | null, account: AccountStatus | null): string {
  if (p?.display_name) return p.display_name;
  return account?.signed_in ? account.name || account.username : "";
}

