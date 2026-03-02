import * as esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const isWatch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: [path.join(rootDir, 'src', 'extension.ts')],
  outfile: path.join(rootDir, 'dist', 'extension.js'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode', 'ssh2', 'basic-ftp'],
  sourcemap: true,
  logLevel: 'info'
};

const webviewConfig = {
  entryPoints: [path.join(rootDir, 'src', 'webview', 'ui', 'main.ts')],
  outfile: path.join(rootDir, 'dist', 'webview', 'ui', 'main.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: true,
  logLevel: 'info'
};

async function copyStaticAssets() {
  const distUiDir = path.join(rootDir, 'dist', 'webview', 'ui');
  const distResourcesDir = path.join(rootDir, 'dist', 'resources');

  await mkdir(distUiDir, { recursive: true });
  await mkdir(distResourcesDir, { recursive: true });

  await cp(path.join(rootDir, 'src', 'webview', 'ui', 'index.html'), path.join(distUiDir, 'index.html'));
  await cp(path.join(rootDir, 'src', 'webview', 'ui', 'styles.css'), path.join(distUiDir, 'styles.css'));
  await cp(path.join(rootDir, 'resources', 'activity-icon.svg'), path.join(distResourcesDir, 'activity-icon.svg'));
}

async function runBuild() {
  if (isWatch) {
    const extensionContext = await esbuild.context(extensionConfig);
    const webviewContext = await esbuild.context(webviewConfig);

    await Promise.all([extensionContext.watch(), webviewContext.watch()]);
    await copyStaticAssets();
    console.log('Watch mode active.');
    return;
  }

  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
  await copyStaticAssets();
}

runBuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
