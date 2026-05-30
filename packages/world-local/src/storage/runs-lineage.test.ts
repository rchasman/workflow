import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SPEC_VERSION_CURRENT, type Storage } from '@workflow/world';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStorage } from '../storage.js';

/**
 * Cross-run lineage via reserved attributes ($rootRunId) in world-local.
 *
 * Proves the RFC headline: lineage is stored as queryable run attributes, not a
 * dedicated column. A daisy-chain (root -> child -> grandchild...) groups under
 * one `$rootRunId`, and `runs.list({ attributes: { $rootRunId } })` returns the whole
 * lineage. Because it rides on attributes, it is also preserved across lifecycle
 * updates for free.
 */
describe('runs lineage attributes — world-local', () => {
  let testDir: string;
  let storage: Storage;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lineage-test-'));
    storage = createStorage(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** Create a run with optional initial attributes. */
  async function createRun(attributes?: Record<string, string>) {
    const result = await storage.events.create(null, {
      eventType: 'run_created',
      specVersion: SPEC_VERSION_CURRENT,
      eventData: {
        deploymentId: 'dpl_test',
        workflowName: 'deliverReminder',
        input: new Uint8Array([1]),
        ...(attributes ? { attributes } : {}),
      },
    });
    if (!result.run) throw new Error('expected run');
    return result.run;
  }

  it('stores initial attributes at creation', async () => {
    const run = await createRun({ $rootRunId: 'wrun_root', tenant: 't1' });
    expect(run.attributes).toEqual({ $rootRunId: 'wrun_root', tenant: 't1' });
  });

  it('groups a daisy-chain of any depth via list({ attributes: { $rootRunId } })', async () => {
    const rootId = 'wrun_root';
    // A chain of ticks all carrying the same root (what start() records as a
    // successor inherits its parent's $rootRunId).
    const tick0 = await createRun({ $rootRunId: rootId });
    const tick1 = await createRun({ $rootRunId: rootId, $parentRunId: tick0.runId });
    const tick2 = await createRun({ $rootRunId: rootId, $parentRunId: tick1.runId });

    // An unrelated lineage running concurrently.
    const other = await createRun({ $rootRunId: 'wrun_other' });

    const lineage = await storage.runs.list({ attributes: { $rootRunId: rootId } });
    const ids = lineage.data.map((r) => r.runId).sort();

    expect(ids).toEqual([tick0.runId, tick1.runId, tick2.runId].sort());
    expect(ids).not.toContain(other.runId);
    for (const run of lineage.data) {
      expect(run.attributes?.$rootRunId).toBe(rootId);
    }
  });

  it('preserves lineage attributes across lifecycle updates', async () => {
    const run = await createRun({ $rootRunId: 'wrun_root' });
    await storage.events.create(run.runId, {
      eventType: 'run_started',
      specVersion: SPEC_VERSION_CURRENT,
    } as any);
    const completed = await storage.events.create(run.runId, {
      eventType: 'run_completed',
      specVersion: SPEC_VERSION_CURRENT,
      eventData: {},
    } as any);
    expect(completed.run?.status).toBe('completed');
    expect(completed.run?.attributes?.$rootRunId).toBe('wrun_root');
  });

  it('composes attribute filter with workflowName', async () => {
    const rootId = 'wrun_scoped';
    await createRun({ $rootRunId: rootId });
    const scoped = await storage.runs.list({
      attributes: { $rootRunId: rootId },
      workflowName: 'deliverReminder',
    });
    expect(scoped.data.length).toBe(1);
    const wrongName = await storage.runs.list({
      attributes: { $rootRunId: rootId },
      workflowName: 'somethingElse',
    });
    expect(wrongName.data.length).toBe(0);
  });
});
