import { useEffect, useState } from "react";
import type { User } from "oidc-client-ts";
import { LogIn } from "lucide-react";
import { loadConfig } from "./config";
import { identify, initAnalytics, track, trackPage } from "./analytics";
import { CALLBACK_PATH, type SignInState, completeSignIn, currentUser, initAuth, intentOf, signIn } from "./auth";

/** Where a signed-in person goes: the web app with their cloud tasks. */
const APP_PATH = "/app/";

type Phase = "loading" | "ready";

const primaryButton =
  "inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900";

/**
 * The site's front page (2026-10-31): signed in, on to the web app; **not signed in, straight
 * to Auth0's sign-in page** (`?signup` for its sign-up form) — no page of our own first. Its
 * card shows only when sign-in is not set up here, or the person came back from Auth0 without
 * signing in (cancelled, or failed), with Sign in and Create an account to try again.
 */
export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [authEnabled, setAuthEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const config = await loadConfig();
      initAnalytics(config.analytics.enabled);
      const manager = initAuth(config);
      if (cancelled) return;
      setAuthEnabled(manager !== null);

      let signedIn: User | null = null;
      // Back from Auth0 without signing in (cancelled, or failed): this page stays, with its
      // buttons — sending them straight back would loop.
      let returned = false;
      if (manager && window.location.pathname === CALLBACK_PATH) {
        // Back from Auth0: finish, then drop the code from the address bar.
        try {
          signedIn = await completeSignIn();
          const intent = (signedIn.state as SignInState | undefined)?.intent ?? "sign_in";
          identify(signedIn.access_token);
          track(intent === "sign_up" ? "Signed Up" : "Signed In");
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          setError(reason.includes("access_denied") ? null : "Sign-in didn't finish. Please try again.");
          track("Sign In Failed", { cancelled: reason.includes("access_denied") });
          returned = true;
        }
        window.history.replaceState(null, "", "/");
      } else if (manager) {
        signedIn = await currentUser();
      }
      if (cancelled) return;
      if (signedIn) {
        // Signed in: straight to the agents. /app/ reads the same stored sign-in.
        // replace(), so Back does not return here only to be sent on again.
        window.location.replace(APP_PATH);
        return;
      }
      if (manager && !returned) {
        // Not signed in: straight to Auth0's page — this one has nothing else to offer.
        const intent = intentOf(window.location.search);
        track("Sign In Started", { intent, automatic: true });
        void signIn(intent, { replace: true });
        return;
      }
      trackPage();
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startSignIn = (intent: SignInState["intent"]) => {
    track(intent === "sign_up" ? "Sign Up Clicked" : "Sign In Clicked");
    void signIn(intent);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <a href="/" aria-label="Wysebee Cloud home">
          <img src="/wysebee-wordmark.png" alt="Wysebee" className="h-8 w-auto" />
        </a>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
          >
            {error}
          </div>
        )}
        {phase === "ready" && (
          <section className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white px-6 py-8 shadow-sm dark:border-stone-700 dark:bg-stone-800">
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">Sign in to Wysebee Cloud</h1>
            <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
              See and edit your tasks from anywhere.
            </p>
            {authEnabled ? (
              <>
                <button
                  type="button"
                  className={`${primaryButton} w-full justify-center py-2.5 text-base`}
                  onClick={() => startSignIn("sign_in")}
                >
                  <LogIn className="h-4 w-4" aria-hidden />
                  Sign in
                </button>
                <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">
                  New to Wysebee?{" "}
                  <button
                    type="button"
                    className="font-medium text-primary-600 hover:underline dark:text-primary-400"
                    onClick={() => startSignIn("sign_up")}
                  >
                    Create an account
                  </button>
                </p>
              </>
            ) : (
              <p role="status" className="text-sm text-stone-600 dark:text-stone-400">
                Sign-in isn't available right now. Please try again later.
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
