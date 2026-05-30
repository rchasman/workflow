import { WorkflowWorldError } from '@workflow/errors';
import { describe, expect, it } from 'vitest';
import { listWorkflowRuns } from './runs.js';

/**
 * The Vercel world proxies `runs.list` to the platform `/v2/runs` endpoint,
 * which does not yet accept an attributes filter. Rather than forward the
 * filter (silently ignored → every run returned) it must fail loud, so
 * lineage queries like `{ attributes: { $rootRunId } }` don't return wrong data.
 *
 * The guard rejects before any network call, so no request mocking is needed.
 */
describe('listWorkflowRuns — attribute filter guard', () => {
  it('throws when an attributes filter is provided', async () => {
    await expect(
      listWorkflowRuns({ attributes: { $rootRunId: 'wrun_root' } })
    ).rejects.toBeInstanceOf(WorkflowWorldError);
  });

  it('throws with a message pointing at the missing /v2/runs support', async () => {
    await expect(
      listWorkflowRuns({ attributes: { $rootRunId: 'wrun_root' } })
    ).rejects.toThrow(/not supported by the Vercel world yet/);
  });
});
