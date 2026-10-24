// The client, client.js, run in a tab made of linkedom, against a real server on a copy of the
// fixtures. No browser: the tab has no layout, so these tests check what the box, the markers,
// and the docket say and what reaches the file, not where anything sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from '../vendor/linkedom.mjs';
import { createServer } from '../server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');

// A server on a fresh copy of the fixtures, in this process.
async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-revisor-client-'));
  fs.cpSync(path.join(here, 'fixtures'), dir, { recursive: true });
  const server = createServer({ root: dir, author: '@AI' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const log = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));   // the server's lines: Announcements and conflicts
  try {
    await fn({
      dir, base,
      announcements: () => lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)),
      read: (name) => fs.readFileSync(path.join(dir, name), 'utf8'),
      write: (name, text) => fs.writeFileSync(path.join(dir, name), text),
    });
  } finally {
    console.log = log;
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// An EventSource over fetch: the tab hears the server's live notices.
function eventSourceFor(base, streams) {
  return class {
    constructor(url) {
      this.listeners = {};
      this.abort = new AbortController();
      streams.push(this);
      fetch(base + url, { headers: { Accept: 'text/event-stream' }, signal: this.abort.signal }).then(async (res) => {
        let buffer = '';
        for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const event = block.match(/^event: (.*)$/m)?.[1];
            const data = block.match(/^data: (.*)$/m)?.[1];
            (this.listeners[event] ?? []).forEach((f) => f({ data }));
          }
        }
      }).catch(() => {});
    }
    addEventListener(type, f) { (this.listeners[type] ??= []).push(f); }
    close() { this.abort.abort(); }
  };
}

// Open a page in a tab: GET it, parse it, and run client.js on it. The tab's fetches go to the
// server; its localStorage is a Map that a second tab can share.
async function openTab(s, name, { storage = new Map() } = {}) {
  const html = await (await fetch(`${s.base}/${name}`)).text();
  const window = parseHTML(html);
  const { document } = window;
  // What linkedom leaves out, that the client calls.
  const proto = window.HTMLElement.prototype;
  const scrolled = [];
  proto.scrollIntoView = function () { scrolled.push(this); };
  proto.setSelectionRange ??= function () {};
  proto.select ??= function () {};
  document.execCommand = () => false;
  Object.assign(window.Node, { DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4 });
  const streams = [];
  const timers = new Set();
  const context = {
    window, document, Node: window.Node, Element: window.Element, Event: window.Event,
    location: { pathname: '/' + name },
    navigator: { platform: 'MacIntel', sendBeacon: () => true },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (f) => setTimeout(f, 0),
    fetch: (url, options) => fetch(s.base + url, options),
    EventSource: eventSourceFor(s.base, streams),
    setTimeout: (f, ms) => { const t = setTimeout(() => { timers.delete(t); f(); }, ms); timers.add(t); return t; },
    clearTimeout: (t) => { timers.delete(t); clearTimeout(t); },
    crypto, performance, Blob, Uint8Array, JSON,
  };
  Object.assign(window, { scrollX: 0, scrollY: 0, EventSource: context.EventSource });
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  const layer = document.getElementById('hrv-layer');
  const el = (selector) => document.querySelector(selector);
  const tab = {
    window, document, layer, el,
    // The element the docket last stepped to: its tag. No layout, so no tip shows.
    steppedTo: () => scrolled.at(-1)?.localName,
    steps: () => scrolled.length,
    idOf: (selector) => el(selector).getAttribute('data-hrv'),
    box: () => layer.querySelector('.hrv-box'),
    field: () => layer.querySelector('.hrv-box textarea.hrv-directive'),
    marker: (selector) => layer.querySelector(`.hrv-marker[data-for="${tab.idOf(selector)}"]`),
    turns: () => [...layer.querySelectorAll('.hrv-box .hrv-turn')].map((t) => [t.querySelector('.hrv-who').textContent, t.querySelector('.hrv-says').textContent]),
    docket: () => layer.querySelector('.hrv-docket'),
    message: () => layer.querySelector('.hrv-docket-msg').textContent,
    label: () => layer.querySelector('.hrv-box textarea.hrv-directive').previousElementSibling.firstChild.textContent,
    click(node) { node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })); },
    open(selector) { tab.click(el(selector)); },
    type(text, field = tab.field()) {
      field.value = text;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    button(text) { return [...layer.querySelectorAll('.hrv-box button')].find((b) => b.textContent === text); },
    done() { tab.click(tab.button('Done')); },
    connected: () => until(() => streams.length > 0).then(() => new Promise((r) => setTimeout(r, 100))),
    // The tab stops hearing live notices, as when one is on its way while the tab saves.
    deafen() { streams.forEach((e) => e.close()); },
    close() { streams.forEach((e) => e.close()); timers.forEach((t) => clearTimeout(t)); },
  };
  await tab.connected();
  return tab;
}

