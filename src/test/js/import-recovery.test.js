const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/import-history.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function browser() {
  const calls = [], storage = new Map(), handlers = new Map(), listeners = new Map(), actions = new Map();
  const document = { addEventListener: (name, fn) => listeners.set(name, fn), dispatchEvent: () => {} };
  const element = () => ({
    append() { return this; }, empty() { return this; }, text(label) { this.label = label; return this; }, attr() { return this; },
    on(name, fn) { if (name === 'click' && this.label) actions.set(this.label, fn); return this; }
  });
  const documentElement = element(); documentElement.on = (name, fn) => { handlers.set(name, fn); return documentElement; };
  const $ = selector => selector === document ? documentElement : element();
  const api = { get(url) {
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ url, resolve, reject }); return promise;
  } };
  const window = { VeriqraApi: api, confirm: () => true, I18n: { t: key => key, formatDateTime: String, enumLabel: String },
    VeriqraQaNavigation: { read: () => ({}), href: () => '#runs', open: () => {} } };
  vm.runInNewContext(source, { window, document, jQuery: $, crypto: { subtle: crypto.webcrypto.subtle, randomUUID: crypto.randomUUID },
    Uint8Array, CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options.detail; } },
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  function emit(name, detail) { handlers.get('veriqra:' + name)?.({ originalEvent: { detail } }); }
  async function enter(actor, project = 7) {
    const start = calls.length;
    emit('project', { project: { id: project } }); emit('view', { view: 'automation' });
    // First entry performs auth + list; project changes while active can perform two read rounds.
    for (const call of calls.slice(start)) call.resolve(call.url === 'auth/me' ? { id: actor } : []);
    await flush();
  }
  return { api: window.VeriqraImportHistory, calls, storage, actions, enter, emit };
}
function file(text) { return { name: 'report.xml', arrayBuffer: async () => new TextEncoder().encode(text).buffer }; }

test('same report and details reuse the persisted request key; changed bytes or details cannot start a second request', async () => {
  const ui = browser(); await ui.enter(1);
  const intent = await ui.api.begin(file('<testsuite/>'), 'original fields');
  ui.api.finish(intent, 'unknown');
  const retry = await ui.api.begin(file('<testsuite/>'), 'original fields');
  assert.equal(retry.requestKey, intent.requestKey);
  assert.equal(retry.reused, true);
  ui.api.finish(retry, 'rejected');
  assert.equal(ui.storage.size, 1);
  await assert.rejects(() => ui.api.begin(file('<different/>'), 'original fields'), /pendingMismatch/);
  await assert.rejects(() => ui.api.begin(file('<testsuite/>'), 'edited fields'), /pendingMismatch/);
  assert.equal(JSON.parse(ui.storage.values().next().value).requestKey, intent.requestKey);
});

test('re-entering after a lost response looks up the original key without posting or importing again', async () => {
  const ui = browser(); await ui.enter(1);
  const { requestKey: key } = await ui.api.begin(file('report'), 'fields');
  const reloaded = browser();
  reloaded.storage.set('veriqra.import.1.7', ui.storage.get('veriqra.import.1.7'));
  await reloaded.enter(1);
  const lookup = reloaded.calls.find(call => call.url.endsWith('/requests/' + key));
  assert.ok(lookup);
  lookup.resolve({ testImport: { id: 3, originalFilename: 'report.xml', sourceNamespace: 'demo', reportSha256: 'hash', requestKey: key },
    run: { id: 8, name: 'Recovered run' }, attempts: [], runCases: [] });
  await flush(); assert.equal(reloaded.storage.size, 0);
});

test('pending requests remain isolated by account and project', async () => {
  const ui = browser(); await ui.enter(1);
  const first = await ui.api.begin(file('one'), 'fields');
  ui.emit('view', { view: 'runs' }); await ui.enter(2);
  const second = await ui.api.begin(file('two'), 'fields');
  assert.notEqual(first.requestKey, second.requestKey); assert.equal(ui.storage.size, 2);
  assert.ok(ui.storage.has('veriqra.import.1.7')); assert.ok(ui.storage.has('veriqra.import.2.7'));
});

test('a definite first rejection clears its original scope and accepts edited details with a new key', async () => {
  const ui = browser(); await ui.enter(1);
  const first = await ui.api.begin(file('report'), 'original');
  ui.emit('view', { view: 'runs' }); await ui.enter(2);
  const other = await ui.api.begin(file('other report'), 'other');
  ui.api.finish(first, 'rejected');
  assert.equal(ui.storage.has('veriqra.import.1.7'), false);
  assert.equal(JSON.parse(ui.storage.get('veriqra.import.2.7')).requestKey, other.requestKey);
  ui.emit('view', { view: 'runs' }); await ui.enter(1);
  const corrected = await ui.api.begin(file('report'), 'edited');
  assert.notEqual(corrected.requestKey, first.requestKey);
});

test('a missing lookup preserves the key until the user discards it', async () => {
  const ui = browser(); await ui.enter(1);
  const intent = await ui.api.begin(file('report'), 'fields');
  ui.api.finish(intent, 'unknown');
  const lookup = ui.calls.find(call => call.url.endsWith('/requests/' + intent.requestKey));
  lookup.reject({ status: 404 }); await flush();
  assert.equal(ui.storage.size, 1);
  assert.equal(typeof ui.actions.get('imports.discardPending'), 'function');
  ui.actions.get('imports.discardPending')();
  assert.equal(ui.storage.size, 0);
  const next = await ui.api.begin(file('report'), 'edited fields');
  assert.notEqual(next.requestKey, intent.requestKey);
});
