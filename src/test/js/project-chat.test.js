const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const webRoot = path.resolve(__dirname, '../../main/webapp');
const source = fs.readFileSync(path.join(webRoot, 'assets/js/project-chat.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(webRoot, 'i18n/en.json'), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function browser({ view = 'dashboard' } = {}) {
  const requests = [], navigation = [], listeners = new Map();
  class Element {
    constructor(tag, attributes = {}) {
      this.tag = tag;
      this.attributes = attributes;
      this.classes = new Set((attributes.class || '').split(/\s+/));
      this.handlers = new Map();
      this.children = [];
      this.content = '';
      this.value = '';
      this.disabled = false;
    }
    focus() { this.focused = true; }
  }
  const card = new Element('section', { id: 'project-chat', class: 'd-none' });
  const specs = { form: 'form', question: 'textarea', send: 'button', clear: 'button', log: 'div', status: 'p', retry: 'button', scope: 'p' };
  const controls = Object.fromEntries(Object.entries(specs).map(([id, tag]) => [id, new Element(tag, { id: 'project-chat-' + id })]));
  card.children.push(controls.scope, controls.log, controls.status, controls.clear, controls.retry, controls.form);
  controls.form.children.push(controls.question, controls.send);
  function find(node, predicate) { return node.children.flatMap(child => [ ...(predicate(child) ? [child] : []), ...find(child, predicate) ]); }
  function content(node) { return node.content + node.children.map(content).join(''); }
  function matches(node, selector) {
    if (selector.startsWith('#')) return node.attributes.id === selector.slice(1);
    if (selector.startsWith('.')) return node.classes.has(selector.slice(1));
    return node.tag === selector;
  }
  class Collection {
    constructor(items) { this.items = items; this.length = items.length; items.forEach((item, index) => { this[index] = item; }); }
    each(fn) { this.items.forEach((item, index) => fn.call(item, index, item)); return this; }
    text(value) {
      if (value === undefined) return this.items.map(content).join('');
      return this.each(function () { this.content = String(value); this.children = []; });
    }
    val(value) { if (value === undefined) return this[0]?.value; return this.each(function () { this.value = String(value); }); }
    prop(name, value) { if (value === undefined) return this[0]?.[name]; return this.each(function () { this[name] = value; }); }
    attr(name, value) {
      if (typeof name === 'object') return this.each(function () { Object.assign(this.attributes, name); });
      if (value === undefined) return this[0]?.attributes[name];
      return this.each(function () { this.attributes[name] = String(value); });
    }
    empty() { return this.text(''); }
    append(...children) { return this.each(function () {
      this.children.push(...children.flatMap(child => child instanceof Collection ? child.items : [child]));
    }); }
    addClass(names) { return this.each(function () { names.split(/\s+/).forEach(name => this.classes.add(name)); }); }
    removeClass(names) { return this.each(function () { names.split(/\s+/).forEach(name => this.classes.delete(name)); }); }
    toggleClass(name, enabled) { return enabled ? this.addClass(name) : this.removeClass(name); }
    on(event, handler) { return this.each(function () {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push(handler);
    }); }
    trigger(event) { return this.each(function () { if (event === 'focus') this.focus(); }); }
  }
  function $(value) {
    if (value instanceof Element) return new Collection([value]);
    if (value.startsWith('<')) {
      const attributes = Object.fromEntries([...value.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      return new Collection([new Element(/^<([\w-]+)/.exec(value)[1], attributes)]);
    }
    const selectors = value.split(',').map(selector => selector.trim());
    return new Collection([card, ...find(card, () => true)].filter(node => selectors.some(selector => matches(node, selector))));
  }
  const document = { addEventListener(name, fn) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  } };
  const window = {
    I18n: { t: (key, args, fallback) => (catalog[key] || fallback || key).replace(/\{(\w+)\}/g, (_, name) => args?.[name] ?? ''),
      error: failure => failure.message, getLocale: () => 'en' },
    VeriqraApi: { post(url, body) {
      let resolve, reject;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ url, body, resolve, reject });
      return pending;
    } },
    VeriqraQaNavigation: {
      read: () => ({ view }),
      href(route, destination) { return 'index.html?' + new URLSearchParams(destination) + '#' + route; },
      open(route, destination) { navigation.push({ route, destination: plain(destination) }); }
    }
  };
  vm.runInNewContext(source, { window, document, jQuery: $, URL, TextEncoder });
  const fire = (node, type, fields = {}) => {
    const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const handler of node.handlers.get(type) || []) handler.call(node, event);
    return event;
  };
  const emit = (type, detail) => (listeners.get('veriqra:' + type) || []).forEach(fn => fn({ detail }));
  return { $, card, controls, requests, navigation, fire, emit,
    project(id) { emit('project', { project: id == null ? null : { id, name: 'Project ' + id, projectKey: 'P' + id } }); },
    submit(question) {
      controls.question.value = question;
      fire(controls.question, 'input');
      fire(controls.form, 'submit');
    },
    links() { return find(controls.log, node => node.tag === 'a'); },
    transcript() { return find(controls.log, node => node.classes.has('project-chat-text')).map(content); }
  };
}

