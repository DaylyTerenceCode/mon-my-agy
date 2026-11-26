import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_PLUGIN_DIR = path.join(
  os.homedir(),
  '.gemini',
  'config',
  'plugins',
  'mon-my-agy',
);

const FILES_TO_SYNC = [
  'plugin.json',
  'hooks.json',
  'mcp_config.json',
  path.join('dist', 'hook.mjs'),
  path.join('dist', 'server.mjs'),
  path.join('dist', 'app.html'),
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function syncLocalPlugin({
  createIfMissing = true,
  targetDir = process.env.AGY_PLUGIN_DIR || DEFAULT_PLUGIN_DIR,
} = {}) {
  if (!createIfMissing && !(await pathExists(targetDir))) {
    return { synced: false, targetDir, files: [] };
  }

  await fs.mkdir(path.join(targetDir, 'dist'), { recursive: true });

  for (const relPath of FILES_TO_SYNC) {
    const src = path.join(rootDir, relPath);
    const dest = path.join(targetDir, relPath);
    await fs.copyFile(src, dest);
  }

  console.log(`Synced ${FILES_TO_SYNC.length} plugin files to ${targetDir}`);
  return { synced: true, targetDir, files: FILES_TO_SYNC };
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  syncLocalPlugin({ createIfMissing: true }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
