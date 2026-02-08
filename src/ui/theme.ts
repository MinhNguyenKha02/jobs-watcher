export const theme = {
  border: '#38bdf8',
  header: '#a78bfa',
  label: '#f59e0b',
  accent: '#22c55e',
  link: '#60a5fa',
  muted: '#94a3b8',
  warning: '#fbbf24',
  danger: '#f87171',
};

export function scoreColor(score: number): string {
  if (score >= 3) return '#22c55e';
  if (score >= 1) return '#f59e0b';
  return '#f87171';
}

export function decisionColor(decision: string): string {
  return decision.startsWith('apply') ? '#22c55e' : '#f59e0b';
}
