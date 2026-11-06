const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const web = path.resolve(__dirname, '../../main/webapp');
const source = fs.readFileSync(path.join(web, 'assets/js/release-acceptance.js'), 'utf8');
const catalogs = Object.fromEntries(['en', 'zh-CN'].map(locale => [locale,
  JSON.parse(fs.readFileSync(path.join(web, 'i18n', locale + '.json'), 'utf8'))]));
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function browser({ canWrite = true, acceptanceId, locale = 'en' } = {}) {
  const nodes = new Map(), calls = [], listeners = new Map(), guards = new Map();
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag;
      this.attrs = attrs;
      this.value = '';
      this.content = '';
      this.children = [];
      this.handlers = new Map();
      this.classes = new Set((attrs.class || '').split(/\s+/));
    }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    textContent() { return this.content + this.children.map(child => child.textContent()).join(' '); }
  }
  class Collection extends Array {
    each(fn) { this.forEach((node, index) => fn.call(node, index, node)); return this; }
    append(...children) { return this.each(function () { children.forEach(child => this.children.push(...child)); }); }
    text(value) { return this.each(function () { this.content = String(value); this.children = []; }); }
    val(value) { if (value === undefined) return this[0]?.value; return this.each(function () { this.value = String(value); }); }
    empty() { return this.each(function () { this.children = []; this.content = ''; }); }
    prop(key, value) { return this.each(function () { this[key] = value; }); }
    attr(key, value) { return this.each(function () { this.attrs[key] = String(value); }); }
    addClass(value) { return this.each(function () { value.split(/\s+/).forEach(name => this.classes.add(name)); }); }
    toggleClass(name, value) { return this.each(function () { if (value) this.classes.add(name); else this.classes.delete(name); }); }
    find(selector) { return Collection.from(this.flatMap(node => node.all().filter(child => child.tag === selector))); }
    on(event, handler) {
      return this.each(function () { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(handler); });
    }
  }
  const document = new Element('document');
  document.addEventListener = (type, fn) => listeners.set(type, fn);
  function $(input) {
    if (input instanceof Element) return Collection.from([input]);
    if (input.startsWith('<')) {
      const attrs = Object.fromEntries([...input.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      return Collection.from([new Element(/^<([\w-]+)/.exec(input)[1], attrs)]);
    }
    if (input.includes(',')) return Collection.from(input.split(',').flatMap(selector => $(selector.trim())));
    if (!nodes.has(input)) nodes.set(input, new Element('div', { id: input.slice(1) }));
    return Collection.from([nodes.get(input)]);
  }
  function call(method, url, body) {
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ method, url, body, resolve, reject });
    return pending;
  }
  let route = { view: 'release-acceptance', projectId: '7', acceptanceId };
  const navigation = {
    read: () => route,
    href: (view, values) => 'index.html?' + new URLSearchParams(values) + '#' + view,
    open: (view, values) => { route = { view, ...values }; emit('veriqra:view', { view, context: route }); }
  };
  const window = { VeriqraApi: { get: url => call('GET', url), post: (url, body) => call('POST', url, body) },
    VeriqraQaNavigation: navigation, VeriqraQaContext: { load: () => Promise.resolve({ canWriteAssets: canWrite }) },
    VeriqraDraftGuard: { register: (name, guard) => guards.set(name, guard) }, I18n: {
      t: (key, values) => (catalogs[locale][key] || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? ''),
      formatDateTime: String, formatNumber: String, enumLabel: String
    } };
  vm.runInNewContext(source, { window, document, jQuery: $, crypto: global.crypto });
  function emit(name, detail) {
    for (const fn of document.handlers.get(name) || []) fn({ originalEvent: { detail } });
    listeners.get(name)?.({ detail });
  }
  function fire(target, name = 'click') {
    const node = typeof target === 'string' ? $(target)[0] : target;
    return Promise.all((node.handlers.get(name) || []).map(fn => fn.call(node, { preventDefault() {} })));
  }
  function text(selector) { return $(selector)[0].textContent(); }
  emit('veriqra:project', { project: { id: 7, status: 'ACTIVE' } });
  return { $, calls, guards, navigation, emit, fire, text, locale(value) { locale = value; emit('veriqra:localechange'); } };
}

