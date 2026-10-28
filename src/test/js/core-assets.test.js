const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/test-assets.js'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/app.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// Executes the production module. This DOM fixture models its jQuery operations, while requests stay deferred.
function browser(initial = { view: 'requirements', projectId: '7', requirementId: '10' }, integrated = false, permissions = {}) {
  const nodes = new Map(), requests = [], sourceReads = [], nativeListeners = new Map(), navigation = [];
  let currentLocale = 'en';
  let route = { ...initial };
  class Node {
    constructor(tag = 'div', attributes = {}) {
      this.tag = tag; this.attributes = { ...attributes }; this.classes = new Set((attributes.class || '').split(/\s+/));
      this.content = ''; this.value = ''; this.disabled = false; this.childrenNodes = []; this.handlers = new Map(); this.parent = null;
    }
    reset() { for (const node of nodes.values()) if (['input', 'textarea', 'select'].includes(node.tag)) node.value = ''; }
    reportValidity() { return true; }
  }
  function descendants(node) { return node.childrenNodes.flatMap(child => child instanceof Node ? [child, ...descendants(child)] : []); }
  function matches(node, selector) {
    if (selector.startsWith('#')) return node.attributes.id === selector.slice(1);
    if (selector.startsWith('.')) return node.classes.has(selector.slice(1));
    return node.tag === selector;
  }
  class Collection {
    constructor(items) { this.items = items; this.length = items.length; items.forEach((node, index) => { this[index] = node; }); }
    each(fn) { this.items.forEach((node, index) => fn.call(node, index, node)); return this; }
    on(names, fn) { return this.each(function () { names.split(' ').forEach(name => { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }); }); }
    text(value) { if (value === undefined) return this.items[0]?.content; return this.each(function () { this.content = String(value); }); }
    val(value) {
      if (value === undefined) { const node = this.items[0]; return node?.value || (node?.tag === 'select' ? node.childrenNodes[0]?.value || '' : ''); }
      return this.each(function () { this.value = String(value == null ? '' : value); });
    }
    empty() { return this.each(function () { this.childrenNodes = []; this.content = ''; this.value = ''; }); }
    append(...children) { return this.each(function () { children.flatMap(child => child instanceof Collection ? child.items : [child]).forEach(child => { if (child instanceof Node) child.parent = this; this.childrenNodes.push(child); }); }); }
    prepend(...children) { return this.each(function () { children.flatMap(child => child instanceof Collection ? child.items : [child]).reverse().forEach(child => { if (child instanceof Node) child.parent = this; this.childrenNodes.unshift(child); }); }); }
    before(...children) { return this.each(function () { if (!this.parent) return; const parent = this.parent; let offset = parent.childrenNodes.indexOf(this); children.flatMap(child => child instanceof Collection ? child.items : [child]).forEach(child => { if (child instanceof Node) child.parent = parent; parent.childrenNodes.splice(offset++, 0, child); }); }); }
    after(...children) { return this.each(function () { if (!this.parent) return; const parent = this.parent; let offset = parent.childrenNodes.indexOf(this) + 1; children.flatMap(child => child instanceof Collection ? child.items : [child]).forEach(child => { if (child instanceof Node) child.parent = parent; parent.childrenNodes.splice(offset++, 0, child); }); }); }
    addClass(value) { return this.each(function () { value.split(' ').forEach(name => this.classes.add(name)); }); }
    removeClass(value) { return this.each(function () { value.split(' ').forEach(name => this.classes.delete(name)); }); }
    toggleClass(name, enabled) { return enabled ? this.addClass(name) : this.removeClass(name); }
    hasClass(name) { return this.items[0]?.classes.has(name); }
    prop(name, value) { if (value === undefined) return this.items[0]?.[name]; return this.each(function () { this[name] = value; }); }
    attr(name, value) { if (value === undefined) return this.items[0]?.attributes[name]; return this.each(function () { this.attributes[name] = String(value); }); }
    removeAttr(name) { return this.each(function () { delete this.attributes[name]; }); }
    find(selector) { return new Collection(selector.split(',').flatMap(part => this.items.flatMap(node => descendants(node).filter(child => matches(child, part.trim().replace(/^#\S+\s+/, '')))))); }
    children() { return new Collection(this.items.flatMap(node => node.childrenNodes).filter(node => node instanceof Node)); }
    map(fn) { const values = this.items.map((node, index) => fn.call(node, index, node)); return { get: () => values }; }
    get() { return this.items; }
    eq(index) { return new Collection(this.items[index] ? [this.items[index]] : []); }
    trigger(name) { if (name === 'focus') { if (this[0]) document.activeElement = this[0]; return this; } this.items.forEach(node => fire(node, name)); return this; }
    prev(selector) { const node = this.items[0], siblings = node?.parent?.childrenNodes || [], index = siblings.indexOf(node); return new Collection(index > 0 && matches(siblings[index - 1], selector) ? [siblings[index - 1]] : []); }
    next(selector) { const node = this.items[0], siblings = node?.parent?.childrenNodes || [], index = siblings.indexOf(node); return new Collection(siblings[index + 1] && matches(siblings[index + 1], selector) ? [siblings[index + 1]] : []); }
    insertBefore(target) { return move(this.items[0], target.items[0], 0); }
    insertAfter(target) { return move(this.items[0], target.items[0], 1); }
    remove() { return this.each(function () { this.parent.childrenNodes.splice(this.parent.childrenNodes.indexOf(this), 1); }); }
  }
  function move(node, target, offset) { const siblings = node.parent.childrenNodes; siblings.splice(siblings.indexOf(node), 1); siblings.splice(siblings.indexOf(target) + offset, 0, node); return new Collection([node]); }
  const documentNode = new Node('document');
  const windowNode = new Node('window');
  function $(selector) {
    if (selector === document) return new Collection([documentNode]);
    if (selector === window) return new Collection([windowNode]);
    if (selector instanceof Node) return new Collection([selector]);
    if (selector instanceof Collection) return selector;
    if (selector.startsWith('<')) {
      const attributes = {};
      for (const match of selector.matchAll(/([\w-]+)="([^"]*)"/g)) attributes[match[1]] = match[2];
      const node = new Node(selector.match(/^<(\w+)/)[1], attributes);
      if (attributes.id) nodes.set('#' + attributes.id, node);
      return new Collection([node]);
    }
    if (selector.includes(',')) return new Collection(selector.split(',').flatMap(part => $(part.trim()).items));
    if (selector.includes(' ')) { const [root, ...parts] = selector.split(' '); return $(root).find(parts.join(' ')); }
    if (!nodes.has(selector)) {
      const tag = /form$/.test(selector) ? 'form' : /target|priority|status$/.test(selector) ? 'select' : /title|description|preconditions$/.test(selector) ? 'input' : 'div';
      nodes.set(selector, new Node(tag, { id: selector.slice(1), class: /panel|form$/.test(selector) ? 'd-none' : '' }));
    }
    return new Collection([nodes.get(selector)]);
  }
  function fire(node, name, fields = {}) {
    const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields };
    return Promise.all((node.handlers.get(name) || []).map(fn => fn.call(node, event)));
  }
  const document = {
    createTextNode: text => String(text), addEventListener: (name, fn) => nativeListeners.set(name, fn),
    dispatchEvent(event) { fire(documentNode, event.type, { originalEvent: event }); nativeListeners.get(event.type)?.(event); }
  };
  const api = {};
  for (const method of ['get', 'post', 'put']) api[method] = (url, body) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    promise.done = fn => { promise.then(fn, () => {}); return promise; };
    promise.fail = fn => { promise.then(() => {}, fn); return promise; };
    promise.always = fn => { promise.then(fn, fn); return promise; };
    const sourceMatch = /^projects\/(\d+)\/requirements\/(\d+)$/.exec(url);
    const currentRoute = window.VeriqraQaNavigation.read();
    if (!permissions.controlSource && method === 'get' && sourceMatch && currentRoute.view === 'test-cases' && currentRoute.action === 'create') {
      // Existing route/recovery scenarios use an explicit valid source fixture; followup tests control these reads below.
      sourceReads.push({ method, url });
      resolve({ id: Number(sourceMatch[2]), projectId: Number(sourceMatch[1]), keyNo: Number(sourceMatch[2]), title: 'Source requirement', status: 'ACTIVE', priority: 'MEDIUM', version: 1 });
      return promise;
    }
    if (integrated && method === 'get' && /^projects\/\d+\/(requirements|test-cases|test-plans|runs|defects)$/.test(url)) {
      // Dashboard summary has its own fixture. Keep its background reads separate from this detail-flow ledger.
      resolve([]); return promise;
    }
    requests.push({ method, url, body, resolve, reject }); return promise;
  };
  const nav = {
    read: () => ({ ...route }), href: (view, context) => 'index.html?' + new URLSearchParams(context) + '#' + view,
    select(view, context) { route = { view, ...context }; },
    open(view, context) { route = { view, ...context }; navigation.push({ ...route }); document.dispatchEvent({ type: 'veriqra:view', detail: { view, projectId: context.projectId, context } }); }
  };
  const window = { VeriqraApi: api, VeriqraQaNavigation: nav, confirm: () => true, I18n: {
    t: (key, values, fallback) => (permissions.translations?.[currentLocale]?.[key] || fallback || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? ''),
    enumLabel: value => value, formatNumber: String, formatDateTime: String, init: async () => {}
  } };
  const permissionReads = [], guards = new Map();
  const qaPermissions = { actorId: 1, systemRole: 'USER', projectRole: 'TESTER', canWriteAssets: true, projectStatus: 'ACTIVE', ...permissions };
  const contextStub = { load(projectId, force) {
    permissionReads.push({ projectId, force });
    const result = { done(fn) { if (!qaPermissions.fail) fn({ ...qaPermissions }); return result; }, fail(fn) { if (qaPermissions.fail) fn({ status: 403 }); return result; },
      then(resolve, reject) { return (qaPermissions.fail ? Promise.reject({ status: 403 }) : Promise.resolve({ ...qaPermissions })).then(resolve, reject); } };
    return result;
  } };
  window.VeriqraQaContext = contextStub;
  if (permissions.missing) delete window.VeriqraQaContext;
  window.VeriqraDraftGuard = { register(owner, value) { guards.set(owner, value); }, unregister(owner) { guards.delete(owner); }, allowLeave: () => true };
  const location = new URL('http://127.0.0.1:9000/veriqra/index.html?' + new URLSearchParams(Object.fromEntries(Object.entries(initial).filter(([key]) => key !== 'view'))) + '#' + initial.view);
  window.history = { pushState(_, __, href) { location.href = href; }, replaceState(_, __, href) { location.href = href; } };
  document.baseURI = 'http://127.0.0.1:9000/veriqra/';
  const context = { window, document, jQuery: $, URL, URLSearchParams, location,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Math,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  if (integrated) vm.runInNewContext(appSource, context);
  // This suite isolates the assets module; shared auth/role loading has its own tests.
  window.VeriqraQaContext = contextStub;
  if (permissions.missing) delete window.VeriqraQaContext;
  vm.runInNewContext(source, context);
  const dispatchProject = (id = '7', status = 'ACTIVE') => document.dispatchEvent({ type: 'veriqra:project', detail: { project: { id, status } } });
  const click = (selector, fields) => fire($(selector)[0], 'click', fields);
  const submit = selector => fire($(selector)[0], 'submit');
  const caseRow = (id = 20, status = 'DRAFT') => ({ id, projectId: 7, keyNo: id, title: 'Case ' + id, status, priority: 'MEDIUM', version: 3 });
  const requirement = (id = 10, status = 'ACTIVE') => ({ id, projectId: 7, keyNo: id, title: 'Requirement ' + id, status, priority: 'MEDIUM', version: 2 });
  return { $, nodes, requests, sourceReads, nav: integrated ? window.VeriqraQaNavigation : nav, navigation, dispatchProject, click, submit, caseRow, requirement, fire,
    fireAiSaved: detail => document.dispatchEvent({ type: 'veriqra:ai-saved', detail }),
    pageshow: () => fire(windowNode, 'pageshow'), locale: () => document.dispatchEvent({ type: 'veriqra:localechange' }), reauth: () => document.dispatchEvent({ type: 'veriqra:reauthenticated' }),
    location, permissions: qaPermissions, permissionReads, guards, window, setLocale(value) { currentLocale = value; document.dispatchEvent({ type: 'veriqra:localechange' }); }, route: () => integrated ? window.VeriqraQaNavigation.read() : route, focused: () => document.activeElement };
}

test('locale during pending requirement or case detail preserves the selected route and rejects the earlier response', async () => {
  for (const view of ['requirements', 'test-cases']) {
    const field = view === 'requirements' ? 'requirementId' : 'testCaseId';
    const id = view === 'requirements' ? '10' : '20';
    const ui = browser({ view, projectId: '7', [field]: id, sourcePlanId: '30' }); ui.dispatchProject();
    ui.locale(); await flush();
    assert.equal(ui.requests[1].url, 'projects/7/' + view + '/' + id);
    assert.equal(ui.route()[field], id); assert.equal(ui.route().sourcePlanId, '30');
    const row = view === 'requirements' ? ui.requirement() : ui.caseRow();
    ui.requests[0].resolve(view === 'requirements' ? { ...row, title: 'Stale response' } : { testCase: { ...row, title: 'Stale response' }, steps: [] });
    await flush(); assert.equal(ui.$('#asset-detail-title').text(), 'Loading…');
    assert.equal(ui.requests.length, 2, 'The abandoned detail read cannot start trace reads.');
    ui.requests[1].resolve(view === 'requirements' ? row : { testCase: row, steps: [] }); await flush();
    if (view === 'requirements') { ui.requests[2].resolve([]); await flush(); }
    assert.equal(ui.route()[field], id); assert.equal(ui.$('#asset-detail-panel').hasClass('d-none'), false);
    assert.equal(ui.requests.some(call => call.url === 'projects/7/' + view), false);
  }
});

test('locale recovers failed detail from the current route rather than its previous requested identity', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].reject({ status: 500, message: 'Unavailable' }); await flush();
  ui.nav.select('test-cases', { projectId: '7', testCaseId: '21', sourceRequirementId: '11' });
  ui.locale(); await flush(); assert.equal(ui.requests[1].url, 'projects/7/test-cases/21');
  ui.requests[1].resolve({ testCase: ui.caseRow(21), steps: [] }); await flush();
  assert.match(ui.$('#asset-detail-title').text(), /Case 21/); assert.equal(ui.route().testCaseId, '21');
  assert.equal(ui.route().sourceRequirementId, '11'); assert.equal(ui.requests.length, 2);
});

test('locale respects the current case route over an older rendered detail and keeps its reverse trace lazy', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  ui.nav.select('test-cases', { projectId: '7', testCaseId: '21' });
  ui.locale(); await flush(); assert.equal(ui.requests[1].url, 'projects/7/test-cases/21');
  ui.requests[1].resolve({ testCase: ui.caseRow(21), steps: [] }); await flush();
  assert.equal(ui.route().testCaseId, '21'); assert.equal(ui.requests.length, 2);
  assert.equal(ui.$('#trace-add-button').prop('disabled'), true);
});

test('locale preserves an asset form draft and does not unlock stale or failed trace reads', async () => {
  const ui = browser(); ui.dispatchProject(); ui.requests[0].resolve(ui.requirement()); await flush();
  ui.locale(); await flush(); assert.equal(ui.requests[2].url, 'projects/7/requirements/10');
  ui.requests[1].resolve([{ testCase: ui.caseRow(), status: 'CONFIRMED' }]); await flush();
  assert.equal(ui.$('#asset-traces').children().length, 0); assert.equal(ui.$('#trace-add-button').prop('disabled'), true);
  ui.requests[2].resolve(ui.requirement()); await flush();
  ui.requests[3].reject({ status: 500, message: 'Trace unavailable' }); await flush();
  assert.equal(ui.$('#trace-add-button').prop('disabled'), true);
  assert.equal(ui.$('#asset-trace-retry').hasClass('d-none'), false);
  await ui.click('#asset-edit'); ui.$('#asset-title').val('Unsaved title'); ui.$('#asset-description').val('Unsaved description');
  ui.locale(); await flush(); assert.equal(ui.$('#asset-title').val(), 'Unsaved title');
  assert.equal(ui.$('#asset-description').val(), 'Unsaved description'); assert.equal(ui.requests.length, 4);
});

test('detail routes accept string IDs; reverse traceability is lazy and links retain source context', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20', sourceRequirementId: '10' });
  ui.dispatchProject(); assert.equal(ui.requests[0].url, 'projects/7/test-cases/20');
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  assert.equal(ui.requests.length, 1); assert.equal(ui.$('#trace-add-button').prop('disabled'), true);
  assert.equal(ui.$('#asset-trace-load').hasClass('d-none'), false);
  const back = ui.$('#asset-primary-actions').children()[0];
  assert.match(back.attributes.href, /requirementId=10/);
  await ui.fire(back, 'click', { ctrlKey: true }); assert.equal(ui.navigation.length, 0);
  await ui.fire(back, 'click'); assert.equal(ui.navigation[0].requirementId, '10');
  assert.equal(ui.navigation[0].sourceTestCaseId, '20');
});

test('failed trace read stays distinct from empty and gates links until retry succeeds', async () => {
  const ui = browser(); ui.dispatchProject(); ui.requests[0].resolve(ui.requirement()); await flush();
  assert.equal(ui.requests[1].url, 'projects/7/requirements/10/test-cases');
  assert.equal(ui.$('#trace-add-button').prop('disabled'), true);
  ui.requests[1].reject({ status: 500, message: 'Unavailable' }); await flush();
  assert.equal(ui.$('#asset-trace-retry').hasClass('d-none'), false);
  assert.match(ui.$('#asset-trace-status').text(), /could not be loaded/);
  await ui.click('#trace-add-button'); assert.equal(ui.requests.length, 2);
  const retry = ui.click('#asset-trace-retry'); ui.requests[2].resolve([]); await retry; await flush();
  assert.equal(ui.$('#trace-add-button').prop('disabled'), false);
  assert.equal(ui.$('#asset-traces').children()[0].content, 'No traceability records yet.');
});

test('reverse traceability uses one scoped GET and a failed read does not offer partial links', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  const loading = ui.click('#asset-trace-load');
  assert.equal(ui.requests[1].url, 'projects/7/test-cases/20/requirements');
  ui.requests[1].reject({ status: 500, message: 'Unavailable' });
  await loading; assert.equal(ui.$('#asset-traces').children().length, 0);
  assert.equal(ui.$('#trace-add-button').prop('disabled'), true);
  assert.equal(ui.requests.length, 2);
});

test('stale detail and trace reads cannot render or fan out in another project', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  const loading = ui.click('#asset-trace-load');
  ui.nav.select('requirements', { projectId: '8', requirementId: '11' }); ui.dispatchProject('8');
  ui.requests[1].resolve([ui.requirement()]); await loading; await flush();
  assert.equal(ui.requests.filter(call => /requirements\/10\/test-cases$/.test(call.url)).length, 0);
  ui.requests[2].resolve(ui.requirement(11)); await flush(); ui.requests[3].resolve([]); await flush();
  assert.match(ui.$('#asset-detail-title').text(), /Requirement 11/);
});

