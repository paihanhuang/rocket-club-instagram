/**
 * A `Generate` that tries one harness and, only when that harness is missing
 * or out of time, tries another. Any other error is the model's answer and is
 * not hidden. The writer's retry-on-invalid-JSON sits above this, unchanged.
 */
import type { Generate } from "../../newsroom/ports.js";
import { ModelTimeoutError, ModelUnavailableError } from "../errors.js";

export function withFallback(
  primary: Generate,
  fallback: Generate,
  onFallback?: (error: ModelUnavailableError | ModelTimeoutError) => void,
): Generate {
  return async (request) => {
    try {
      return await primary(request);
    } catch (error) {
      if (error instanceof ModelUnavailableError || error instanceof ModelTimeoutError) {
        onFallback?.(error);
        return fallback(request);
      }
      throw error;
    }
  };
}
