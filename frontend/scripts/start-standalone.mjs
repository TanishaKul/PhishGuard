import { cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const standalone = resolve(root, '.next', 'standalone');
const server = join(standalone, 'server.js');

if (!existsSync(server)) {
  console.error('Standalone build not found. Run `npm run build` first.');
  process.exit(1);
}

const staticSource = resolve(root, '.next', 'static');
if (existsSync(staticSource)) {
  cpSync(staticSource, join(standalone, '.next', 'static'), { recursive: true });
}
const publicSource = resolve(root, 'public');
if (existsSync(publicSource)) {
  cpSync(publicSource, join(standalone, 'public'), { recursive: true });
}

process.env.HOSTNAME ||= '0.0.0.0';
process.chdir(standalone);
await import(pathToFileURL(server).href);
