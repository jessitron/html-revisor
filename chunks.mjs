// html-revisor chunks: decide which elements are the units of editing and directives.
//
//   node chunks.mjs <file>              prints the chunk tree of the body
//   node chunks.mjs --annotate <file>   marks the chunks of each .ex example in place
//                                       (data-chunk attributes, a report under each example)
//
// A chunk is the unit of editing and of directives. Elements inside a chunk get no data-n,
// no hover, and no directives. The rules below are a proposal under discussion (PLAN.html
// stage 2, yak p5pm); try-me.html#chunks holds the cases.
//
// Tiers, dependencies point downward only:
//   Tier I   orchestration: the CLI
//   Tier II  domain: findChunks, the chunk report, annotation (pure functions over a DOM)
//   Tier III interface: the filesystem, through fs in the CLI; parse/serialize from formatter.mjs
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parse, serialize, trimAscii, escapeText } from './formatter.mjs';

// ======================================================================
// Tier I: orchestration
// ======================================================================

export async function main(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const annotating = args[0] === '--annotate';
  const files = annotating ? args.slice(1) : args;
  if (files.length === 0) {
    stderr.write('usage: node chunks.mjs [--annotate] <file>...\n');
    return 2;
  }
  for (const file of files) {
    const document = parse(await fs.readFile(file, 'utf8'));
    if (annotating) {
      annotate(document);
      await fs.writeFile(file, serialize(document));
    } else {
      stdout.write(report(findChunks(bodyOf(document))) + '\n');
    }
  }
  return 0;
}

const bodyOf = (document) => document.querySelector('body');

// ======================================================================
// Tier II: domain
// ======================================================================

// ---- Kinds of element ---------------------------------------------------

// Not shown, so never a chunk.
const HIDDEN = new Set('head script style template title meta link noscript'.split(' '));

// Shown, but not text: a chunk of its own, never edited as prose. Inside prose it is a token.
const NONPROSE = new Set(
  'svg img picture video audio canvas iframe embed object math input button select textarea meter progress hr br'.split(' '),
);

// Flow content that ends a run of prose. Everything else is phrasing.
// Unlike the formatter's BLOCK set, svg and img are not here: inside a sentence they are tokens.
const BLOCK = new Set(
  `address article aside blockquote body details dialog div dl dd dt fieldset figcaption figure
   footer form h1 h2 h3 h4 h5 h6 header hgroup li main menu nav ol p pre section summary
   table caption colgroup thead tbody tfoot tr th td ul`.split(/\s+/),
);

// An element is block-level by name, or because it holds a block (E3: a link wrapping a card).
function holdsBlocks(el) {
  return [...el.children].some((c) => BLOCK.has(c.localName) || (!NONPROSE.has(c.localName) && holdsBlocks(c)));
}
const isBlock = (el) => BLOCK.has(el.localName) || holdsBlocks(el);

// Text a reader sees, not counting text inside nonprose (svg <text>, button labels).
function proseText(el) {
  let text = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) text += n.data;
    else if (n.nodeType === 1 && !NONPROSE.has(n.localName) && !HIDDEN.has(n.localName)) text += proseText(n);
  }
  return text;
}
const hasProse = (el) => proseText(el).trim() !== ''; // U+00A0 alone is blank too (F1)

// ---- Chunks -------------------------------------------------------------

// A chunk: { kind, el, children?, tokens?, html? }
//   prose      an element whose content is all phrasing, with text. Edited as markdown.
//   blank      an element whose content is all phrasing, with no text (F1). Nothing to edit.
//   code       a <pre>. Edited as a fenced block (C11).
//   nonprose   svg, img, hr...: takes directives, no text editing.
//   container  holds blocks; takes directives, no text editing. Its children are chunks.
//   run        phrasing sitting bare in a container, next to blocks (C10). No element of its own,
//              so it can't take a data-n or a directive. el is null; nodes holds the run.
export function findChunks(root) {
  return chunkOf(root);
}

function chunkOf(el) {
  const name = el.localName;
  if (NONPROSE.has(name)) return { kind: 'nonprose', el };
  if (name === 'pre') return { kind: 'code', el };
  if (holdsBlocks(el)) return { kind: 'container', el, children: chunksIn(el) };
  return { kind: hasProse(el) ? 'prose' : 'blank', el, tokens: tokensIn(el) };
}

// The chunks among a container's children: block children chunk on their own; runs of
// phrasing between them become run chunks, unless the run is blank.
function chunksIn(container) {
  const chunks = [];
  let run = [];
  const flush = () => {
    if (run.some((n) => (n.nodeType === 3 ? trimAscii(n.data) !== '' : true))) {
      const nodes = run;
      chunks.push(runChunk(nodes));
    }
    run = [];
  };
  for (const n of container.childNodes) {
    if (n.nodeType === 1 && HIDDEN.has(n.localName)) continue;
    if (n.nodeType === 1 && (isBlock(n) || n.localName === 'hr')) {
      flush();
      chunks.push(chunkOf(n));
    } else if (n.nodeType === 1 || n.nodeType === 3) {
      run.push(n);
    }
  }
  flush();
  return chunks;
}

