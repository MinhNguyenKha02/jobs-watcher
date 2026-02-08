import { spawn } from 'child_process';

export function openUrlInBrowser(url: string): void {
  if (!url) return;
  
  const command = process.platform === 'darwin' ? 'open' : 
                 process.platform === 'win32' ? 'start' : 
                 'xdg-open';
  
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  
  // Add https:// if missing
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  
  return trimmed;
}
