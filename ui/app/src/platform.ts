/**
 * What the desktop's shell does for its page, on the web: nothing of its own. A link opens
 * in a new tab (the page's own `window.open`, when `openExternal` says it did not), and a
 * picture is downloaded by the page (when `saveBase64` refuses). The same seam as the
 * desktop's platform.ts, so the screens ported from it read the same.
 */
export const platform = {
  /** False: the page opens it itself. */
  openExternal: async (_url: string): Promise<boolean> => false,
  /** Refused: the page downloads it itself. */
  saveBase64: async (_filename: string, _base64: string): Promise<{ saved: boolean; path: string }> => {
    throw new Error("No shell on the web.");
  },
};

export default platform;