test('project chat sends the current question and earlier completed turns in order', async () => {
  const ui = browser();
  ui.project(7);
  ui.submit('  What is ready?  ');
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].url, 'projects/7/ai/chat');
  assert.deepEqual(plain(ui.requests[0].body), { question: 'What is ready?', history: [], language: 'en' });
  assert.equal(ui.controls.send.disabled, true);
  ui.requests[0].resolve({ answer: 'Three cases are ready.', sources: [], truncated: false });
  await flush();
  assert.deepEqual(ui.transcript(), ['What is ready?', 'Three cases are ready.']);
  ui.submit('What is blocked?');
  assert.equal(ui.requests.length, 2);
  assert.deepEqual(plain(ui.requests[1].body), { question: 'What is blocked?', language: 'en', history: [
    { role: 'user', text: 'What is ready?' }, { role: 'assistant', text: 'Three cases are ready.' }
  ] });
  ui.requests[1].resolve({ answer: 'One run is blocked.', sources: [], truncated: false });
  await flush();
});

test('a failed chat request keeps the question available and retry stays explicit', async () => {
  const ui = browser();
  ui.project(7);
  ui.submit('Which test failed?');
  ui.requests[0].reject({ status: 503, message: 'Temporarily unavailable' });
  await flush();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.controls.question.value, 'Which test failed?');
  assert.equal(ui.controls.retry.classes.has('d-none'), false);
  ui.fire(ui.controls.retry, 'click');
  assert.equal(ui.requests.length, 2);
  assert.deepEqual(plain(ui.requests[1].body), plain(ui.requests[0].body));
  ui.requests[1].resolve({ answer: 'The login test failed.', sources: [], truncated: false });
  await flush();
  assert.deepEqual(ui.transcript(), ['Which test failed?', 'The login test failed.']);
});

test('clearing the pending conversation ignores its late answer', async () => {
  const ui = browser();
  ui.project(7);
  ui.submit('Old question');
  ui.fire(ui.controls.clear, 'click');
  ui.requests[0].resolve({ answer: 'Old answer', sources: [], truncated: false });
  await flush();
  assert.deepEqual(ui.transcript(), []);
  ui.submit('New question');
  assert.deepEqual(plain(ui.requests[1].body.history), []);
  ui.requests[1].resolve({ answer: 'New answer', sources: [], truncated: false });
  await flush();
});

test('a stale answer and earlier turns cannot enter another project or account', async () => {
  const ui = browser();
  ui.emit('identity', { user: { id: 2 } });
  ui.project(7);
  ui.submit('Earlier private question');
  ui.requests[0].resolve({ answer: 'Earlier private answer', sources: [], truncated: false });
  await flush();
  ui.submit('Private project question');
  ui.project(null);
  ui.project('8');
  ui.submit('Current project question');
  assert.equal(ui.requests[2].url, 'projects/8/ai/chat');
  assert.deepEqual(plain(ui.requests[2].body.history), []);
  ui.requests[2].resolve({ answer: 'Current project answer', sources: [], truncated: false });
  await flush();
  ui.requests[1].resolve({ answer: 'Stale private answer', sources: [], truncated: false });
  await flush();
  assert.deepEqual(ui.transcript(), ['Current project question', 'Current project answer']);
  ui.emit('identity', { user: { id: 3 } });
  assert.deepEqual(ui.transcript(), []);
});

test('project chat renders plain answer text and only links supported source routes in the active project', async () => {
  const ui = browser();
  ui.project(7);
  ui.submit('Show the source records');
  ui.requests[0].resolve({ answer: '<b>Plain answer</b>', truncated: true, sources: [
    { type: 'TEST_CASE', id: 23, label: '<b>Case</b>', href: 'https://invalid.example/' },
    { type: 'RELEASE_ACCEPTANCE', id: '24', label: 'Release record' },
    { type: 'PROJECT', id: 7, label: 'This project' },
    { type: 'PROJECT', id: 8, label: 'Other project' },
    { type: 'DEFECT', id: '2#/admin', label: 'Malformed' },
    { type: 'ADMIN', id: 5, label: 'Unknown', href: 'https://invalid.example/' }
  ] });
  await flush();
  assert.equal(ui.transcript().at(-1), '<b>Plain answer</b>');
  assert.equal(ui.$('b').length, 0);
  const links = ui.links();
  assert.deepEqual(links.map(link => link.attributes.href), [
    'index.html?projectId=7&testCaseId=23#test-cases',
    'index.html?projectId=7&acceptanceId=24#release-acceptance',
    'index.html?projectId=7#dashboard'
  ]);
  assert.equal(links[0].content, '<b>Case</b>');
  const click = ui.fire(links[0], 'click');
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(ui.navigation, [{ route: 'test-cases', destination: { projectId: '7', testCaseId: '23' } }]);
  assert.equal(ui.fire(links[1], 'click', { ctrlKey: true }).defaultPrevented, undefined);
  assert.equal(ui.navigation.length, 1);
});
