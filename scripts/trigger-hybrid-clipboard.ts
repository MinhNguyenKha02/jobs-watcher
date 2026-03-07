import fs from 'fs';
import path from 'path';

const pidFilePath = path.join(process.cwd(), 'logs', 'data-listening.pid');

function main() {
  if (!fs.existsSync(pidFilePath)) {
    console.error(`[clipboard:trigger] Missing PID file: ${pidFilePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(pidFilePath, 'utf-8').trim();
  const pid = Number.parseInt(content, 10);
  if (Number.isNaN(pid) || pid <= 0) {
    console.error(`[clipboard:trigger] Invalid PID in file: ${content}`);
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGUSR1');
    console.log(`[clipboard:trigger] Sent SIGUSR1 to data-listening service PID ${pid}`);
  } catch (error) {
    console.error(
      `[clipboard:trigger] Failed to signal PID ${pid}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

main();