test('case creation with definitively rejected attach keeps the saved case and retry never creates it again', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }); ui.dispatchProject(); await flush();
  ui.$('#asset-title').val('New case'); ui.$('#asset-priority').val('MEDIUM');
  const saving = ui.submit('#asset-form'); await flush(); assert.equal(ui.requests[0].method, 'post');
  ui.requests[0].resolve(ui.caseRow()); await flush();
  assert.equal(ui.requests[1].url, 'projects/7/requirements/10/test-cases/20');
  assert.equal(JSON.stringify(ui.requests[1].body), '{}');
  ui.requests[1].reject({ status: 400, message: 'Invalid link' }); await flush();
  ui.requests[2].resolve({ testCase: ui.caseRow(), steps: [] }); await saving; await flush();
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), false);
  assert.equal(ui.route().testCaseId, '20'); assert.equal(ui.route().sourceRequirementId, '10');
  const retrying = ui.click('#asset-partial-link-retry');
  assert.equal(ui.requests[3].url, 'projects/7/requirements/10/test-cases/20');
  ui.requests[3].resolve(); await flush(); ui.requests[4].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  await retrying; await flush();
  assert.equal(ui.requests.filter(call => call.method === 'post' && call.url === 'projects/7/test-cases').length, 1);
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), true);
  assert.equal(ui.requests.length, 5, 'Successful attach must not automatically scan all requirement links.');
  assert.equal(ui.$('#asset-trace-load').hasClass('d-none'), false);
});

