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
  console.log = () => {};   // the server's lines: Announcements and conflicts; tests read the file
  try {
    await fn({
      dir, base,
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
  proto.scrollIntoView ??= function () {};
  proto.setSelectionRange ??= function () {};
  proto.select ??= function () {};
  document.execCommand = () => false;
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
    idOf: (selector) => el(selector).getAttribute('data-hrv'),
    box: () => layer.querySelector('.hrv-box'),
    field: () => layer.querySelector('.hrv-box textarea.hrv-directive'),
    marker: (selector) => layer.querySelector(`.hrv-marker[data-for="${tab.idOf(selector)}"]`),
    turns: () => [...layer.querySelectorAll('.hrv-box .hrv-turn')].map((t) => [t.querySelector('.hrv-who').textContent, t.querySelector('.hrv-says').textContent]),
    docket: () => layer.querySelector('.hrv-docket'),
    click(node) { node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })); },
    open(selector) { tab.click(el(selector)); },
    type(text, field = tab.field()) {
      field.value = text;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    button(text) { return [...layer.querySelectorAll('.hrv-box button')].find((b) => b.textContent === text); },
    done() { tab.click(tab.button('Done')); },
    connected: () => until(() => streams.length > 0).then(() => new Promise((r) => setTimeout(r, 100))),
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
