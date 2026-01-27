import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { Job, ParsedEmail } from '../types.js';
import { randomUUID } from 'crypto';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        email_id TEXT UNIQUE NOT NULL,
        subject TEXT NOT NULL,
        from_email TEXT NOT NULL,
        platform TEXT NOT NULL,
        company TEXT,
        position TEXT,
        location TEXT,
        description TEXT,
        url TEXT,
        raw_content TEXT NOT NULL,
        received_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'applied', 'skipped')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_platform ON jobs(platform);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    `);

    console.log('✅ Database initialized');
  }

  createJob(data: ParsedEmail & { status: 'queued' | 'applied' | 'skipped' }): Job {
    const now = new Date().toISOString();
    const id = randomUUID();

    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, email_id, subject, from_email, platform, company, position,
        location, description, url, raw_content, received_at, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.emailId,
      data.subject,
      data.from,
      data.platform,
      data.company || null,
      data.position || null,
      data.location || null,
      data.description || null,
      data.url || null,
      data.rawContent,
      data.receivedAt.toISOString(),
      data.status,
      now,
      now
    );

    return this.getJob(id)!;
  }

  getJob(id: string): Job | null {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToJob(row);
  }

  getJobByEmailId(emailId: string): Job | null {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE email_id = ?');
    const row = stmt.get(emailId) as any;

    if (!row) return null;

    return this.rowToJob(row);
  }

  updateJobStatus(id: string, status: 'queued' | 'applied' | 'skipped'): void {
    const stmt = this.db.prepare(`
      UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?
    `);

    stmt.run(status, new Date().toISOString(), id);
  }

  getJobsByStatus(status: 'queued' | 'applied' | 'skipped'): Job[] {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC');
    const rows = stmt.all(status) as any[];

    return rows.map(row => this.rowToJob(row));
  }

  getAllJobs(): Job[] {
    const stmt = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => this.rowToJob(row));
  }

  getStats() {
    const stmt = this.db.prepare(`
      SELECT
        status,
        COUNT(*) as count
      FROM jobs
      GROUP BY status
    `);

    const rows = stmt.all() as any[];
    const stats: Record<string, number> = {
      queued: 0,
      applied: 0,
      skipped: 0,
    };

    rows.forEach(row => {
      stats[row.status] = row.count;
    });

    return stats;
  }

  private rowToJob(row: any): Job {
    return {
      id: row.id,
      emailId: row.email_id,
      subject: row.subject,
      from: row.from_email,
      platform: row.platform,
      company: row.company,
      position: row.position,
      location: row.location,
      description: row.description,
      url: row.url,
      rawContent: row.raw_content,
      receivedAt: new Date(row.received_at),
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  close(): void {
    this.db.close();
  }
}
