import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contextStorage } from '../step/context-storage.js';
import { start } from './start.js';
import { setWorld } from './world.js';

// Mock @vercel/functions + telemetry the same way start.test.ts does.
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('../telemetry.js', () => ({
  serializeTraceCarrier: vi.fn().mockResolvedValue({}),
  trace: vi.fn((_name: string, fn: any) => fn(undefined)),
}));

/**
 * Cross-run lineage via reserved attributes ($rootRunId / $parentRunId).
 *
 * Proves the RFC claim: start() derives a lineage from ambient run context and
 * records it as queryable run attributes, so a daisy-chain / fan-out groups
 * under one root — answering "can start() cheaply propagate run context?" with:
 * yes, via the existing step AsyncLocalStorage.
 */
describe('start() lineage attributes', () => {
  let eventsCreate: ReturnType<typeof vi.fn>;
  let runsGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    eventsCreate = vi.fn().mockImplementation((runId) =>
      Promise.resolve({ run: { runId: runId ?? 'wrun_x', status: 'pending' } })
    );
    runsGet = vi.fn();

    setWorld({
      getDeploymentId: vi.fn().mockResolvedValue('deploy_123'),
      events: { create: eventsCreate },
      runs: { get: runsGet },
      queue: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  afterEach(() => {
    setWorld(undefined);
    vi.clearAllMocks();
  });

  const wf = (id: string) =>
    Object.assign(() => Promise.resolve('ok'), { workflowId: id });

  function attrsFromCall(): Record<string, string> {
    const [, event] = eventsCreate.mock.calls[0];
    return event.eventData.attributes;
  }
  function runIdFromCall(): string {
    return eventsCreate.mock.calls[0][0];
  }

  /** Run a function as if executing inside a parent run's step context. */
  function insideRun<T>(parentRunId: string, fn: () => Promise<T>): Promise<T> {
    return contextStorage.run(
      {
        stepMetadata: {
          stepName: 'start',
          stepId: 'step_1',
          stepStartedAt: new Date(),
          attempt: 1,
        },
        workflowMetadata: {
          workflowName: 'parent',
          workflowRunId: parentRunId,
          workflowStartedAt: new Date(),
          url: 'http://localhost:3000',
          features: { encryption: false },
        },
        ops: [],
      },
      fn
    );
  }

  it('a run started outside any run is its own root ($rootRunId === runId, no parent)', async () => {
    await start(wf('test-workflow'), []);

    expect(attrsFromCall()).toEqual({ $rootRunId: runIdFromCall() });
    expect(runsGet).not.toHaveBeenCalled();
  });

  it('a child inherits the parent run’s $rootRunId (deep chains stay flat) and records $parentRunId', async () => {
    // Parent 'wrun_child' is itself in a lineage rooted at 'wrun_root'.
    runsGet.mockResolvedValue({
      runId: 'wrun_child',
      attributes: { $rootRunId: 'wrun_root' },
    });

    await insideRun('wrun_child', () => start(wf('child-workflow'), []));

    expect(runsGet).toHaveBeenCalledWith('wrun_child', { resolveData: 'none' });
    expect(attrsFromCall()).toEqual({
      $rootRunId: 'wrun_root',
      $parentRunId: 'wrun_child',
    });
  });

  it('anchors the lineage to the parent when the parent has no $rootRunId yet', async () => {
    runsGet.mockResolvedValue({ runId: 'wrun_parent', attributes: {} });

    await insideRun('wrun_parent', () => start(wf('child-workflow'), []));

    expect(attrsFromCall()).toEqual({
      $rootRunId: 'wrun_parent',
      $parentRunId: 'wrun_parent',
    });
  });

  it('merges caller-provided attributes over the inferred lineage', async () => {
    await start(wf('test-workflow'), [], { attributes: { tenant: 't1' } });

    expect(attrsFromCall()).toEqual({
      $rootRunId: runIdFromCall(),
      tenant: 't1',
    });
  });
});