async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const got = await check();
    if (got) return got;
    if (Date.now() > end) throw new Error(`timed out waiting for ${check}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// The agent's reply, as reply.mjs sends it. The thread base comes from a stale try's answer,
// as an agent that read the Announcement late would get it.
async function reply(s, name, id, text) {
  const put = (thread) => fetch(`${s.base}/${name}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, thread, reply: text }),
  }).then((res) => res.json());
  const stale = await put('none');
  const landed = await put(stale.thread);
  assert.ok(landed.ok, JSON.stringify(landed));
  return landed;
}

test('the tab: typing in the box saves the directive into the file', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    assert.ok(tab.box(), 'a box opens');
    tab.type('say more');
    await until(() => s.read('page.html').includes('<!-- @AI: say more -->'));
    tab.done();
    assert.equal(tab.box(), null);
    assert.ok(tab.marker('p'), 'the paragraph has a marker');
    tab.close();
  }));

test('the tab: a reply to a closed box turns its marker to the bubble, without a reload', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    tab.type('add a diagram');
    tab.done();
    await until(() => s.read('page.html').includes('<!-- @AI: add a diagram -->'));
    await reply(s, 'page.html', tab.idOf('p'), 'Added one.');
    await until(() => tab.marker('p').classList.contains('hrv-answered'));
    tab.close();
  }));

// The turns of the file's thread on the paragraph, in order.
const turnsInFile = (text) => [...text.matchAll(/<!-- (@AI|@Human): (.*?) -->/g)].map((m) => [m[1], m[2]]);

test('a reply to the open box joins its thread; what you add after it is one new turn', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    assert.equal(tab.label(), 'Directive');
    tab.type('add a diagram');
    await until(() => s.read('page.html').includes('<!-- @AI: add a diagram -->'));
    await reply(s, 'page.html', tab.idOf('p'), 'Added one.');
    await until(() => tab.turns().length === 2);
    assert.deepEqual(tab.turns(), [['you', 'add a diagram'], ['agent', 'Added one.']]);
    assert.equal(tab.field().value, '', 'what you sent went up into the thread');
    assert.equal(tab.label(), 'You');
    assert.ok(tab.button('Resolve'), 'Resolve shows once there is a thread');
    assert.equal(tab.message(), '', 'no notice to close the box');
    tab.type('and a caption');
    await until(() => s.read('page.html').includes('and a caption'));
    tab.done();
    await until(() => s.announcements().length === 1);
    assert.deepEqual(turnsInFile(s.read('page.html')), [['@AI', 'add a diagram'], ['@Human', 'Added one.'], ['@AI', 'and a caption']]);
    assert.deepEqual(s.announcements()[0].directive, { before: '', after: 'and a caption' }, 'Done tells what you added since the reply');
    tab.close();
  }));

test('Done after a reply came into the open box, with nothing added, announces nothing new', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    tab.type('add a diagram');
    tab.done();
    await until(() => s.announcements().length === 1);
    tab.open('p');
    await reply(s, 'page.html', tab.idOf('p'), 'Added one.');
    await until(() => tab.turns().at(-1)[1] === 'Added one.');
    tab.done();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(s.announcements().length, 1);
    tab.close();
  }));

test('a turn typed before the tab heard of a reply is refused, and what was past the sent turn goes after the reply, once', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    tab.type('add a diagram');
    await until(() => s.read('page.html').includes('<!-- @AI: add a diagram -->'));
    tab.deafen();
    await reply(s, 'page.html', tab.idOf('p'), 'Added one.');
    tab.type('add a diagram with arrows');
    await until(() => tab.turns().length === 2);
    assert.equal(tab.field().value, 'with arrows');
    await until(() => s.read('page.html').includes('with arrows'));
    assert.deepEqual(turnsInFile(s.read('page.html')), [['@AI', 'add a diagram'], ['@Human', 'Added one.'], ['@AI', 'with arrows']]);
    assert.equal(tab.message(), '');
    tab.close();
  }));