function runChunk(nodes) {
  // A run that is one nonprose element (an svg alone between blocks) is that element's chunk.
  const elements = nodes.filter((n) => n.nodeType === 1);
  const textBlank = nodes.every((n) => n.nodeType !== 3 || trimAscii(n.data) === '');
  if (textBlank && elements.length === 1 && NONPROSE.has(elements[0].localName)) {
    return { kind: 'nonprose', el: elements[0] };
  }
  return { kind: 'run', el: null, nodes, tokens: nodes.flatMap((n) => (n.nodeType === 1 ? tokensOf(n) : [])) };
}

// The nonprose tokens inside a prose chunk (D1, D2, D7): they ride along in the chunk's text.
function tokensIn(el) {
  return [...el.children].flatMap(tokensOf);
}
function tokensOf(el) {
  if (NONPROSE.has(el.localName) && el.localName !== 'br') return [el];
  return tokensIn(el);
}

// ---- Report -------------------------------------------------------------

// One line per chunk, indented by nesting. Prose shows its content as inline HTML with
// nonprose tokens shortened to ⟦name⟧, so the question "what would I edit" has an answer.
export function report(chunk, depth = 0) {
  const lines = [];
  const label = chunk.el ? `<${chunk.el.localName}${classSuffix(chunk.el)}>` : '(no element)';
  let line = `${'  '.repeat(depth)}${chunk.kind.padEnd(9)} ${label}`;
  if (chunk.kind === 'prose' || chunk.kind === 'run') line += `  ${preview(chunk.el ? [...chunk.el.childNodes] : chunk.nodes)}`;
  if (chunk.kind === 'code') line += `  ${preview([...chunk.el.childNodes], true)}`;
  lines.push(line);
  for (const child of chunk.children ?? []) lines.push(report(child, depth + 1));
  return lines.join('\n');
}

const classSuffix = (el) => (el.getAttribute('class') ? `.${el.getAttribute('class').split(/\s+/).join('.')}` : '');

const PREVIEW_LIMIT = 110;
function preview(nodes, keepSpace = false) {
  const html = nodes.map((n) => previewNode(n)).join('');
  const text = keepSpace ? html.replace(/\n/g, '⏎') : trimAscii(html.replace(/[ \t\n\r\f]+/g, ' '));
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}
function previewNode(n) {
  if (n.nodeType === 3) return escapeText(n.data);
  if (n.nodeType !== 1) return '';
  const name = n.localName;
  if (name === 'br') return '<br>';
  if (NONPROSE.has(name)) return `⟦${name}⟧`;
  return `<${name}${classSuffix(n)}>${[...n.childNodes].map(previewNode).join('')}</${name}>`;
}

// ---- Annotation ---------------------------------------------------------

// Marks the chunks of each .ex example: data-chunk on each chunk's element, and a
// <pre class="chunk-report"> after the example. Annotating again replaces the old marks,
// leaving everything else (directives included) where it was.
export function annotate(document) {
  clearAnnotations(document);
  for (const ex of document.querySelectorAll('.ex')) {
    const chunks = chunksIn(ex);
    for (const chunk of chunks) mark(chunk);
    const pre = document.createElement('pre');
    pre.setAttribute('class', 'chunk-report');
    pre.textContent = chunks.map((c) => report(c)).join('\n');
    ex.after(pre);
  }
  const style = document.createElement('style');
  style.setAttribute('id', 'chunk-view');
  style.textContent = CHUNK_VIEW_CSS;
  document.querySelector('head').appendChild(style);
}

function mark(chunk) {
  chunk.el?.setAttribute('data-chunk', chunk.kind);
  for (const child of chunk.children ?? []) mark(child);
}

function clearAnnotations(document) {
  document.querySelectorAll('.chunk-report, #chunk-view').forEach((el) => el.remove());
  document.querySelectorAll('[data-chunk]').forEach((el) => el.removeAttribute('data-chunk'));
}

const CHUNK_VIEW_CSS = `
  [data-chunk] { outline-offset: 2px; }
  [data-chunk="prose"] { outline: 2px solid #1a7f37; }
  [data-chunk="blank"] { outline: 2px dashed #1a7f37; min-height: 0.5em; }
  [data-chunk="code"] { outline: 2px solid #0969da; }
  [data-chunk="nonprose"] { outline: 2px dashed #6e7781; }
  [data-chunk="container"] { outline: 1px dotted #8250df; }
  .chunk-report { font-size: 0.75rem; background: #f6f8fa; border-left: 3px solid #1a7f37; white-space: pre-wrap; margin: 0.5rem 0; }
`;

// Run the CLI when this file is the entry point, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
