// Architecture: the import graph of the code, read from the source. No module imports itself
// through others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['vendor', 'test', 'node_modules', '.claude', '.git', '.yaks']);

// Every .mjs file of ours, as a path from the root.
function sources(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith('.mjs') ? [path.relative(ROOT, full)] : [];
  });
}

// What a file imports: './x.mjs' resolved to a path from the root, 'node:fs' as it is.
// Static imports, re-exports, and dynamic import() of a string.
function importsOf(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const specifiers = [...text.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
  return specifiers.map((s) => (s.startsWith('.') ? path.normalize(path.join(path.dirname(file), s)) : s));
}

export const graph = () => new Map(sources().map((f) => [f, importsOf(f)]));

// Each cycle as the list of files around it, first file repeated at the end.
function cycles(edges) {
  const found = [];
  const done = new Set();
  const visit = (file, trail) => {
    const at = trail.indexOf(file);
    if (at >= 0) return found.push([...trail.slice(at), file]);
    if (done.has(file)) return;
    for (const next of edges.get(file) ?? []) if (edges.has(next)) visit(next, [...trail, file]);
    done.add(file);
  };
  for (const file of edges.keys()) visit(file, []);
  return found;
}

test('the source files are found, imports and all', () => {
  const edges = graph();
  assert.ok(edges.has('server.mjs'));
  assert.ok(edges.get('server.mjs').includes('node:http'));
});

test('no import cycles', () => {
  assert.deepEqual(cycles(graph()).map((c) => c.join(' → ')), []);
});

test('the cycle finder finds a cycle', () => {
  const edges = new Map([['a', ['b']], ['b', ['c']], ['c', ['a']], ['d', ['a']]]);
  assert.deepEqual(cycles(edges), [['a', 'b', 'c', 'a']]);
});
