const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/app.js'), 'utf8');

function deferred() {
  const callbacks = { done: [], fail: [], always: [] };
  const result = {};
  for (const name of Object.keys(callbacks)) result[name] = fn => { callbacks[name].push(fn); return result; };
  result.resolve = value => { callbacks.done.forEach(fn => fn(value)); callbacks.always.forEach(fn => fn()); };
  result.reject = error => { callbacks.fail.forEach(fn => fn(error)); callbacks.always.forEach(fn => fn()); };
  return result;
}

async function browser(role = 'ADMIN') {
  const nodes = new Map(), calls = [], events = [], listeners = new Map(), stored = new Map();
  class Node {
    constructor() { this.value = ''; this.content = ''; this.hidden = false; this.disabled = false; this.handlers = {}; }
    on(name, fn) { this.handlers[name] = fn; return this; }
    val(value) { if (value === undefined) return this.value; this.value = value; return this; }
    text(value) { if (value === undefined) return this.content; this.content = value; return this; }
    empty() { return this; }
    append() { return this; }
    addClass(name) { if (name === 'd-none') this.hidden = true; return this; }
    removeClass(name) { if (name === 'd-none') this.hidden = false; return this; }
    toggleClass(name, value) { if (name === 'd-none') this.hidden = value; return this; }
    hasClass(name) { return name === 'd-none' && this.hidden; }
    prop(name, value) { if (value === undefined) return this[name]; this[name] = value; return this; }
    attr(name, value) { this[name] = value; return this; }
    removeAttr() { return this; }
    trigger() { return this; }
    reset() { this.wasReset = true; }
  }
  function $(selector) {
    if (selector instanceof Node) return selector;
    if (typeof selector === 'string' && selector.includes(',')) {
      const list = selector.split(',').map(value => $(value.trim()));
      const group = {};
      for (const method of ['addClass', 'removeClass', 'toggleClass', 'prop', 'text'])
        group[method] = (...args) => { list.forEach(node => node[method](...args)); return group; };
      return group;
    }
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return nodes.get(selector);
  }
  const api = {};
  for (const method of ['get', 'post']) api[method] = (url, body) => {
    const call = deferred(); calls.push({method, url, body, call}); return call;
  };
  const location = { hash: '#dashboard' };
  const window = { VeriqraApi: api, I18n: { t: key => key, enumLabel: value => value, init: async () => {} } };
  const document = { addEventListener(name, fn) { listeners.set(name, fn); },
    dispatchEvent(event) { events.push(event); listeners.get(event.type)?.(event); } };
  const sessionStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  vm.runInNewContext(source, { window, document, jQuery: $, location, sessionStorage, CustomEvent });
  $(window).handlers.pageshow({});
  await Promise.resolve();
  calls[0].call.resolve({ id: 1, username: 'admin', systemRole: role });
  calls[1].call.resolve([]);
  const submit = () => {
    const form = $('#project-create-form');
    form.handlers.submit.call(form, { preventDefault() {} });
  };
  function fields(key = 'QA2026') {
    $('#project-create-key').val(key); $('#project-create-name').val('Quality project');
    $('#project-create-description').val('   ');
  }
  return { $, calls, events, stored, fields, submit, window };
}

test('ADMIN can create the first project, select its returned identity and open member setup', async () => {
  const ui = await browser();
  assert.equal(ui.$('#project-create-open').hidden, false);
  ui.$('#project-create-open').handlers.click.call(ui.$('#project-create-open'));
  ui.fields(); ui.submit(); ui.submit();
  assert.equal(ui.calls.filter(call => call.method === 'post').length, 1);
  assert.equal(JSON.stringify(ui.calls[2].body), JSON.stringify({ projectKey: 'QA2026', name: 'Quality project', description: null }));
  const project = { id: 10, projectKey: 'QA2026', name: 'Quality project', status: 'ACTIVE' };
  ui.calls[2].call.resolve(project);
  ui.calls[3].call.resolve([project]);
  assert.equal(ui.calls[4].url, 'projects/10');
  ui.calls[4].call.resolve(project);
  assert.equal(ui.stored.get('veriqra.selectedProjectId'), '10');
  assert.equal(ui.$('#project-create-form').hidden, true);
  assert.equal(ui.$('#project-create-form').wasReset, true);
  assert.equal(ui.$('#project-created').hidden, false);
  ui.$('#project-setup-link').handlers.click();
  assert.equal(ui.events.at(-1).detail.view, 'project-settings');
});

