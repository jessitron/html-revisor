// The client's sync engine in the tab (client-lib.mjs): what a save's answer does to the page,
// the box, and the docket, what the tab does when the file changes under it, and two tabs on
// one page. These pin what the client does today, ahead of moving it into tiers. Each test names
// the line of README's "Manual client checklist" it stands for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withServer, openTab, until } from './client-lib.mjs';

const RELOAD = 'the page changed on disk; reload to see it';

// Checklist: "Typing in the Content field changes the file within about half a second, and the
// page when the save answers."
test('a markdown save puts the answer\'s HTML in the page, and the box stays on the element', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    const id = tab.idOf('p');
    tab.type('First paragraph, **edited**', tab.content());
    assert.equal(tab.hint(), 'saving…');
    await until(() => tab.el(`[data-hrv="${id}"] strong`));
    assert.match(s.read('page.html'), /First paragraph, <strong>edited<\/strong>/);
    assert.equal(tab.el('p').innerHTML, 'First paragraph, <strong>edited</strong>', 'the HTML the server wrote, not the markdown');
    assert.equal(tab.idOf('p'), id, 'the paragraph keeps its ID');
    assert.equal(tab.layer.querySelector('.hrv-box .hrv-what').textContent, 'p · First paragraph, edited', 'the header reads the new text');
    await until(() => tab.hint() === 'saved');
    tab.type('First paragraph, **edited** twice', tab.content());
    await until(() => s.read('page.html').includes('twice'));
    assert.equal(s.read('page.html').split('First paragraph').length - 1, 1, 'the second save replaces the first');
    assert.equal(tab.message(), '');
    tab.close();
  }));

// Checklist: "Type a list's markdown into one sentence: the list becomes a paragraph, the box
// stays open on it, and the list's own directive moves to it."
test('a list typed into a sentence: the box, the directive, and the next save follow the ID that holds it now', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('ul');
    const listId = tab.idOf('ul');
    tab.type('tidy this');
    await until(() => s.read('page.html').includes('<!-- @AI: tidy this -->'));
    tab.type('one and two', tab.content());
    await until(() => !tab.el('ul'));
    const holder = [...tab.document.querySelectorAll('p')].at(-1);
    assert.equal(holder.textContent.trim(), 'one and two');
    const id = holder.getAttribute('data-hrv');
    assert.ok(tab.box(), 'the box stays open');
    assert.equal(tab.layer.querySelector('.hrv-box .hrv-what').textContent, 'p · one and two');
    assert.notEqual(id, listId, 'the paragraph is a new element, with an ID of its own');
    assert.equal(tab.layer.querySelector(`.hrv-marker[data-for="${listId}"]`), null, 'no marker on the old ID');
    assert.ok(tab.layer.querySelector(`.hrv-marker[data-for="${id}"]`), 'the directive\'s marker is on the paragraph');
    assert.match(s.read('page.html'), new RegExp(`<p data-hrv="${id}">\\s*<!-- @AI: tidy this -->\\s*one and two`));
    tab.type('tidy this, please');
    await until(() => s.read('page.html').includes('<!-- @AI: tidy this, please -->'));
    tab.type('one and two and three', tab.content());
    await until(() => s.read('page.html').includes('one and two and three'));
    assert.doesNotMatch(s.read('page.html'), /one and two</, 'the next save replaced the paragraph, not added one');
    assert.equal(tab.message(), '');
    tab.close();
  }));

// Checklist: "Edit one element in the file on disk while the tab is open, then type a directive
// on that element: the docket says it wasn't saved and suggests a reload, the box's footer says
// `not saved`, the file stays untouched, and the box keeps your text."
test('412: a directive on an element changed on disk is not saved, and the box keeps its text', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    s.write('page.html', s.read('page.html').replace('First paragraph', 'First paragraph, from an editor'));
    await until(() => tab.message() === RELOAD);
    assert.equal(tab.el('p').textContent, 'First paragraph', 'the tab can\'t show it without a reload');
    const onDisk = s.read('page.html');
    tab.open('p');
    tab.type('say more');
    await until(() => tab.hint() === 'not saved');
    assert.match(tab.message(), /^not saved: .+\. Copy what you wrote, then reload to see the page as it is now$/);
    assert.equal(s.read('page.html'), onDisk, 'the file is untouched');
    assert.equal(tab.field().value, 'say more');
    assert.ok(tab.marker('p'), 'the marker shows what you typed');
    tab.type('say more, again');
    await until(() => tab.hint() === 'not saved');
    assert.equal(s.read('page.html'), onDisk, 'each try is refused');
    tab.close();
  }));

// Checklist: "Edit a different element on disk: without typing, the docket says the page changed
// on disk. Type a directive: it saves."
test('another element changed on disk: the docket says the page changed, and a directive still saves', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    s.write('page.html', s.read('page.html').replace('Title', 'Title, from an editor'));
    await until(() => tab.message() === RELOAD);
    tab.open('p');
    tab.type('say more');
    await until(() => tab.hint() === 'saved');
    assert.ok(s.read('page.html').includes('<!-- @AI: say more -->'));
    assert.ok(s.read('page.html').includes('Title, from an editor'), 'the save keeps the other edit');
    assert.equal(tab.message(), RELOAD, 'the notice stays');
    assert.equal(tab.el('h1').textContent, 'Title', 'the heading shows after a reload');
    tab.close();
  }));

// Checklist: "Stopping the server and typing shows `save failed: ...` on the docket; restarting
// and typing again saves and clears it."
// The tab's live notices go on through this; a stopped server would end them too.
test('server down: "save failed", then typing again once it is back saves the latest text', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    s.down = true;
    tab.type('say more');
    await until(() => tab.message().startsWith('save failed'));
    assert.equal(tab.message(), 'save failed: Failed to fetch');
    assert.ok(tab.docket().classList.contains('hrv-error'));
    assert.equal(tab.hint(), '⌘↵ or esc to close', 'the footer goes back to the hint');
    tab.type('say more, please');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(tab.message(), 'save failed: Failed to fetch', 'still down');
    s.down = false;
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!s.read('page.html').includes('@AI'), 'nothing retries until you type');
    tab.type('say more, please, now');
    await until(() => tab.hint() === 'saved');
    assert.ok(s.read('page.html').includes('<!-- @AI: say more, please, now -->'));
    assert.equal(tab.message(), '', 'the error clears');
    assert.ok(!tab.docket().classList.contains('hrv-error'));
    tab.close();
  }));