test('saved case and failed link remain visible when its detail read also fails; retry never repeats creation', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }); ui.dispatchProject(); await flush();
  ui.$('#asset-title').val('New case'); const saving = ui.submit('#asset-form'); await flush();
  ui.requests[0].resolve(ui.caseRow()); await flush();
  ui.requests[1].reject({ status: 400, message: 'Link unavailable' }); await flush();
  assert.match(ui.$('#asset-partial-link-status').text(), /Test case #20.*requirement #10/);
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), false);
  ui.requests[2].reject({ status: 500, message: 'Details unavailable' }); await saving;
  assert.equal(ui.route().testCaseId, '20'); assert.equal(ui.route().sourceRequirementId, '10');
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), false);
  assert.match(ui.$('#asset-partial-link-status').text(), /Link unavailable/);
  assert.equal(ui.$('#asset-notice').text(), 'Details unavailable');
  assert.equal(ui.$('#asset-edit').prop('disabled'), true);
  assert.equal(ui.$('#asset-partial-link-retry').prop('disabled'), false);
  const retrying = ui.click('#asset-partial-link-retry');
  assert.equal(ui.requests[3].method, 'post'); assert.equal(ui.requests[3].url, 'projects/7/requirements/10/test-cases/20');
  assert.equal(ui.$('#asset-primary-actions').find('button')[0].disabled, true);
  ui.requests[3].resolve(); await flush(); ui.requests[4].resolve({ testCase: ui.caseRow(), steps: [] }); await retrying;
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), true);
  assert.equal(ui.requests.filter(call => call.method === 'post' && call.url === 'projects/7/test-cases').length, 1);
});

test('primary detail retry preserves saved link recovery and ignores a click after route ownership changes', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }); ui.dispatchProject(); await flush();
  ui.$('#asset-title').val('New case'); const saving = ui.submit('#asset-form'); await flush();
  ui.requests[0].resolve(ui.caseRow()); await flush();
  ui.requests[1].reject({ status: 500, message: 'Link unavailable' }); await flush();
  ui.requests[2].reject({ status: 500, message: 'Details unavailable' }); await saving;
  const detailRetry = ui.$('#asset-primary-actions').find('button')[0];
  const loading = ui.fire(detailRetry, 'click'); assert.equal(ui.requests[3].method, 'get');
  assert.equal(ui.requests[3].url, 'projects/7/test-cases/20');
  ui.requests[3].resolve({ testCase: ui.caseRow(), steps: [] }); await loading;
  assert.match(ui.$('#asset-detail-title').text(), /Case 20/);
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), false);
  assert.match(ui.$('#asset-partial-link-status').text(), /Test case #20.*Link unavailable/);
  assert.equal(ui.route().sourceRequirementId, '10');
  ui.nav.open('test-cases', { projectId: '7', testCaseId: '21' });
  const calls = ui.requests.length; await ui.fire(detailRetry, 'click');
  assert.equal(ui.requests.length, calls, 'A detached retry button must not reopen its previous route.');
  assert.equal(ui.requests.filter(call => call.method === 'post' && call.url === 'projects/7/test-cases').length, 1);
});

