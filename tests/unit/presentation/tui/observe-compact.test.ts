import { describe, it, expect } from 'vitest';

import { renderObserveCompactPane } from '../../../../src/presentation/tui/components/ObserveCompactPane.js';

describe('ObserveCompactPane 4-line compact', () => {
  it('GIVEN JSON with jobsBrokeredTotal WHEN render 64w THEN contains brokered', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          jobsBrokeredTotal: [{ labels: { source: 'browser-auto' }, value: 12 }],
          jobStageTotal: [{ labels: { stage: 's1', status: 'enriching' }, value: 3 }],
          jobErrorsTotal: [{ labels: { stage: 's1', errorType: 'extraction' }, value: 1 }],
          jobsInFlight: [{ labels: { stage: 's1' }, value: 1 }],
        },
      } as any,
      64
    );
    expect(frame).toContain('jobs_brokered:12');
  });
});
