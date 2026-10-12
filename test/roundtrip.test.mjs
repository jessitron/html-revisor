// The round-trip property (PLAN.html stage 5): for every scope, scope → markdown → scope is the
// same HTML, element IDs and directives aside. Opening a scope and saving it unchanged must
// leave the file unchanged.
//
// Two sources of scopes: every page in this repo, and pages generated from a seed in the shapes
// agents write, with text full of characters markdown reads as syntax. No property-testing
// library: deploy runs these tests where npm install can't. A failure prints its seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, parse } from '../formatter.mjs';
import { scopeElements, scopeMarkdown, scopeFromMarkdown, canonicalHTML } from '../scopes.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Why a scope doesn't round-trip, or null if it does.
function roundTripFailure(document, el) {
  const markdown = scopeMarkdown(el);
  const before = canonicalHTML(document, [el]);
  const after = canonicalHTML(document, scopeFromMarkdown(el, markdown));
  if (before === after) return null;
  return `<${el.localName}> doesn't round-trip.\n--- HTML\n${before}\n--- markdown\n${markdown}\n--- back\n${after}`;
}

// ---- Every page here ----------------------------------------------------

// The dev-only pages don't deploy; the test runs on what is there.
const pages = [
  ...['OVERVIEW.html', 'PLAN.html', 'DESIGN.html', 'try-me.html'].map((f) => path.join(root, f)),
  ...fs.readdirSync(path.join(root, 'test/fixtures')).filter((f) => f.endsWith('.html')).map((f) => path.join(root, 'test/fixtures', f)),
].filter((f) => fs.existsSync(f));

for (const file of pages) {
  test(`every scope in ${path.relative(root, file)} round-trips`, () => {
    const document = parse(normalize(fs.readFileSync(file, 'utf8')));
    for (const el of scopeElements(document)) {
      const failure = roundTripFailure(document, el);
      assert.equal(failure, null, failure);
    }
  });
}

// ---- Generated pages ----------------------------------------------------

// mulberry32: small, seeded, good enough to pick shapes.
function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (xs) => xs[int(xs.length)];
  const times = (lo, hi, f) => Array.from({ length: lo + int(hi - lo + 1) }, f);
  return { int, pick, times, chance: (p) => next() < p };
}