test('a closed box whose last turn was refused for a reply sends what is left, then Done announces it', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    tab.type('add a diagram');
    await until(() => s.read('page.html').includes('<!-- @AI: add a diagram -->'));
    tab.deafen();
    await reply(s, 'page.html', tab.idOf('p'), 'Added one.');
    tab.type('add a diagram with arrows');
    tab.done();
    await until(() => s.announcements().length === 1);
    assert.deepEqual(turnsInFile(s.read('page.html')), [['@AI', 'add a diagram'], ['@Human', 'Added one.'], ['@AI', 'with arrows']]);
    assert.deepEqual(s.announcements()[0].directive, { before: '', after: 'with arrows' });
    assert.equal(tab.message(), '');
    tab.close();
  }));

test('working: your turn is last and its box closed; the box shows the agent working, and the field adds a turn', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    tab.type('add a diagram');
    assert.ok(!tab.marker('p').classList.contains('hrv-working'), 'the pencil while you write');
    tab.done();
    const working = () => tab.marker('p').classList.contains('hrv-working');
    assert.ok(working(), 'closed, the agent has it');
    assert.equal(tab.marker('p').getAttribute('aria-label'), 'Agent working on: add a diagram');
    await until(() => s.announcements().length === 1);

    tab.open('p');
    assert.deepEqual(tab.turns(), [['you', 'add a diagram'], ['agent', 'working']]);
    assert.ok(tab.layer.querySelector('.hrv-box .hrv-turn.hrv-agent .hrv-dots'), 'the agent\'s turn shows the squares');
    assert.ok(tab.layer.querySelector('.hrv-box .hrv-head .hrv-icon').classList.contains('hrv-icon-working'));
    assert.equal(tab.field().value, '', 'what you sent stays as you wrote it; the field is your next turn');
    assert.equal(tab.label(), 'You');
    assert.ok(tab.button('Resolve'));
    assert.ok(!working(), 'open, it is the pencil again');
    tab.type('and a caption');
    await until(() => s.read('page.html').includes('and a caption'));
    assert.match(s.read('page.html'), /<!-- @AI: add a diagram\nand a caption -->/);
    tab.done();
    await until(() => s.announcements().length === 2);
    assert.deepEqual(s.announcements()[1].directive, { before: 'add a diagram', after: 'add a diagram\nand a caption' });
    assert.ok(working());

    await reply(s, 'page.html', tab.idOf('p'), 'Added both.');
    await until(() => tab.marker('p').classList.contains('hrv-answered'));
    assert.ok(!working(), 'the reply ends it');
    tab.open('p');
    assert.deepEqual(tab.turns(), [['you', 'add a diagram\nand a caption'], ['agent', 'Added both.']]);
    assert.ok(!tab.layer.querySelector('.hrv-box .hrv-head .hrv-icon').classList.contains('hrv-icon-working'));
    tab.close();
  }));

test('the docket counts new replies in a second row, steps through them, and rings green when one comes', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    const row2 = () => tab.layer.querySelector('.hrv-docket-main.hrv-row2').textContent;
    const stacked = () => tab.docket().classList.contains('hrv-stacked');
    for (const selector of ['h1', 'p', 'li']) {
      tab.open(selector);
      tab.type('look here');
      tab.done();
    }
    await until(() => s.announcements().length === 3);
    assert.ok(!stacked(), 'no new replies: one row');
    await reply(s, 'page.html', tab.idOf('li'), 'Looked.');
    await until(stacked);
    assert.equal(row2(), '1 new reply');
    assert.ok(tab.docket().classList.contains('hrv-arrived'), 'a green ring');
    await reply(s, 'page.html', tab.idOf('h1'), 'Seen.');
    await until(() => row2() === '2 new replies');
    const [up, down] = [...tab.layer.querySelectorAll('.hrv-step.hrv-row2')];
    assert.equal(down.title, 'Next new reply');
    tab.click(down);
    assert.equal(tab.steppedTo(), 'h1', 'the first new reply in the page');
    tab.click(down);
    assert.equal(tab.steppedTo(), 'li', 'the paragraph, with no reply, is skipped');
    tab.click(down);
    assert.equal(tab.steppedTo(), 'h1', 'wraps around');
    tab.click(up);
    assert.equal(tab.steppedTo(), 'li');
    await until(() => !tab.docket().classList.contains('hrv-arrived'), 3000);
    tab.open('li');
    tab.type('thanks');
    assert.equal(row2(), '1 new reply', 'a turn takes it off the second row');
    tab.close();
  }));

