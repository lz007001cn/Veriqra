const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/automation-imports.js'), 'utf8');
const catalogs = Object.fromEntries(['en', 'zh-CN'].map(locale => [locale,
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../main/webapp/i18n/' + locale + '.json'), 'utf8'))]));
const flush = () => new Promise(resolve => setImmediate(resolve));

// Run the production module with deferred network responses, matching the other core browser fixtures.
function browser() {
  const nodes = new Map(), calls = [], listeners = new Map(), events = [];
  const location = { hash: '#automation' };
  let locale = 'en';
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.children = []; this.content = ''; this.value = '';
      this.classes = new Set((attrs.class || '').split(/\s+/)); this.handlers = new Map();
    }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    reportValidity() { return true; }
    reset() {
      const fields = this.attrs.id === 'automation-register' ? ['automation-namespace', 'automation-key'] : [];
      fields.forEach(id => { if (nodes.has(id)) nodes.get(id).value = ''; });
    }
  }
  class Collection {
    constructor(items) { this.items = items; this.length = items.length; items.forEach((node, index) => { this[index] = node; }); }
    each(fn) { this.items.forEach(node => fn(node)); return this; }
    text(value) { if (value === undefined) return this[0]?.content; return this.each(node => { node.content = String(value); node.children = []; }); }
    val(value) { if (value === undefined) return this[0]?.value || ''; return this.each(node => { node.value = String(value); }); }
    prop(name, value) { if (value === undefined) return this[0]?.[name]; return this.each(node => { node[name] = value; }); }
    attr(name, value) { return this.each(node => { node.attrs[name] = String(value); }); }
    empty() { return this.each(node => { node.children = []; node.content = ''; }); }
    append(...children) { return this.each(node => children.flatMap(child => child instanceof Collection ? child.items : [child]).forEach(child => node.children.push(child))); }
    addClass(value) { return this.each(node => value.split(/\s+/).forEach(name => node.classes.add(name))); }
    toggleClass(name, value) { return this.each(node => { if (value) node.classes.add(name); else node.classes.delete(name); }); }
    on(names, fn) { return this.each(node => names.split(' ').forEach(name => { if (!node.handlers.has(name)) node.handlers.set(name, []); node.handlers.get(name).push(fn); })); }
  }
  const documentNode = new Element('document');
  const document = { addEventListener(name, fn) { listeners.set(name, fn); }, dispatchEvent(event) { events.push(event); } };
  function $(selector) {
    if (selector === document) return new Collection([documentNode]);
    if (typeof selector !== 'string') return new Collection([selector]);
    if (selector.startsWith('<')) {
      const attrs = Object.fromEntries([...selector.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      return new Collection([new Element(/^<([\w-]+)/.exec(selector)[1], attrs)]);
    }
    if (selector.includes(',')) return new Collection(selector.split(',').flatMap(part => $(part.trim()).items));
    if (!nodes.has(selector.slice(1))) nodes.set(selector.slice(1), new Element('div', { id: selector.slice(1) }));
    return new Collection([nodes.get(selector.slice(1))]);
  }
  const api = {};
  for (const method of ['get', 'post', 'put', 'xml']) api[method] = (url, body) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ method, url, body, resolve, reject }); return promise;
  };
  const window = { VeriqraApi: api, confirm: () => true, I18n: {
    t: (key, values, fallback) => (catalogs[locale][key] || fallback || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? ''),
    enumLabel: String, formatNumber: String
  } };
  vm.runInNewContext(source, { window, document, location, jQuery: $, URLSearchParams, crypto: global.crypto,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } } });
  const fire = (node, name = 'click') => Promise.all((node.handlers.get(name) || []).map(fn => fn.call(node, { preventDefault() {} })));
  function emit(name, detail) {
    (documentNode.handlers.get(name) || []).forEach(fn => fn({ originalEvent: { detail } }));
    listeners.get(name)?.({ detail });
  }
  emit('veriqra:project', { project: { id: 7 } }); emit('veriqra:view', { view: 'automation' });
  return { $, nodes, calls, events, location, fire, emit, locale(value) { locale = value; emit('veriqra:localechange', {}); } };
}

const identity = { id: 20, source: 'JUNIT', namespace: 'suite', externalKey: 'example.Test' };
const caseRow = { id: 30, keyNo: 1, title: 'Login case', status: 'READY' };
const mapping = { automationIdentityId: 20, testCaseId: 30, status: 'ACTIVE', version: 2 };
function respondRows(ui, start, rows = [identity], mappings = []) {
  ui.calls[start].resolve(rows); ui.calls[start + 1].resolve(mappings); ui.calls[start + 2].resolve([caseRow]);
}
function button(ui, container, label) { return ui.nodes.get(container).all().find(node => node.tag === 'button' && node.content === label); }

