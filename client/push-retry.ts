/** Waits before subscribing again after a failed or closed push subscription (PASEO-0.16-SPEC §3.5), by attempt; the last repeats. */
export const PUSH_RETRY_MS = [5_000, 30_000, 60_000];

export function pushRetryDelay(attempt: number) {
  return PUSH_RETRY_MS[Math.min(attempt, PUSH_RETRY_MS.length - 1)];
}