// Words agents write, and words markdown would read as syntax. Escaped as HTML text.
const WORDS = [
  'the', 'scope', 'saves', 'markdown', 'deploy', 'formatter', 'plan', 'stage', 'directive', 'yak',
  'snake_case', 'a*b', '2*3=6', '`tick`', '[x]', '[link](y)', '#1', 'C#', 'x|y', '***', '---', '===',
  '~~strike~~', '\\back', 'AT&amp;T', '&amp;copy;', '&lt;tag&gt;', 'a&lt;b', '"quoted"', "it's", '!',
  '![no](img)', '_under_', 'ünïcode', '😀', 'nbsp&nbsp;here', 'http://example.com', '⟦svg⟧', '1.', '2)',
  '+', '-', '&gt;', '*', '_',
];
const PLAIN = WORDS.slice(0, 10);
const attr = (s) => s.replace(/"/g, '&quot;');
const wrap = (tag, inner) => `<${tag}>${inner}</${tag}>`;
const HREFS = ['#x', 'page.html', 'https://example.com/a?b=1&amp;c=2', 'a b.html', 'x(1).html', 'mailto:j@example.com', 'data:image/png;base64,AAAA', 'q.html#a_b'];
const ICON = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>';

// tidy: the shapes agents write most, which should come out as markdown with no HTML in it.
function generator(r, tidy) {
  const words = tidy ? PLAIN : WORDS;
  const text = (lo = 1, hi = 4) => r.times(lo, hi, () => r.pick(words)).join(' ');
  const inline = (depth = 0) => {
    const parts = r.times(1, 4, () => {
      const kinds = ['text', 'text', 'strong', 'em', 'code', 'a', 'img', 'br'];
      if (!tidy) kinds.push('span', 'kbd', 'icon', 'a-target', 'img-sized', 'spaced', 'empty', 'touching', 'code-ticks', 'a-title', 'nbsp', 'newline');
      const kind = depth > 1 ? 'text' : r.pick(kinds);
      switch (kind) {
        case 'strong': return `<strong>${tidy ? text() : inline(depth + 1)}</strong>`;
        case 'em': return `<em>${tidy ? text() : inline(depth + 1)}</em>`;
        case 'code': return `<code>${r.pick(words)}${r.chance(0.3) ? ' ' + r.pick(WORDS) : ''}</code>`;
        case 'a': return `<a href="${r.pick(tidy ? ['#x', 'page.html'] : HREFS)}">${text()}</a>`;
        case 'a-target': return `<a href="${r.pick(HREFS)}" target="_blank">${text()}</a>`;
        case 'img': return `<img src="${r.pick(['pic.png', 'a b.png'])}" alt="${attr(tidy ? text() : r.pick(words))}">`;
        case 'img-sized': return `<img src="pic.png" alt="${attr(text())}" width="20" height="10">`;
        case 'br': return `${text()}<br>${text()}`;
        case 'span': return `<span class="tag">${inline(depth + 1)}</span>`;
        case 'kbd': return `<kbd>${r.pick(words)}</kbd>`;
        case 'icon': return ICON;
        case 'spaced': return wrap(r.pick(['strong', 'em']), ` ${text()} `);
        case 'empty': return r.pick(['<em></em>', '<strong></strong>', '<code></code>', '<a href="#x"></a>', '<span class="tag"></span>']);
        case 'touching': return `${r.pick(WORDS)}${wrap(r.pick(['strong', 'em', 'code']), r.pick(WORDS))}${r.pick(WORDS)}`;
        case 'code-ticks': return `<code>${r.pick(['`', '``a``', ' a ', '  ', 'a`b', '`a', '<b>'])}</code>`.replace('<b>', '&lt;b&gt;');
        case 'a-title': return `<a href="x.html" title="say &quot;hi&quot; \\ (there)">${text()}</a>`;
        case 'nbsp': return `&nbsp;${text()}&nbsp;`;
        case 'newline': return `${text()}\n    ${text()}`;
        default: return text();
      }
    });
    return parts.join(tidy || r.chance(0.8) ? ' ' : '');
  };
  const item = (depth, loose) => {
    if (loose) return `<li>${r.times(1, 3, () => `<p>${inline()}</p>`).join('')}</li>`;
    const nested = depth < 2 && r.chance(0.3) ? list(depth + 1) : '';
    return `<li>${inline()}${nested}</li>`;
  };
  const list = (depth = 0) => {
    const tag = r.pick(['ul', 'ol']);
    // Nested under an item's text, a list numbered from past 1 can only be HTML.
    const start = tag === 'ol' && (!tidy || depth === 0) && r.chance(0.3) ? ` start="${2 + r.int(5)}"` : '';
    const loose = !tidy && r.chance(0.25);
    const cls = !tidy && r.chance(0.2) ? ' class="yaks"' : '';
    return `<${tag}${start}${cls}>${r.times(1, 4, () => item(depth, loose)).join('')}</${tag}>`;
  };
  const table = () => {
    const cols = 1 + r.int(3);
    const row = (tag) => `<tr>${r.times(cols, cols, () => `<${tag}>${tidy ? text() : inline(2)}</${tag}>`).join('')}</tr>`;
    return `<table><tr>${r.times(cols, cols, () => `<th>${text()}</th>`).join('')}</tr>${r.times(0, 3, () => row('td')).join('')}</table>`;
  };
  const pre = () => {
    const lines = r.times(1, 4, () => `${r.pick(['', '  ', '    '])}${text()}`).join('\n');
    const code = r.pick(['', ' class="language-js"']);
    return r.chance(0.7) ? `<pre><code${code}>${lines}</code></pre>` : `<pre>${lines}</pre>`;
  };
  const block = (depth = 0) => {
    const kinds = ['p', 'p', 'p', 'h', 'list', 'list', 'table', 'pre', 'hr', 'blockquote'];
    if (depth < 2) kinds.push('card', 'section');
    if (!tidy) kinds.push('p-class', 'figure', 'details', 'bare', 'empty-p', 'h-id', 'h-hash', 'empty-li', 'head-only', 'pipes', 'fences', 'lists-hr');
    switch (r.pick(kinds)) {
      case 'h': {
        const level = 2 + r.int(3);
        return `<h${level}>${tidy ? text() : inline(1)}</h${level}>`; // a heading holding a <br> is HTML
      }
      case 'list': return list();
      case 'table': return table();
      case 'pre': return pre();
      case 'hr': return '<hr>';
      case 'blockquote': return `<blockquote>${r.times(1, 2, () => `<p>${inline()}</p>`).join('')}</blockquote>`;
      case 'card': return `<div class="card">${r.times(1, 3, () => block(depth + 1)).join('')}</div>`;
      case 'section': return `<section><h2>${text()}</h2>${r.times(1, 3, () => block(depth + 1)).join('')}</section>`;
      case 'p-class': return `<p class="why">${inline()}</p>`;
      case 'figure': return `<figure>${ICON}<figcaption>${inline()}</figcaption></figure>`;
      case 'details': return `<details><summary>${text()}</summary><p>${inline()}</p></details>`;
      case 'bare': return `<div>${text()}${list()}${text()}</div>`;
      case 'empty-p': return '<p></p>';
      case 'h-id': return `<h3 id="goals">${text()}</h3>`;
      case 'h-hash': return `<h2>${text()} #</h2>`;
      case 'empty-li': return `<ul><li>${text()}</li><li></li></ul>`;
      case 'head-only': return `<table><tr><th>${text()}</th><th></th></tr></table>`;
      case 'pipes': return `<table><tr><th>a|b</th></tr><tr><td><code>x|y</code> \\| ${text()}</td></tr></table>`;
      case 'fences': return r.pick(['<pre><code>```\nin\n```</code></pre>', '<pre>~~~\nin\n~~~</pre>', '<pre><code>\n\nblank first</code></pre>']);
      case 'lists-hr': return `${list()}<hr>${list()}`;
      default: return `<p>${inline()}</p>`;
    }
  };
  return () => r.times(1, 5, () => block()).join('');
}

const SEEDS = Number(process.env.ROUND_TRIP_SEEDS ?? 150);

for (const tidy of [false, true]) {
  test(`generated ${tidy ? 'tidy ' : ''}pages: every scope round-trips (${SEEDS} seeds)`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const body = generator(random(seed), tidy)();
      const document = parse(normalize(`<html><body>${body}</body></html>`));
      for (const el of scopeElements(document)) {
        const failure = roundTripFailure(document, el);
        assert.equal(failure, null, `seed ${seed}${tidy ? ' (tidy)' : ''}: ${failure}`);
      }
    }
  });
}

// A section or a card has no markdown syntax: its tags stand on their own lines around markdown.
const WRAPPER_LINE = /^<\/?[a-z][a-z0-9]*(\s[^<>]*)?>$/gm;

test(`generated tidy pages come out as markdown, HTML only for the tags of sections and cards (${SEEDS} seeds)`, () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const document = parse(normalize(`<html><body>${generator(random(seed), true)()}</body></html>`));
    for (const el of scopeElements(document)) {
      const markdown = scopeMarkdown(el);
      const html = markdown
        .replace(WRAPPER_LINE, '')
        .replace(/\]\(<[^<>]*>/g, '](') // a destination with a space: ![x](<a b.png>)
        .replace(/`[^`\n]*`/g, '') // a code span: `<tag>`
        .match(/<\/?[a-z][a-z0-9]*[\s>]/);
      assert.equal(html, null, `seed ${seed}: <${el.localName}> came out with HTML:\n${canonicalHTML(document, [el])}\n--- markdown\n${markdown}`);
    }
  }
});
