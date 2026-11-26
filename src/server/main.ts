import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseDataDir(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith('--data_dir=')) {
      return arg.slice('--data_dir='.length);
    }
  }
  return process.env.PLUGIN_DATA || path.join(process.cwd(), '.plugin-data');
}

async function main(): Promise<void> {
  const dataDir = parseDataDir(process.argv.slice(2));
  const defaultHtmlPath = path.join(__dirname, 'app.html');

  const server = createMcpServer({
    dataDir,
    loadUiHtml: async () => {
      const htmlPath = process.env.MON_MY_AGY_APP_HTML || defaultHtmlPath;
      return fs.readFile(htmlPath, 'utf8');
    },
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[mon-my-agy] Fatal MCP server error:', err);
  process.exit(1);
});
