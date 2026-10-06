// html-notes: leave comments on HTML files; they live in the file as <!-- author: text -->.
//
// Three tiers, dependencies point downward only:
//   Tier I   orchestration: CLI, request routing, the GET and PUT flows
//   Tier II  domain: formatter, notes, element identity (pure functions over a DOM)
//   Tier III interface: filesystem gateway, content types, listings, client assets
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

// ======================================================================
// Tier I: orchestration
// ======================================================================

export function parseArgs(argv) {
  const config = { root: process.cwd(), port: 7777, author: 'jess' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag === '--port') config.port = Number(inline ?? argv[++i]);
    else if (flag === '--author') config.author = inline ?? argv[++i];
    else if (!flag.startsWith('--')) config.root = path.resolve(argv[i]);
    else throw new Error(`unknown option ${flag}`);
  }
  return config;
}

export function createServer({ root, author }) {
  return http.createServer((req, res) => {
    route(req, res, { root: path.resolve(root), author }).catch((err) => sendError(res, err));
  });
}

async function route(req, res, config) {
  const urlPath = decodeRequestPath(req.url);
  const file = resolveUnderRoot(config.root, urlPath);
  const isHtml = /\.html?$/i.test(urlPath);

  if (req.method === 'PUT' && isHtml) return putNotes(req, res, file, urlPath, config);
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');

  const stat = await fs.stat(file);
  if (stat.isDirectory()) {
    if (!urlPath.endsWith('/')) return redirect(res, urlPath + '/');
    return sendHtml(res, directoryListing(urlPath, await fs.readdir(file, { withFileTypes: true })));
  }
  if (isHtml) return getPage(res, file, urlPath, config);
  res.writeHead(200, { 'Content-Type': contentTypeFor(file) });
  res.end(await fs.readFile(file));
}

// GET: normalize on disk, then serve a stamped copy with notes lifted out into JSON.
async function getPage(res, file, urlPath, { author }) {
  const onDisk = await fs.readFile(file, 'utf8');
  const formatted = normalize(onDisk);
  if (formatted !== onDisk) {
    await fs.writeFile(file, formatted);
    console.log(`${urlPath} (normalized)`);
  }
  const { document } = parseHTML(formatted);
  stamp(document);
  const notes = collectNotes(document, author);
  removeNotes(document, author);
  injectClient(document, notes);
  console.log(`${urlPath} — ${Object.keys(notes).length} pending notes`);
  sendHtml(res, document.toString());
}

// PUT: the body is the complete set of notes; rewrite them all into the file.
async function putNotes(req, res, file, urlPath, { author }) {
  let notes;
  try {
    notes = JSON.parse(await readBody(req)).notes;
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    throw new HttpError(400, 'body must look like {"notes": {"<id>": "text"}}');
  }
  const { document } = parseHTML(await fs.readFile(file, 'utf8'));
  const elements = [...document.querySelectorAll('*')]; // snapshot: ids are indices into this
  removeNotes(document, author);
  let count = 0;
  for (const [id, text] of Object.entries(notes)) {
    const element = elements[id];
    if (!element || typeof text !== 'string' || !text.trim()) continue;
    placeNote(element, text, author);
    count++;
  }
  unstamp(document);
  await fs.writeFile(file, serialize(document));
  console.log(`${urlPath} — saved ${count} notes`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, count }));
}

function sendError(res, err) {
  const status = err.status ?? (err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500);
  if (status === 500) console.error(err.stack ?? err);
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(status === 404 ? 'not found' : String(err.message ?? err));
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const server = createServer(config);
  server.listen(config.port, '127.0.0.1', () => {
    const { port } = server.address();
    console.log(`html-notes: http://localhost:${port}/ serving ${path.resolve(config.root)}`);
  });
}

// ======================================================================
// Tier II: domain
// ======================================================================

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set('pre textarea script style template'.split(' ')); // inner content is kept as-is
const BLOCK = new Set(
  `html head body main header footer nav section article aside div p h1 h2 h3 h4 h5 h6
   ul ol li dl dt dd table thead tbody tfoot tr th td blockquote pre figure figcaption hr
   form fieldset details summary meta link script style noscript template iframe video
   audio canvas svg`.split(/\s+/),
);
const ONE_LINE_LIMIT = 90; // inline-only blocks shorter than this stay on one line

// ---- Formatter ----------------------------------------------------------

export function parse(html) {
  return parseHTML(html).document;
}

export function normalize(html) {
  return serialize(parse(html));
}

// Canonical serialization of a whole document.
export function serialize(document) {
  const doctype = document.doctype?.name || 'html';
  const lines = [`<!DOCTYPE ${doctype}>`, ...formatChildren(document, 0)];
  return lines.join('\n') + '\n';
}