const endpoint = 'projects/7/release-acceptances';
const run = (id, buildVersion, name = 'Run ' + id) => ({ id, projectId: 7, name, buildVersion, environment: 'QA', status: 'COMPLETED' });
const counts = { total: 4, recorded: 3, passed: 1, failed: 1, blocked: 0, skipped: 1, notRun: 1 };
const firstRun = { ...run(11, '2.1'), outcome: 'FAIL', counts };
const secondRun = { ...run(12, '2.1'), outcome: 'PASS', counts: { total: 1, recorded: 1, passed: 1, failed: 0, blocked: 0, skipped: 0, notRun: 0 } };
const defects = [{ id: 30, keyNo: 4, title: '<Pending defect>', status: 'OPEN', severity: 'HIGH', priority: 'HIGH' }];
const preview = (runs = [firstRun], reviewToken = 'review-1') => ({ buildVersion: '2.1', runs, unclosedDefects: defects, reviewToken });
const detail = (overrides = {}) => ({ id: 99, projectId: 7, buildVersion: '2.1', verdict: 'REJECTED', reviewerName: 'Reviewer',
  createdAt: '2026-11-06T11:00:00Z', notes: 'Fix the failure.', runs: [firstRun], unclosedDefects: defects, ...overrides });

async function ready() {
  const ui = browser(); await flush();
  ui.calls.find(call => call.url === endpoint).resolve([]);
  ui.calls.find(call => call.url === 'projects/7/runs').resolve([run(11, '2.1'), run(12, '2.1'), run(13, '2.2'), run(14, null)]);
  await flush();
  ui.$('#release-build').val('2.1'); await ui.fire('#release-build', 'change');
  return ui;
}
async function selectRun(ui, id, checked = true) {
  const box = ui.$('#release-run-list')[0].all().find(node => node.attrs.id === 'release-run-' + id);
  assert.ok(box, 'Expected same-build run option');
  box.checked = checked;
  await ui.fire(box, 'change');
}
async function review(ui, evidence = preview()) {
  const request = ui.fire('#release-preview-trigger');
  assert.equal(ui.calls.at(-1).url, endpoint + '/preview');
  ui.calls.at(-1).resolve(evidence); await request;
}
async function decide(ui, value = 'REJECTED') {
  ui.$('#release-verdict').val(value); await ui.fire('#release-verdict', 'change');
}