for (const action of ['register', 'confirm', 'deactivate']) {
  test('saved automation ' + action + ' with failed refresh stays partial success and Retry never repeats the mutation', async () => {
    const ui = browser(); respondRows(ui, 0, [identity], action === 'deactivate' ? [mapping] : []); await flush();
    let saving;
    if (action === 'register') {
      ui.$('#automation-namespace').val('suite'); ui.$('#automation-key').val('other.Test');
      saving = ui.fire(ui.$('#automation-register')[0], 'submit');
    } else {
      if (action === 'confirm') ui.nodes.get('automation-identities').all().find(node => node.tag === 'select').value = '30';
      saving = ui.fire(button(ui, 'automation-identities', action === 'confirm' ? catalogs.en['automation.confirmMapping'] : catalogs.en['automation.deactivateMapping']));
    }
    const write = ui.calls.at(-1); assert.notEqual(write.method, 'get'); write.resolve({}); await flush();
    const refresh = ui.calls.length - 3;
    ui.calls[refresh].reject({ status: 500, message: 'Identity reads unavailable' });
    ui.calls[refresh + 1].resolve([]); ui.calls[refresh + 2].resolve([]); await saving;
    assert.equal(ui.$('#automation-status').text(), catalogs.en['common.unavailable']);
    assert.match(ui.$('#automation-notice').text(), /Saved, but identities/);
    assert.equal(ui.$('#automation-notice')[0].classes.has('alert-warning'), true);
    assert.equal(ui.$('#automation-notice')[0].classes.has('alert-danger'), false);
    assert.equal(ui.nodes.get('automation-identities').all().some(node => node.tag === 'strong'), false);
    ui.locale('zh-CN');
    assert.match(ui.$('#automation-notice').text(), /已保存/);
    const before = ui.calls.length; const retrying = ui.fire(button(ui, 'automation-identities', catalogs['zh-CN']['common.retry']));
    assert.equal(ui.calls.length, before + 3); assert.equal(ui.calls.slice(before).every(call => call.method === 'get'), true);
    respondRows(ui, before, [], []); await retrying;
    assert.equal(ui.calls.filter(call => call.method !== 'get').length, 1);
    assert.equal(ui.$('#automation-notice')[0].classes.has('alert-success'), true);
  });
}

test('failed automation refresh cannot restore cached identity rows or clear its error on locale change', async () => {
  const ui = browser(); respondRows(ui, 0); await flush();
  ui.$('#automation-namespace').val('Unsaved namespace'); await ui.fire(ui.$('#automation-refresh')[0]);
  ui.calls[3].reject({ status: 403, message: 'Identity read denied' }); ui.calls[4].resolve([]); ui.calls[5].resolve([]); await flush();
  const before = ui.calls.length; ui.locale('zh-CN');
  assert.equal(ui.calls.length, before); assert.equal(ui.nodes.get('automation-identities').all().some(node => node.tag === 'strong'), false);
  assert.equal(ui.$('#automation-notice').text(), 'Identity read denied');
  assert.equal(ui.$('#automation-notice')[0].classes.has('alert-danger'), true);
  assert.equal(ui.$('#automation-namespace').val(), 'Unsaved namespace');
  const retry = button(ui, 'automation-identities', catalogs['zh-CN']['common.retry']);
  ui.emit('veriqra:view', { view: 'dashboard' }); const requests = ui.calls.length;
  await ui.fire(retry); assert.equal(ui.calls.length, requests, 'A stale Retry does not fetch for another view');
});

test('JUnit success and replay show imported attempt counts before the optional run action', async () => {
  for (const replayed of [false, true]) {
    const ui = browser(); respondRows(ui, 0); await flush();
    ui.$('#import-file')[0].files = [{ name: 'junit.xml', size: 1000 }];
    await ui.fire(ui.$('#import-file')[0], 'change');
    ui.$('#import-namespace').val('suite'); ui.$('#import-run-name').val('Imported run');
    const preview = ui.fire(ui.$('#import-preview-button')[0]);
    ui.calls.at(-1).resolve({ readyToImport: true, mappedResults: [{ testCase: caseRow,
      result: { namespace: 'suite', externalKey: 'example.Test', outcome: 'PASS' } }], unknownIdentities: [], invalidEntries: [] });
    await preview;
    const importing = ui.fire(ui.$('#import-form')[0], 'submit');
    const result = { testImport: { id: 51 }, run: { id: 52, name: 'Imported run', status: 'COMPLETED' }, runCases: [caseRow],
      attempts: [{ outcome: 'FAIL' }, { outcome: 'PASS' }, { outcome: 'SKIPPED' }, { outcome: 'PASS' }], replayed };
    ui.calls.at(-1).resolve(result); await importing;
    assert.equal(ui.nodes.get('import-preview').all().length, 0);
    assert.ok(ui.nodes.get('import-result').all().some(node => node.content === 'Passed 2 · Failed 1 · Skipped 1'));
    assert.equal(ui.events.length, 0);
    assert.equal(ui.calls.length, 5, 'Only the initial reads, preview and import have run');
    if (replayed) {
      ui.emit('veriqra:import-recovered', { projectId: 7, result });
      ui.locale('zh-CN');
      assert.ok(ui.nodes.get('import-result').all().some(node => node.content === '通过 2 · 失败 1 · 跳过 1'));
    }
    await ui.fire(button(ui, 'import-result', replayed ? '查看运行结果' : 'View run results'));
    assert.equal(ui.events[0].type, 'veriqra:open-run');
    assert.equal(ui.events[0].detail.projectId, '7'); assert.equal(ui.events[0].detail.runId, 52);
    assert.equal(ui.location.hash, '#runs'); assert.equal(ui.calls.length, 5);
  }
});
