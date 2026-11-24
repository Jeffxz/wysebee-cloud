/**
 * What the desktop's shell does for its page, on the web: nothing of its own. A link opens
 * in a new tab (the page's own `window.open`, when `openExternal` says it did not). The
 * same seam as the desktop's platform.ts, so the screens ported from it read the same.
 */
export const platform = {
  /** False: the page opens it itself. */
  openExternal: async (_url: string): Promise<boolean> => false,
};

export default platform;
