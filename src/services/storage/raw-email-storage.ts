import fs from 'fs';
import path from 'path';

export interface RawEmailEntry {
  messageId: string;
  from: string;
  subject: string;
  body?: string;
  baseDirOverride?: string;
}

export class RawEmailStorage {
  private baseDir: string;

  constructor(baseDirOverride?: string) {
    this.baseDir = RawEmailStorage.resolveBaseDir(baseDirOverride);
  }

  static resolveBaseDir(baseDirOverride?: string): string {
    if (baseDirOverride && baseDirOverride.trim().length > 0) {
      return baseDirOverride;
    }

    if (process.env.RAW_EMAIL_LOG_DIR && process.env.RAW_EMAIL_LOG_DIR.trim().length > 0) {
      return process.env.RAW_EMAIL_LOG_DIR;
    }

    return path.join(process.cwd(), 'src', 'db', 'emails');
  }

  append(entry: RawEmailEntry): { jsonlFile: string; bodyFile: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const baseDir = entry.baseDirOverride
      ? RawEmailStorage.resolveBaseDir(entry.baseDirOverride)
      : this.baseDir;
    const dir = path.join(baseDir, `${year}-${month}`, day);
    const jsonlFile = path.join(dir, 'raw-emails.jsonl');
    const bodyFile = path.join(dir, `${entry.messageId}.body.txt`);

    const record = {
      timestamp: new Date().toISOString(),
      messageId: entry.messageId,
      from: entry.from,
      subject: entry.subject,
    };

    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(jsonlFile, JSON.stringify(record) + '\n', 'utf-8');
    fs.writeFileSync(bodyFile, entry.body ?? '', 'utf-8');

    return { jsonlFile, bodyFile };
  }

  cleanupOldEmails(baseDirOverride?: string): string[] {
    const baseDir = baseDirOverride ? RawEmailStorage.resolveBaseDir(baseDirOverride) : this.baseDir;
    const deleted: string[] = [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const monthDirs = fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : [];
    for (const monthDir of monthDirs) {
      const monthPath = path.join(baseDir, monthDir);
      if (!fs.statSync(monthPath).isDirectory()) continue;

      const [year, month] = monthDir.split('-').map(Number);
      if (!year || !month) continue;

      const dayDirs = fs.readdirSync(monthPath);
      for (const dayDir of dayDirs) {
        const dayPath = path.join(monthPath, dayDir);
        if (!fs.statSync(dayPath).isDirectory()) continue;

        const day = Number(dayDir);
        if (!day || day < 1 || day > 31) continue;

        const checkDate = new Date(year, month - 1, day);
        if (checkDate < thirtyDaysAgo) {
          fs.rmSync(dayPath, { recursive: true, force: true });
          deleted.push(`${monthDir}/${dayDir}`);
        }
      }

      const remaining = fs.readdirSync(monthPath);
      if (remaining.length === 0) {
        fs.rmSync(monthPath, { recursive: true, force: true });
      }
    }

    return deleted;
  }
}
