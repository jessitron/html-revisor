// Telemetry smoke tests. The rest of the suite runs with telemetry off; these check the switch,
// the spans a GET and a PUT make, and, given OTel variables that point at Honeycomb, that spans land
// there. The key needs Send Events, Manage Queries and Columns, and Run Queries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from '../vendor/linkedom.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(here, '..', 'server.mjs');

// The environment without any telemetry settings this shell might carry.
function cleanEnv(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OTEL_|HRV_TELEMETRY)/.test(k)));
  return { ...env, ...extra };
}

// A stand-in OTLP/HTTP collector. spans() flattens what it received.
async function withCollector(fn) {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      bodies.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const collector = {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    bodies,
    spans: () =>
      bodies.flatMap(({ body }) =>
        body.resourceSpans.flatMap((rs) =>
          rs.scopeSpans.flatMap((ss) => ss.spans.map((s) => ({ ...s, resource: attrs(rs.resource.attributes), attributes: attrs(s.attributes) }))),
        ),
      ),
  };
  try {
    await fn(collector);
  } finally {
    server.close();
  }
}

const attrs = (list = []) => Object.fromEntries(list.map(({ key, value }) => [key, Object.values(value)[0]]));

// Start the server on a copy of the fixtures, run fn, then stop it the way Ctrl-C does and wait
// for it to exit, so it has flushed its spans.
async function withServer(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-revisor-'));
  fs.cpSync(path.join(here, 'fixtures'), dir, { recursive: true });
  const child = spawn(process.execPath, [serverFile, dir, '--port', '0'], { env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((r) => child.on('exit', r));
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no startup line; stderr: ${stderr}`)), 5000);
      child.stdout.on('data', () => {
        const m = stdout.match(/html-revisor: (http:\/\/localhost:\d+\/) serving/);
        if (m) clearTimeout(timer), resolve(m[1]);
      });
      exited.then((code) => reject(new Error(`server exited ${code}; stderr: ${stderr}`)));
    });
    await fn({ base, stdout: () => stdout });
  } finally {
    child.kill('SIGINT');
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// One GET of page.html, under the given traceparent, and one directive PUT on its first <p>.
async function getAndPut(base, traceparent) {
  const html = await (await fetch(base + 'page.html', { headers: { traceparent } })).text();
  const { document } = parseHTML(html);
  const bases = JSON.parse(document.querySelector('script#hrv-bases').textContent);
  const id = document.querySelector('p').getAttribute('data-hrv');
  const res = await fetch(base + 'page.html', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, base: bases[id], directive: 'make it shorter' }),
  });
  assert.equal(res.status, 200);
  return id;
}

const traceId = () => crypto.randomBytes(16).toString('hex');

test('telemetry is off without HRV_TELEMETRY, even with an OTLP endpoint set', () =>
  withCollector(async (collector) => {
    const env = cleanEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint });
    await withServer(env, async ({ base, stdout }) => {
      await getAndPut(base, `00-${traceId()}-${'1'.repeat(16)}-01`);
      assert.doesNotMatch(stdout(), /telemetry on/);
    });
    assert.deepEqual(collector.bodies, []);
  }));

test('with HRV_TELEMETRY, a GET and a PUT send spans for their steps', () =>
  withCollector(async (collector) => {
    const env = cleanEnv({ HRV_TELEMETRY: '1', OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint, OTEL_SERVICE_NAME: 'hrv-test' });
    const trace = traceId(), parent = 'abcdef0123456789';
    let id;
    await withServer(env, async ({ base, stdout }) => {
      assert.match(stdout(), /telemetry on, to http:\/\/127\.0\.0\.1/);
      id = await getAndPut(base, `00-${trace}-${parent}-01`);
    });
    assert.ok(collector.bodies.every((b) => b.url === '/v1/traces'));
    const spans = collector.spans();
    const named = (name) => spans.filter((s) => s.name === name);

    const [get] = named('GET page');
    assert.ok(get, `no GET page span among ${spans.map((s) => s.name)}`);
    assert.equal(get.resource['service.name'], 'hrv-test');
    assert.equal(get.traceId, trace, 'GET continues the traceparent it was sent');
    assert.equal(get.parentSpanId, parent);
    assert.equal(get.attributes['hrv.page'], '/page.html');
    assert.equal(get.attributes['http.response.status_code'], 200);
    assert.ok(get.attributes['hrv.page.bytes'] > 0);
    assert.ok(get.attributes['hrv.answer.bytes'] > get.attributes['hrv.page.bytes']);
    const getSteps = spans.filter((s) => s.parentSpanId === get.spanId).map((s) => s.name);
    for (const step of ['read file', 'normalize', 'parse', 'directives', 'bases', 'markdowns', 'serialize']) {
      assert.ok(getSteps.includes(step), `GET has no ${step} step; it has ${getSteps}`);
    }

    const [put] = named('PUT change');
    assert.ok(put, 'no PUT change span');
    assert.equal(put.attributes['hrv.change.kind'], 'directive');
    assert.equal(put.attributes['hrv.scope.id'], id);
    assert.equal(put.attributes['hrv.directive.count'], 1);
    const putSteps = spans.filter((s) => s.parentSpanId === put.spanId).map((s) => s.name);
    for (const step of ['read file', 'parse', 'check base', 'set directive', 'serialize', 'write file', 'reparse', 'bases']) {
      assert.ok(putSteps.includes(step), `PUT has no ${step} step; it has ${putSteps}`);
    }
  }));

// Real spans, to Honeycomb, found again with the Query Data API. Runs when the shell's standard
// OTel variables point at Honeycomb, as .be sets them; the key comes from the headers.
const honeycombKey = /(?:^|,)\s*x-honeycomb-team=([^,]+)/i.exec(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '')?.[1];
const honeycombApi = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'https://api.honeycomb.io').replace(/\/$/, '');
const dataset = 'html-revisor-test';

async function honeycomb(method, apiPath, body) {
  const res = await fetch(honeycombApi + apiPath, {
    method,
    headers: { 'X-Honeycomb-Team': honeycombKey, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${apiPath}: ${res.status} ${text}`);
  return JSON.parse(text);
}

// How many spans in the dataset carry this run's ID, from the last ten minutes.
async function countRun(run) {
  const query = await honeycomb('POST', `/1/queries/${dataset}`, {
    calculations: [{ op: 'COUNT' }],
    filters: [{ column: 'hrv.test.run', op: '=', value: run }],
    time_range: 600,
  });
  let result = await honeycomb('POST', `/1/query_results/${dataset}`, { query_id: query.id, disable_series: true });
  while (!result.complete) {
    await new Promise((r) => setTimeout(r, 500));
    result = await honeycomb('GET', `/1/query_results/${dataset}/${result.id}`);
  }
  return result.data.results[0]?.data.COUNT ?? 0;
}

test('with HRV_TELEMETRY, spans land in Honeycomb', { skip: !honeycombKey && 'set OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key> to run', timeout: 120_000 }, async () => {
  const run = crypto.randomUUID();
  const env = cleanEnv({
    HRV_TELEMETRY: '1',
    OTEL_EXPORTER_OTLP_ENDPOINT: honeycombApi,
    OTEL_EXPORTER_OTLP_HEADERS: `x-honeycomb-team=${honeycombKey}`,
    OTEL_SERVICE_NAME: dataset,
    OTEL_RESOURCE_ATTRIBUTES: `hrv.test.run=${run}`,
  });
  await withServer(env, ({ base }) => getAndPut(base, `00-${traceId()}-${'1'.repeat(16)}-01`));
  // Ingest takes a few seconds; the column is new on a first run, so early queries can fail.
  let count = 0, lastError;
  for (const deadline = Date.now() + 90_000; Date.now() < deadline && count === 0; ) {
    await new Promise((r) => setTimeout(r, 3000));
    count = await countRun(run).catch((err) => ((lastError = err), 0));
  }
  assert.ok(count >= 2, `found ${count} spans for run ${run} in ${dataset}${lastError ? `; last error: ${lastError.message}` : ''}`);
});
