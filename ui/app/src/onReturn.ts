import { useEffect } from "react";

/** Calls `onReturn` when the person comes back to the page: the window regains focus, or the
 * tab is shown again — from paying in another tab, say. */
export function useOnReturn(onReturn: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onReturn]);
}