test('retry conflict verifies an existing active relationship without a project-wide scan', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }); ui.dispatchProject(); await flush();
  ui.$('#asset-title').val('New case'); const saving = ui.submit('#asset-form'); await flush();
  ui.requests[0].resolve(ui.caseRow()); await flush();
  ui.requests[1].reject({ status: 409, message: 'Conflict' }); await flush();
  assert.equal(ui.requests[2].url, 'projects/7/requirements/10/test-cases');
  ui.requests[2].resolve([{ testCase: ui.caseRow(), status: 'NEEDS_REVIEW' }]); await flush();
  ui.requests[3].resolve({ testCase: ui.caseRow(), steps: [] }); await saving;
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), true);
  assert.equal(ui.requests.length, 4);
});

test('creation completing after project navigation cannot attach or reopen the saved case', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }); ui.dispatchProject(); await flush();
  ui.$('#asset-title').val('New case'); const saving = ui.submit('#asset-form'); await flush();
  ui.nav.select('requirements', { projectId: '8', requirementId: '11' }); ui.dispatchProject('8');
  ui.requests[0].resolve(ui.caseRow()); await saving; await flush();
  assert.equal(ui.requests.some(call => call.url.includes('/test-cases/20')), false);
  assert.equal(ui.route().projectId, '8');
});

test('pending confirm blocks editing and navigation prevents its completion reopening detail', async () => {
  const ui = browser(); ui.dispatchProject(); ui.requests[0].resolve(ui.requirement()); await flush();
  ui.requests[1].resolve([{ testCase: ui.caseRow(), status: 'NEEDS_REVIEW' }]); await flush();
  const confirm = ui.$('#asset-traces').find('button')[0]; const confirming = ui.fire(confirm, 'click');
  assert.equal(ui.$('#asset-edit').prop('disabled'), true); await ui.click('#asset-edit');
  assert.equal(ui.$('#asset-form').hasClass('d-none'), true);
  ui.nav.open('test-cases', { projectId: '7', testCaseId: '21' }); ui.requests[2].resolve(); await confirming; await flush();
  assert.equal(ui.requests.filter(call => call.url === 'projects/7/requirements/10').length, 1);
  ui.requests[3].resolve({ testCase: ui.caseRow(21), steps: [] }); await flush();
  assert.match(ui.$('#asset-detail-title').text(), /Case 21/);
});

test('same-view create navigation invalidates a pending save without leaving writes locked', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create' }); ui.dispatchProject();
  ui.$('#asset-title').val('First case'); const saving = ui.submit('#asset-form'); await flush();
  ui.nav.open('test-cases', { projectId: '7', action: 'create', sourceRequirementId: '11' });
  ui.$('#asset-title').val('Second case'); ui.requests[0].resolve(ui.caseRow()); await saving;
  assert.equal(ui.$('#asset-form').hasClass('d-none'), false); assert.equal(ui.$('#asset-title').val(), 'Second case');
  assert.equal(ui.$('#asset-save').prop('disabled'), false);
  assert.equal(ui.requests.length, 1);
});

test('archived endpoints remain navigable without edit or trace mutations', async () => {
  const ui = browser(); ui.dispatchProject(); ui.requests[0].resolve(ui.requirement(10, 'ARCHIVED')); await flush();
  ui.requests[1].resolve([{ testCase: ui.caseRow(), status: 'NEEDS_REVIEW' }]); await flush();
  assert.equal(ui.$('#asset-edit').prop('disabled'), true); assert.equal(ui.$('#trace-add-button').prop('disabled'), true);
  assert.equal(ui.$('#asset-traces').find('button').length, 0); assert.equal(ui.$('#asset-traces').find('a').length, 1);
  await ui.click('#asset-edit'); assert.equal(ui.$('#asset-form').hasClass('d-none'), true);
});

test('READY with no steps is locally rejected; conflicts preserve draft and expectedVersion', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: [] }); await flush(); await ui.click('#asset-edit');
  ui.$('#asset-status').val('READY'); await ui.submit('#asset-form');
  assert.equal(ui.requests.length, 1); assert.match(ui.$('#asset-form-error').text(), /at least one complete step/);
  ui.$('#asset-status').val('DRAFT'); ui.$('#asset-title').val('Changed case'); const saving = ui.submit('#asset-form'); await flush();
  assert.equal(ui.requests[1].body.expectedVersion, 3); assert.equal(ui.requests[1].method, 'put');
  ui.requests[1].reject({ status: 409, message: 'Conflict' }); await saving;
  assert.equal(ui.$('#asset-title').val(), 'Changed case'); assert.equal(ui.$('#asset-form').hasClass('d-none'), false);
  assert.match(ui.$('#asset-form-error').text(), /cannot be edited in its current state/);
});

test('actual app navigation verifies project, opens requirement→case and returns with URL context', async () => {
  const ui = browser({ view: 'requirements', projectId: '7', requirementId: '10' }, true);
  await ui.pageshow(); await flush(); assert.equal(ui.requests[0].url, 'auth/me');
  ui.requests[0].resolve({ id: 1, username: 'tester', systemRole: 'USER' }); await flush();
  assert.equal(ui.requests[1].url, 'projects');
  ui.requests[1].resolve([{ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }]); await flush();
  assert.equal(ui.requests[2].url, 'projects/7');
  ui.requests[2].resolve({ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }); await flush();
  assert.equal(ui.requests[3].url, 'projects/7/requirements/10');
  ui.requests[3].resolve(ui.requirement()); await flush();
  ui.requests[4].resolve([{ testCase: ui.caseRow(), status: 'REMOVED' }]); await flush();
  const openCase = ui.$('#asset-traces').find('a')[0];
  assert.match(openCase.attributes.href, /\/veriqra\/index.html\?projectId=7&testCaseId=20&sourceRequirementId=10#test-cases$/);
  await ui.fire(openCase, 'click'); await flush();
  assert.equal(ui.requests[5].url, 'projects/7/test-cases/20');
  ui.requests[5].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  assert.equal(ui.route().sourceRequirementId, '10'); assert.equal(ui.route().testCaseId, '20');
  assert.equal(ui.requests.length, 6, 'Opening a case must not automatically scan reverse links.');
  const back = ui.$('#asset-primary-actions').find('a')[0]; await ui.fire(back, 'click'); await flush();
  assert.equal(ui.route().requirementId, '10'); assert.equal(ui.route().sourceTestCaseId, '20');
  assert.equal(ui.requests[6].url, 'projects/7/requirements/10');
});

test('actual app create route preserves source requirement through partial link retry', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }, true);
  await ui.pageshow(); await flush(); ui.requests[0].resolve({ id: 1, username: 'tester', systemRole: 'USER' }); await flush();
  ui.requests[1].resolve([{ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }]); await flush();
  ui.requests[2].resolve({ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }); await flush();
  ui.$('#asset-title').val('Created case'); const saving = ui.submit('#asset-form'); await flush();
  ui.requests[3].resolve(ui.caseRow()); await flush(); ui.requests[4].reject({ status: 400, message: 'Invalid link' }); await flush();
  ui.requests[5].resolve({ testCase: ui.caseRow(), steps: [] }); await saving;
  assert.equal(ui.route().testCaseId, '20'); assert.equal(ui.route().sourceRequirementId, '10'); assert.equal(ui.route().action, undefined);
  const retrying = ui.click('#asset-partial-link-retry');
  assert.equal(ui.requests[6].url, 'projects/7/requirements/10/test-cases/20');
  ui.requests[6].resolve(); await flush(); ui.requests[7].resolve({ testCase: ui.caseRow(), steps: [] }); await retrying;
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), true);
  assert.equal(ui.requests.filter(call => call.method === 'post' && call.url === 'projects/7/test-cases').length, 1);
});

