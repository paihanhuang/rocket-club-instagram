/**
 * The writer's failure vocabulary. These three are part of its interface: a
 * caller can tell "the model is not there" from "the model was too slow" from
 * "the model answered, twice, and both answers were unusable".
 */

/** One rejected answer: what the model said and why the schema refused it. */
export type DraftAttempt = { raw: string; issues: unknown[] };

/** Both attempts failed validation. `attempts` carries the raw text and the zod issues. */
export class DraftInvalidError extends Error {
  readonly attempts: DraftAttempt[];

  constructor(attempts: DraftAttempt[], message?: string) {
    const last = attempts[attempts.length - 1];
    super(
      message ??
        `The model returned invalid draft text ${attempts.length} time(s). ` +
          `Last issues: ${JSON.stringify(last?.issues ?? [])}`,
    );
    this.name = "DraftInvalidError";
    this.attempts = attempts;
  }
}

/** The harness or the server is not reachable at all (no binary, connection refused). */
export class ModelUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ModelUnavailableError";
  }
}

/** The wall-time budget ran out before an answer arrived. */
export class ModelTimeoutError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ModelTimeoutError";
  }
}
