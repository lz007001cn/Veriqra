const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/ai-requirement-assist.js'), 'utf8');
const catalogs = Object.fromEntries(['en', 'zh-CN'].map(locale => [locale,
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../main/webapp/i18n/' + locale + '.json'), 'utf8'))]));
const flush = () => new Promise(resolve => setImmediate(resolve));

// A small DOM fixture runs the actual UI module with deferred server responses.
function browser(options = {}) {
  const requests = [], imports = [], adoptions = [], permissions = [], navigation = [], listeners = new Map(), guards = new Map(), visibility = [];
  let locale = 'en';
  class Element {
    constructor(tag = 'div', attributes = {}) {
      this.tag = tag; this.attributes = attributes; this.nodeType = 1; this.childNodes = []; this.parent = null;
      this.classes = new Set((attributes.class || '').split(/\s+/)); this.handlers = new Map();
      this.value = ''; this.checked = Object.hasOwn(attributes, 'checked'); this.disabled = false;
    }
    focus() { document.activeElement = this; }
  }
  const root = new Element(), actions = new Element('div', { id: 'ai-cases-panel' }), detail = new Element('section', { id: 'asset-detail' });
  root.childNodes.push(actions, detail); actions.parent = root; detail.parent = root;
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
    trigger(name) { return this.each(function () { if (name === 'focus') this.focus(); }); }
    remove() { return this.each(function () { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); }); }
  }
  function $(selector) {
    if (selector instanceof Collection) return selector;
    if (selector instanceof Element) return new Collection([selector]);
    if (selector.startsWith('<')) return new Collection([create(selector)]);
    return new Collection(descendants(root).filter(node => selector.split(',').some(part => matches(node, part.trim()))));
  }
  const document = {
    activeElement: null, documentElement: { lang: 'en' },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatchEvent(event) {
      if (event.type === 'veriqra:ai-requirement-visibility') visibility.push(JSON.parse(JSON.stringify(event.detail)));
      (listeners.get(event.type) || []).forEach(fn => fn(event));
    }
  };
  const window = {
    I18n: { t: (key, values, fallback) => (catalogs[locale][key] || fallback || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? ''), enumLabel: String, formatNumber: String, formatDateTime: String, getLocale: () => locale },
    VeriqraApi: {
      post: (url, body) => request('POST', url, body), get: url => request('GET', url)
    },
    VeriqraQaContext: { load(projectId, force) {
      permissions.push({ projectId, force });
      return Promise.resolve(options.permission || { actorId: 1, canWriteAssets: true });
    } },
    VeriqraAiCases: { importPreview(value, owner) { imports.push({ value, owner }); return options.importResult !== false; }, clear() { options.clearedCases = true; } },
    VeriqraQaNavigation: {
      href: (view, destination) => 'index.html?' + new URLSearchParams(destination) + '#' + view,
      open(view, destination) { navigation.push({ view, ...destination }); }
    },
    VeriqraDraftGuard: { register(name, guard) { guards.set(name, guard); } }, confirm: () => true
  };
  vm.runInNewContext(source, { window, document, jQuery: $, CustomEvent: class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  } });
  function request(method, url, body) {
    let resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({ method, url, body, resolve, reject }); return result;
  }
  const mount = (projectId = 7, id = 10, fields = {}, actorId = 1, writable = true) => window.VeriqraRequirementAssist.mount({ projectId,
    requirement: { id, version: 2, keyNo: 3, title: 'Empty hot-update cache server switch', description: 'Allow switching with an empty cache.', ...fields }, writable, actorId,
    onAdoptCriteria: async value => { adoptions.push(value); } });
  async function fire(node, type = 'click', fields = {}) {
    const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const handler of node.handlers.get(type) || []) if (!handler.selector) await handler.fn.call(node, event);
    return event;
  }
  mount();
  return { $, requests, imports, adoptions, permissions, navigation, guards, mount, fire, window, root, visibility, focused: () => document.activeElement,
    locale(next) { locale = next; document.dispatchEvent({ type: 'veriqra:localechange' }); } };
}

const candidate = title => ({ title, description: 'Description', preconditions: 'Empty cache', priority: 'MEDIUM', steps: [{ action: 'Switch server', expectedResult: 'Server switched' }] });
const review = (fields = {}) => ({ requirementId: 10, expectedVersion: 2, capturedAt: '2026-11-05T01:00:00Z', generatedAt: '2026-11-05T01:01:00Z',
  analysis: { overview: 'Clarify the success condition.', issues: ['No timeout is stated'], questions: ['Which server should remain selected?'], acceptanceCriteria: ['Empty cache does not block a server switch', 'Keep the selected server after restart'] }, ...fields });