test('actual app requirement round trip preserves plan and frozen-run origin', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20', sourcePlanId: '30', runId: '40', runCaseId: '50', attemptId: '60' }, true);
  await ui.pageshow(); await flush(); ui.requests[0].resolve({ id: 1, username: 'tester', systemRole: 'USER' }); await flush();
  ui.requests[1].resolve([{ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }]); await flush();
  ui.requests[2].resolve({ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }); await flush();
  ui.requests[3].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  const loading = ui.click('#asset-trace-load');
  ui.requests[4].resolve([{ testCaseId: 20, requirement: ui.requirement(), status: 'CONFIRMED' }]); await loading;
  await ui.fire(ui.$('#asset-traces').find('a')[0], 'click'); await flush();
  assert.equal(ui.route().sourcePlanId, '30'); assert.equal(ui.route().runCaseId, '50'); assert.equal(ui.route().attemptId, '60');
  ui.requests[5].resolve(ui.requirement()); await flush(); ui.requests[6].resolve([]); await flush();
  const backCase = ui.$('#asset-primary-actions').find('a')[0]; await ui.fire(backCase, 'click'); await flush();
  assert.equal(ui.route().testCaseId, '20'); assert.equal(ui.route().sourcePlanId, '30'); assert.equal(ui.route().runId, '40');
  ui.requests[7].resolve({ testCase: ui.caseRow(), steps: [] }); await flush();
  const links = ui.$('#asset-primary-actions').find('a').get();
  assert.equal(links.some(link => /#test-plans$/.test(link.attributes.href) && /planId=30/.test(link.attributes.href)), true);
  assert.equal(links.some(link => /#runs$/.test(link.attributes.href) && /runCaseId=50/.test(link.attributes.href) && /attemptId=60/.test(link.attributes.href)), true);
});

test('asset list failure is unavailable, Retry reads only, and stale Retry cannot reopen a create form', async () => {
  const ui = browser({ view: 'requirements', projectId: '7' }); ui.dispatchProject();
  ui.requests[0].reject({ status: 500, message: 'Requirements unavailable' }); await flush();
  assert.equal(ui.$('#asset-list-status').text(), 'Unavailable');
  assert.equal(ui.focused(), ui.$('#asset-list-title')[0]);
  const retry = ui.$('#asset-list')[0].childrenNodes.find(node => node.tag === 'button');
  const reading = ui.fire(retry, 'click'); ui.requests[1].resolve([]); await reading;
  assert.match(ui.$('#asset-list-status').text(), /No items yet/);
  assert.equal(ui.requests.every(call => call.method === 'get'), true);
  await ui.click('#asset-new'); ui.$('#asset-title').val('Unsaved title');
  const before = ui.requests.length; await ui.fire(retry, 'click');
  assert.equal(ui.requests.length, before); assert.equal(ui.$('#asset-title').val(), 'Unsaved title');
  assert.equal(ui.focused(), ui.$('#asset-title')[0]);
  const cancel = ui.click('#asset-form-cancel'); assert.equal(ui.focused(), ui.$('#asset-list-title')[0]);
  ui.requests.at(-1).resolve([]); await cancel;
});

test('trace picker failure ends loading and Retry reads only; cancel owns focus and ignores its late read', async () => {
  const ui = browser(); ui.dispatchProject(); ui.requests[0].resolve(ui.requirement()); await flush(); ui.requests[1].resolve([]); await flush();
  const loading = ui.click('#trace-add-button'); ui.requests[2].reject({ status: 500, message: 'Cases unavailable' }); await loading;
  assert.equal(ui.$('#trace-target').prop('disabled'), true); assert.equal(ui.$('#trace-submit').prop('disabled'), true);
  assert.equal(ui.$('#trace-target')[0].childrenNodes[0].content, 'Unavailable');
  const retry = ui.$('#asset-notice')[0].childrenNodes.find(node => node.tag === 'button');
  const recovering = ui.fire(retry, 'click'); ui.requests[3].resolve([ui.caseRow()]); await recovering;
  assert.equal(ui.$('#trace-target').prop('disabled'), false); assert.equal(ui.focused(), ui.$('#trace-target')[0]);
  await ui.click('#trace-cancel'); assert.equal(ui.focused(), ui.$('#trace-add-button')[0]);
  const pending = ui.click('#trace-add-button'); const read = ui.requests.at(-1);
  await ui.click('#trace-cancel'); read.resolve([ui.caseRow()]); await pending;
  assert.equal(ui.$('#trace-form').hasClass('d-none'), true); assert.equal(ui.focused(), ui.$('#trace-add-button')[0]);
  assert.equal(ui.requests.every(call => call.method === 'get'), true);
});

const completeSteps = [{ stepOrder: 1, action: ' Open login ', expectedResult: ' Form appears ' }];

test('explicit Ready reads current permissions and complete definition before one versioned PUT', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  const fresh = { ...ui.caseRow(), title: ' Current title ', description: ' Retain bytes ', preconditions: null, version: 4 };
  ui.requests[0].resolve({ testCase: fresh, steps: completeSteps }); await flush();
  const marking = ui.click('#asset-ready'); await flush();
  assert.equal(ui.permissionReads.at(-1).force, true);
  assert.equal(ui.requests[1].method, 'get'); assert.equal(ui.requests[1].url, 'projects/7/test-cases/20');
  ui.requests[1].resolve({ testCase: fresh, steps: completeSteps }); await flush();
  assert.equal(ui.requests[2].method, 'put');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.requests[2].body)), { title: fresh.title, description: fresh.description, preconditions: null,
    priority: 'MEDIUM', status: 'READY', expectedVersion: 4, steps: completeSteps });
  assert.equal(ui.$('#asset-edit').prop('disabled'), true);
  ui.requests[2].resolve({ ...fresh, status: 'READY', version: 5 }); await flush();
  ui.requests[3].resolve({ testCase: { ...fresh, status: 'READY', version: 5 }, steps: completeSteps }); await marking;
  assert.match(ui.$('#asset-notice').text(), /Case marked Ready/);
  assert.equal(ui.$('#asset-ready').hasClass('d-none'), true);
  assert.equal(ui.requests.length, 4, 'No automatic trace confirm or reverse scan.');
});

test('Ready does not silently approve a newer definition the user has not yet reviewed', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  const marking = ui.click('#asset-ready'); await flush();
  const changed = { ...ui.caseRow(), version: 4, title: 'Changed by another tester' };
  ui.requests[1].resolve({ testCase: changed, steps: completeSteps }); await flush();
  assert.equal(ui.requests[2].method, 'get'); ui.requests[2].resolve({ testCase: changed, steps: completeSteps }); await marking;
  assert.match(ui.$('#asset-notice').text(), /Review the latest definition/);
  assert.equal(ui.requests.some(call => call.method === 'put'), false);
  assert.match(ui.$('#asset-detail-title').text(), /Changed by another tester/);
});

test('explicit Ready explains missing steps from the fresh definition without sending a PUT', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  const marking = ui.click('#asset-ready'); await flush(); ui.requests[1].resolve({ testCase: ui.caseRow(), steps: [] }); await marking;
  assert.match(ui.$('#asset-notice').text(), /at least one complete step/);
  assert.equal(ui.requests.every(call => call.method === 'get'), true);
});

test('explicit Ready refuses a refreshed role denial or a different project projection', async () => {
  for (const denial of ['role', 'project']) {
    const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
    ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
    if (denial === 'role') ui.permissions.canWriteAssets = false;
    const marking = ui.click('#asset-ready'); await flush();
    if (denial === 'project') ui.requests[1].resolve({ testCase: { ...ui.caseRow(), projectId: 8 }, steps: completeSteps });
    await marking;
    assert.equal(ui.requests.some(call => call.method === 'put'), false);
    assert.match(ui.$('#asset-notice').text(), denial === 'role' ? /current role/ : /changed/);
  }
});

test('Ready 409 never retries automatically and a new explicit attempt reads the new version', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  const marking = ui.click('#asset-ready'); await flush(); ui.requests[1].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  ui.requests[2].reject({ status: 409, message: 'Conflict' }); await marking;
  assert.equal(ui.requests.length, 3); assert.match(ui.$('#asset-notice').text(), /changed/);
  const next = ui.click('#asset-ready'); await flush(); assert.equal(ui.requests[3].method, 'get');
  ui.requests[3].resolve({ testCase: { ...ui.caseRow(), version: 9, status: 'READY' }, steps: completeSteps }); await flush();
  ui.requests[4].resolve({ testCase: { ...ui.caseRow(), version: 9, status: 'READY' }, steps: completeSteps }); await next;
  assert.equal(ui.requests.filter(call => call.method === 'put').length, 1);
});

