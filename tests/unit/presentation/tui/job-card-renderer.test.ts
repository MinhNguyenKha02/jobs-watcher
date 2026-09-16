import { describe, it, expect, beforeEach } from 'vitest';

const { JobCardRenderer } =
  await import('../../../../src/presentation/tui/components/JobCardRenderer.js');

describe('JobCardRenderer', () => {
  let renderer: InstanceType<typeof JobCardRenderer>;

  beforeEach(() => {
    renderer = new JobCardRenderer(80, 24);
  });

  describe('renderCard with full job', () => {
    const fullJob = {
      _id: 'job-1',
      company: 'Acme Inc.',
      role: 'Senior Engineer',
      location: 'San Francisco, CA',
      url: 'https://example.com/job/1',
      salary: '$150k',
      matchScore: 85,
      matchedSkills: ['TypeScript', 'Node.js', 'React'],
      details:
        'Responsibilities:\nLead development\n\nRequirements:\n5+ years\n\nBenefits:\nHealth insurance',
    };

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN renders card with job metadata', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
        state: 'DISPLAY',
      });
      expect(output).toContain('Acme Inc.');
      expect(output).toContain('Senior Engineer');
      expect(output).toContain('San Francisco');
      expect(output).toContain('$150k');
    });

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN includes state indicator in header', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
        state: 'DISPLAY',
      });
      expect(output).toContain('[DISPLAY]');
    });

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN shows SSE/UDS indicators', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).toContain('SSE');
      expect(output).toContain('UDS');
    });

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN closes with border and no Actions footer (PB owns labels)', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).not.toContain('Actions');
      expect(output).not.toContain('j=queue');
      expect(output).toMatch(/╚═+╝/);
    });

    it('GIVEN pruned payload WHEN renderer.renderCard THEN url stays in payload but never renders', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).not.toContain('example.com/job/1');
      expect(output).not.toContain('raw:');
      expect(output).not.toContain('gmailMeta');
    });

    it('GIVEN long details WHEN renderer.renderCard THEN wraps in full with zero truncation', () => {
      const longLine = `alpha ${'x'.repeat(200)} omega`;
      const output = renderer.renderCard({ _id: 'job-w', company: 'W', role: 'R', details: longLine } as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).not.toContain('...');
      expect(output).toContain('alpha');
      expect(output).toContain('omega');
      expect(output).toContain('x'.repeat(20));
    });

    it('GIVEN unfiltered payload WHEN renderer.renderCard THEN renders every present field generically', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).toContain('matchScore');
      expect(output).toContain('85');
    });

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN renders details sub-fields', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).toContain('Responsibilities');
      expect(output).toContain('Lead development');
    });
  });

  describe('renderCard with partial job (no details)', () => {
    const partialJob = {
      _id: 'job-2',
      company: 'Partial Co',
      role: 'Junior Dev',
      matchScore: 0,
    };

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN renders partial job metadata', () => {
      const output = renderer.renderCard(partialJob as any, {
        sseConnected: true,
        udsReady: false,
        state: 'DISPLAY',
      });
      expect(output).toContain('Partial Co');
      expect(output).toContain('Junior Dev');
    });

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN shows matchScore 0 for partial jobs', () => {
      const output = renderer.renderCard(partialJob as any, {
        sseConnected: true,
        udsReady: false,
      });
      expect(output).toContain('matchScore');
      expect(output).toContain('0');
    });
  });

  describe('renderCard with null job (waiting/idle)', () => {
    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN shows waiting state in queue mode', () => {
      const output = renderer.renderCard(null, {
        sseConnected: true,
        udsReady: true,
        state: 'IDLE',
        queueMode: true,
      });
      expect(output).toContain('Waiting');
      expect(output).toContain('eval-fetch-and-trigger');
    });

    it('GIVEN JobCardRenderer WHEN renderer.renderCard THEN shows direct mode instructions in direct mode', () => {
      const output = renderer.renderCard(null, {
        sseConnected: true,
        udsReady: true,
        state: 'IDLE',
        queueMode: false,
      });
      expect(output).toContain('Direct mode');
      expect(output).toContain('[i] ingest');
    });

    it('GIVEN UDS not ready WHEN renderer.renderCard THEN shows red UDS indicator', () => {
      const output = renderer.renderCard(null, {
        sseConnected: true,
        udsReady: false,
        state: 'IDLE',
      });
      expect(output).toMatch(/[✗]/);
    });
  });

  describe('renderCard with action in progress', () => {
    it('GIVEN actionInProgress is set WHEN renderer.renderCard THEN shows action status', () => {
      const job = { _id: 'job-3', company: 'ActCo', role: 'Dev' };
      const output = renderer.renderCard(
        job as any,
        {
          sseConnected: true,
          udsReady: true,
        },
        'queuing'
      );
      expect(output).toContain('queuing');
    });
  });

  describe('renderScoreBar', () => {
    it('GIVEN JobCardRenderer WHEN exercised THEN clamps score at 0', () => {
      const result = (renderer as any).renderScoreBar(-10);
      expect(result).toContain('░');
    });

    it('GIVEN JobCardRenderer WHEN exercised THEN clamps score at 100', () => {
      const result = (renderer as any).renderScoreBar(110);
      expect(result).toContain('█');
    });
  });

  describe('static renderSample', () => {
    it('GIVEN JobCardRenderer WHEN JobCardRenderer.renderSample THEN produces output without error', () => {
      const output = JobCardRenderer.renderSample();
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(100);
    });
  });
});