const ASCII_SPACE = '[ \\t\\n\\r\\f]'; // the only whitespace HTML collapses; U+00A0 is not in it
const collapse = (s) => s.replace(new RegExp(`${ASCII_SPACE}+`, 'g'), ' ');
const trimAscii = (s) => s.replace(new RegExp(`^${ASCII_SPACE}+|${ASCII_SPACE}+$`, 'g'), '');
const pad = (depth) => '  '.repeat(depth);

// Parsers decoded the entities already, so escape on the way out.
const escapeText = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Child nodes with adjacent text nodes merged into one string (entities split text in linkedom).
// Elements and comments pass through; other node types (doctype) are dropped.
function childrenOf(parent) {
  const items = [];
  for (const node of parent.childNodes) {
    if (node.nodeType === 3) {
      if (typeof items.at(-1) === 'string') items[items.length - 1] += node.data;
      else items.push(node.data);
    } else if (node.nodeType === 1 || node.nodeType === 8) {
      items.push(node);
    }
  }
  return items;
}

// A block element by name, or any element holding a block element.
function isBlockish(el) {
  return BLOCK.has(el.localName) || [...el.childNodes].some((n) => n.nodeType === 1 && isBlockish(n));
}

const isBlockItem = (item) =>
  typeof item !== 'string' && (item.nodeType === 8 || isBlockish(item));

// Lay out the children of a block container: block items on their own lines,
// runs of inline items joined onto one line.
function formatChildren(parent, depth) {
  const lines = [];
  let run = [];
  const flush = () => {
    const text = trimAscii(inlineHTML(run));
    run = [];
    if (text) lines.push(pad(depth) + text);
  };
  for (const item of childrenOf(parent)) {
    if (isBlockItem(item)) {
      flush();
      lines.push(...formatBlock(item, depth));
    } else {
      run.push(item);
    }
  }
  flush();
  return lines;
}

function formatBlock(node, depth) {
  if (node.nodeType === 8) return [`${pad(depth)}<!--${node.data}-->`];
  const open = openTag(node);
  if (VOID.has(node.localName)) return [pad(depth) + open];
  const close = `</${node.localName}>`;
  if (RAW.has(node.localName)) return [pad(depth) + open + rawInner(node) + close];

  const kids = childrenOf(node);
  if (kids.some(isBlockItem)) {
    return [pad(depth) + open, ...formatChildren(node, depth + 1), pad(depth) + close];
  }
  const inner = trimAscii(inlineHTML(kids));
  if ((open + inner + close).length < ONE_LINE_LIMIT) return [pad(depth) + open + inner + close];
  return [pad(depth) + open, pad(depth + 1) + inner, pad(depth) + close];
}

// Inline content: whitespace collapses to single spaces, and a whitespace-only
// string between two inline nodes survives as one space.
function inlineHTML(items) {
  return items
    .map((item) => {
      if (typeof item === 'string') return escapeText(collapse(item));
      if (item.nodeType === 8) return `<!--${item.data}-->`;
      const open = openTag(item);
      if (VOID.has(item.localName)) return open;
      const inner = RAW.has(item.localName) ? rawInner(item) : inlineHTML(childrenOf(item));
      return `${open}${inner}</${item.localName}>`;
    })
    .join('');
}

function openTag(el) {
  const attrs = [...el.attributes]
    .map((a) => (a.value === '' ? ` ${a.name}` : ` ${a.name}="${escapeAttr(a.value)}"`))
    .join('');
  return `<${el.localName}${attrs}>`;
}

// pre/textarea/script/style/template: linkedom's own inner serialization, no re-indenting.
// linkedom writes U+00A0 as &#160;; use the named entity instead.
function rawInner(el) {
  return el.innerHTML.replace(/&#160;/g, '&nbsp;');
}

// ---- Element identity ---------------------------------------------------

// data-n is the element's index in document order. Comments are not elements,
// so adding and removing notes never shifts an index.
export function stamp(document) {
  document.querySelectorAll('*').forEach((el, i) => el.setAttribute('data-n', String(i)));
}

export function unstamp(document) {
  document.querySelectorAll('[data-n]').forEach((el) => el.removeAttribute('data-n'));
}

// ---- Notes --------------------------------------------------------------

// Notes go before these elements; for everything else a note is the first child.
const NOTE_BEFORE = new Set([...VOID, ...RAW]);
const noteGoesBefore = (el) => NOTE_BEFORE.has(el.localName);

// A note is a comment inside an element whose text starts with "<author>:".
// Comments outside any element (before <html>) are never notes.
export function isNote(node, author) {
  return (
    node.nodeType === 8 &&
    node.parentNode?.nodeType === 1 &&
    node.data.trimStart().startsWith(`${author}:`)
  );
}

export function noteText(comment, author) {
  return comment.data.trimStart().slice(author.length + 1).trim();
}

// Escape so the text cannot end the comment early. Repeat for runs like "---".
export function escapeNoteText(text) {
  let out = text;
  while (out.includes('--')) out = out.replaceAll('--', '- -');
  return out.replaceAll('>', '&gt;');
}

function allComments(node, found = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 8) found.push(child);
    else if (child.nodeType === 1) allComments(child, found);
  }
  return found;
}