const coverage = (fields = {}) => ({ requirementId: 10, expectedVersion: 2, capturedAt: '2026-11-05T01:00:00Z', generatedAt: '2026-11-05T01:01:00Z',
  totalLinkedCases: 1, includedCases: 1, truncated: false, sourceCases: [{ id: 20, version: 3, status: 'READY', linkStatus: 'CONFIRMED' }],
  analysis: { overview: 'The empty-cache boundary is missing.', gaps: ['Empty cache'], duplicates: [], candidates: [candidate('Empty cache switch')] }, ...fields });
async function generate(ui, kind = 'review', value) {
  ui.window.VeriqraRequirementAssist.open(kind);
  ui.requests.at(-1).resolve(value || (kind === 'review' ? review() : coverage())); await flush();
}
async function freshReads(ui, value, links) {
  await flush(); ui.requests.at(-1).resolve(value || { id: 10, version: 2, status: 'ACTIVE' }); await flush();
  if (links) { ui.requests.at(-1).resolve(links); await flush(); }
}

test('requirement review starts on explicit action, caches reopening and never writes the requirement', async () => {
  const ui = browser(); assert.equal(ui.requests.length, 0);
  await generate(ui);
  assert.equal(ui.requests[0].url, 'projects/7/requirements/10/ai-review'); assert.equal(ui.requests[0].body.language, 'en');
  assert.match(ui.$('.ai-assist-result').text(), /No timeout is stated/); assert.match(ui.$('.ai-assist-result').text(), /Requirement revision 2/);
  ui.window.VeriqraRequirementAssist.open('review'); assert.equal(ui.requests.length, 1);
  assert.equal(ui.$('.ai-assist-adopt').prop('disabled'), true); assert.equal(ui.adoptions.length, 0);
});

test('selected acceptance criteria require fresh saved version and are passed to an unsaved-draft hook only', async () => {
  const ui = browser(); await generate(ui);
  const choice = ui.$('.ai-assist-criterion')[1]; choice.checked = true; await ui.fire(choice, 'change');
  const work = ui.fire(ui.$('.ai-assist-adopt')[0]); await freshReads(ui); await work;
  assert.equal(ui.permissions[0].force, true); assert.equal(ui.requests[1].method, 'GET');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.adoptions)), [{ requirementId: 10, expectedVersion: 2, criteria: ['Keep the selected server after restart'] }]);
  assert.equal(ui.requests.filter(row => row.method === 'POST').length, 1, 'Only the explicit analysis request was posted.');
  assert.equal(ui.guards.get('ai-requirement-assist').dirty(), false);
});

test('stale requirement blocks criterion adoption and retains the valid result for review', async () => {
  const ui = browser(); await generate(ui);
  const choice = ui.$('.ai-assist-criterion')[0]; choice.checked = true; await ui.fire(choice, 'change');
  const work = ui.fire(ui.$('.ai-assist-adopt')[0]); await freshReads(ui, { id: 10, version: 3, status: 'ACTIVE' }); await work;
  assert.equal(ui.adoptions.length, 0); assert.match(ui.$('.ai-assist-status').text(), /changed/);
  assert.equal(ui.$('.ai-assist-criterion')[0].checked, true); assert.match(ui.$('.ai-assist-result').text(), /No timeout is stated/);
});

test('coverage handoff verifies source metadata and imports editable candidates without accepting or confirming coverage', async () => {
  const ui = browser(); await generate(ui, 'coverage');
  assert.equal(ui.requests[0].url, 'projects/7/requirements/10/ai-coverage');
  const links = [{ status: 'CONFIRMED', testCase: { id: 20, version: 3, status: 'READY' } }];
  const work = ui.fire(ui.$('.ai-assist-handoff')[0]); await freshReads(ui, null, links); await work;
  assert.equal(ui.imports.length, 1); assert.equal(ui.imports[0].value.candidates[0].title, 'Empty cache switch');
  assert.equal(ui.imports[0].value.sourceCaseCount, 1);
  assert.equal(ui.imports[0].owner.actorId, 1); assert.equal(ui.requests.filter(row => row.method === 'POST').length, 1);
  const validation = assert.rejects(ui.imports[0].owner.validateFresh(), error => error.status === 409);
  await freshReads(ui, null, [{ status: 'NEEDS_REVIEW', testCase: { id: 20, version: 3, status: 'READY' } }]); await validation;
});

