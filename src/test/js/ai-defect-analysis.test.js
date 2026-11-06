const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/ai-defect-analysis.js'), 'utf8');
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
  const root = new Element(), detail = new Element('section', { id: 'defect-actions' });
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
  const mount = (projectId = 7, id = 10, extra = {}) => window.VeriqraAiDefectAnalysis.mount({ projectId, actorId: 7, defect: { id, keyNo: id, title: 'Failure '+id, version: 2 }, ...extra });
  async function fire(node, type = 'click', fields = {}) {
    const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const handler of node.handlers.get(type) || []) if (!handler.selector) await handler.fn.call(node, event);
    return event;
  }
  mount();
  return { $, requests, navigation, guards, mount, fire, window, copies, document,
    locale(next) { locale = next; document.dispatchEvent({ type: 'veriqra:localechange' }); } };
}

function response(id = 10, extra = {}) {
  return { defectId: id, expectedVersion: 2, capturedAt: '2026-11-05T08:00:00', generatedAt: '2026-11-05T08:00:02',
    evidenceCount: 2, includedEvidenceCount: 2, truncated: false,
    analysis: { overview: 'The historical failure was fixed and retested.', observations: ['An empty cache was rejected.'],
      possibleCauses: ['The empty-directory check may have been too strict.'], missingInformation: [],
      retestSuggestions: ['Review the recorded later PASS and retain the original FAIL.'] }, ...extra };
}
async function analyze(ui, value = response()) {
  const work = ui.fire(ui.$('.ai-defect-generate')[0]);
  ui.requests.at(-1).resolve(value); await work; await flush();
}

test('defect analysis is an explicit read-only request with recorded context and folded hypotheses', async () => {
  const ui = browser();
  assert.equal(ui.requests.length, 0);
  const work = ui.fire(ui.$('.ai-defect-generate')[0]);
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].url, 'projects/7/defects/10/ai-analysis');
  assert.equal(ui.requests[0].body.language, 'en'); assert.equal(ui.$('.ai-defect-generate').prop('disabled'), true);
  ui.requests[0].resolve(response()); await work;
  assert.match(ui.$('.ai-assist-result').text(), /historical failure was fixed/);
  assert.match(ui.$('.ai-assist-result').text(), /Record revision 2/);
  assert.match(ui.$('.ai-assist-result').text(), /2 of 2 failure sources/);
  const folded = ui.$('.ai-assist-section').items.filter(node => node.tag === 'details');
  assert.equal(folded.length, 3); assert.ok(folded.every(node => node.open !== true));
  assert.equal(ui.requests.length, 1);
});

test('wrong defect, changed revision and inconsistent evidence counts cannot become valid analysis', async () => {
  const ui = browser();
  for (const value of [response(11), response(10, { expectedVersion: 3 }), response(10, { includedEvidenceCount: 3 }),
    response(10, { analysis: { ...response().analysis, possibleCauses: [null] } })]) {
    await analyze(ui, value); assert.equal(ui.$('.ai-assist-result').hasClass('d-none'), true);
    assert.equal(ui.$('.ai-assist-status').text(), catalogs.en['aiDefect.AI_INVALID_RESPONSE']);
  }
});

test('late results after changing object or view are ignored, and a new revision clears previous text', async () => {
  const ui = browser(), pending = ui.fire(ui.$('.ai-defect-generate')[0]);
  ui.mount(8, 20); ui.requests[0].resolve(response()); await pending;
  assert.equal(ui.$('.ai-assist-result').hasClass('d-none'), true);
  await analyze(ui, response(20));
  assert.equal(ui.$('.ai-assist-result').hasClass('d-none'), false);
  ui.mount(8, 20, { defect: { id: 20, keyNo: 20, title: 'Changed', version: 3 } });
  assert.equal(ui.$('.ai-assist-result').hasClass('d-none'), true);
  const next = ui.fire(ui.$('.ai-defect-generate')[0]); ui.document.dispatchEvent({ type: 'veriqra:view' });
  ui.requests.at(-1).resolve(response(20, { expectedVersion: 3 })); await next;
  assert.equal(ui.$('#ai-defect-analysis-panel').hasClass('d-none'), true);
});