test('ordinary USER has no create entry and a synthetic submit cannot call the API', async () => {
  const ui = await browser('USER');
  assert.equal(ui.$('#project-create-open').hidden, true);
  ui.fields(); ui.submit();
  assert.equal(ui.calls.some(call => call.method === 'post'), false);
});

test('duplicate project key shows a local error and preserves the form for correction', async () => {
  const ui = await browser();
  ui.$('#project-create-open').handlers.click.call(ui.$('#project-create-open'));
  ui.fields(); ui.submit();
  ui.calls[2].call.reject({status: 409, message: 'Conflict'});
  assert.equal(ui.$('#project-create-error').content, 'project.keyConflict');
  assert.equal(ui.$('#project-create-form').hidden, false);
  assert.equal(ui.$('#project-create-key').val(), 'QA2026');
  assert.equal(ui.$('#page-alert').content, '');
  assert.equal(ui.$('#project-create-open').disabled, false);
  ui.fields('QA2027'); ui.submit();
  assert.equal(ui.calls.at(-1).body.projectKey, 'QA2027');
});

test('invalid project identity is rejected before writing', async () => {
  const ui = await browser(); ui.fields('bad-key'); ui.submit();
  assert.equal(ui.$('#project-create-error').content, 'project.invalid');
  assert.equal(ui.calls.some(call => call.method === 'post'), false);
});

test('failed project-list reload cannot expose a setup link for the previous project', async () => {
  const ui = await browser(); ui.fields(); ui.submit();
  ui.calls[2].call.resolve({id:10,projectKey:'QA2026',name:'Quality project',status:'ACTIVE'});
  ui.calls[3].call.reject({status:503,message:'Unavailable'});
  assert.equal(ui.$('#project-created').hidden, true);
  assert.equal(ui.$('#page-alert').content, 'Unavailable');
  assert.equal(ui.events.some(event => event.type === 'veriqra:project' && event.detail.project?.id === 10), false);
});

test('navigating to test work closes the global create form while keeping an unfinished project draft', async () => {
  const ui = await browser();
  ui.$('#project-create-open').handlers.click.call(ui.$('#project-create-open'));
  ui.fields('DRAFT2026');
  ui.window.VeriqraQaNavigation.open('test-plans', {});
  assert.equal(ui.$('#project-create-form').hidden, true);
  assert.equal(ui.$('#project-create-open')['aria-expanded'], 'false');
  assert.equal(ui.$('#project-create-open').hidden, true);
  assert.equal(ui.$('#project-create-key').val(), 'DRAFT2026');
  ui.window.VeriqraQaNavigation.open('dashboard', {});
  ui.$('#project-create-open').handlers.click.call(ui.$('#project-create-open'));
  assert.equal(ui.$('#project-create-form').hidden, false);
  assert.equal(ui.$('#project-create-key').val(), 'DRAFT2026');
});

test('project-created message is dismissed when navigating away and does not return with the dashboard', async () => {
  const ui = await browser(); ui.fields(); ui.submit();
  const project = {id:10,projectKey:'QA2026',name:'Quality project',status:'ACTIVE'};
  ui.calls[2].call.resolve(project); ui.calls[3].call.resolve([project]); ui.calls[4].call.resolve(project);
  assert.equal(ui.$('#project-created').hidden, false);
  ui.window.VeriqraQaNavigation.open('requirements', {});
  assert.equal(ui.$('#project-created').hidden, true);
  ui.window.VeriqraQaNavigation.open('dashboard', {});
  assert.equal(ui.$('#project-created').hidden, true);
});

test('project-created message can be closed before continuing on the dashboard', async () => {
  const ui = await browser(); ui.fields(); ui.submit();
  const project = {id:10,projectKey:'QA2026',name:'Quality project',status:'ACTIVE'};
  ui.calls[2].call.resolve(project); ui.calls[3].call.resolve([project]); ui.calls[4].call.resolve(project);
  assert.equal(ui.$('#project-created').hidden, false);
  ui.$('#project-created-dismiss').handlers.click();
  assert.equal(ui.$('#project-created').hidden, true);
});
