import { useSyncExternalStore } from "react";
import { currentProfile } from "./cloud/auth";

/**
 * Who is signed in, as the desktop's account store answers it — on the web, the person
 * the page signed in as (cloud/auth.ts), read once. Home's rows name them by it.
 */
export interface AccountStatus {
  signed_in: boolean;
  username: string;
  email: string;
  name: string;
}

export interface AccountState {
  status: AccountStatus | null;
}

let state: AccountState = { status: null };
let started = false;
const listeners = new Set<() => void>();

/** Read who is signed in (again). */
export async function refreshAccount(): Promise<void> {
  started = true;
  const p = await currentProfile();
  state = { status: p ? { signed_in: true, username: "", email: p.email, name: p.name } : { signed_in: false, username: "", email: "", name: "" } };
  listeners.forEach((l) => l());
}

/** Read who is signed in, once. */
export async function loadAccount(): Promise<void> {
  if (!started) await refreshAccount();
}

export function useAccount(): AccountState {
  void loadAccount();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
