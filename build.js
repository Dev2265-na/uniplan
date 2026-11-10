// ============================================================
// build.js — Compiles Google Apps Script HTML templates into
//            standalone static bundles (public/index.html for Vercel
//            and docs/index.html for GitHub Pages)
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Replace <?!= include('filename'); ?> with the contents of filename.html
html = html.replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g, (_, partialName) => {
  const partialPath = path.join(ROOT, `${partialName}.html`);
  if (!fs.existsSync(partialPath)) {
    throw new Error(`Missing partial file: ${partialPath}`);
  }
  return fs.readFileSync(partialPath, 'utf8');
});

['public', 'docs'].forEach((dir) => {
  const outDir = path.join(ROOT, dir);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Built standalone bundle: ${outPath} (${Buffer.byteLength(html, 'utf8')} bytes)`);
});
