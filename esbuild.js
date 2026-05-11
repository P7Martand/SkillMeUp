const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node20',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'info'
  });

  // Copy webview media into out/ so it can be loaded via vscode.Uri.joinPath
  copyMedia();

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

function copyMedia() {
  const src = path.join(__dirname, 'src', 'ui', 'webview', 'media');
  const dest = path.join(__dirname, 'out', 'media');
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
