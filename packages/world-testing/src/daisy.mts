import { expect, test, vi } from 'vitest';
import { createFetcher, startServer } from './util.mjs';

/**
 * End-to-end proof of cross-run lineage (rootRunId).
 *
 * `daisyTick(2)` does a step, then starts `daisyTick(1)`, which starts
 * `daisyTick(0)` — a real daisy-chain through the runtime + queue. Each
 * successor is started from inside a run, so it should inherit the root's
 * lineage id. The whole chain must then be listable as one unit via
 * `runs.list({ rootRunId })`.
 */
export function daisy(world: string) {
  test('daisy-chain runs share one rootRunId', { timeout: 30_000 }, async () => {
    const server = await startServer({ world }).then(createFetcher);

    const { runId: rootRunId } = await server.invoke(
      'workflows/daisy.ts',
      'daisyTick',
      [2]
    );

    // Wait until the full lineage (root + 2 successors = 3 runs) completes.
    const runs = await vi.waitFor(
      async () => {
        const lineage = await server.listRuns(rootRunId);
        expect(lineage.length).toBe(3);
        for (const r of lineage) expect(r.status).toBe('completed');
        return lineage;
      },
      { interval: 200, timeout: 25_000 }
    );

    // Every run in the lineage shares the root's id...
    for (const r of runs) expect(r.rootRunId).toBe(rootRunId);
    // ...and the root's rootRunId is itself.
    expect(runs.find((r) => r.runId === rootRunId)?.rootRunId).toBe(rootRunId);

    // An independent run is its own root and is NOT in the lineage.
    const { runId: otherRunId } = await server.invoke(
      'workflows/daisy.ts',
      'daisyTick',
      [0]
    );
    await vi.waitFor(
      async () => {
        const r = await server.getRun(otherRunId);
        expect(r.status).toBe('completed');
      },
      { interval: 200, timeout: 25_000 }
    );
    const lineage = await server.listRuns(rootRunId);
    expect(lineage.map((r) => r.runId)).not.toContain(otherRunId);
  });
}
