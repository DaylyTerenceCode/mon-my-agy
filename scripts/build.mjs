import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

async function build() {
  await fs.mkdir(distDir, { recursive: true });

  // 1. Bundle lifecycle hook (zero external deps for sub-50ms execution)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/hook/index-conversation.ts')],
    outfile: path.join(distDir, 'hook.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minify: true,
  });

  // 2. Bundle MCP server
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/server/main.ts')],
    outfile: path.join(distDir, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });

  // 3. Bundle MCP App UI into a single self-contained HTML file (strict CSP compliant)
  const uiResult = await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/ui/app.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: false,
  });

  const bundledJs = uiResult.outputFiles[0]?.text ?? '';
  const [templateHtml, stylesCss] = await Promise.all([
    fs.readFile(path.join(rootDir, 'src/ui/index.html'), 'utf8'),
    fs.readFile(path.join(rootDir, 'src/ui/styles.css'), 'utf8'),
  ]);

  // Escape </script> inside JS to prevent premature tag closure
  const safeJs = bundledJs.replace(/<\/script>/gi, '<\\/script>');
  const finalHtml = templateHtml
    .replace('<!-- INLINE_STYLES -->', () => `<style>\n${stylesCss}\n</style>`)
    .replace('<!-- INLINE_SCRIPT -->', () => `<script>\n${safeJs}\n</script>`);

  await fs.writeFile(path.join(distDir, 'app.html'), finalHtml, 'utf8');
  console.log('Built dist/hook.mjs, dist/server.mjs, dist/app.html');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
