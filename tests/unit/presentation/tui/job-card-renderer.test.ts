import { describe, it, expect, vi, beforeEach } from 'vitest';

const { JobCardRenderer } =
  await import('../../../../src/presentation/tui/components/JobCardRenderer.js');

describe('JobCardRenderer', () => {
  let renderer: JobCardRenderer;

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
      details: {
        responsibilities: 'Lead development',
        requirements: '5+ years',
        benefits: 'Health insurance',
      },
    };

    it('renders card with job metadata', () => {
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

    it('includes state indicator in header', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
        state: 'DISPLAY',
      });
      expect(output).toContain('[DISPLAY]');
    });

    it('shows SSE/UDS indicators', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).toContain('SSE');
      expect(output).toContain('UDS');
    });

    it('includes action footer with job present', () => {
      const output = renderer.renderCard(fullJob as any, {
        sseConnected: true,
        udsReady: true,
      });
      expect(output).toContain('Actions');
      expect(output).toContain('j=queue');
      expect(output).toContain('d=trash');
    });

    it('renders details sub-fields', () => {
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

    it('renders partial job metadata', () => {
      const output = renderer.renderCard(partialJob as any, {
        sseConnected: true,
        udsReady: false,
        state: 'DISPLAY',
      });
      expect(output).toContain('Partial Co');
      expect(output).toContain('Junior Dev');
    });

    it('shows matchScore 0 for partial jobs', () => {
      const output = renderer.renderCard(partialJob as any, {
        sseConnected: true,
        udsReady: false,
      });
      expect(output).toContain('matchScore');
      expect(output).toContain('0');
    });
  });

  describe('renderCard with null job (waiting/idle)', () => {
    it('shows waiting state in queue mode', () => {
      const output = renderer.renderCard(null, {
        sseConnected: true,
        udsReady: true,
        state: 'IDLE',
        queueMode: true,
      });
      expect(output).toContain('Waiting');
      expect(output).toContain('eval-fetch-and-trigger');
    });

    it('shows direct mode instructions in direct mode', () => {
      const output = renderer.renderCard(null, {
        sseConnected: true,
        udsReady: true,
        state: 'IDLE',
        queueMode: false,
      });
      expect(output).toContain('Direct mode');
      expect(output).toContain('[i] ingest');
    });

    it('shows red UDS indicator when UDS not ready', () => {
      const output = renderer.renderCard(null, {
        sseConnected: true,
        udsReady: false,
        state: 'IDLE',
      });
      expect(output).toMatch(/[✗]/);
    });
  });

  describe('renderCard with action in progress', () => {
    it('shows action status when actionInProgress is set', () => {
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
    it('clamps score at 0', () => {
      const result = (renderer as any).renderScoreBar(-10);
      expect(result).toContain('░');
    });

    it('clamps score at 100', () => {
      const result = (renderer as any).renderScoreBar(110);
      expect(result).toContain('█');
    });
  });

  describe('static renderSample', () => {
    it('produces output without error', () => {
      const output = JobCardRenderer.renderSample();
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(100);
    });
  });
});
