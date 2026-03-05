import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const e2eOutputDir = path.join(projectRoot, 'src', 'db', 'e2e-output');

export function getE2EOutputDir(): string {
  return e2eOutputDir;
}

export function ensureE2EOutputDir(): string {
  if (!fs.existsSync(e2eOutputDir)) {
    fs.mkdirSync(e2eOutputDir, { recursive: true });
  }
  return e2eOutputDir;
}

export function getE2EOutputDirRelativeToRoot(): string {
  return path.relative(projectRoot, e2eOutputDir) || 'src/db/e2e-output';
}
