import fs from 'node:fs/promises';
import path from 'node:path';

import { ARTIFACT_OUTPUT_DIR } from '../constants/artifact.constants.js';

export async function ensureArtifactDirectory() {
  await fs.mkdir(ARTIFACT_OUTPUT_DIR, {
    recursive: true,
  });
}

export async function writeArtifactFile(filename: string, data: unknown) {
  await fs.writeFile(
    path.join(ARTIFACT_OUTPUT_DIR, filename),

    JSON.stringify(data, null, 2),

    'utf8'
  );
}

export async function readArtifactFile<T>(filename: string): Promise<T> {
  const raw = await fs.readFile(path.join(ARTIFACT_OUTPUT_DIR, filename), 'utf8');

  return JSON.parse(raw) as T;
}