// The reading rule: a note belongs to its parent, unless the next sibling (skipping
// whitespace-only text) is a void or preformatted element; then it belongs to that sibling.
// Only whitespace is skipped, not other notes. Skipping notes would make a parent's
// note and the note of its first-child <img> ambiguous; since writing merges to one
// note per element, they sit in order [parent note][img note][img] and read back correctly.
// Known limit: a parent's note directly before an un-noted <img> first child reads as the img's.
function noteOwner(comment) {
  let next = comment.nextSibling;
  while (next?.nodeType === 3 && trimAscii(next.data) === '') next = next.nextSibling;
  return next?.nodeType === 1 && noteGoesBefore(next) ? next : comment.parentNode;
}

// { [element index]: note text }; several notes on one element join with newlines.
export function collectNotes(document, author) {
  const index = new Map([...document.querySelectorAll('*')].map((el, i) => [el, i]));
  const notes = {};
  for (const comment of allComments(document)) {
    if (!isNote(comment, author)) continue;
    const id = index.get(noteOwner(comment));
    if (id === undefined) continue;
    const text = noteText(comment, author);
    notes[id] = id in notes ? `${notes[id]}\n${text}` : text;
  }
  return notes;
}

export function removeNotes(document, author) {
  for (const comment of allComments(document)) {
    if (isNote(comment, author)) comment.remove();
  }
}

export function placeNote(el, text, author) {
  const comment = el.ownerDocument.createComment(` ${author}: ${escapeNoteText(text.trim())} `);
  if (noteGoesBefore(el) && el.parentNode) el.parentNode.insertBefore(comment, el);
  else el.insertBefore(comment, el.firstChild);
}

// ======================================================================
// Tier III: interface (filesystem gateway, HTTP helpers, client assets)
// ======================================================================

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The raw request path, percent-decoded. Done by hand because URL parsing
// would quietly resolve ".." before we can reject it.
function decodeRequestPath(rawUrl) {
  const raw = rawUrl.split(/[?#]/)[0];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.includes('\0')) throw new Error('null byte');
    return decoded;
  } catch {
    throw new HttpError(400, 'bad request path');
  }
}

export function resolveUnderRoot(root, urlPath) {
  const resolved = path.resolve(root, '.' + path.posix.sep + urlPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HttpError(403, 'forbidden');
  }
  return resolved;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};
const contentTypeFor = (file) =>
  CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'], 'Cache-Control': 'no-store' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(301, { Location: encodeURI(location) });
  res.end();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const escapeHtml = (s) => escapeText(s).replace(/"/g, '&quot;');

function directoryListing(urlPath, entries) {
  const visible = entries
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => b.isDirectory() - a.isDirectory() || a.name.localeCompare(b.name));
  const items = visible.map((e) => {
    const name = e.isDirectory() ? e.name + '/' : e.name;
    return `<li><a href="${escapeHtml(encodeURIComponent(e.name))}${e.isDirectory() ? '/' : ''}">${escapeHtml(name)}</a></li>`;
  });
  const up = urlPath === '/' ? '' : '<li><a href="../">../</a></li>';
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title></head>\n<body><h1>${escapeHtml(urlPath)}</h1>\n<ul>${up}${items.join('\n')}</ul></body></html>\n`;
}

// Client assets. Appended to the served copy after stamping, so none of it gets a data-n.
const CLIENT_CSS = `/* html-notes client styles */`;
const CLIENT_JS = `/* html-notes client script */`;

export function injectClient(document, notes) {
  const head = document.querySelector('head') ?? document.documentElement;
  const body = document.querySelector('body') ?? document.documentElement;

  const style = document.createElement('style');
  style.textContent = CLIENT_CSS;
  head.appendChild(style);

  const data = document.createElement('script');
  data.setAttribute('type', 'application/json');
  data.setAttribute('id', 'hn-notes');
  data.textContent = JSON.stringify(notes).replace(/</g, '\\u003c');
  body.appendChild(data);

  const script = document.createElement('script');
  script.textContent = CLIENT_JS;
  body.appendChild(script);
}

// Start only when run directly, not when imported by tests. This sits last so
// every constant above is initialized before main runs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
