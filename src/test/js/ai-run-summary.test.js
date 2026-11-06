const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/ai-run-summary.js'), 'utf8');
const catalogs = Object.fromEntries(['en', 'zh-CN'].map(locale => [locale,
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../main/webapp/i18n/' + locale + '.json'), 'utf8'))]));
const flush = () => new Promise(resolve => setImmediate(resolve));

// A small DOM fixture runs the actual UI module with deferred server responses.
function browser(options = {}) {
  const requests = [], navigation = [], listeners = new Map(), guards = new Map(), copies = [];
  let locale = 'en';
  class Element {
    constructor(tag = 'div', attributes = {}) {
      this.tag = tag; this.attributes = attributes; this.nodeType = 1; this.childNodes = []; this.parent = null;
      this.classes = new Set((attributes.class || '').split(/\s+/)); this.handlers = new Map();
      this.value = ''; this.checked = Object.hasOwn(attributes, 'checked'); this.disabled = false;
    }
  }
  const root = new Element(), detail = new Element('section', { id: 'execution-actions' });
  root.childNodes.push(detail); detail.parent = root;
  function descendants(node) { return node.childNodes.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []); }
  function matches(node, selector) {
    if (selector.endsWith(':checked')) return matches(node, selector.slice(0, -8)) && node.checked;
    if (selector.startsWith('.')) return node.classes.has(selector.slice(1));
    if (selector.startsWith('#')) return node.attributes.id === selector.slice(1);
    if (selector.startsWith('[')) return Object.hasOwn(node.attributes, selector.slice(1, -1));
    return node.tag === selector;
  }
  function create(html) {
    const attributes = Object.fromEntries([...html.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    if (/\schecked[\s>]/.test(html)) attributes.checked = '';
    return new Element(/^<(\w+)/.exec(html)[1], attributes);
  }
  function textOf(node) { return node.nodeType === 3 ? node.nodeValue : node.childNodes.map(textOf).join(''); }
  class Collection {
    constructor(items) { this.items = items; this.length = items.length; items.forEach((item, index) => { this[index] = item; }); }
    each(fn) { this.items.forEach((item, index) => fn.call(item, index, item)); return this; }
    text(value) {
      if (value === undefined) return this.items.map(textOf).join('');
      return this.each(function () { this.childNodes = [{ nodeType: 3, nodeValue: String(value) }]; });
    }
    val(value) { if (value === undefined) return this[0]?.value || ''; return this.each(function () { this.value = String(value); }); }
    prop(name, value) { if (value === undefined) return this[0]?.[name]; return this.each(function () { this[name] = value; }); }
    attr(name, value) { if (value === undefined) return this[0]?.attributes[name]; return this.each(function () { this.attributes[name] = String(value); }); }
    addClass(value) { return this.each(function () { value.split(/\s+/).forEach(name => this.classes.add(name)); }); }
    removeClass(value) { return this.each(function () { value.split(/\s+/).forEach(name => this.classes.delete(name)); }); }
    toggleClass(name, enabled) { return enabled ? this.addClass(name) : this.removeClass(name); }
    hasClass(name) { return this[0]?.classes.has(name); }
    empty() { return this.each(function () { this.childNodes = []; }); }
    append(...children) { return this.each(function () {
      children.flatMap(child => child instanceof Collection ? child.items : [child]).forEach(child => {
        if (typeof child === 'string') child = create(child);
        child.parent = this; this.childNodes.push(child);
      });
    }); }
    prepend(child) { const items = child instanceof Collection ? child.items : [create(child)]; return this.each(function () {
      items.forEach(item => { item.parent = this; }); this.childNodes.unshift(...items);
    }); }
    after(child) { return this.each(function () {
      child.items.forEach(item => { item.parent = this.parent; });
      this.parent.childNodes.splice(this.parent.childNodes.indexOf(this) + 1, 0, ...child.items);
    }); }
    find(selector) { return new Collection(this.items.flatMap(node => descendants(node).filter(child => selector.split(',').some(part => matches(child, part.trim()))))); }
    children() { return new Collection(this.items.flatMap(node => node.childNodes).filter(node => node.nodeType === 1)); }
    filter(fn) { return new Collection(this.items.filter((node, index) => fn.call(node, index, node))); }
    map(fn) { return { get: () => this.items.map((node, index) => fn.call(node, index, node)) }; }
    on(name, selector, fn) { return this.each(function () {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push({ selector: fn ? selector : null, fn: fn || selector });
    }); }
    trigger(name) { return this.each(function () { this.lastTriggered = name; }); }
    remove() { return this.each(function () { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); }); }
  }
  function $(selector) {
    if (selector instanceof Collection) return selector;
    if (selector instanceof Element) return new Collection([selector]);
    if (selector.startsWith('<')) return new Collection([create(selector)]);
    return new Collection(descendants(root).filter(node => selector.split(',').some(part => matches(node, part.trim()))));
  }
  const document = {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatchEvent(event) { (listeners.get(event.type) || []).forEach(fn => fn(event)); }
  };
  const window = {
    I18n: { t: (key, values, fallback) => (catalogs[locale][key] || fallback || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? ''), enumLabel: String, formatDateTime: String, getLocale: () => locale },
    addEventListener(name, fn) { document.addEventListener(name, fn); },
    navigator: { clipboard: { async writeText(text) { if (options.copyFails) throw new Error('Unavailable'); copies.push(text); } } },
    VeriqraApi: { post(url, body) {
      let resolve, reject;
      const result = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ url, body, resolve, reject }); return result;
    } },
    VeriqraQaNavigation: {
      href: (view, destination) => 'index.html?' + new URLSearchParams(destination) + '#' + view,
      open(view, destination) { navigation.push({ view, ...destination }); }
    },
    VeriqraDraftGuard: { register(name, guard) { guards.set(name, guard); } }, confirm: () => true
  };
  vm.runInNewContext(source, { window, document, jQuery: $, CustomEvent: class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  } });
  const mount = (projectId = 7, id = 10, extra = {}) => window.VeriqraAiRunSummary.mount({ projectId, run: { id, name: 'Regression '+id }, ...extra });
  async function fire(node, type = 'click', fields = {}) {
    const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const handler of node.handlers.get(type) || []) if (!handler.selector) await handler.fn.call(node, event);
    return event;
  }
  mount();
  return { $, requests, navigation, guards, mount, fire, window, copies, document,
    locale(next) { locale = next; document.dispatchEvent({ type: 'veriqra:localechange' }); } };
}

