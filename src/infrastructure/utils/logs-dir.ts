import path from 'node:path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');

export function getLogsDir(): string {
  return path.join(projectRoot, 'logs');
}
