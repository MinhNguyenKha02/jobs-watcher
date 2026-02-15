#!/usr/bin/env tsx
/**
 * Profile Hash Generator
 * 
 * Generates SHA256 hash of canonical profile for immutability tracking.
 * Used to detect profile changes and invalidate cached drafts.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface ProfileHashOutput {
  filePath: string;
  hash: string;
  timestamp: string;
  fileSize: number;
}

/**
 * Generate SHA256 hash for a file
 */
function generateHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: npm run hash:profile <profile-file-path>');
    console.error('Example: npm run hash:profile bored-cv-refinement/json.json');
    process.exit(1);
  }

  const inputPath = args[0];
  const resolvedPath = path.resolve(process.cwd(), inputPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }

  try {
    const hash = generateHash(resolvedPath);
    const stats = fs.statSync(resolvedPath);

    const output: ProfileHashOutput = {
      filePath: resolvedPath,
      hash,
      timestamp: new Date().toISOString(),
      fileSize: stats.size,
    };

    console.log('✅ Profile Hash Generated\n');
    console.log(`File: ${output.filePath}`);
    console.log(`SHA256: ${output.hash}`);
    console.log(`Size: ${output.fileSize} bytes`);
    console.log(`Generated: ${output.timestamp}`);

    // Write to hash file
    const hashFilePath = `${resolvedPath}.hash.json`;
    fs.writeFileSync(hashFilePath, JSON.stringify(output, null, 2));
    console.log(`\n📝 Hash saved to: ${hashFilePath}`);
  } catch (error) {
    console.error('Error generating hash:', error);
    process.exit(1);
  }
}

main();