function response(projectId = 7, runId = 10, extra = {}) {
  return { input: { projectId, runId, runName: 'Regression '+runId, runStatus: 'COMPLETED', environment: 'Test', buildVersion: 'v1',
    capturedAt: '2026-10-31T08:00:00', counts: { total: 5, recorded: 4, passed: 2, failed: 1, blocked: 1, skipped: 0, notRun: 1 },
    linkedDefectCount: 1, omittedCaseCount: 0, omittedDefectCount: 0, detailsTruncated: false, ...extra },
    analysis: { overview: 'Recorded 4 of 5 cases.', findings: ['FAIL: empty cache'], recommendations: ['Retest the fix.'] }, generatedAt: '2026-10-31T08:00:02' };
}
async function generate(ui, value = response()) {
  const work = ui.fire(ui.$('.ai-summary-generate')[0]);
  ui.requests.at(-1).resolve(value); await work; await flush();
}

test('run summary is explicit, read-only and renders server counts with snapshot time', async () => {
  const ui = browser();
  assert.equal(ui.requests.length, 0);
  const work = ui.fire(ui.$('.ai-summary-generate')[0]);
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].url, 'projects/7/runs/10/ai-summary');
  assert.equal(ui.requests[0].body.language, 'en'); assert.equal(ui.$('.ai-summary-generate').prop('disabled'), true);
  ui.requests[0].resolve(response()); await work;
  assert.match(ui.$('.ai-summary-result').text(), /Total 5 · Recorded 4 · Passed 2 · Failed 1/);
  assert.match(ui.$('.ai-summary-result').text(), /2026-10-31T08:00:00/);
  assert.match(ui.$('.ai-summary-result').text(), /FAIL: empty cache/);
  assert.match(ui.$('.ai-summary-result').text(), /Retest the fix/);
  assert.equal(ui.$('.ai-summary-statistics').length, 1);
  assert.notEqual(ui.$('.ai-summary-statistics').prop('open'), true, 'Snapshot counts stay available without repeating the main run metrics by default.');
  assert.equal(ui.$('.ai-summary-generate').text(), 'Generate again');
  assert.equal(ui.guards.size, 0, 'Summary generation adds no write or unsaved-draft flow.');
});

