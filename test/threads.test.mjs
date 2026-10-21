// Threads: an element's directives and the agent's replies, as HTML comments in the file
// (REPLY-DESIGN.html). Where a reply goes, that it reads back, that it changes no base, and
// that cleanup takes it out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../domain/format.mjs';
import { parse, serialize } from '../domain/canonical.mjs';
import { elementById } from '../domain/identity.mjs';
import { baseOf } from '../domain/bases.mjs';
import { cleanup } from '../domain/cleanup.mjs';
import { placeReply, threadOf, collectDirectives, removeThreads, setDirective } from '../domain/directives.mjs';

const page = (body) => parse(normalize(body));
const idOf = (document, selector) => document.querySelector(selector).getAttribute('data-hrv');
const turns = (...pairs) => pairs.map(([prefix, text]) => ({ prefix, text }));

test('a reply goes after the directive, and the thread reads back in order', () => {
  const document = page('<p><!-- @AI: add a diagram -->Where it is headed</p>');
  const p = document.querySelector('p');
  placeReply(p, 'Added one below.', '@AI');
  assert.match(serialize(document), /<!-- @AI: add a diagram -->\s*<!-- @Human: Added one below. -->/);
  assert.deepEqual(threadOf(p, '@AI'), turns(['@AI', 'add a diagram'], ['@Human', 'Added one below.']));
});

test('turns alternate: each reply goes after the last turn', () => {
  const document = page('<p><!-- @AI: one --><!-- @Human: two --><!-- @AI: three -->text</p>');
  const p = document.querySelector('p');
  placeReply(p, 'four', '@AI');
  const reread = parse(serialize(document)).querySelector('p');
  assert.deepEqual(threadOf(reread, '@AI'), turns(['@AI', 'one'], ['@Human', 'two'], ['@AI', 'three'], ['@Human', 'four']));
});

test('a reply on an image goes before it, after its directive', () => {
  const document = page('<div><p>a</p><!-- @AI: crop it --><img src="a.png" alt="a"></div>');
  const img = document.querySelector('img');
  placeReply(img, 'Cropped.', '@AI');
  const reread = parse(serialize(document));
  assert.deepEqual(threadOf(reread.querySelector('img'), '@AI'), turns(['@AI', 'crop it'], ['@Human', 'Cropped.']));
  assert.deepEqual(threadOf(reread.querySelector('div'), '@AI'), []);
});

test("when the first child is an image, the parent's thread goes last, apart from the image's", () => {
  const document = page('<figure><!-- @AI: bigger --><img src="a.png" alt="a"><figcaption>A</figcaption></figure>');
  const figure = document.querySelector('figure');
  setDirective(figure, 'caption?', '@AI');
  placeReply(figure, 'Added one.', '@AI');
  placeReply(document.querySelector('img'), 'Done.', '@AI');
  const reread = parse(serialize(document));
  assert.equal(reread.querySelector('figure').lastElementChild.localName, 'figcaption');
  assert.equal(reread.querySelector('figure').lastElementChild.nextSibling.nextSibling.data, ' @AI: caption? ');
  assert.deepEqual(threadOf(reread.querySelector('figure'), '@AI'), turns(['@AI', 'caption?'], ['@Human', 'Added one.']));
  assert.deepEqual(threadOf(reread.querySelector('img'), '@AI'), turns(['@AI', 'bigger'], ['@Human', 'Done.']));
});

test('a thread on a pre, several turns long, stays the pre\'s', () => {
  const document = page('<div><pre>code</pre></div>');
  const pre = document.querySelector('pre');
  setDirective(pre, 'explain', '@AI');
  placeReply(pre, 'It loops.', '@AI');
  const reread = parse(serialize(document));
  assert.deepEqual(threadOf(reread.querySelector('pre'), '@AI'), turns(['@AI', 'explain'], ['@Human', 'It loops.']));
  assert.deepEqual(threadOf(reread.querySelector('div'), '@AI'), []);
});

test('a reply with no directive goes where a directive would', () => {
  const document = page('<p>text</p>');
  placeReply(document.querySelector('p'), 'unasked', '@AI');
  assert.match(serialize(document), /<p data-hrv="\d+">\s*<!-- @Human: unasked -->\s*text/);
});

test('reply text that would end the comment is escaped', () => {
  const document = page('<p><!-- @AI: arrows? -->text</p>');
  placeReply(document.querySelector('p'), 'a --> b', '@AI');
  assert.deepEqual(threadOf(parse(serialize(document)).querySelector('p'), '@AI').at(-1), { prefix: '@Human', text: 'a - -&gt; b' });
});

test('replies are not directives: the tab gets only your turns', () => {
  const document = page('<p><!-- @AI: one --><!-- @Human: two -->text</p>');
  assert.deepEqual(Object.values(collectDirectives(document, '@AI')), ['one']);
});

test('a reply changes no base', () => {
  const document = page('<section><p>text</p></section>');
  const [section, p] = [document.querySelector('section'), document.querySelector('p')];
  const before = [baseOf(section, '@AI'), baseOf(p, '@AI')];
  placeReply(p, 'noted', '@AI');
  const reread = parse(serialize(document));
  const id = idOf(document, 'p');
  assert.deepEqual([baseOf(reread.querySelector('section'), '@AI'), baseOf(elementById(reread, id), '@AI')], before);
});

test('removeThreads takes out directives and replies, and leaves other comments', () => {
  const document = page('<p><!-- @AI: one --><!-- @Human: two --><!-- ordinary -->text</p>');
  removeThreads(document, '@AI');
  assert.doesNotMatch(serialize(document), /@AI|@Human/);
  assert.match(serialize(document), /<!-- ordinary -->/);
});

test('cleanup takes out replies, and lists only the directives', () => {
  const { html, removed } = cleanup(normalize('<p><!-- @AI: one --><!-- @Human: two -->text</p>'));
  assert.doesNotMatch(html, /@Human/);
  assert.deepEqual(removed, ['one']);
});
