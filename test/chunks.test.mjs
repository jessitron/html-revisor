import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from '../formatter.mjs';
import { findChunks, report, annotate } from '../chunks.mjs';

// The chunk report of a body, without the body line itself.
const chunksOf = (body) => {
  const document = parse(`<html><body>${body}</body></html>`);
  return report(findChunks(document.querySelector('body'))).split('\n').slice(1).map((l) => l.slice(2)).join('\n');
};

test('a paragraph with inline markup is one prose chunk', () => {
  assert.equal(chunksOf('<p>Run <code>x</code>, <strong>now</strong>.</p>'), 'prose     <p>  Run <code>x</code>, <strong>now</strong>.');
});

test('a list is a container of prose items', () => {
  assert.equal(chunksOf('<ul><li>a</li><li>b</li></ul>'), 'container <ul>\n  prose     <li>  a\n  prose     <li>  b');
});

test('bare text beside a block is a run with no element', () => {
  assert.match(chunksOf('<div>before<ul><li>a</li></ul>after</div>'), /run {7}\(no element\) {2}before[\s\S]*run {7}\(no element\) {2}after/);
});

test('an svg inside a sentence is a token, not a boundary', () => {
  assert.equal(chunksOf('<p>Click <svg><circle></circle></svg> here.</p>'), 'prose     <p>  Click ⟦svg⟧ here.');
});

test('a pre is a code chunk', () => {
  assert.match(chunksOf('<pre><code>a\nb</code></pre>'), /^code {6}<pre> {2}<code>a⏎b<\/code>$/);
});

test('a paragraph of only nbsp is blank', () => {
  assert.equal(chunksOf('<p>&nbsp;</p>'), 'blank     <p>');
});

test('a link wrapping blocks is a container', () => {
  assert.match(chunksOf('<a href="#"><h4>T</h4><p>x</p></a>'), /^container <a>\n {2}prose {5}<h4>/);
});

test('annotating twice gives the same page', () => {
  const document = parse('<html><head></head><body><div class="ex"><p>a</p></div></body></html>');
  annotate(document);
  const once = serialize(document);
  annotate(document);
  assert.equal(serialize(document), once);
  assert.match(once, /<p data-chunk="prose">a<\/p>/);
  assert.match(once, /<pre class="chunk-report">prose/);
});
