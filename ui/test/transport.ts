import { beforeEach, vi } from "vitest";
import { cloudHost } from "../app/src/cloud/host";

/**
 * For a test file of screens: their admin API requests go to `fetch` — answered by
 * test/fetch.ts `mockFetch` — instead of the in-browser gateway over wysebee-cloud
 * (cloud/router.ts, tested on its own).
 */
export function useFetchTransport() {
  beforeEach(() => {
    vi.spyOn(cloudHost, "request").mockImplementation((method, path, body) =>
      fetch(path, {
        method,
        body,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      }),
    );
  });
}
