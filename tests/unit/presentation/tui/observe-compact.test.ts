import { describe, it, expect } from 'vitest';

import { renderObserveCompactPane } from '../../../../src/presentation/tui/components/ObserveCompactPane.js';

describe('ObserveCompactPane 4-line compact', () => {
  it('GIVEN JSON with jobs_brokered_total WHEN render 64w THEN contains brokered', () => {
    const frame = renderObserveCompactPane(
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        jobs_brokered_total: 12,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        job_stage_total: 3,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        job_errors_total: 1,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        jobs_in_flight: 1,
      },
      64
    );
    expect(frame).toContain('jobs_brokered:12');
  });
});