test('JUnit failure actions open the exact source draft or an existing defect without a write', async () => {
  const ui = browser(), drafts = [];
  let discarded = false;
  ui.window.VeriqraDefects = { stageAiDraft(draft) { drafts.push(draft); return () => { discarded = true; }; } };
  ui.mount(7, 10, { canWrite: () => true });
  assert.equal(ui.$('.ai-summary-create-defect').length, 0);
  await generate(ui, { ...response(), failureActions: [
    { runCaseId: 11, attemptId: 15, title: 'Empty cache', draftTitle: 'Cache prevented switching', suggestion: 'Verify the failure against a clean cache.', linkedDefects: [] },
    { runCaseId: 12, attemptId: 16, title: 'Already tracked', linkedDefects: [{ id: 13, keyNo: 2 }] }
  ] });
  assert.match(ui.$('.ai-summary-failure-actions').text(), /Empty cache.*Verify the failure.*Create defect draft.*View existing defect BUG-002/);
  await ui.fire(ui.$('.ai-summary-create-defect')[0]);
  assert.equal(drafts[0].draftTitle, 'Cache prevented switching');
  assert.equal(drafts[0].attemptId, 15);
  assert.equal(discarded, true);
  await ui.fire(ui.$('.ai-summary-failure-actions').find('a')[0]);
  assert.deepEqual(ui.navigation, [
    { view: 'defects', projectId: 7, runId: 10, runCaseId: 11, attemptId: 15, action: 'create', failureAttemptId: 15 },
    { view: 'defects', projectId: 7, defectId: 13 }
  ]);
  assert.equal(ui.requests.length, 1, 'Opening a form or a linked defect only navigates');
});

test('a read-only or stale run summary cannot open a defect draft', async () => {
  const ui = browser();
  const value = { ...response(), failureActions: [{ runCaseId: 11, attemptId: 15, title: 'Empty cache', linkedDefects: [] }] };
  await generate(ui, value);
  assert.equal(ui.$('.ai-summary-create-defect').length, 0);
  ui.mount(7, 10, { canWrite: () => true });
  await generate(ui, value);
  const button = ui.$('.ai-summary-create-defect')[0];
  ui.mount(8, 20);
  await ui.fire(button);
  assert.equal(ui.navigation.length, 0);
});

test('duplicate clicks do not launch another generation; regeneration failure preserves the previous summary', async () => {
  const ui = browser(); await generate(ui);
  const before = ui.$('.ai-summary-result').text(), work = ui.fire(ui.$('.ai-summary-generate')[0]);
  await ui.fire(ui.$('.ai-summary-generate')[0]); assert.equal(ui.requests.length, 2);
  ui.requests[1].reject({ code: 'AI_TIMEOUT', status: 504 }); await work;
  assert.equal(ui.$('.ai-summary-result').text(), before);
  assert.equal(ui.$('.ai-summary-generate').prop('disabled'), false);
  assert.equal(ui.$('.ai-summary-copy').prop('disabled'), false);
  assert.equal(ui.$('.ai-summary-status').hasClass('text-danger'), true);
  assert.equal(ui.$('.ai-summary-status').text(), catalogs.en['aiSummary.AI_TIMEOUT']);
  assert.doesNotMatch(ui.$('.ai-summary-status').text(), /cases have been saved|candidates/);
});

