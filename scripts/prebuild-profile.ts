import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths: generate canonical profile TypeScript from prebuilt JSON
const prebuilt = path.resolve(__dirname, '../bored-cv-refinement/profile.prebuilt.json');
const dest = path.resolve(__dirname, '../src/db/json.ts');

if (!fs.existsSync(prebuilt)) {
  console.error(`[prebuild-profile] Canonical prebuilt file not found: ${prebuilt}`);
  process.exit(1);
}

try {
  // Ensure destination directory exists
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  // Read JSON and emit as TypeScript
  const json = fs.readFileSync(prebuilt, 'utf-8');
  const ts = `// Canonical profile, auto-generated from bored-cv-refinement/profile.prebuilt.json\n// Do not edit by hand. Edit profile.prebuilt.json and run prebuild script.\nexport const canonicalProfile = ${json}\n`;
  fs.writeFileSync(dest, ts, 'utf-8');
  console.log(`[prebuild-profile] Rendered ${prebuilt} → ${dest}`);
} catch (err) {
  console.error(`[prebuild-profile] Error rendering TypeScript:`, err);
  process.exit(1);
}
