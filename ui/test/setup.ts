import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Every test renders into a fresh document. One hook, in this order: unmount first,
// while the globals a component cleans up through (`chrome`, `fetch`) are still
// stubbed; then put the globals back (a test may have stubbed `window` itself) before
// resetting the page's storage and address.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
});
