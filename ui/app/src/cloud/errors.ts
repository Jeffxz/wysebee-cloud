/** A refusal from Wysebee Cloud: its status and its detail (a string or `{code, message}`),
 * and the `code` it sent beside a sentence (`{"detail": "…", "code": "…"}`, the browser
 * links'). */
export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    readonly code?: string,
    /** What else the refusal said beside its sentence and code (a taken name's `agent`). */
    readonly more: Record<string, unknown> = {},
  ) {
    super(
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string"
          ? (detail as { message: string }).message
          : `Wysebee Cloud answered ${status}`,
    );
  }
}
