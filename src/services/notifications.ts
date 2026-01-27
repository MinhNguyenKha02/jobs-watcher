import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface Notification {
  title: string;
  message: string;
  urgency?: 'low' | 'normal' | 'high';
}

/**
 * Cross-platform system notifications
 * Works on Linux (notify-send), macOS (osascript), Windows (powershell)
 */
export async function notifyUser(notification: Notification): Promise<void> {
  const { title, message, urgency = 'normal' } = notification;

  try {
    const platform = process.platform;

    if (platform === 'linux') {
      // Linux: use notify-send
      const urgencyFlag = `--urgency=${urgency}`;
      const cmd = `notify-send "${title}" "${message}" ${urgencyFlag} --icon=dialog-information`;
      execSync(cmd, { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      // macOS: use osascript
      const cmd = `osascript -e 'display notification "${message}" with title "${title}"'`;
      execSync(cmd, { stdio: 'ignore' });
    } else if (platform === 'win32') {
      // Windows: use PowerShell
      const psCmd = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">${title}</text>
            <text id="2">${message}</text>
        </binding>
    </visual>
</toast>"@; $toast = New-Object Windows.UI.Notifications.ToastNotification $template; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Jobs Watcher").Show($toast)`;
      
      execSync(`powershell -Command "${psCmd}"`, { stdio: 'ignore' });
    }

    console.log(`🔔 Notification: ${title}`);
  } catch (error) {
    // Silently fail if notification system not available
    console.debug('Notification not sent (system not available)');
  }
}

/**
 * Log job action to monitoring file
 * Use for local monitoring and improvements
 */
export function logAction(action: {
  timestamp: Date;
  jobId: string;
  company: string;
  position: string;
  action: 'apply' | 'skip' | 'queue';
  matchScore?: number;
  generatedPath?: string;
}): void {
  const logDir = path.join(process.cwd(), 'logs');
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, `actions-${new Date().toISOString().split('T')[0]}.jsonl`);
  const logEntry = JSON.stringify(action) + '\n';

  fs.appendFileSync(logFile, logEntry);
}

/**
 * Get monitoring stats from logs
 */
export function getMonitoringStats(): {
  totalProcessed: number;
  applied: number;
  skipped: number;
  queued: number;
  averageMatchScore: number;
} {
  const logDir = path.join(process.cwd(), 'logs');
  
  if (!fs.existsSync(logDir)) {
    return {
      totalProcessed: 0,
      applied: 0,
      skipped: 0,
      queued: 0,
      averageMatchScore: 0,
    };
  }

  const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl'));
  let applied = 0;
  let skipped = 0;
  let queued = 0;
  let totalScore = 0;
  let scoreCount = 0;

  logFiles.forEach(file => {
    const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
    const lines = content.trim().split('\n');

    lines.forEach(line => {
      try {
        const entry = JSON.parse(line);
        if (entry.action === 'apply') applied++;
        if (entry.action === 'skip') skipped++;
        if (entry.action === 'queue') queued++;
        if (entry.matchScore) {
          totalScore += entry.matchScore;
          scoreCount++;
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    });
  });

  const totalProcessed = applied + skipped + queued;

  return {
    totalProcessed,
    applied,
    skipped,
    queued,
    averageMatchScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
  };
}