test('uncertain Ready is locked until a read observes the exact saved definition; no duplicate PUT', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  const marking = ui.click('#asset-ready'); await flush(); ui.requests[1].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  ui.requests[2].reject({ status: 0 }); await marking;
  assert.equal(ui.$('#asset-ready').prop('disabled'), true); assert.match(ui.$('#asset-notice').text(), /uncertain/);
  await ui.click('#asset-ready'); assert.equal(ui.requests.length, 3);
  const check = ui.$('#asset-primary-actions').find('button')[0]; const reload = ui.fire(check, 'click');
  assert.equal(ui.requests[3].method, 'get'); ui.requests[3].resolve({ testCase: { ...ui.caseRow(), status: 'READY', version: 4 }, steps: completeSteps }); await reload;
  assert.equal(ui.requests.filter(call => call.method === 'put').length, 1); assert.equal(ui.$('#asset-ready').hasClass('d-none'), true);
});

test('failed or missing permission context keeps read details available and all mutations disabled', async () => {
  for (const permissions of [{ fail: true }, { missing: true }, { canWriteAssets: false, projectRole: 'DEVELOPER' }]) {
    const ui = browser(undefined, false, permissions); ui.dispatchProject(); ui.requests[0].resolve(ui.requirement()); await flush(); ui.requests[1].resolve([]); await flush();
    assert.equal(ui.$('#asset-edit').prop('disabled'), true); assert.equal(ui.$('#asset-new').prop('disabled'), true);
    await ui.click('#asset-new'); await ui.click('#asset-edit'); await ui.submit('#asset-form');
    assert.equal(ui.requests.some(call => call.method !== 'get'), false);
    assert.equal(ui.$('#asset-detail-panel').hasClass('d-none'), false);
  }
});

test('Requirement template is editable and locale preserves draft, caret owner and dirty guard', async () => {
  const ui = browser({ view: 'requirements', projectId: '7', action: 'create' }); ui.dispatchProject();
  assert.equal(ui.guards.get('test-assets').dirty(), false);
  await ui.click('#asset-description-template'); assert.match(ui.$('#asset-description').val(), /Acceptance criteria/);
  ui.$('#asset-title').val('User can sign in'); ui.$('#asset-description').val('My own acceptance text');
  ui.$('#asset-description').trigger('focus'); ui.locale(); await flush();
  assert.equal(ui.$('#asset-description').val(), 'My own acceptance text'); assert.equal(ui.focused(), ui.$('#asset-description')[0]);
  assert.equal(ui.guards.get('test-assets').dirty(), true); assert.equal(ui.requests.length, 0);
  ui.window.confirm = () => false; await ui.click('#asset-description-template'); assert.equal(ui.$('#asset-description').val(), 'My own acceptance text');
  await ui.click('#asset-form-cancel'); assert.equal(ui.$('#asset-form').hasClass('d-none'), false);
});

test('asset search and state filter apply to the loaded list with an honest result count', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7' }); ui.dispatchProject();
  ui.requests[0].resolve([{ ...ui.caseRow(20, 'READY'), title: 'Login with valid password' }, { ...ui.caseRow(21), title: 'Logout' }]); await flush();
  ui.$('#asset-search').val('login'); await ui.fire(ui.$('#asset-search')[0], 'input');
  assert.equal(ui.$('#asset-list').children().length, 1); assert.match(ui.$('#asset-filter-count').text(), /Showing 1 of 2 saved/);
  ui.$('#asset-status-filter').val('DRAFT'); await ui.fire(ui.$('#asset-status-filter')[0], 'change');
  assert.match(ui.$('#asset-list').children()[0].content, /No matching/); assert.equal(ui.requests.length, 1);
  ui.$('#asset-search').val('TC-021'); await ui.fire(ui.$('#asset-search')[0], 'input'); assert.equal(ui.$('#asset-list').children().length, 1);
});

test('empty asset lists lead to creation without showing a search field as an input form', async () => {
  for (const view of ['requirements', 'test-cases']) {
    const ui = browser({ view, projectId: '7' }); ui.dispatchProject();
    ui.requests[0].resolve([]); await flush();
    assert.equal(ui.$('#asset-list-filters').hasClass('d-none'), true);
    assert.equal(ui.$('#asset-filter-count').hasClass('d-none'), true);
    assert.ok(ui.$('#asset-list-status').text().includes(ui.$('#asset-new').text()));
    assert.equal(ui.$('#asset-permission-note').hasClass('d-none'), true);
    await ui.click('#asset-new');
    assert.equal(ui.$('#asset-form').hasClass('d-none'), false);
    assert.equal(ui.route().action, 'create');
    assert.match(ui.$('#asset-form-guidance').text(), view === 'requirements' ? /acceptance criteria/ : /save the draft/);
    ui.$('#asset-title').val('Unsaved entry'); ui.locale(); await flush();
    assert.equal(ui.$('#asset-title').val(), 'Unsaved entry');
    assert.match(ui.$('#asset-form-guidance').text(), view === 'requirements' ? /acceptance criteria/ : /save the draft/);
    assert.equal(ui.requests.length, 1, 'Opening and translating a create form does not write or load another record.');
  }
});

test('read-only users retain an explanation and cannot use the creation action', async () => {
  const ui = browser({ view: 'requirements', projectId: '7' }, false, { canWriteAssets: false, projectRole: 'READER' });
  ui.dispatchProject(); ui.requests[0].resolve([]); await flush();
  assert.equal(ui.$('#asset-permission-note').hasClass('d-none'), false);
  assert.match(ui.$('#asset-permission-note').text(), /Read-only access/);
  assert.equal(ui.$('#asset-new').prop('disabled'), true);
  await ui.click('#asset-new');
  assert.equal(ui.$('#asset-form').hasClass('d-none'), true);
  assert.equal(ui.requests.length, 1);
});

