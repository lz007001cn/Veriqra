const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/ai-cases.js'), 'utf8');
const catalogs = Object.fromEntries(['en', 'zh-CN'].map(locale => [locale,
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../main/webapp/i18n/' + locale + '.json'), 'utf8'))]));
const flush = () => new Promise(resolve => setImmediate(resolve));

// A small DOM fixture runs the actual UI module with deferred server responses.
function browser() {
  const requests = [], navigation = [], listeners = new Map(), guards = new Map();
  let locale = 'en';
  class Element {
    constructor(tag = 'div', attributes = {}) {
      this.tag = tag; this.attributes = attributes; this.nodeType = 1; this.childNodes = []; this.parent = null;
      this.classes = new Set((attributes.class || '').split(/\s+/)); this.handlers = new Map();
      this.value = ''; this.checked = Object.hasOwn(attributes, 'checked'); this.disabled = false;
    }
  }
  const root = new Element(), detail = new Element('section', { id: 'asset-detail' });
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
    I18n: { t: (key, values, fallback) => catalogs[locale][key] || fallback || key, enumLabel: String },
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
  const mount = (projectId = 7, id = 10, fields = {}) => window.VeriqraAiCases.mount({ projectId,
    requirement: { id, version: 2, keyNo: 3, title: 'Empty hot-update cache server switch', description: 'Allow switching with an empty cache.', ...fields }, writable: true });
  async function fire(node, type = 'click', fields = {}) {
    const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const handler of node.handlers.get(type) || []) if (!handler.selector) await handler.fn.call(node, event);
    return event;
  }
  mount();
  return { $, requests, navigation, guards, mount, fire, window,
    locale(next) { locale = next; document.dispatchEvent({ type: 'veriqra:localechange' }); } };
}

const candidate = title => ({ title, description: 'Description', preconditions: 'Preconditions', priority: 'MEDIUM',
  steps: [{ action: 'Switch server', expectedResult: 'Server switched' }] });
async function generate(ui) {
  const work = ui.fire(ui.$('.ai-generate')[0]);
  ui.requests[0].resolve({ expectedVersion: 2, candidates: [candidate('Empty cache'), candidate('Normal cache'), candidate('Missing cache')] });
  await work; await flush();
}
async function save(ui) {
  const work = ui.fire(ui.$('.ai-save')[0]);
  ui.requests.at(-1).resolve([{ id: 20, keyNo: 4, title: 'Edited empty cache' }, { id: 22, keyNo: 6, title: 'Missing cache' }]);
  await work; await flush();
}

test('AI saving exposes saved-case review and plan navigation without opening another creation form', async () => {
  const ui = browser(); await generate(ui);
  ui.$('.ai-title')[0].value = 'Edited empty cache'; ui.$('.ai-select')[1].checked = false;
  await save(ui);
  assert.equal(ui.requests.length, 2); assert.equal(ui.requests[1].url, 'projects/7/requirements/10/ai-cases/accept');
  assert.equal(ui.requests[1].body.expectedVersion, 2);
  assert.deepEqual(Array.from(ui.requests[1].body.candidates, row => row.title), ['Edited empty cache', 'Missing cache']);
  assert.equal(ui.guards.get('ai-cases').dirty(), false);
  assert.equal(ui.$('.ai-saved').hasClass('d-none'), false); assert.equal(ui.$('.ai-candidates').children().length, 0);
  assert.equal(ui.$('.ai-status').text(), '', 'The success panel owns the saved message and next step.');
  assert.match(ui.$('.ai-saved').text(), /TC-004 · Edited empty cache/);
  assert.match(ui.$('.ai-saved').text(), /mark it Ready/); assert.match(ui.$('.ai-saved').text(), /links still need review/);
  const links = ui.$('.ai-saved').find('a'); assert.equal(links.length, 3);
  assert.match(links[0].attributes.href, /testCaseId=20/); assert.doesNotMatch(links[0].attributes.href, /action=create/);
  await ui.fire(links[0]); assert.deepEqual(ui.navigation[0], { view: 'test-cases', projectId: '7', testCaseId: '20', sourceRequirementId: '10' });
  await ui.fire(links[2]); assert.deepEqual(ui.navigation[1], { view: 'test-plans', projectId: '7' });
  assert.equal(ui.requests.length, 2, 'Navigation must not create plans or change Ready / trace review states.');
});

test('generation basis identifies the selected saved requirement and optional instructions remain optional', async () => {
  const ui = browser();
  assert.equal(ui.$('.ai-basis-requirement').text(), 'REQ-003 · Empty hot-update cache server switch');
  assert.match(ui.$('.ai-basis').text(), /description, including acceptance criteria/);
  assert.match(ui.$('.ai-basis').text(), /additional instructions below/);
  ui.mount(7, 11, { keyNo: 4, title: 'Title only', description: '' });
  assert.equal(ui.$('.ai-basis-requirement').text(), 'REQ-004 · Title only');
  const work = ui.fire(ui.$('.ai-generate')[0]);
  assert.equal(ui.requests[0].url, 'projects/7/requirements/11/ai-cases/preview');
  assert.equal(ui.requests[0].body.instruction, '', 'An empty description or instruction must not add a frontend gate.');
  ui.requests[0].reject({ code: 'AI_TIMEOUT', status: 504 }); await work;
});

test('candidate details collapse without dropping fields, selection or edited steps from the accepted batch', async () => {
  const ui = browser(); ui.$('.ai-instruction').val('Include boundary scenarios.'); await generate(ui);
  assert.equal(ui.requests[0].body.instruction, 'Include boundary scenarios.');
  const details = ui.$('.ai-candidate-details');
  assert.deepEqual(details.items.map(node => node.open), [true, false, false]);
  ui.$('.ai-select')[1].checked = false;
  ui.$('.ai-description')[2].value = 'Edited while details were closed';
  ui.$('.ai-action')[2].value = 'Switch with missing cache directory';
  ui.locale('zh-CN');
  assert.deepEqual(details.items.map(node => node.open), [true, false, false]);
  const work = ui.fire(ui.$('.ai-save')[0]);
  assert.equal(ui.requests[1].body.candidates.length, 2);
  assert.equal(ui.requests[1].body.candidates[1].description, 'Edited while details were closed');
  assert.equal(ui.requests[1].body.candidates[1].steps[0].action, 'Switch with missing cache directory');
  ui.requests[1].reject({ status: 400 }); await work;
  assert.equal(ui.guards.get('ai-cases').dirty(), true);
});

test('saved-case and plan links preserve browser modifier navigation', async () => {
  const ui = browser(); await generate(ui); await save(ui);
  for (const node of ui.$('.ai-saved').find('a').items) {
    const event = await ui.fire(node, 'click', { ctrlKey: true }); assert.equal(event.defaultPrevented, undefined);
  }
  assert.equal(ui.navigation.length, 0);
});

test('locale switches preserve edited AI candidates and saved case identities', async () => {
  const ui = browser(); await generate(ui);
  const title = ui.$('.ai-title')[0]; title.value = 'Retain my edit'; ui.$('.ai-select')[1].checked = false;
  ui.locale('zh-CN'); assert.equal(ui.$('.ai-title')[0], title); assert.equal(title.value, 'Retain my edit');
  assert.equal(ui.$('.ai-select')[1].checked, false); assert.equal(ui.guards.get('ai-cases').dirty(), true);
  await save(ui);
  const hrefs = ui.$('.ai-saved').find('a').items.map(node => node.attributes.href);
  ui.locale('en'); ui.locale('zh-CN');
  assert.deepEqual(ui.$('.ai-saved').find('a').items.map(node => node.attributes.href), hrefs);
  assert.equal(ui.requests.length, 2); assert.match(ui.$('.ai-saved').text(), /Edited empty cache/);
  assert.equal(ui.$('.ai-saved').find('[data-ai-text]')[0].childNodes[0].nodeValue, catalogs['zh-CN']['ai.savedHeading'] || 'Saved test cases');
});

test('unknown AI save keeps the draft locked and never displays a successful next step', async () => {
  const ui = browser(); await generate(ui);
  const work = ui.fire(ui.$('.ai-save')[0]); ui.requests[1].reject({ status: 0 }); await work;
  assert.equal(ui.guards.get('ai-cases').dirty(), true); assert.equal(ui.$('.ai-saved').hasClass('d-none'), true);
  assert.equal(ui.$('.ai-save').prop('disabled'), true); assert.equal(ui.$('.ai-generate').prop('disabled'), true);
  await ui.fire(ui.$('.ai-save')[0]); await ui.fire(ui.$('.ai-generate')[0]);
  assert.equal(ui.requests.length, 2); ui.locale('zh-CN'); assert.equal(ui.$('.ai-save').prop('disabled'), true);
});

test('a new candidate batch clears the previous success panel before another save', async () => {
  const ui = browser(); await generate(ui); await save(ui);
  const generating = ui.fire(ui.$('.ai-generate')[0]);
  ui.requests[2].resolve({ expectedVersion: 2, candidates: [candidate('New candidate')] }); await generating;
  assert.equal(ui.$('.ai-saved').hasClass('d-none'), true); assert.equal(ui.$('.ai-saved').find('a').length, 0);
  const saving = ui.fire(ui.$('.ai-save')[0]); ui.requests[3].reject({ status: 500 }); await saving;
  assert.equal(ui.$('.ai-saved').hasClass('d-none'), true); assert.equal(ui.guards.get('ai-cases').dirty(), true);
});

test('late AI acceptance from a previous requirement cannot render saved links in another project', async () => {
  const ui = browser(); await generate(ui);
  const work = ui.fire(ui.$('.ai-save')[0]); ui.mount(8, 11);
  ui.requests[1].resolve([{ id: 20, keyNo: 4, title: 'Old saved case' }]); await work;
  assert.equal(ui.$('.ai-saved').hasClass('d-none'), true); assert.equal(ui.$('.ai-saved').find('a').length, 0);
  assert.equal(ui.guards.get('ai-cases').dirty(), false);
});