test('one build selects multiple runs and saves only the explicitly reviewed evidence and human verdict', async () => {
  const ui = await ready();
  assert.deepEqual(ui.$('#release-run-list')[0].all().filter(node => node.tag === 'input').map(node => node.attrs.id), ['release-run-12', 'release-run-11']);
  await selectRun(ui, 11); await selectRun(ui, 12);
  await ui.fire('#release-form', 'submit');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
  await review(ui, preview([firstRun, secondRun]));
  assert.deepEqual(plain(ui.calls.at(-1).body), { buildVersion: '2.1', runIds: [11, 12] });
  assert.match(ui.text('#release-preview'), /Recorded 3\/4 · Passed 1 · Failed 1/);
  assert.match(ui.text('#release-preview'), /BUG-004 · <Pending defect>/);
  assert.equal(ui.$('#release-preview').find('img').length, 0);
  assert.equal(ui.$('#release-save')[0].disabled, true);
  await decide(ui);
  ui.$('#release-notes').val('Fix the failure.'); await ui.fire('#release-notes', 'input');
  const saving = ui.fire('#release-form', 'submit');
  const post = ui.calls.at(-1);
  assert.equal(post.url, endpoint);
  const { requestKey, ...body } = plain(post.body);
  assert.match(requestKey, /^[\da-f-]{36}$/);
  assert.deepEqual(body, { buildVersion: '2.1', runIds: [11, 12], verdict: 'REJECTED', notes: 'Fix the failure.', reviewToken: 'review-1' });
  post.resolve(detail({ runs: [firstRun, secondRun] })); await saving;
  assert.equal(ui.navigation.read().acceptanceId, '99');
  assert.match(ui.text('#release-record'), /#99 · 2\.1.*Rejected/);
  assert.match(ui.text('#release-history-list'), /2\.1.*Rejected/);
  assert.equal(ui.guards.get('release-acceptance').dirty(), false);
});

test('an evidence conflict preserves notes, requires a fresh preview and forces the reviewer to choose again', async () => {
  const ui = await ready(); await selectRun(ui, 11); await review(ui); await decide(ui, 'APPROVED');
  ui.$('#release-notes').val('Review held.'); await ui.fire('#release-notes', 'input');
  let saving = ui.fire('#release-form', 'submit'); const old = ui.calls.at(-1);
  old.reject({ status: 409, code: 'RELEASE_ACCEPTANCE_EVIDENCE_CHANGED' }); await saving;
  assert.match(ui.text('#release-write-feedback'), /Evidence changed/);
  assert.equal(ui.$('#release-verdict').val(), '');
  assert.equal(ui.$('#release-notes').val(), 'Review held.');
  assert.equal(ui.$('#release-save')[0].disabled, true);
  await review(ui, preview([firstRun], 'review-2'));
  assert.equal(ui.$('#release-save')[0].disabled, true);
  await decide(ui, 'REJECTED');
  saving = ui.fire('#release-form', 'submit'); const next = ui.calls.at(-1);
  assert.equal(next.body.reviewToken, 'review-2'); assert.notEqual(next.body.requestKey, old.body.requestKey);
  assert.equal(next.body.notes, 'Review held.');
  next.resolve(detail()); await saving;
});

test('an uncertain save reuses its request key and review token while locking the original draft', async () => {
  const ui = await ready(); await selectRun(ui, 11); await review(ui); await decide(ui);
  let saving = ui.fire('#release-form', 'submit'); const original = ui.calls.at(-1);
  original.reject({ status: 503 }); await saving;
  assert.match(ui.text('#release-write-feedback'), /same request/);
  assert.equal(ui.$('#release-build')[0].disabled, true);
  assert.equal(ui.$('#release-preview-trigger')[0].disabled, true);
  saving = ui.fire('#release-form', 'submit'); const retry = ui.calls.at(-1);
  assert.deepEqual(plain(retry.body), plain(original.body));
  retry.resolve(detail()); await saving;
});

test('old preview results cannot authorize a decision after run selection changes', async () => {
  const ui = await ready(); await selectRun(ui, 11);
  const stale = ui.fire('#release-preview-trigger'); const older = ui.calls.at(-1);
  await selectRun(ui, 12); const newer = ui.fire('#release-preview-trigger');
  ui.calls.at(-1).resolve(preview([firstRun, secondRun], 'current-review')); await newer;
  older.resolve(preview()); await stale;
  assert.match(ui.text('#release-preview'), /Run 12/);
  await decide(ui); const saving = ui.fire('#release-form', 'submit');
  assert.equal(ui.calls.at(-1).body.reviewToken, 'current-review');
  ui.calls.at(-1).resolve(detail({ runs: [firstRun, secondRun] })); await saving;
});

test('read-only members can open a shareable record and switch language without write requests', async () => {
  const ui = browser({ canWrite: false, acceptanceId: '99' }); await flush();
  assert.deepEqual(ui.calls.map(call => call.url), [endpoint, endpoint + '/99']);
  ui.calls[0].resolve([detail()]); ui.calls[1].resolve(detail()); await flush();
  assert.equal(ui.$('#release-create')[0].classes.has('d-none'), true);
  assert.match(ui.text('#release-record'), /Rejected/);
  ui.locale('zh-CN');
  assert.match(ui.text('#release-record'), /不通过/);
  assert.match(ui.text('#release-record'), /项目未关闭缺陷（1）/);
  assert.match(ui.$('#release-history-list').find('a')[0].attrs.href, /projectId=7&acceptanceId=99#release-acceptance/);
  await ui.fire('#release-form', 'submit'); assert.equal(ui.calls.length, 2);
});
