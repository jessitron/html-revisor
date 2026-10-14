#!/usr/bin/env node
// Freeze one page of a Mintlify export into test/pages, with one small stylesheet.
//
// Usage: node scripts/vendor-mintlify-page.mjs <export dir> <page path> <name>
//   e.g. node scripts/vendor-mintlify-page.mjs ~/.cache/mintlify-page-review/export \
//          send-data/use-cases/anthropic-usage-monitoring anthropic-usage-monitoring
//
// Reads <export dir>/<page path>/static.html, which iterate-on-a-mintlify-page's strip_scripts.py
// makes from the page's index.html. Writes test/pages/mintlify-<name>.html and
// test/pages/mintlify-<name>.css. The copy only has to look okay and keep the page's volume of
// content, so it drops the fonts, logos, and external links, and keeps only the CSS rules whose
// selectors the page uses (PurgeCSS, fetched by npx).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [exportDir, page, name] = process.argv.slice(2);
if (!name) {
  console.error('usage: node scripts/vendor-mintlify-page.mjs <export dir> <page path> <name>');
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outHtml = path.join(root, 'test/pages', `mintlify-${name}.html`);
const outCss = path.join(root, 'test/pages', `mintlify-${name}.css`);
let html = fs.readFileSync(path.join(exportDir, page, 'static.html'), 'utf8');

const sheets = [...html.matchAll(/<link rel="stylesheet" href="\/(_next\/static\/[^"]*\.css)"[^>]*>/g)].map((m) => m[1]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-mintlify-'));
const allCss = path.join(tmp, 'all.css');
fs.writeFileSync(allCss, sheets.map((s) => fs.readFileSync(path.join(exportDir, s), 'utf8')).join('\n'));

// Every stylesheet link becomes one link to the pruned copy; fonts, KaTeX, and logos go.
let linked = false;
html = html.replace(/<link rel="stylesheet" href="\/_next\/static\/[^"]*\.css"[^>]*>/g, () =>
  linked ? '' : ((linked = true), `<link rel="stylesheet" href="${path.basename(outCss)}">`));
html = html.replace(/<link[^>]*(fonts\.googleapis|fonts\.gstatic|katex|\/_assets\/|\.woff2)[^>]*>/g, '');
html = html.replace(/<img[^>]*src="\/_assets\/logos\/[^"]*"[^>]*>/g, '');
const pageHtml = path.join(tmp, 'page.html');
fs.writeFileSync(pageHtml, html);

// Tailwind class names hold brackets, colons, and slashes; split on what can't be in one.
const extractor = path.join(tmp, 'purgecss.config.cjs');
fs.writeFileSync(extractor, `module.exports = {
  content: [${JSON.stringify(pageHtml)}],
  css: [${JSON.stringify(allCss)}],
  defaultExtractor: (s) => s.split(/[\\s"'<>=]+/),
  safelist: ['html', 'body', 'dark'],
  fontFace: true, keyframes: true, variables: true,
};`);
const out = JSON.parse(execFileSync('npx', ['--yes', 'purgecss@6.0.0', '--config', extractor], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const css = out.map((o) => o.css).join('\n').replace(/@font-face\s*{[^}]*}/g, '');

fs.writeFileSync(outCss, css);
fs.writeFileSync(outHtml, html);
execFileSync('node', [path.join(root, 'formatter.mjs'), outHtml], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true });
console.log(`wrote ${path.relative(root, outHtml)} and ${path.relative(root, outCss)} (${css.length} bytes of CSS, from ${sheets.length} sheets)`);