test('ordinary failures retain a previous analysis; permission loss removes it and blocks repeat calls', async () => {
  const ui = browser(); await analyze(ui);
  const failed = ui.fire(ui.$('.ai-defect-generate')[0]); ui.requests.at(-1).reject({ code: 'AI_TIMEOUT', status: 503 }); await failed;
  assert.match(ui.$('.ai-assist-result').text(), /historical failure was fixed/);
  assert.match(ui.$('.ai-assist-status').text(), /previous analysis is still shown/);
  const denied = ui.fire(ui.$('.ai-defect-generate')[0]); ui.requests.at(-1).reject({ status: 403 }); await denied;
  assert.equal(ui.$('.ai-assist-result').hasClass('d-none'), true);
  assert.equal(ui.$('.ai-defect-generate').prop('disabled'), true);
  await ui.fire(ui.$('.ai-defect-generate')[0]); assert.equal(ui.requests.length, 3);
});

test('business mutation blocking discards an in-flight response and does not permit duplicate generation', async () => {
  const ui = browser(), pending = ui.fire(ui.$('.ai-defect-generate')[0]);
  await ui.fire(ui.$('.ai-defect-generate')[0]); assert.equal(ui.requests.length, 1);
  ui.window.VeriqraAiDefectAnalysis.setBlocked(true);
  ui.requests[0].resolve(response()); await pending;
  assert.equal(ui.$('.ai-assist-result').hasClass('d-none'), true);
  assert.equal(ui.$('.ai-defect-generate').prop('disabled'), true);
  ui.window.VeriqraAiDefectAnalysis.setBlocked(false);
  assert.equal(ui.$('.ai-defect-generate').prop('disabled'), false);
});

test('locale changes preserve completed analysis and discard pending text from the previous language', async () => {
  const ui = browser(); await analyze(ui);
  ui.locale('zh-CN'); assert.match(ui.$('.ai-assist-result').text(), /historical failure was fixed/);
  assert.equal(ui.$('.ai-defect-generate').text(), catalogs['zh-CN']['aiDefect.regenerate']);
  const pending = ui.fire(ui.$('.ai-defect-generate')[0]); assert.equal(ui.requests.at(-1).body.language, 'zh-CN');
  ui.locale('en'); ui.requests.at(-1).resolve(response(10, { analysis: { ...response().analysis, overview: 'Late translated text' } })); await pending;
  assert.doesNotMatch(ui.$('.ai-assist-result').text(), /Late translated text/);
});

test('copy includes defect and source metadata and provides manual fallback', async () => {
  const ui = browser(); await analyze(ui, response(10, { truncated: true, includedEvidenceCount: 1 }));
  await ui.fire(ui.$('.ai-defect-copy')[0]);
  assert.equal(ui.copies.length, 1); assert.match(ui.copies[0], /BUG-010 · Failure 10/);
  assert.match(ui.copies[0], /Some source details were omitted/);
  const manual = browser({ copyFails: true }); await analyze(manual); await manual.fire(manual.$('.ai-defect-copy')[0]);
  assert.equal(manual.$('.ai-assist-copy-fallback').hasClass('d-none'), false);
  assert.match(manual.$('#ai-defect-copy-text').val(), /Review the recorded later PASS/);
});

test('model text renders as text and a missing verified actor cannot initiate analysis', async () => {
  const ui = browser(); await analyze(ui, response(10, { analysis: { ...response().analysis, overview: '<img src=x onerror=alert(1)>' } }));
  assert.equal(ui.$('img').length, 0); assert.match(ui.$('.ai-assist-result').text(), /<img/);
  ui.mount(7, 10, { actorId: null }); assert.equal(ui.$('.ai-defect-generate').prop('disabled'), true);
  await ui.fire(ui.$('.ai-defect-generate')[0]); assert.equal(ui.requests.length, 1);
});
