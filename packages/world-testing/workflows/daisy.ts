import { start } from 'workflow/api';

async function noop(): Promise<void> {
  'use step';
}

/**
 * Daisy-chain fixture: each tick does a trivial step, then starts its own
 * successor via `start()`. This is the imperative-cron / durable daisy-chain
 * pattern. Every successor is started from *inside* a run, so it should inherit
 * the root's lineage id — producing N runs that all share one `rootRunId`.
 */
export async function daisyTick(remaining: number): Promise<string> {
  'use workflow';

  await noop();

  if (remaining > 0) {
    const next = await start(daisyTick, [remaining - 1]);
    return next.runId;
  }

  return 'done';
}
