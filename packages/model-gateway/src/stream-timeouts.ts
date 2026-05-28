export interface ModelProviderStreamTimeouts {
  firstByteMs?: number;
  idleMs?: number;
  maxDurationMs?: number;
}

export interface ResolvedModelProviderStreamTimeouts {
  firstByteMs: number;
  idleMs: number;
  maxDurationMs: number;
}

export interface ModelProviderStreamTimeoutDefaults {
  firstByteMs: number;
  idleMs: number;
  maxDurationMs: number;
}

type StreamTimeoutReason = "first_byte" | "idle" | "max_duration";

export interface ModelProviderStreamTimeoutController {
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
  readonly reason?: StreamTimeoutReason;
  markProgress(): void;
  clear(): void;
}

export function resolveModelProviderStreamTimeouts(
  timeouts: ModelProviderStreamTimeouts | undefined,
  defaults: ModelProviderStreamTimeoutDefaults
): ResolvedModelProviderStreamTimeouts {
  return {
    firstByteMs: resolvePositiveInteger(timeouts?.firstByteMs, defaults.firstByteMs),
    idleMs: resolvePositiveInteger(timeouts?.idleMs, defaults.idleMs),
    maxDurationMs: resolvePositiveInteger(timeouts?.maxDurationMs, defaults.maxDurationMs)
  };
}

export function createModelProviderStreamTimeoutController(
  timeouts: ResolvedModelProviderStreamTimeouts
): ModelProviderStreamTimeoutController {
  const controller = new AbortController();
  let activityTimeout: ReturnType<typeof setTimeout> | undefined;
  let maxDurationTimeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let reason: StreamTimeoutReason | undefined;

  const abortForTimeout = (nextReason: StreamTimeoutReason) => {
    if (controller.signal.aborted) {
      return;
    }
    timedOut = true;
    reason = nextReason;
    controller.abort();
  };

  const scheduleActivityTimeout = (timeoutMs: number, nextReason: StreamTimeoutReason) => {
    if (activityTimeout) {
      clearTimeout(activityTimeout);
    }
    activityTimeout = setTimeout(() => abortForTimeout(nextReason), timeoutMs);
  };

  scheduleActivityTimeout(timeouts.firstByteMs, "first_byte");
  maxDurationTimeout = setTimeout(() => abortForTimeout("max_duration"), timeouts.maxDurationMs);

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    get reason() {
      return reason;
    },
    markProgress() {
      if (!controller.signal.aborted) {
        scheduleActivityTimeout(timeouts.idleMs, "idle");
      }
    },
    clear() {
      if (activityTimeout) {
        clearTimeout(activityTimeout);
      }
      if (maxDurationTimeout) {
        clearTimeout(maxDurationTimeout);
      }
    }
  };
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}