test('changed linked cases or incomplete metadata block importing the candidate batch', async () => {
  const ui = browser(); await generate(ui, 'coverage');
  let work = ui.fire(ui.$('.ai-assist-handoff')[0]); await freshReads(ui, null, [{ status: 'CONFIRMED', testCase: { id: 20, version: 4, status: 'READY' } }]); await work;
  assert.equal(ui.imports.length, 0); assert.match(ui.$('.ai-assist-status').text(), /changed/);
  const refresh = ui.fire(ui.$('.ai-assist-generate')[0]); ui.requests.at(-1).resolve(coverage({ totalLinkedCases: 101, truncated: true })); await refresh;
  work = ui.fire(ui.$('.ai-assist-handoff')[0]); await freshReads(ui); await work;
  assert.equal(ui.imports.length, 0); assert.match(ui.$('.ai-assist-status').text(), /could not be verified/);
});

test('wrong-owner or malformed analysis never replaces an earlier valid result', async () => {
  const ui = browser(); await generate(ui);
  const work = ui.fire(ui.$('.ai-assist-generate')[0]); ui.requests.at(-1).resolve(review({ requirementId: 99 })); await work;
  assert.match(ui.$('.ai-assist-result').text(), /Clarify the success condition/); assert.match(ui.$('.ai-assist-status').text(), /previous result/);
  const next = ui.fire(ui.$('.ai-assist-generate')[0]); ui.requests.at(-1).reject({ status: 502 }); await next;
  assert.match(ui.$('.ai-assist-result').text(), /No timeout is stated/); assert.equal(ui.$('.ai-assist-generate').prop('disabled'), false);
});

test('locale change retains criterion choices and ignores in-flight analysis without another paid request', async () => {
  const ui = browser(); await generate(ui);
  const choice = ui.$('.ai-assist-criterion')[0]; choice.checked = true; await ui.fire(choice, 'change');
  const work = ui.fire(ui.$('.ai-assist-generate')[0]); ui.locale('zh-CN');
  assert.equal(ui.$('.ai-assist-criterion')[0].checked, true);
  assert.equal(ui.$('.ai-assist-status').text(), catalogs['zh-CN']['aiRequirementAssist.interrupted'] || 'Language changed. The previous request result will be ignored; generate again when ready.');
  ui.requests[1].resolve(review({ analysis: { overview: 'Obsolete result', issues: [], questions: [], acceptanceCriteria: [] } })); await work;
  assert.doesNotMatch(ui.$('.ai-assist-result').text(), /Obsolete result/); assert.equal(ui.requests.length, 2);
});

test('permission loss or a different project/object/actor clears analysis and discards late responses', async () => {
  const options = {}, ui = browser(options); await generate(ui);
  const work = ui.fire(ui.$('.ai-assist-generate')[0]); ui.requests[1].reject({ status: 403 }); await work;
  assert.equal(ui.$('#ai-requirement-assist-panel').hasClass('d-none'), true); assert.equal(ui.$('.ai-assist-result').length, 0); assert.equal(options.clearedCases, true);
  ui.mount(); ui.window.VeriqraRequirementAssist.open('coverage'); const pending = ui.requests.at(-1);
  ui.mount(8, 11, {}, 2); pending.resolve(coverage()); await flush();
  assert.equal(ui.$('.ai-assist-result').text(), ''); assert.equal(ui.$('#ai-requirement-assist-panel').hasClass('d-none'), true);
});

test('coverage draft replacement refusal retains analysis and does not save or confirm anything', async () => {
  const ui = browser({ importResult: false }); await generate(ui, 'coverage');
  const work = ui.fire(ui.$('.ai-assist-handoff')[0]); await freshReads(ui, null, [{ status: 'CONFIRMED', testCase: { id: 20, version: 3, status: 'READY' } }]); await work;
  assert.match(ui.$('.ai-assist-status').text(), /Existing case candidates were retained/);
  assert.match(ui.$('.ai-assist-result').text(), /Empty cache switch/); assert.equal(ui.requests.filter(row => row.method === 'POST').length, 1);
});

test('new objects with revision zero are valid analysis sources', async () => {
  const ui = browser(); ui.mount(7, 10, { version: 0 });
  await generate(ui, 'coverage', coverage({ expectedVersion: 0, sourceCases: [{ id: 20, version: 0, status: 'DRAFT', linkStatus: 'NEEDS_REVIEW' }] }));
  assert.match(ui.$('.ai-assist-result').text(), /Requirement revision 0/);
  assert.equal(ui.$('.ai-assist-handoff').prop('disabled'), false);
});