test('responses from another run, project or view cannot populate the current summary', async () => {
  const ui = browser(), work = ui.fire(ui.$('.ai-summary-generate')[0]);
  ui.mount(8, 20); ui.requests[0].resolve(response()); await work;
  assert.equal(ui.$('.ai-summary-result').hasClass('d-none'), true);
  assert.equal(ui.$('.ai-summary-generate').text(), 'Generate test summary');
  const newer = ui.fire(ui.$('.ai-summary-generate')[0]);
  ui.document.dispatchEvent({ type: 'veriqra:view' }); ui.requests[1].resolve(response(8, 20)); await newer;
  assert.equal(ui.$('#ai-run-summary-panel').hasClass('d-none'), true);
});

test('wrong response identity and inconsistent counts are rejected without inventing facts', async () => {
  const ui = browser(); await generate(ui, response(8, 10));
  assert.equal(ui.$('.ai-summary-result').hasClass('d-none'), true);
  await generate(ui, response(7, 10, { counts: { total: 5, recorded: 4, passed: 99, failed: 1, blocked: 1, skipped: 0, notRun: 1 } }));
  assert.equal(ui.$('.ai-summary-result').hasClass('d-none'), true);
  assert.equal(ui.$('.ai-summary-status').hasClass('text-danger'), true);
});

test('summary copying includes metadata and exact counts and has a usable manual-copy fallback', async () => {
  const ui = browser(); await generate(ui); await ui.fire(ui.$('.ai-summary-copy')[0]);
  assert.equal(ui.requests.length, 1); assert.equal(ui.copies.length, 1);
  assert.match(ui.copies[0], /Regression 10/); assert.match(ui.copies[0], /Environment: Test · Build: v1/);
  assert.match(ui.copies[0], /Total 5 · Recorded 4/); assert.match(ui.copies[0], /- Retest the fix/);
  const fallback = browser({ copyFails: true }); await generate(fallback); await fallback.fire(fallback.$('.ai-summary-copy')[0]);
  assert.equal(fallback.$('.ai-summary-copy-fallback').hasClass('d-none'), false);
  assert.match(fallback.$('.ai-summary-copy-text').val(), /Recorded 4 of 5 cases/);
});

test('partial runs and sampled evidence are explicitly described while all-count facts remain available', async () => {
  const ui = browser(); await generate(ui, response(7, 10, { runStatus: 'IN_PROGRESS', detailsTruncated: true, omittedCaseCount: 5 }));
  assert.match(ui.$('.ai-summary-result').text(), /IN_PROGRESS/);
  assert.match(ui.$('.ai-summary-result').text(), /All results are included in the counts/);
  assert.match(ui.$('.ai-summary-result').text(), /Total 5/);
});

test('locale changes clear pending text and use the selected language on the next request', async () => {
  const ui = browser(), work = ui.fire(ui.$('.ai-summary-generate')[0]);
  ui.locale('zh-CN'); ui.mount(); ui.requests[0].resolve(response()); await work;
  assert.equal(ui.$('.ai-summary-generate').text(), '生成测试总结');
  const newer = ui.fire(ui.$('.ai-summary-generate')[0]); assert.equal(ui.requests[1].body.language, 'zh-CN');
  ui.requests[1].resolve(response()); await newer;
  assert.match(ui.$('.ai-summary-result').text(), /共 5 条 · 已记录 4/);
});

test('summary failures use dedicated messages in both languages without case-writing instructions', async () => {
  for (const locale of ['en', 'zh-CN']) {
    for (const code of ['AI_NOT_CONFIGURED', 'AI_AUTH_ERROR', 'AI_RATE_LIMITED', 'AI_UPSTREAM_ERROR', 'AI_TIMEOUT', 'AI_INVALID_RESPONSE']) {
      const ui = browser(); ui.locale(locale); ui.mount();
      const work = ui.fire(ui.$('.ai-summary-generate')[0]);
      ui.requests[0].reject({ code, status: 503 }); await work;
      assert.equal(ui.$('.ai-summary-status').text(), catalogs[locale]['aiSummary.' + code]);
      assert.doesNotMatch(ui.$('.ai-summary-status').text(), /用例|候选|cases|candidates/i);
      assert.equal(ui.$('.ai-summary-generate').prop('disabled'), false);
    }
  }
});