test('a case opened from a plan leads back to that plan instead of creating another one', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20', sourcePlanId: '30' });
  ui.dispatchProject(); ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  const links = ui.$('#asset-primary-actions').find('a').get();
  const back = links.find(link => link.classes.has('btn-primary'));
  assert.ok(back);
  const url = new URL(back.attributes.href, 'http://localhost/');
  assert.equal(url.hash, '#test-plans'); assert.equal(url.searchParams.get('planId'), '30');
  assert.equal(url.searchParams.get('sourceTestCaseId'), '20');
  assert.equal(links.some(link => /action=create/.test(link.attributes.href) && /#test-plans$/.test(link.attributes.href)), false);
  assert.equal(ui.requests.length, 1);
});

test('a defect source survives opening and reviewing a current case so it can return directly to retesting', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20', defectId: '90', runId: '40', runCaseId: '50' }, true);
  await ui.pageshow(); ui.requests[0].resolve({ id: 1, username: 'tester', systemRole: 'USER', status: 'ACTIVE' }); await flush();
  ui.requests[1].resolve([{ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }]); await flush();
  ui.requests[2].resolve({ id: 7, projectKey: 'QA', name: 'Quality', status: 'ACTIVE' }); await flush();
  ui.requests[3].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  assert.equal(ui.route().defectId, '90');
  await ui.click('#asset-edit'); ui.$('#asset-title').val('Retained draft'); ui.locale(); await flush();
  assert.equal(ui.route().defectId, '90'); assert.equal(ui.$('#asset-title').val(), 'Retained draft');
  await ui.click('#asset-form-cancel'); ui.requests.at(-1).resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  const back = ui.$('#asset-primary-actions').find('a').get().find(link => /#defects$/.test(link.attributes.href));
  assert.ok(back); assert.match(back.attributes.href, /defectId=90/);
  assert.equal(ui.$('#asset-primary-actions').find('a').get().some(link => /action=create/.test(link.attributes.href)), false);
  assert.equal(ui.requests.every(call => call.method === 'get'), true);
});

test('AI save refreshes current requirement coverage and an older empty response cannot replace it', async () => {
  const ui = browser(); ui.dispatchProject(); ui.requests[0].resolve(ui.requirement()); await flush();
  assert.equal(ui.requests[1].url, 'projects/7/requirements/10/test-cases');
  ui.fireAiSaved({ projectId: '7', requirementId: '10' });
  assert.equal(ui.requests[2].url, 'projects/7/requirements/10/test-cases');
  ui.requests[2].resolve([{ testCase: ui.caseRow(), status: 'NEEDS_REVIEW' }]); await flush();
  assert.equal(ui.$('#asset-traces').find('a').length, 1);
  ui.requests[1].resolve([]); await flush();
  assert.equal(ui.$('#asset-traces').find('a').length, 1);
  ui.fireAiSaved({ projectId: '8', requirementId: '10' });
  ui.fireAiSaved({ projectId: '7', requirementId: '11' });
  assert.equal(ui.requests.length, 3);
  assert.equal(ui.requests.every(call => call.method === 'get'), true);
});

test('unknown create preserves draft and blocks same-session resubmission even after route change', async () => {
  const ui = browser({ view: 'requirements', projectId: '7', action: 'create' }); ui.dispatchProject();
  ui.$('#asset-title').val('Do not duplicate'); const save = ui.submit('#asset-form'); await flush(); ui.requests[0].reject({ status: 0 }); await save;
  assert.equal(ui.$('#asset-title').val(), 'Do not duplicate'); assert.match(ui.$('#asset-form-error').text(), /uncertain/);
  await ui.submit('#asset-form'); assert.equal(ui.requests.length, 1); assert.equal(ui.$('#asset-save').prop('disabled'), true);
  ui.nav.open('requirements', { projectId: '7', action: 'create' }); ui.$('#asset-title').val('Still uncertain'); await ui.submit('#asset-form');
  assert.equal(ui.requests.length, 1);
});

test('unknown case link reconciliation only GETs and never repeats a pending POST', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }); ui.dispatchProject(); await flush();
  ui.$('#asset-title').val('Linked case'); const save = ui.submit('#asset-form'); await flush(); ui.requests[0].resolve(ui.caseRow()); await flush();
  ui.requests[1].reject({ status: 0 }); await flush(); ui.requests[2].resolve({ testCase: ui.caseRow(), steps: [] }); await save;
  const checking = ui.click('#asset-partial-link-retry'); assert.equal(ui.requests[3].method, 'get');
  ui.requests[3].resolve([]); await checking; assert.match(ui.$('#asset-notice').text(), /no duplicate request/);
  const checkingAgain = ui.click('#asset-partial-link-retry'); ui.requests[4].resolve([{ testCase: ui.caseRow(), status: 'NEEDS_REVIEW' }]); await flush();
  ui.requests[5].resolve({ testCase: ui.caseRow(), steps: [] }); await checkingAgain;
  assert.equal(ui.requests.filter(call => call.method === 'post').length, 2, 'Exactly one creation and one initial attach.');
  assert.equal(ui.$('#asset-partial-link-panel').hasClass('d-none'), true);
});

test('401 preserves the form and same-actor reauthentication rechecks permissions and version using GET only', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush(); await ui.click('#asset-edit');
  ui.$('#asset-title').val('Retained after login'); const save = ui.submit('#asset-form'); await flush(); ui.requests[1].reject({ status: 401, message: 'Sign in again' }); await save;
  assert.equal(ui.$('#asset-title').val(), 'Retained after login'); assert.equal(ui.$('#asset-save').prop('disabled'), true);
  ui.reauth(); await flush(); assert.equal(ui.permissionReads.at(-1).force, true);
  assert.equal(ui.requests[2].method, 'get'); ui.requests[2].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush();
  assert.equal(ui.$('#asset-title').val(), 'Retained after login'); assert.equal(ui.$('#asset-save').prop('disabled'), false);
  assert.match(ui.$('#asset-form-recovery-message').text(), /version verified/);
  assert.equal(ui.requests.filter(call => call.method === 'put').length, 1);
});

test('409 retains draft, requires read and explicit comparison before adopting a new expectedVersion', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush(); await ui.click('#asset-edit');
  ui.$('#asset-title').val('My retained change'); const save = ui.submit('#asset-form'); await flush(); ui.requests[1].reject({ status: 409 }); await save;
  assert.equal(ui.$('#asset-save').prop('disabled'), true); assert.equal(ui.$('#asset-title').val(), 'My retained change');
  await ui.submit('#asset-form'); assert.equal(ui.requests.length, 2);
  const check = ui.click('#asset-form-check-read'); ui.requests[2].resolve({ testCase: { ...ui.caseRow(), title: 'Other editor saved title', version: 4 }, steps: completeSteps }); await check;
  assert.equal(ui.$('#asset-title').val(), 'My retained change'); assert.equal(ui.$('#asset-save').prop('disabled'), true);
  assert.equal(ui.$('#asset-use-latest-version').hasClass('d-none'), false);
  ui.window.confirm = () => false; await ui.click('#asset-use-latest-version'); assert.equal(ui.$('#asset-save').prop('disabled'), true);
  ui.window.confirm = () => true; await ui.click('#asset-use-latest-version'); assert.equal(ui.$('#asset-save').prop('disabled'), false);
  assert.equal(ui.requests.filter(call => call.method === 'put').length, 1, 'Reviewing the version must not write.');
  const retry = ui.submit('#asset-form'); assert.equal(ui.requests[3].body.expectedVersion, 4); assert.equal(ui.requests[3].body.title, 'My retained change');
  ui.requests[3].resolve({ ...ui.caseRow(), title: 'My retained change', version: 5 }); await flush();
  ui.requests[4].resolve({ testCase: { ...ui.caseRow(), title: 'My retained change', version: 5 }, steps: completeSteps }); await retry;
});

test('failed conflict inspection keeps the draft and cannot release the version gate', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush(); await ui.click('#asset-edit');
  ui.$('#asset-description').val('Keep this description'); const save = ui.submit('#asset-form'); await flush(); ui.requests[1].reject({ status: 409 }); await save;
  const check = ui.click('#asset-form-check-read'); ui.requests[2].reject({ status: 500, message: 'Unavailable' }); await check;
  await ui.click('#asset-use-latest-version'); await ui.submit('#asset-form');
  assert.equal(ui.requests.length, 3); assert.equal(ui.$('#asset-save').prop('disabled'), true); assert.equal(ui.$('#asset-description').val(), 'Keep this description');
});

test('uncertain versioned save is reconciled only by an exact newer saved definition, without resending', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  const original = { ...ui.caseRow(), description: null, preconditions: null };
  ui.requests[0].resolve({ testCase: original, steps: completeSteps }); await flush(); await ui.click('#asset-edit');
  ui.$('#asset-title').val('Saved once'); const save = ui.submit('#asset-form'); await flush(); const submitted = JSON.parse(JSON.stringify(ui.requests[1].body));
  ui.requests[1].reject({ status: 0 }); await save;
  assert.equal(ui.guards.get('test-assets').dirty(), true); assert.equal(ui.$('#asset-save').prop('disabled'), true);
  const checking = ui.click('#asset-form-cancel'); assert.equal(ui.requests[2].method, 'get');
  ui.requests[2].resolve({ testCase: { ...original, title: submitted.title, version: 4 }, steps: submitted.steps }); await checking; await flush();
  assert.match(ui.$('#asset-notice').text(), /previously uncertain save/); assert.equal(ui.requests.filter(call => call.method === 'put').length, 1);
  assert.equal(ui.guards.get('test-assets').dirty(), false);
  await ui.click('#asset-edit'); assert.equal(ui.$('#asset-save').prop('disabled'), false);
});

