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
  if (score >= 70) return '#22c55e';  // Green: 70%+
  if (score >= 50) return '#f59e0b';  // Amber: 50-69%
  return '#f87171';  // Red: <50%
}

export function decisionColor(decision: string): string {
  return decision.startsWith('apply') ? '#22c55e' : '#f59e0b';
}