test('review off: the docket hides its arrows, and ⌥↓ goes to the page', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    tab.type('look here');
    tab.done();
    const altDown = () => {
      const e = new tab.window.Event('keydown', { bubbles: true, cancelable: true });
      Object.assign(e, { key: 'ArrowDown', altKey: true });
      tab.document.body.dispatchEvent(e);
    };
    altDown();
    assert.equal(tab.steppedTo(), 'p', 'review on, it steps');
    tab.click(tab.layer.querySelector('.hrv-docket-main'));
    assert.ok(tab.docket().classList.contains('hrv-off'));
    const steps = tab.steps();
    altDown();
    assert.equal(tab.steps(), steps, 'review off, no step');
    const css = fs.readFileSync(path.join(here, '..', 'client.css'), 'utf8');
    assert.match(css, /\.hrv-docket\.hrv-off \.hrv-step \{ display: none; \}/, 'the arrows hide');
    tab.close();
  }));

test('a reply stays new through opening the box and reloading, until you add a turn or Resolve', () =>
  withServer(async (s) => {
    const storage = new Map();
    const tab = await openTab(s, 'page.html', { storage });
    tab.open('p');
    tab.type('add a diagram');
    tab.done();
    await until(() => s.announcements().length === 1);
    await reply(s, 'page.html', tab.idOf('p'), 'Added one.');
    const isNew = (t) => t.marker('p').classList.contains('hrv-answered');
    await until(() => isNew(tab));
    tab.open('p');
    tab.done();
    assert.ok(isNew(tab), 'opening the box leaves it new');
    tab.close();
    const again = await openTab(s, 'page.html', { storage });
    assert.ok(isNew(again), 'a reload too');
    assert.equal(storage.size, 0, 'the browser keeps nothing');
    again.open('p');
    again.type('and a caption');
    assert.ok(!isNew(again), 'a turn of yours makes it yours to wait on');
    again.type('');
    assert.ok(isNew(again), 'emptying the turn brings it back');
    again.click(again.button('Resolve'));
    assert.equal(again.marker('p'), null, 'Resolve ends the thread');
    again.close();
  }));

// A literal <p> typed in a paragraph's Content box is raw HTML, and a paragraph can't hold one:
// the file splits it into paragraphs. The box goes on editing all of them, so each later save
// replaces them instead of adding a copy beside them.
test('a <p> typed in the Content box splits the paragraph; the next saves replace the split, not copy it', () =>
  withServer(async (s) => {
    const tab = await openTab(s, 'page.html');
    tab.open('p');
    const content = () => tab.layer.querySelector('.hrv-box textarea.hrv-text');
    const paragraphs = () => (s.read('page.html').match(/<p[ >]/g) ?? []).length;
    const before = paragraphs();
    const saves = ['I edited a <p>, with newlines', 'I edited a <p>, with newlines, and', 'I edited a <p>, with newlines, and got'];
    for (const text of saves) {
      tab.type(text, content());
      await until(() => s.read('page.html').includes(text.split('<p>')[1] + '</p>'));
    }
    assert.equal(s.read('page.html').split(', with newlines').length - 1, 1, 'one copy of the text after the <p>');
    assert.equal(paragraphs(), before + 2, 'the split made two more paragraphs, once');
    assert.equal(tab.document.body.innerHTML.split(', with newlines').length - 1, 1, 'the tab shows one copy too');
    tab.type('I edited a paragraph', content());
    await until(() => s.read('page.html').includes('I edited a paragraph'));
    assert.equal(paragraphs(), before, 'markdown without the <p> puts back one paragraph');
    assert.equal(tab.document.body.innerHTML.split(', with newlines').length - 1, 0, 'and so does the tab');
    assert.ok(tab.box(), 'the box stays open');
    tab.close();
  }));