test('uncertain update stays locked when a newer saved definition does not match the submitted draft', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }); ui.dispatchProject();
  const original = { ...ui.caseRow(), description: null, preconditions: null };
  ui.requests[0].resolve({ testCase: original, steps: completeSteps }); await flush(); await ui.click('#asset-edit');
  ui.$('#asset-title').val('My uncertain draft'); const save = ui.submit('#asset-form'); await flush(); ui.requests[1].reject({ status: 500 }); await save;
  const checking = ui.click('#asset-form-cancel'); ui.requests[2].resolve({ testCase: { ...original, title: 'Different saved title', version: 4 }, steps: completeSteps }); await checking; await flush();
  await ui.click('#asset-edit'); assert.equal(ui.$('#asset-save').prop('disabled'), true);
  await ui.submit('#asset-form'); assert.equal(ui.requests.filter(call => call.method === 'put').length, 1);
});

test('R2 followup: visible API validation error retranslates without clearing inputs, focus or selection', async () => {
  const translations = { en: { 'r2Error.QA_FIELD_TOO_LONG': 'Shorten this field.' }, 'zh-CN': { 'r2Error.QA_FIELD_TOO_LONG': '请缩短此字段。' } };
  const ui = browser({ view: 'requirements', projectId: '7', action: 'create' }, false, { translations }); ui.dispatchProject();
  ui.$('#asset-title').val('Keep my title'); ui.$('#asset-description').val('Keep my long description');
  const saving = ui.submit('#asset-form'); ui.requests[0].reject({ status: 400, messageKey: 'r2Error.QA_FIELD_TOO_LONG', messageFallback: 'Too long' }); await saving;
  assert.equal(ui.$('#asset-form-error').text(), 'Shorten this field.');
  const input = ui.$('#asset-description')[0]; input.selectionStart = 2; input.selectionEnd = 8; ui.$('#asset-description').trigger('focus');
  ui.setLocale('zh-CN'); await flush();
  assert.equal(ui.$('#asset-form-error').text(), '请缩短此字段。'); assert.equal(ui.$('#asset-description').val(), 'Keep my long description');
  assert.equal(ui.focused(), input); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 8); assert.equal(ui.requests.length, 1);
});

test('R2 followup: conflict recovery guidance and latest saved summary retranslate without another request', async () => {
  const translations = { 'zh-CN': { 'r2Assets.conflictDraft': '草稿保留，先读取最新版本。', 'r2Assets.latestReview': '请对比已保存定义和草稿。', 'common.title': '标题' } };
  const ui = browser({ view: 'test-cases', projectId: '7', testCaseId: '20' }, false, { translations }); ui.dispatchProject();
  ui.requests[0].resolve({ testCase: ui.caseRow(), steps: completeSteps }); await flush(); await ui.click('#asset-edit');
  ui.$('#asset-description').val('Retained draft'); const saving = ui.submit('#asset-form'); ui.requests[1].reject({ status: 409 }); await saving;
  ui.$('#asset-description').trigger('focus'); ui.setLocale('zh-CN'); await flush();
  assert.equal(ui.$('#asset-form-recovery-message').text(), '草稿保留，先读取最新版本。');
  const reading = ui.click('#asset-form-check-read'); ui.requests[2].resolve({ testCase: { ...ui.caseRow(), title: 'Latest title', version: 4 }, steps: completeSteps }); await reading;
  const input = ui.$('#asset-description')[0]; input.selectionStart = 1; input.selectionEnd = 4; ui.$('#asset-description').trigger('focus');
  ui.setLocale('en'); ui.setLocale('zh-CN'); await flush();
  assert.equal(ui.$('#asset-form-recovery-message').text(), '请对比已保存定义和草稿。');
  assert.equal(ui.$('#asset-description').val(), 'Retained draft'); assert.equal(ui.focused(), input); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 4);
  assert.equal(ui.requests.length, 3); assert.equal(ui.$('#asset-save').prop('disabled'), true);
});

test('R2 followup: linked-case source shows scoped key/title and is reverified before the sole creation', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }, false, { controlSource: true }); ui.dispatchProject();
  assert.equal(ui.requests[0].url, 'projects/7/requirements/10'); assert.equal(ui.$('#asset-save').prop('disabled'), true);
  ui.$('#asset-title').val('Case with named source'); await ui.submit('#asset-form'); assert.equal(ui.requests.length, 1);
  ui.requests[0].resolve({ ...ui.requirement(), title: 'User can log in' }); await flush();
  assert.match(ui.$('#asset-form-context').text(), /REQ-010.*User can log in/); assert.equal(ui.$('#asset-save').prop('disabled'), false);
  const saving = ui.submit('#asset-form'); assert.equal(ui.requests[1].method, 'get'); assert.equal(ui.requests[1].url, 'projects/7/requirements/10');
  ui.requests[1].resolve(ui.requirement()); await flush(); assert.equal(ui.requests[2].method, 'post'); assert.equal(ui.requests[2].url, 'projects/7/test-cases');
  ui.requests[2].resolve(ui.caseRow()); await flush(); assert.equal(ui.requests[3].url, 'projects/7/requirements/10/test-cases/20');
  ui.requests[3].resolve(); await flush(); ui.requests[4].resolve({ testCase: ui.caseRow(), steps: [] }); await saving;
  assert.equal(ui.requests.filter(call => call.method === 'post').length, 2); assert.equal(ui.requests.some(call => call.url.endsWith('/confirm')), false);
});

test('R2 followup: failed and archived source reads block creation, preserve draft and expose read-only retry', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }, false, { controlSource: true }); ui.dispatchProject();
  ui.$('#asset-title').val('Do not orphan'); ui.requests[0].reject({ status: 500, message: 'Source unavailable' }); await flush();
  assert.equal(ui.$('#asset-save').prop('disabled'), true); assert.equal(ui.$('#asset-source-retry').hasClass('d-none'), false);
  await ui.submit('#asset-form'); assert.equal(ui.requests.length, 1);
  const reading = ui.click('#asset-source-retry'); ui.requests[1].resolve(ui.requirement(10, 'ARCHIVED')); await reading;
  assert.equal(ui.$('#asset-title').val(), 'Do not orphan'); assert.equal(ui.$('#asset-save').prop('disabled'), true); assert.match(ui.$('#asset-form-context').text(), /archived/);
  const retry = ui.click('#asset-source-retry'); ui.requests[2].resolve(ui.requirement()); await retry;
  assert.equal(ui.$('#asset-save').prop('disabled'), false); assert.equal(ui.requests.every(call => call.method === 'get'), true);
});

test('R2 followup: source ownership and late responses cannot authorize another project or source', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }, false, { controlSource: true }); ui.dispatchProject();
  ui.nav.open('test-cases', { projectId: '7', action: 'create', sourceRequirementId: '11' });
  ui.requests[1].resolve({ ...ui.requirement(11), projectId: 8 }); await flush();
  ui.requests[0].resolve(ui.requirement()); await flush();
  assert.equal(ui.$('#asset-save').prop('disabled'), true); assert.match(ui.$('#asset-form-context').text(), /selected project/);
  ui.$('#asset-title').val('No cross-project source'); await ui.submit('#asset-form'); assert.equal(ui.requests.every(call => call.method === 'get'), true);
});

test('R2 followup: source archived during editing is detected before creating any case', async () => {
  const ui = browser({ view: 'test-cases', projectId: '7', action: 'create', sourceRequirementId: '10' }, false, { controlSource: true }); ui.dispatchProject();
  ui.requests[0].resolve(ui.requirement()); await flush(); ui.$('#asset-title').val('Still a local draft');
  const saving = ui.submit('#asset-form'); ui.requests[1].resolve(ui.requirement(10, 'ARCHIVED')); await saving;
  assert.equal(ui.requests.length, 2); assert.equal(ui.requests.every(call => call.method === 'get'), true);
  assert.equal(ui.$('#asset-title').val(), 'Still a local draft'); assert.equal(ui.$('#asset-save').prop('disabled'), true); assert.equal(ui.$('#asset-source-retry').prop('disabled'), false);
});
