/** Failure of a server run action, already worded for the user; status and reason drive the next step. */
export class RunError extends Error {
  readonly status: number | undefined;
  /** API code such as review_required or speaker_review_required. */
  readonly reason: string | undefined;

  constructor(message: string, status?: number, reason?: string) {
    super(message);
    this.name = 'RunError';
    this.status = status;
    this.reason = reason;
  }

  /** A newer revision or another status on the server: the page must reload the run before retrying. */
  get stale(): boolean {
    return this.status === 409 && !this.reason;
  }
}
