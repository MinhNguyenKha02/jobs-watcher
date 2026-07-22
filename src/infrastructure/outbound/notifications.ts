
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

declare global {
  // eslint-disable-next-line no-var
  var __notifyLastSent: Record<string, number> | undefined;
}

export interface Notification {
  title: string;
  message: string;
  urgency?: 'low' | 'normal' | 'high';
  id?: number;
}

/**
 * Cross-platform system notifications
 * Works on Linux (notify-send), macOS (osascript), Windows (powershell)
 */

export async function notifyUser(notification: Notification): Promise<void> {
  const { title, message, urgency = 'normal', id } = notification;
  // In-memory rate-limiting: only one notification per type per second
  if (!globalThis.__notifyLastSent) globalThis.__notifyLastSent = {};
  const notifyKey = id ? `id:${id}` : title;
  const now = Date.now();
  if (globalThis.__notifyLastSent[notifyKey] && now - globalThis.__notifyLastSent[notifyKey] < 1000) {
    return;
  }
  globalThis.__notifyLastSent[notifyKey] = now;

  try {
    const platform = process.platform;
    if (platform === 'linux') {
      // Linux: use notify-send with replacement ID and 6s timeout
      // Use explicit id if provided, else hash of title
      const notifyId = id !== undefined ? id : Math.abs([...title].reduce((acc, c) => acc + c.charCodeAt(0), 0)) % 10000 + 2000;
      const urgencyFlag = `--urgency=${urgency}`;
      const cmd = `notify-send -r ${notifyId} ${urgencyFlag} -t 6000 "${title}" "${message}" --icon=dialog-information`;
      execSync(cmd, { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      // macOS: use osascript
      const cmd = `osascript -e 'display notification "${message}" with title "${title}"'`;
      execSync(cmd, { stdio: 'ignore' });
    }
    // Windows support removed for now
    console.log(`🔔 Notification: ${title}`);
  } catch (error) {
    // Silently fail if notification system not available
    console.debug('Notification not sent (system not available)');
  }
}
