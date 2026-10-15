const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/defects.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function browser(context = { view: 'defects', projectId: '1' }, options = {}) {
  const nodes = new Map(), calls = [], memberCalls = [], closureCalls = [], actorCalls = [], projectCalls = [], listeners = new Map(), emitted = [], opened = [];
  let locale = 'en';
  const chinese = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../main/webapp/i18n/zh-CN.json'), 'utf8'));
  const english = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../main/webapp/i18n/en.json'), 'utf8'));
  let route = { ...context };
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.children = []; this.parent = null;
      this.classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
      this.handlers = new Map(); this.content = ''; this.value = ''; this.disabled = false;
      this.required = false;
      if (attrs.id) nodes.set(attrs.id, this);
    }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    reset() { this.all().forEach(node => { node.value = node.tag === 'select' ? node.children[0]?.value || '' : ''; }); }
    reportValidity() { return this.all().every(node => !node.required || node.disabled || !!node.value); }
  }
  function matches(node, selector) {
    const match = /^(?:#([\w-]+)|([\w-]+))?(?:\[value="([^"]*)"\])?$/.exec(selector);
    return !!match && (!match[1] || node.attrs.id === match[1]) && (!match[2] || node.tag === match[2]) &&
      (match[3] === undefined || String(node.value) === match[3]);
  }
  function query(selector) {
    return selector.split(',').flatMap(part => {
      const pieces = part.trim().split(/\s+/);
      let values = [...nodes.values()].filter(node => matches(node, pieces[0]));
      for (const piece of pieces.slice(1)) values = values.flatMap(node => node.all().filter(child => matches(child, piece)));
      return values;
    });
  }
  class Collection {
    constructor(values) { this.values = [...new Set(values)]; this.length = this.values.length; this.values.forEach((value, index) => { this[index] = value; }); }
    each(fn) { this.values.forEach(node => fn(node)); return this; }
    on(name, fn) { return this.each(node => { if (!node.handlers.has(name)) node.handlers.set(name, []); node.handlers.get(name).push(fn); }); }
    text(value) {
      if (value === undefined) return this.values.map(node => node.content + node.all().map(child => child.content).join('')).join('');
      return this.each(node => { node.content = String(value); node.children = []; });
    }
    val(value) {
      if (value === undefined) return this[0]?.value ?? null;
      return this.each(node => { node.value = String(value ?? ''); });
    }
    empty() { return this.each(node => { node.children = []; node.content = ''; if (node.tag === 'select') node.value = ''; }); }
    append(...items) { return this.each(node => items.forEach(item => (item instanceof Collection ? item.values : [item]).forEach(child => { child.parent = node; node.children.push(child); }))); }
    prop(name, value) { if (value === undefined) return this[0]?.[name]; return this.each(node => { node[name] = value; }); }
    attr(name, value) { return this.each(node => { node.attrs[name] = String(value); if (name === 'id') nodes.set(String(value), node); }); }
    toggleClass(name, value) { return this.each(node => { if (value) node.classes.add(name); else node.classes.delete(name); }); }
    addClass(value) { return this.each(node => value.split(/\s+/).forEach(name => node.classes.add(name))); }
    removeClass(name) { return this.each(node => node.classes.delete(name)); }
    hasClass(name) { return this[0]?.classes.has(name) || false; }
    find(selector) { return new Collection(this.values.flatMap(node => node.all().filter(child => matches(child, selector)))); }
    after(item) { return this.each(node => { item.values.forEach(child => { child.parent = node.parent; node.parent.children.splice(node.parent.children.indexOf(node) + 1, 0, child); }); }); }
    remove() { return this.each(node => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); if (node.attrs.id) nodes.delete(node.attrs.id); }); }
    trigger(name) { if (name === 'focus' && this[0]) document.activeElement = this[0]; return this; }
  }
  const document = {
    handlers: new Map(),
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatchEvent(event) {
      emitted.push(event);
      (document.handlers.get(event.type) || []).forEach(fn => fn({ originalEvent: event }));
      (listeners.get(event.type) || []).forEach(fn => fn(event));
    }
  };
  function $(selector) {
    if (selector === document) return new Collection([document]);
    if (typeof selector !== 'string') return new Collection([selector]);
    if (selector.startsWith('<')) {
      const attrs = Object.fromEntries([...selector.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      return new Collection([new Element(/^<([\w-]+)/.exec(selector)[1], attrs)]);
    }
    return new Collection(query(selector));
  }
  function add(id, tag = 'div', parent) {
    const node = new Element(tag, { id });
    if (parent) { node.parent = nodes.get(parent); node.parent.children.push(node); }
    return node;
  }
  ['defect-list-panel', 'defect-detail-panel', 'defect-create-form'].forEach(id => add(id, id.endsWith('form') ? 'form' : 'div'));
  ['defect-notice', 'defect-list-status', 'defect-list', 'defect-new'].forEach(id => add(id));
  add('defect-list-heading', 'h2', 'defect-list-panel');
  ['defect-detail-title', 'defect-detail', 'defect-evidence', 'defect-evidence-status', 'defect-actions', 'defect-back', 'defect-action-status', 'defect-closure', 'defect-closure-heading'].forEach(id => add(id, id === 'defect-back' ? 'button' : 'div', 'defect-detail-panel'));
  add('defect-action-form', 'form', 'defect-detail-panel');
  ['defect-action-title', 'defect-action-help', 'defect-action-error', 'defect-resolution-wrap', 'defect-action-assignee-wrap', 'defect-action-evidence'].forEach(id => add(id, 'div', 'defect-action-form'));
  add('defect-resolution', 'textarea', 'defect-resolution-wrap'); add('defect-action-assignee', 'select', 'defect-action-assignee-wrap');
  add('defect-edit-fields', 'div', 'defect-action-form');
  ['title', 'description', 'severity', 'priority'].forEach(suffix => add('defect-edit-' + suffix, ['severity', 'priority'].includes(suffix) ? 'select' : 'input', 'defect-edit-fields'));
  ['defect-create-heading', 'defect-create-error', 'defect-create-context', 'defect-create-target-wrap', 'defect-create-fields'].forEach(id => add(id, 'div', 'defect-create-form'));
  add('defect-create-target', 'select', 'defect-create-target-wrap');
  for (const prefix of ['defect-create', 'defect-action']) {
    for (const suffix of ['run', 'case', 'attempt']) add(prefix + '-' + suffix, 'select', prefix === 'defect-create' ? 'defect-create-form' : 'defect-action-evidence').required = prefix === 'defect-create';
    add(prefix + '-submit', 'button', prefix + '-form'); add(prefix + '-cancel', 'button', prefix + '-form');
  }
  ['title', 'description', 'assignee', 'severity', 'priority'].forEach(suffix => add('defect-create-' + suffix, ['assignee', 'severity', 'priority'].includes(suffix) ? 'select' : 'input', 'defect-create-fields'));
  for (const prefix of ['defect-create', 'defect-action']) { add(prefix + '-assignee-search', 'input', prefix === 'defect-create' ? 'defect-create-fields' : 'defect-action-assignee-wrap'); add(prefix + '-assignee-status', 'div', prefix === 'defect-create' ? 'defect-create-fields' : 'defect-action-assignee-wrap'); }
  nodes.get('defect-create-title').required = true;
  function request(method, url, body) {
    let resolve, reject;
    const promise = new Promise((ok, error) => { resolve = ok; reject = error; });
    const call = { method, url, body: body && plain(body), resolve, reject };
    if (url === 'auth/me') { actorCalls.push(call); resolve(options.actor || { id: 1, systemRole: 'ADMIN', status: 'ACTIVE' }); }
    else if (/^projects\/[1-9][0-9]*$/.test(url)) { projectCalls.push(call); resolve(options.project || { id: Number(url.split('/')[1]), status: 'ACTIVE' }); }
    else if (url.endsWith('/closure-eligibility')) {
      closureCalls.push(call);
      if (!options.manualEligibility) resolve({ defect: { id: 9, status: 'RESOLVED', lockVersion: 2 }, defectVersion: 2, canClose: true, failures: [], reasons: [], history: [], legacyClosed: false });
    } else if (url.endsWith('/members')) {
      memberCalls.push(call);
      if (!options.manualMembers) resolve([{ userId: 11, username: 'dev', displayName: 'Developer', projectRole: 'DEVELOPER', status: 'ACTIVE', userStatus: 'ACTIVE' }]);
    } else calls.push(call);
    return promise;
  }
  const api = { get: url => request('GET', url), post: (url, body) => request('POST', url, body), put: (url, body) => request('PUT', url, body) };
  const nav = {
    read: () => route,
    select(view, value) { route = { view, ...plain(value) }; },
    href(view, value) { return 'https://example.test/veriqra/index.html?' + new URLSearchParams(value).toString() + '#' + view; },
    open(view, value) { opened.push({ view, ...plain(value) }); route = { view, ...plain(value) }; document.dispatchEvent({ type: 'veriqra:view', detail: { view, projectId: value.projectId, context: route } }); }
  };
  const storage = options.storage || new Map();
  const window = { VeriqraApi: api, VeriqraQaNavigation: nav, confirm: () => true, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, I18n: {
    t: (key, values, fallback) => ((locale === 'zh-CN' && chinese[key]) || (key.startsWith('defects.reason.') && english[key]) || fallback || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? ''),
    enumLabel: value => value, formatDateTime: value => value || '—', formatNumber: value => String(value)
  } };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  let sequence = 0;
  vm.runInNewContext(source, { window, document, jQuery: $, CustomEvent, location: { hash: '#defects' }, crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') } });
  const emit = (type, detail) => document.dispatchEvent({ type, detail });
  const fire = (node, type = 'click') => Promise.all((node.handlers.get(type) || []).map(fn => fn.call(node, { preventDefault() {} })));
  emit('veriqra:project', { project: { id: Number(context.projectId || 1) } });
  return { $, nodes, calls, memberCalls, closureCalls, actorCalls, projectCalls, storage, emit, fire, opened, emitted, route: () => route, nav, focused: () => document.activeElement, locale(name) { locale = name; emit('veriqra:localechange', {}); } };
}

const defect = (id = 9, status = 'OPEN') => ({ id, keyNo: id, projectId: 1, title: 'Broken login', status, severity: 'HIGH', priority: 'HIGH', version: 2 });
const evidence = (attemptId = 6) => ({ attemptId, runId: 4, runCaseId: 5, attemptNo: attemptId - 5, outcome: 'FAIL', failureMessage: 'failed' });
const run = { run: { id: 4, name: 'Regression' }, cases: [{ runCaseId: 5, testCaseId: 3, snapshotTitle: 'Frozen login' }] };
const fail = id => ({ id, runCaseId: 5, attemptNo: id - 5, outcome: 'FAIL', executedAt: '2026-10-01', comment: 'Actual failure' });
function button(ui, container, label) { return ui.nodes.get(container).all().find(node => node.tag === 'button' && node.content === label); }

async function loadPrefill(ui) {
  ui.calls.find(call => call.url === 'projects/1/runs').resolve([{ id: 4, name: 'Regression' }]); await flush();
  ui.calls.find(call => call.url === 'projects/1/runs/4').resolve(run); await flush();
  ui.calls.find(call => call.url.endsWith('/attempts')).resolve([fail(6), { ...fail(7), outcome: 'PASS' }]); await flush();
}

test('defect detail shares enrichment and produces exact source Attempt and original Case links', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(), evidence: [evidence(6), evidence(7)] }); await flush();
  assert.deepEqual(ui.calls.map(call => call.url), ['projects/1/defects/9', 'projects/1/runs/4', 'projects/1/runs/4/cases/5/attempts']);
  ui.calls[1].resolve(run); ui.calls[2].resolve([fail(6), fail(7)]); await flush();
  const anchors = ui.nodes.get('defect-evidence').all().filter(node => node.tag === 'a');
  const exact = anchors.find(node => node.content === 'Open source attempt');
  const href = new URL(exact.attrs.href);
  assert.equal(href.hash, '#runs'); assert.equal(href.searchParams.get('runCaseId'), '5'); assert.equal(href.searchParams.get('attemptId'), '6');
  await ui.fire(exact);
  assert.deepEqual(ui.opened[0], { view: 'runs', projectId: '1', runId: '4', runCaseId: '5', attemptId: '6', defectId: '9' });
  const original = anchors.find(node => node.content === 'Open original Test Case');
  assert.equal(new URL(original.attrs.href).searchParams.get('testCaseId'), '3');
});

test('failed enrichment does not claim empty retests and retry preserves evidence identity', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(), evidence: [evidence()] }); await flush();
  ui.calls[1].resolve(run); ui.calls[2].reject({ status: 500, message: 'Unavailable' }); await flush();
  assert.match(ui.$('#defect-evidence').text(), /Retest status is unavailable/);
  assert.doesNotMatch(ui.$('#defect-evidence').text(), /No later attempt recorded/);
  const retry = button(ui, 'defect-evidence', 'Retry evidence');
  const pending = ui.fire(retry); await flush();
  assert.equal(retry.disabled, true);
  ui.calls[3].resolve(run); ui.calls[4].resolve([fail(6)]); await pending; await flush();
  assert.match(ui.$('#defect-evidence').text(), /No later attempt recorded/);
  assert.doesNotMatch(ui.$('#defect-evidence').text(), /Retest status is unavailable/);
});

test('late evidence mutation controls remain disabled while a transition is pending', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(), evidence: [evidence()] }); await flush();
  const pending = ui.fire(button(ui, 'defect-actions', 'Start work')); await flush();
  const transition = ui.calls.find(call => call.method === 'POST');
  assert.deepEqual(transition.body, { expectedVersion: 2 });
  ui.calls[1].resolve(run); ui.calls[2].resolve([fail(6)]); await flush();
  const remove = button(ui, 'defect-evidence', 'Remove link (correction)');
  assert.equal(remove.disabled, true);
  await ui.fire(remove); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  transition.reject({ status: 409, message: 'Conflict' }); await pending;
  assert.equal(remove.disabled, false);
});

test('route creation prefills numeric API identities and reports the verified association', async () => {
  const ui = browser({ view: 'defects', projectId: '1', action: 'create', runId: '4', runCaseId: '5', attemptId: '6' });
  await loadPrefill(ui);
  assert.equal(ui.$('#defect-create-attempt').val(), '6'); assert.equal(ui.$('#defect-create-submit').prop('disabled'), false);
  ui.$('#defect-create-title').val('Failure'); ui.$('#defect-create-severity').val('HIGH'); ui.$('#defect-create-priority').val('HIGH');
  const pending = ui.fire(ui.nodes.get('defect-create-form'), 'submit'); await flush();
  const creation = ui.calls.find(call => call.method === 'POST');
  assert.deepEqual(creation.body, { failureAttemptId: 6, title: 'Failure', description: null, severity: 'HIGH', priority: 'HIGH', assigneeId: null });
  creation.resolve(defect()); await flush();
  assert.deepEqual(plain(ui.emitted.find(event => event.type === 'veriqra:defect-linked').detail), { projectId: '1', defectId: '9', runId: '4', runCaseId: '5', attemptId: '6' });
  assert.equal(ui.route().defectId, '9'); assert.equal(ui.route().action, undefined);
  ui.calls.at(-1).resolve({ defect: defect(), evidence: [] }); await pending;
});

test('association loads one Defect list and posts versioned failure evidence to the selected existing Defect', async () => {
  const ui = browser({ view: 'defects', projectId: '1', action: 'link', runId: '4', runCaseId: '5', attemptId: '6' });
  ui.calls.find(call => call.url === 'projects/1/defects').resolve([defect(), defect(10, 'CLOSED')]);
  await loadPrefill(ui);
  assert.equal(ui.nodes.get('defect-create-title').disabled, true);
  assert.equal(ui.nodes.get('defect-create-target').children.some(node => node.value === '10'), false);
  ui.$('#defect-create-target').val('9'); await ui.fire(ui.nodes.get('defect-create-target'), 'change');
  const pending = ui.fire(ui.nodes.get('defect-create-form'), 'submit'); await flush();
  await ui.fire(ui.nodes.get('defect-create-form'), 'submit');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1, 'A second submit while the association is pending must not write again.');
  const write = ui.calls.find(call => call.method === 'POST');
  assert.equal(write.url, 'projects/1/defects/9/evidence'); assert.deepEqual(write.body, { failureAttemptId: 6, expectedVersion: 2 });
  assert.equal(ui.calls.filter(call => /\/defects\/\d+$/.test(call.url)).length, 0);
  write.resolve(undefined); await flush(); ui.calls.at(-1).resolve({ defect: defect(), evidence: [] }); await pending;
  assert.equal(ui.route().defectId, '9');
});

test('late evidence from an earlier Defect cannot replace the newer Defect detail', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(), evidence: [evidence()] }); await flush();
  const oldRun = ui.calls[1], oldHistory = ui.calls[2];
  ui.nav.open('defects', { projectId: '1', defectId: '10' }); await flush();
  ui.calls[3].resolve({ defect: defect(10), evidence: [] }); await flush();
  oldRun.resolve(run); oldHistory.resolve([fail(6)]); await flush();
  assert.match(ui.$('#defect-detail-title').text(), /BUG-010/);
  assert.equal(ui.$('#defect-evidence').text(), '');
  assert.match(ui.$('#defect-evidence-status').text(), /No linked failure evidence/);
});

test('successful removal reports its original verified association even after navigating away', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(), evidence: [evidence()] }); await flush();
  ui.calls[1].resolve(run); ui.calls[2].resolve([fail(6)]); await flush();
  const pending = ui.fire(button(ui, 'defect-evidence', 'Remove link (correction)')); await flush();
  const removal = ui.calls[3];
  assert.equal(removal.url, 'projects/1/defects/9/evidence/6/remove');
  ui.nav.open('runs', { projectId: '1', runId: '4', runCaseId: '5', attemptId: '6' });
  removal.resolve(undefined); await pending;
  assert.deepEqual(plain(ui.emitted.find(event => event.type === 'veriqra:defect-unlinked').detail),
    { projectId: '1', defectId: '9', attemptId: '6', runId: '4', runCaseId: '5' });
  assert.equal(ui.calls.filter(call => call.url === 'projects/1/defects/9').length, 1, 'The stale detail must not reopen.');
});

for (const action of ['create', 'link']) {
  test('successful ' + action + ' reports its original association after changing projects', async () => {
    const ui = browser({ view: 'defects', projectId: '1', action, runId: '4', runCaseId: '5', attemptId: '6' });
    if (action === 'link') ui.calls.find(call => call.url === 'projects/1/defects').resolve([defect()]);
    await loadPrefill(ui);
    if (action === 'link') {
      ui.$('#defect-create-target').val('9'); await ui.fire(ui.nodes.get('defect-create-target'), 'change');
    } else {
      ui.$('#defect-create-title').val('Failure'); ui.$('#defect-create-severity').val('HIGH'); ui.$('#defect-create-priority').val('HIGH');
    }
    const pending = ui.fire(ui.nodes.get('defect-create-form'), 'submit'); await flush();
    const write = ui.calls.find(call => call.method === 'POST');
    ui.nav.open('runs', { projectId: '2', runId: '8' }); ui.emit('veriqra:project', { project: { id: 2 } });
    write.resolve(action === 'link' ? undefined : defect()); await pending;
    assert.deepEqual(plain(ui.emitted.find(event => event.type === 'veriqra:defect-linked').detail),
      { projectId: '1', defectId: '9', runId: '4', runCaseId: '5', attemptId: '6' });
    assert.deepEqual(ui.route(), { view: 'runs', projectId: '2', runId: '8' });
    assert.equal(ui.calls.filter(call => call.url === 'projects/1/defects/9').length, 0, 'A completed stale write must not reopen detail.');
  });
}

for (const mode of ['add', 'reopen']) {
  test('successful ' + mode + ' reports its captured source after changing projects', async () => {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
    ui.calls[0].resolve({ defect: defect(9, mode === 'reopen' ? 'CLOSED' : 'OPEN'), evidence: [evidence()] }); await flush();
    ui.calls[1].resolve(run); ui.calls[2].resolve([fail(6)]); await flush();
    await ui.fire(button(ui, 'defect-actions', mode === 'reopen' ? 'Reopen with new FAIL' : 'Add failure evidence'));
    ui.calls.at(-1).resolve([{ id: 4, name: 'Regression' }]); await flush();
    ui.$('#defect-action-run').val('4'); await ui.fire(ui.nodes.get('defect-action-run'), 'change');
    ui.calls.at(-1).resolve(run); await flush();
    ui.$('#defect-action-case').val('5'); await ui.fire(ui.nodes.get('defect-action-case'), 'change');
    ui.calls.at(-1).resolve([fail(6), fail(7)]); await flush();
    ui.$('#defect-action-attempt').val('7'); await ui.fire(ui.nodes.get('defect-action-attempt'), 'change');
    if (mode === 'reopen') { ui.$('#defect-action-assignee').val('11'); await ui.fire(ui.nodes.get('defect-action-assignee'), 'change'); }
    const pending = ui.fire(ui.nodes.get('defect-action-form'), 'submit'); await flush();
    const write = ui.calls.find(call => call.method === 'POST');
    assert.equal(write.url, 'projects/1/defects/9/' + (mode === 'add' ? 'evidence' : 'reopen'));
    ui.nav.open('runs', { projectId: '2', runId: '8' }); ui.emit('veriqra:project', { project: { id: 2 } });
    write.resolve(undefined); await pending;
    assert.deepEqual(plain(ui.emitted.find(event => event.type === 'veriqra:defect-linked').detail),
      { projectId: '1', defectId: '9', runId: '4', runCaseId: '5', attemptId: '7' });
    assert.deepEqual(ui.route(), { view: 'runs', projectId: '2', runId: '8' });
    assert.equal(ui.calls.filter(call => call.url === 'projects/1/defects/9').length, 1, 'A completed stale write must not reopen detail.');
  });
}

test('canonical failureAttemptId route and missing FAIL source cannot enable an invalid submit', async () => {
  const ui = browser({ view: 'defects', projectId: '1', action: 'create', runId: '4', runCaseId: '5', failureAttemptId: '99' });
  await loadPrefill(ui);
  assert.equal(ui.$('#defect-create-submit').prop('disabled'), true);
  assert.match(ui.$('#defect-create-error').text(), /no longer available/);
  ui.$('#defect-create-attempt').val('6'); await ui.fire(ui.nodes.get('defect-create-attempt'), 'change');
  assert.equal(ui.route().failureAttemptId, '6');
  assert.equal(ui.$('#defect-create-submit').prop('disabled'), false);
});

test('rapid picker changes and project changes reject stale FAIL selections and stale detail responses', async () => {
  const ui = browser({ view: 'defects', projectId: '1', action: 'create', runId: '4', runCaseId: '5', attemptId: '6' });
  ui.calls[0].resolve([{ id: 4, name: 'First' }, { id: 8, name: 'Second' }]); await flush();
  const first = ui.calls[1];
  ui.$('#defect-create-run').val('8'); await ui.fire(ui.nodes.get('defect-create-run'), 'change');
  ui.calls[2].resolve({ run: { id: 8 }, cases: [{ runCaseId: 12, snapshotTitle: 'Second case' }] }); await flush();
  first.resolve(run); await flush();
  assert.equal(ui.nodes.get('defect-create-case').children.some(node => node.value === '5'), false);
  ui.$('#defect-create-attempt').val('6'); await ui.fire(ui.nodes.get('defect-create-attempt'), 'change');
  assert.equal(ui.$('#defect-create-submit').prop('disabled'), true);
  ui.nav.open('defects', { projectId: '1', defectId: '9' }); await flush();
  const stale = ui.calls.at(-1);
  ui.nav.select('defects', { projectId: '2' }); ui.emit('veriqra:project', { project: { id: 2 } });
  stale.resolve({ defect: defect(), evidence: [evidence()] }); await flush();
  assert.equal(ui.$('#defect-detail').text(), '');
  assert.equal(ui.calls.filter(call => call.url === 'projects/1/runs/4/cases/5/attempts').length, 0);
});

test('locale changes keep an unsubmitted resolution draft and selected FAIL evidence', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(9, 'IN_PROGRESS'), evidence: [] }); await flush();
  await ui.fire(button(ui, 'defect-actions', 'Resolve'));
  ui.$('#defect-resolution').val('Working draft');
  ui.emit('veriqra:localechange', {});
  assert.equal(ui.$('#defect-resolution').val(), 'Working draft');
  assert.equal(ui.$('#defect-action-form').hasClass('d-none'), false);
  assert.equal(ui.calls.length, 1);
});

test('Defect list and detail failure end loading and offer scoped GET Retry', async () => {
  for (const detailed of [false, true]) {
    const ui = browser({ view: 'defects', projectId: '1', ...(detailed ? { defectId: '9' } : {}) });
    ui.calls[0].reject({ status: 500, message: 'Defects unavailable' }); await flush();
    assert.equal(ui.$(detailed ? '#defect-detail-title' : '#defect-list-status').text(), 'Unavailable');
    const retry = button(ui, detailed ? 'defect-actions' : 'defect-list', 'Retry');
    const loading = ui.fire(retry); assert.equal(ui.calls.at(-1).method, 'GET');
    assert.equal(ui.calls.at(-1).url, 'projects/1/defects' + (detailed ? '/9' : ''));
    ui.calls.at(-1).resolve(detailed ? { defect: defect(), evidence: [] } : []); await loading;
    assert.match(ui.$(detailed ? '#defect-detail-title' : '#defect-list-status').text(), detailed ? /Broken login/ : /No defects/);
    assert.equal(ui.calls.every(call => call.method === 'GET'), true);
    ui.nav.open('defects', { projectId: '1', action: 'create' }); const before = ui.calls.length;
    await ui.fire(retry); assert.equal(ui.calls.length, before, 'Obsolete Retry cannot reopen another panel');
  }
});

test('each evidence picker failure stays unavailable across locale and Retry preserves the unsaved draft', async () => {
  for (const field of ['run', 'case', 'attempt']) {
    const ui = browser({ view: 'defects', projectId: '1', action: 'create', runId: '4', runCaseId: '5', attemptId: '6' });
    ui.$('#defect-create-title').val('Unsaved report'); ui.$('#defect-create-description').val('Typed details');
    if (field !== 'run') { ui.calls.at(-1).resolve([{ id: 4, name: 'Regression' }]); await flush(); }
    if (field === 'attempt') { ui.calls.at(-1).resolve(run); await flush(); }
    ui.calls.at(-1).reject({ status: 500, message: field + ' unavailable' }); await flush();
    const select = ui.$('#defect-create-' + field);
    assert.equal(select[0].children[0].content, 'Unavailable'); assert.equal(select.prop('disabled'), true);
    ui.emit('veriqra:localechange', {});
    assert.equal(select[0].children[0].content, 'Unavailable'); assert.equal(ui.$('#defect-create-submit').prop('disabled'), true);
    const loading = ui.fire(ui.nodes.get('defect-create-' + field + '-retry'));
    assert.equal(ui.calls.at(-1).method, 'GET'); ui.calls.at(-1).resolve(field === 'case' ? { cases: [] } : []); await loading;
    assert.notEqual(select[0].children[0].content, 'Unavailable');
    assert.equal(ui.$('#defect-create-title').val(), 'Unsaved report'); assert.equal(ui.$('#defect-create-description').val(), 'Typed details');
    assert.equal(ui.calls.every(call => call.method === 'GET'), true);
  }
});

test('failed existing-defect picker remains disabled on locale and retries independently of evidence', async () => {
  const ui = browser({ view: 'defects', projectId: '1', action: 'link' });
  ui.calls.find(call => call.url.endsWith('/runs')).resolve([]);
  ui.calls.find(call => call.url.endsWith('/defects')).reject({ status: 500, message: 'Defect choices unavailable' }); await flush();
  ui.emit('veriqra:localechange', {});
  assert.equal(ui.$('#defect-create-target').prop('disabled'), true);
  assert.equal(ui.$('#defect-create-target')[0].children[0].content, 'Unavailable');
  const loading = ui.fire(ui.nodes.get('defect-create-target-retry')); ui.calls.at(-1).resolve([]); await loading;
  assert.match(ui.$('#defect-create-target')[0].children[0].content, /No open defects/);
  assert.equal(ui.calls.filter(call => call.url.endsWith('/runs')).length, 1);
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('opening and cancelling a Defect resolution panel moves focus to visible controls', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(9, 'IN_PROGRESS'), evidence: [] }); await flush();
  await ui.fire(button(ui, 'defect-actions', 'Resolve'));
  assert.equal(ui.focused(), ui.$('#defect-resolution')[0]);
  await ui.fire(ui.$('#defect-action-cancel')[0]);
  assert.equal(ui.$('#defect-action-form').hasClass('d-none'), true); assert.equal(ui.focused(), ui.$('#defect-detail-title')[0]);
});

for (const state of ['pending', 'failed']) {
  test('locale change restores the selected Defect while detail is ' + state, async () => {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
    const first = ui.calls[0];
    if (state === 'failed') { first.reject({ status: 500, message: 'Detail unavailable' }); await flush(); }
    ui.emit('veriqra:localechange', {}); await flush();
    assert.equal(ui.calls[1].url, 'projects/1/defects/9');
    assert.equal(ui.$('#defect-detail-panel').hasClass('d-none'), false);
    assert.equal(ui.$('#defect-list-panel').hasClass('d-none'), true);
    assert.equal(ui.route().defectId, '9');
    if (state === 'pending') { first.resolve({ defect: defect(10), evidence: [] }); await flush(); }
    ui.calls[1].resolve({ defect: defect(), evidence: [] }); await flush();
    assert.match(ui.$('#defect-detail-title').text(), /BUG-009/);
    assert.equal(ui.calls.filter(call => call.url === 'projects/1/defects').length, 0);
  });
}

const developer = (id, name, extra = {}) => ({ userId: id, username: name.toLowerCase(), displayName: name, projectRole: 'DEVELOPER', status: 'ACTIVE', userStatus: 'ACTIVE', ...extra });

test('assignee picker searches real active project Developers and never defaults or requests an admin directory', async () => {
  const ui = browser({ view: 'defects', projectId: '1', action: 'create', runId: '4', runCaseId: '5', attemptId: '6' }, { manualMembers: true });
  await loadPrefill(ui);
  assert.equal(ui.$('#defect-create-submit').prop('disabled'), true);
  ui.memberCalls[0].resolve([developer(11, 'Alice'), developer(12, 'Bob'), developer(13, 'Disabled', { userStatus: 'DISABLED' }), developer(14, 'Inactive', { status: 'INACTIVE' }), developer(15, 'Tester', { projectRole: 'TESTER' })]); await flush();
  assert.equal(ui.$('#defect-create-assignee').val(), '');
  assert.deepEqual(ui.$('#defect-create-assignee')[0].children.map(node => node.value), ['', '11', '12']);
  ui.$('#defect-create-assignee-search').val('bob'); await ui.fire(ui.nodes.get('defect-create-assignee-search'), 'input');
  assert.deepEqual(ui.$('#defect-create-assignee')[0].children.map(node => node.value), ['', '12']);
  ui.$('#defect-create-assignee').val('12'); await ui.fire(ui.nodes.get('defect-create-assignee'), 'change');
  ui.$('#defect-create-assignee-search').val('alice'); await ui.fire(ui.nodes.get('defect-create-assignee-search'), 'input');
  assert.equal(ui.$('#defect-create-assignee').val(), '12', 'Filtering cannot clear a chosen assignment');
  ui.$('#defect-create-assignee').val(''); await ui.fire(ui.nodes.get('defect-create-assignee'), 'change'); ui.emit('veriqra:localechange', {});
  assert.equal(ui.$('#defect-create-assignee').val(), '', 'A deliberate clear stays cleared');
  assert.deepEqual(ui.memberCalls.map(call => call.url), ['projects/1/members']);
});

test('member failure blocks reassignment, exposes scoped Retry, preserves drafts and rejects stale project results', async () => {
  const ui = browser({ view: 'defects', projectId: '1', action: 'create', runId: '4', runCaseId: '5', attemptId: '6' }, { manualMembers: true });
  await loadPrefill(ui); ui.$('#defect-create-title').val('Unsaved title');
  ui.memberCalls[0].reject({ status: 500, message: 'Unavailable' }); await flush();
  assert.equal(ui.$('#defect-create-assignee').prop('disabled'), true); assert.equal(ui.$('#defect-create-submit').prop('disabled'), true);
  const retry = ui.fire(ui.nodes.get('defect-create-assignee-retry')); ui.memberCalls[1].resolve([developer(11, 'Alice')]); await retry;
  assert.equal(ui.$('#defect-create-title').val(), 'Unsaved title'); assert.equal(ui.$('#defect-create-submit').prop('disabled'), false);
  ui.nav.open('defects', { projectId: '1', action: 'create' });
  const stale = ui.memberCalls.at(-1);
  ui.nav.select('defects', { projectId: '2', action: 'create' }); ui.emit('veriqra:project', { project: { id: 2 } });
  stale.resolve([developer(99, 'Old project')]); await flush();
  assert.equal(ui.$('#defect-create-assignee')[0].children.some(node => node.value === '99'), false);
});

test('metadata edits preserve outsider or disabled existing assignees and save with the captured version', async () => {
  for (const current of [88, 13]) {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualMembers: true });
    ui.calls[0].resolve({ defect: { ...defect(), assigneeId: current }, evidence: [] }); await flush();
    ui.memberCalls[0].resolve([developer(11, 'Alice'), developer(13, 'Disabled', { userStatus: 'DISABLED' })]); await flush();
    await ui.fire(button(ui, 'defect-actions', 'Edit and reassign'));
    ui.memberCalls[1].resolve([developer(11, 'Alice'), developer(13, 'Disabled', { userStatus: 'DISABLED' })]); await flush();
    assert.equal(ui.$('#defect-action-assignee').val(), String(current));
    ui.$('#defect-edit-title').val('Edited title'); ui.$('#defect-edit-description').val('Edited detail');
    const pending = ui.fire(ui.nodes.get('defect-action-form'), 'submit'); await flush();
    const write = ui.calls.at(-1); assert.equal(write.method, 'PUT');
    assert.deepEqual(write.body, { expectedVersion: 2, title: 'Edited title', description: 'Edited detail', severity: 'HIGH', priority: 'HIGH', assigneeId: current });
    write.reject({ status: 409, message: 'Changed' }); await pending;
    assert.equal(ui.$('#defect-edit-title').val(), 'Edited title'); assert.match(ui.$('#defect-action-error').text(), /draft is kept/);
    const review = ui.fire(button(ui, 'defect-action-error', 'Review latest details')); ui.calls.at(-1).resolve({ defect: { ...defect(), version: 3, title: 'Other edit', assigneeId: 11 }, evidence: [] }); await review;
    assert.equal(ui.$('#defect-edit-title').val(), 'Edited title');
    await ui.fire(button(ui, 'defect-action-error', 'Use this reviewed version'));
    ui.$('#defect-action-assignee').val('11'); await ui.fire(ui.nodes.get('defect-action-assignee'), 'change');
    const saved = ui.fire(ui.nodes.get('defect-action-form'), 'submit'); await flush();
    assert.equal(ui.calls.at(-1).body.expectedVersion, 3); assert.equal(ui.calls.at(-1).body.assigneeId, 11);
    ui.calls.at(-1).reject({ status: 403, message: 'Forbidden' }); await saved;
  }
});

async function chooseReopenFailure(ui) {
  ui.calls.at(-1).resolve([{ id: 4, name: 'Regression' }]); await flush();
  ui.$('#defect-action-run').val('4'); await ui.fire(ui.nodes.get('defect-action-run'), 'change');
  ui.calls.at(-1).resolve(run); await flush();
  ui.$('#defect-action-case').val('5'); await ui.fire(ui.nodes.get('defect-action-case'), 'change');
  ui.calls.at(-1).resolve([fail(7)]); await flush();
  ui.$('#defect-action-attempt').val('7'); await ui.fire(ui.nodes.get('defect-action-attempt'), 'change');
}

test('reopen clears an unavailable retained assignee and requires an explicit active Developer without losing source or search', async () => {
  const rows = [developer(11, 'Alice'), developer(13, 'Disabled', { userStatus: 'DISABLED' }), developer(14, 'Inactive', { status: 'INACTIVE' }), developer(15, 'Tester', { projectRole: 'TESTER' })];
  for (const current of [88, 13, 14, 15]) {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualMembers: true });
    ui.calls[0].resolve({ defect: { ...defect(9, 'CLOSED'), assigneeId: current }, evidence: [] }); await flush();
    ui.memberCalls[0].resolve(rows); await flush();
    await ui.fire(button(ui, 'defect-actions', 'Reopen with new FAIL')); await chooseReopenFailure(ui);
    ui.$('#defect-action-assignee-search').val('alice');
    ui.memberCalls[1].resolve(rows); await flush();
    assert.equal(ui.$('#defect-action-assignee').val(), '');
    assert.equal(ui.$('#defect-action-submit').prop('disabled'), true);
    assert.deepEqual(ui.nodes.get('defect-action-assignee').children.map(node => node.value), ['', '11']);
    await ui.fire(ui.nodes.get('defect-action-form'), 'submit');
    assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
    ui.locale('zh-CN'); assert.equal(ui.$('#defect-action-assignee-search').val(), 'alice');
    assert.equal(ui.$('#defect-action-attempt').val(), '7'); assert.equal(ui.$('#defect-action-assignee').val(), '');
    ui.$('#defect-action-assignee').val(String(current)); await ui.fire(ui.nodes.get('defect-action-assignee'), 'change');
    assert.equal(ui.$('#defect-action-submit').prop('disabled'), true, 'An unavailable ID cannot be restored as a valid reopen choice');
    ui.$('#defect-action-assignee').val('11'); await ui.fire(ui.nodes.get('defect-action-assignee'), 'change');
    assert.equal(ui.$('#defect-action-submit').prop('disabled'), false);
    const saving = ui.fire(ui.nodes.get('defect-action-form'), 'submit'); await flush(); const write = ui.calls.at(-1);
    assert.deepEqual(write.body, { expectedVersion: 2, failureAttemptId: 7, assigneeId: 11 });
    write.reject({ status: 403, message: 'Forbidden' }); await saving;
  }
});

test('reopen preselects the existing assignee only after active Developer membership loads and preserves a deliberate clear', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualMembers: true });
  ui.calls[0].resolve({ defect: { ...defect(9, 'RESOLVED'), assigneeId: 11 }, evidence: [] }); await flush();
  ui.memberCalls[0].resolve([developer(11, 'Alice')]); await flush();
  await ui.fire(button(ui, 'defect-actions', 'Reopen with new FAIL')); await chooseReopenFailure(ui);
  assert.equal(ui.$('#defect-action-assignee').val(), ''); assert.equal(ui.$('#defect-action-submit').prop('disabled'), true);
  ui.memberCalls[1].resolve([developer(11, 'Alice'), developer(12, 'Bob')]); await flush();
  assert.equal(ui.$('#defect-action-assignee').val(), '11'); assert.equal(ui.$('#defect-action-submit').prop('disabled'), false);
  ui.$('#defect-action-assignee-search').val('bob'); await ui.fire(ui.nodes.get('defect-action-assignee-search'), 'input');
  assert.equal(ui.$('#defect-action-assignee').val(), '11');
  ui.$('#defect-action-assignee').val(''); await ui.fire(ui.nodes.get('defect-action-assignee'), 'change');
  ui.locale('zh-CN'); assert.equal(ui.$('#defect-action-assignee').val(), ''); assert.equal(ui.$('#defect-action-submit').prop('disabled'), true);
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
});

test('CLOSED detail offers no metadata edit and locale switching preserves an edit draft', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' });
  ui.calls[0].resolve({ defect: defect(9, 'CLOSED'), evidence: [] }); await flush();
  assert.equal(button(ui, 'defect-actions', 'Edit and reassign'), undefined);
  ui.nav.open('defects', { projectId: '1', defectId: '10' }); ui.calls.at(-1).resolve({ defect: defect(10), evidence: [] }); await flush();
  await ui.fire(button(ui, 'defect-actions', 'Edit and reassign')); await flush(); ui.$('#defect-edit-title').val('Draft title');
  ui.emit('veriqra:localechange', {}); assert.equal(ui.$('#defect-edit-title').val(), 'Draft title');
});

function executionEvidence(id, outcome, extra = {}) {
  return { attempt: { id, attemptNo: 1, status: outcome, recordedAt: '2026-10-14T10:00:00', executedAt: '2026-10-14T10:00:00', importId: null },
    run: { id: id === 6 ? 4 : 8, name: id === 6 ? 'Original release' : 'Actual retest', status: 'COMPLETED', buildVersion: 'build-2', environment: 'QA' },
    runCase: { id: id === 6 ? 5 : 12, testCaseId: 3, snapshotTitle: 'Frozen login', snapshotDescription: null, snapshotPreconditions: null, snapshotPriority: 'HIGH' },
    steps: [{ stepOrder: 1, action: 'Sign in', expectedResult: 'Dashboard' }], currentCase: { id: 3, status: 'READY' }, currentDefinitionCompatible: true, ...extra };
}
function eligibility(extra = {}) {
  return { defect: { id: 9, status: 'RESOLVED', lockVersion: 2 }, defectVersion: 2, canClose: false, reasons: [], failures: [{ source: executionEvidence(6, 'FAIL'), selectedPass: null, selection: null, reasons: ['MISSING_RETEST'], eligible: false, canRetestOriginal: false, currentCaseCompatible: true }], history: [], legacyClosed: false, ...extra };
}
async function openClosure(ui, value = eligibility(), state = 'RESOLVED') {
  ui.calls[0].resolve({ defect: defect(9, state), evidence: [] }); await flush();
  ui.closureCalls[0].resolve(value); await flush();
}
async function chooseCandidate(ui, value = { execution: executionEvidence(17, 'PASS'), reasons: [], eligible: true, requiresImportConfirmation: false }) {
  const loading = ui.fire(button(ui, 'defect-closure', 'Find retest PASS')); await flush();
  ui.calls.at(-1).resolve({ failureAttemptId: 6, candidates: [value], nextCursor: null }); await loading;
  await ui.fire(button(ui, 'defect-closure', 'Use this PASS'));
}

test('terminal FAIL offers a named READY new-run route, per-failure blocking reason, honest import review and disabled incompatible PASS', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui);
  assert.equal(button(ui, 'defect-actions', 'Close').disabled, true);
  assert.match(ui.$('#defect-closure').text(), /no valid selected retest PASS/);
  const next = ui.nodes.get('defect-closure').all().find(node => node.tag === 'a' && node.content === 'Retest in a new run');
  const url = new URL(next.attrs.href); assert.equal(url.searchParams.get('sourceTestCaseId'), '3'); assert.equal(url.searchParams.get('failureAttemptId'), '6');
  const loading = ui.fire(button(ui, 'defect-closure', 'Find retest PASS')); await flush();
  const imported = executionEvidence(17, 'PASS'); imported.attempt.importId = 42; imported.attempt.executedAt = null;
  const different = executionEvidence(18, 'PASS'); different.runCase.snapshotTitle = 'Other semantics';
  ui.calls.at(-1).resolve({ failureAttemptId: 6, candidates: [{ execution: imported, reasons: [], eligible: true, requiresImportConfirmation: true }, { execution: different, reasons: ['DEFINITION_MISMATCH'], eligible: false, requiresImportConfirmation: false }], nextCursor: 17 }); await loading;
  assert.match(ui.$('#defect-closure').text(), /Upload time alone does not prove/); assert.match(ui.$('#defect-closure').text(), /verified actual execution time/);
  const choices = ui.nodes.get('defect-closure').all().filter(node => node.tag === 'button' && node.content === 'Use this PASS');
  assert.equal(choices[0].disabled, false); assert.equal(choices[1].disabled, true);
  const more = ui.fire(button(ui, 'defect-closure', 'Load more PASS candidates')); await flush(); assert.match(ui.calls.at(-1).url, /cursor=17/);
  ui.calls.at(-1).resolve({ candidates: [], nextCursor: null }); await more;
  const changed = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }), changedValue = eligibility();
  changedValue.failures[0].currentCaseCompatible = false;
  changedValue.failures[0].source.currentCase = { id: 3, status: 'READY', title: 'Changed login', description: null, preconditions: null };
  await openClosure(changed, changedValue);
  assert.match(changed.$('#defect-closure').text(), /Frozen definition differs: title/);
  assert.equal(changed.nodes.get('defect-closure').all().some(node => node.tag === 'a' && node.content === 'Retest in a new run'), false);
});

test('linking an imported PASS requires the note and actual timing attestation; language changes preserve the draft', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui);
  const candidate = { execution: executionEvidence(17, 'PASS'), reasons: [], eligible: true, requiresImportConfirmation: true }; candidate.execution.attempt.importId = 42; candidate.execution.attempt.executedAt = null;
  await chooseCandidate(ui, candidate);
  await ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
  ui.$('#defect-retest-note').val('I observed a new external execution after the failure.'); ui.$('#defect-retest-confirm').prop('checked', true);
  ui.locale('zh-CN'); assert.equal(ui.$('#defect-retest-note').val(), 'I observed a new external execution after the failure.'); assert.equal(ui.$('#defect-retest-confirm').prop('checked'), true);
  assert.match(ui.$('#defect-closure').text(), /复测审查说明/);
  const submit = ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); await flush(); const write = ui.calls.at(-1);
  assert.equal(write.url, 'projects/1/defects/9/retests'); assert.equal(write.body.timingBasis, 'IMPORT_REVIEW_ATTESTATION'); assert.equal(write.body.expectedVersion, 2);
  write.reject({ status: 409, reasonCode: 'LATER_NON_PASS', message: 'Conflict' }); await submit;
  assert.match(ui.$('#defect-action-status').text(), /后续或时序不明/); assert.equal(ui.$('#defect-retest-note').val(), 'I observed a new external execution after the failure.');
});

test('uncertain LINK recovers after refresh using its original actor-scoped key and replays the exact payload only after a 404 lookup', async () => {
  const storage = new Map();
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true, storage }); await openClosure(ui); await chooseCandidate(ui);
  ui.$('#defect-retest-note').val('Manual retest actually ran after the original FAIL.'); ui.$('#defect-retest-confirm').prop('checked', true);
  const pending = ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); await flush(); const first = ui.calls.at(-1);
  first.reject({ status: 0, message: 'Connection lost' }); await pending;
  assert.equal(storage.size, 1); assert.equal(button(ui, 'defect-closure', 'Replay original request'), undefined);
  const refreshed = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true, storage }); await openClosure(refreshed);
  const recovery = refreshed.calls.at(-1); assert.equal(recovery.method, 'GET'); assert.match(recovery.url, new RegExp('/retest-operations/' + first.body.requestKey + '\\?action=LINK$'));
  assert.equal(refreshed.calls.filter(call => call.method !== 'GET').length, 0);
  recovery.reject({ status: 404, message: 'Not found' }); await flush();
  const replay = refreshed.fire(button(refreshed, 'defect-closure', 'Replay original request')); await flush(); const repeated = refreshed.calls.at(-1);
  assert.deepEqual(repeated.body, first.body); assert.equal(repeated.url, first.url);
  repeated.reject({ status: 409, message: 'Changed' }); await replay; assert.equal(storage.size, 0);
});

test('replace and revoke use separate explicit reasons and versioned request keys without mutating original FAIL evidence', async () => {
  const selected = { id: 23, passAttemptId: 16, reviewNote: 'Earlier review', timingBasis: 'MANUAL_SERVER_RECORD', linkedAt: '2026-10-14T10:00:00', revocation: null };
  for (const mode of ['LINK', 'REVOKE']) {
    const value = eligibility(); value.failures[0].selection = selected; value.failures[0].selectedPass = executionEvidence(16, 'PASS');
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, value);
    if (mode === 'LINK') { await chooseCandidate(ui); ui.$('#defect-retest-note').val('Later legal retest'); ui.$('#defect-retest-confirm').prop('checked', true); }
    else await ui.fire(button(ui, 'defect-closure', 'Revoke selected PASS'));
    await ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
    ui.$('#defect-retest-reason').val('The earlier test was the wrong execution.');
    const pending = ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); await flush(); const write = ui.calls.at(-1);
    assert.equal(write.body.expectedVersion, 2); assert.ok(write.body.requestKey);
    if (mode === 'LINK') { assert.equal(write.body.oldLinkId, 23); assert.equal(write.body.revokeReason, 'The earlier test was the wrong execution.'); }
    else { assert.equal(write.url, 'projects/1/defects/9/retests/23/revoke'); assert.equal(write.body.reason, 'The earlier test was the wrong execution.'); }
    assert.equal(write.url.includes('/evidence'), false);
    write.reject({ status: 403, message: 'Forbidden' }); await pending;
  }
});

test('CLOSED receipt displays accepted original FAIL/PASS facts, legacy history is explicit, and assigned Developers cannot link or close', async () => {
  const history = [{ receipt: { closedAt: '2026-10-14T12:00:00', closedDefectVersion: 3, evidenceCount: 1, resolutionNote: 'Fixed login' }, items: [{ failure: executionEvidence(6, 'FAIL'), pass: executionEvidence(17, 'PASS'), policy: 'EXACT_SEMANTIC_V1', retestLinkId: 23 }] }];
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, eligibility({ history, legacyClosed: true }), 'CLOSED');
  assert.match(ui.$('#defect-closure').text(), /Closed at version 3/); assert.match(ui.$('#defect-closure').text(), /Later results do not change/); assert.match(ui.$('#defect-closure').text(), /No immutable closure receipt was saved/);
  assert.match(ui.$('#defect-closure').text(), /current results may differ/); assert.doesNotMatch(ui.$('#defect-closure').text(), /Closure is currently blocked/); assert.match(ui.$('#defect-closure').text(), /exact frozen-definition compatibility rule/);
  assert.equal(button(ui, 'defect-closure', 'Find retest PASS'), undefined);
  const developerUi = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true, actor: { id: 11, systemRole: 'USER', status: 'ACTIVE' } });
  developerUi.calls[0].resolve({ defect: { ...defect(9, 'IN_PROGRESS'), assigneeId: 11 }, evidence: [] }); await flush(); developerUi.closureCalls[0].resolve(eligibility()); await flush();
  assert.ok(button(developerUi, 'defect-actions', 'Resolve')); assert.equal(button(developerUi, 'defect-actions', 'Edit and reassign'), undefined); assert.equal(button(developerUi, 'defect-closure', 'Find retest PASS'), undefined);
});

test('uncertain CLOSE checks status and receipts before any retry and a newer eligibility version cannot authorize close', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, eligibility({ canClose: true, failures: [] }));
  const close = ui.fire(button(ui, 'defect-actions', 'Close')); await flush(); ui.calls.at(-1).reject({ status: 0, message: 'Response lost' }); await close;
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1); assert.equal(button(ui, 'defect-actions', 'Close').disabled, true);
  const checking = ui.fire(button(ui, 'defect-closure', 'Check submitted operation')); await flush();
  ui.closureCalls.at(-1).resolve(eligibility({ canClose: true, failures: [] })); await checking;
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1); assert.ok(button(ui, 'defect-closure', 'Review latest details'));
  const changed = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(changed, eligibility({ canClose: true, failures: [], defectVersion: 3 }));
  assert.equal(button(changed, 'defect-actions', 'Close').disabled, true); assert.match(changed.$('#defect-closure').text(), /changed while evidence was loading/);
});

test('multiple original FAILs keep independent candidate context and obsolete candidate responses cannot replace another detail', async () => {
  const value = eligibility(), second = { ...plain(value.failures[0]), source: executionEvidence(7, 'FAIL') }; second.source.run.name = 'Second original run'; value.failures.push(second);
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, value);
  const loading = ui.fire(button(ui, 'defect-closure-failure-7', 'Find retest PASS')); await flush(); assert.match(ui.calls.at(-1).url, /failureAttemptId=7&/);
  ui.calls.at(-1).resolve({ failureAttemptId: 7, candidates: [{ execution: executionEvidence(17, 'PASS'), reasons: [], eligible: true, requiresImportConfirmation: false }], nextCursor: null }); await loading;
  await ui.fire(button(ui, 'defect-closure-failure-7', 'Use this PASS')); ui.$('#defect-retest-note').val('Retested the second failure'); ui.$('#defect-retest-confirm').prop('checked', true);
  const saving = ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); await flush(); assert.equal(ui.calls.at(-1).body.failureAttemptId, 7);
  ui.calls.at(-1).reject({ status: 409, message: 'Changed' }); await saving;
  const oldLoad = ui.fire(button(ui, 'defect-closure-failure-6', 'Find retest PASS')); await flush(); const old = ui.calls.at(-1);
  ui.nav.open('defects', { projectId: '1', defectId: '10' }); ui.calls.at(-1).resolve({ defect: defect(10), evidence: [] }); await flush();
  old.resolve({ failureAttemptId: 6, candidates: [{ execution: executionEvidence(18, 'PASS'), reasons: [], eligible: true, requiresImportConfirmation: false }], nextCursor: null }); await oldLoad;
  assert.doesNotMatch(ui.$('#defect-closure').text(), /Actual retest/); assert.equal(ui.route().defectId, '10');
});

test('concurrent rollback preserves the retest draft and original request, explains recovery in both languages and never changes the key automatically', async () => {
  for (const locale of ['en', 'zh-CN']) {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui); await chooseCandidate(ui);
    ui.$('#defect-retest-note').val('Actual later retest'); ui.$('#defect-retest-confirm').prop('checked', true); ui.locale(locale);
    const pending = ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); await flush(); const original = ui.calls.at(-1);
    original.reject({ status: 409, reasonCode: 'CONCURRENT_CHANGE', message: 'Conflict' }); await pending;
    assert.match(ui.$('#defect-action-status').text(), locale === 'en' ? /transaction to roll back.*latest facts.*original request.*original request key/ : /事务已回滚.*最新事实和原请求.*原请求键/);
    assert.equal(ui.$('#defect-retest-note').val(), 'Actual later retest'); assert.equal(ui.$('#defect-retest-confirm').prop('checked'), true);
    assert.equal(ui.storage.size, 1); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
    const lookup = ui.fire(button(ui, 'defect-closure', locale === 'en' ? 'Check submitted operation' : '查询已提交操作')); await flush();
    assert.match(ui.calls.at(-1).url, new RegExp(original.body.requestKey + '\\?action=LINK$'));
    ui.calls.at(-1).reject({ status: 404, message: 'Not found' }); await lookup;
    const replay = ui.fire(button(ui, 'defect-closure', locale === 'en' ? 'Replay original request' : '重放原请求')); await flush();
    assert.deepEqual(ui.calls.at(-1).body, original.body);
    ui.calls.at(-1).reject({ status: 409, reasonCode: 'STALE_VERSION', message: 'Changed' }); await replay;
    assert.equal(new Set(ui.calls.filter(call => call.method === 'POST').map(call => call.body.requestKey)).size, 1);
  }
});

test('unknown workflow reason uses safe readable recovery guidance in both languages instead of exposing the machine code', async () => {
  for (const locale of ['en', 'zh-CN']) {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }), value = eligibility();
    value.failures[0].reasons = ['FUTURE_UNRECOGNIZED_REASON']; await openClosure(ui, value); ui.locale(locale);
    assert.doesNotMatch(ui.$('#defect-closure').text(), /FUTURE_UNRECOGNIZED_REASON/);
    assert.match(ui.$('#defect-closure').text(), locale === 'en' ? /Review the latest facts and the original request.*Check the submitted operation first/ : /核对最新事实和原请求.*先查询已提交操作/);
  }
});

test('RESOLVED next-step guidance follows authoritative canClose in both languages without extra reads or permission changes', async () => {
  for (const locale of ['en', 'zh-CN']) {
    for (const ready of [true, false]) {
      const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true });
      await openClosure(ui, eligibility({ canClose: ready })); const reads = ui.calls.length + ui.closureCalls.length; ui.locale(locale);
      assert.equal(ui.calls.length + ui.closureCalls.length, reads);
      assert.match(ui.$('#defect-closure').text(), ready ? locale === 'en' ? /Retest evidence is complete.*Next, close the defect.*verify eligibility again/ : /复测证据已齐全.*下一步关闭缺陷.*再次验证关闭资格/ : locale === 'en' ? /Next: perform the retest, link its PASS/ : /下一步：执行复测.*关联 PASS/);
      assert.equal(button(ui, 'defect-actions', locale === 'en' ? 'Close' : '关闭').disabled, !ready);
      if (ready) assert.doesNotMatch(ui.$('#defect-closure').text(), locale === 'en' ? /Next: perform the retest/ : /下一步：执行复测/);
    }
  }
});

test('close rejected by a later FAIL invalidates old eligibility immediately and rechecks with GET while retaining the original reason', async () => {
  for (const locale of ['en', 'zh-CN']) {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, eligibility({ canClose: true, failures: [] })); ui.locale(locale);
    const close = ui.fire(button(ui, 'defect-actions', locale === 'en' ? 'Close' : '关闭')); await flush(); const write = ui.calls.at(-1);
    write.reject({ status: 409, reasonCode: 'LATER_NON_PASS', message: 'Conflict' }); await close;
    assert.equal(ui.closureCalls.length, 2); assert.equal(ui.closureCalls[1].method, 'GET');
    assert.equal(button(ui, 'defect-actions', locale === 'en' ? 'Close' : '关闭').disabled, true);
    assert.doesNotMatch(ui.$('#defect-closure').text(), locale === 'en' ? /Retest evidence is complete|Every retained FAIL/ : /复测证据已齐全|每条保留的 FAIL 都已有/);
    const revised = eligibility(); revised.failures[0].reasons = ['LATER_NON_PASS']; ui.closureCalls[1].resolve(revised); await flush();
    assert.equal(button(ui, 'defect-actions', locale === 'en' ? 'Close' : '关闭').disabled, true);
    assert.match(ui.$('#defect-action-status').text(), locale === 'en' ? /later or unordered non-PASS/ : /后续或时序不明的非 PASS/);
    assert.match(ui.$('#defect-closure').text(), locale === 'en' ? /Closure is currently blocked/ : /尚不满足关闭条件/);
    assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('failed eligibility GET stays unavailable and disabled across locale/render; scoped Retry never repeats Close', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, eligibility({ canClose: true, failures: [] }));
  const close = ui.fire(button(ui, 'defect-actions', 'Close')); await flush(); ui.calls.at(-1).reject({ status: 409, reasonCode: 'LATER_NON_PASS', message: 'Conflict' }); await close;
  ui.closureCalls[1].reject({ status: 500, message: 'Eligibility unavailable' }); await flush();
  assert.equal(button(ui, 'defect-actions', 'Close').disabled, true); assert.match(ui.$('#defect-closure').text(), /No close permission can be inferred/);
  ui.locale('zh-CN'); assert.match(ui.$('#defect-closure').text(), /无法读取关闭资格/); assert.ok(button(ui, 'defect-closure', '重试'));
  assert.match(ui.$('#defect-action-status').text(), /后续或时序不明的非 PASS/);
  const retry = ui.fire(button(ui, 'defect-closure', '重试')); await flush(); assert.equal(ui.closureCalls.length, 3);
  assert.equal(button(ui, 'defect-actions', '关闭').disabled, true); ui.closureCalls[2].resolve(eligibility()); await retry;
  assert.equal(button(ui, 'defect-actions', '关闭').disabled, true); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(ui.projectCalls.length, 2, 'Both failed-close recheck and Retry revalidate current project access');
});

test('typed rejected-close reason follows locale while failed GET recovery stays disabled and does not replay the write', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, eligibility({ canClose: true, failures: [] }));
  const close = ui.fire(button(ui, 'defect-actions', 'Close')); await flush();
  ui.calls.at(-1).reject({ status: 409, reasonCode: 'LATER_NON_PASS', message: 'Server internal English text' }); await close;
  ui.closureCalls[1].reject({ status: 500, message: 'Read failed' }); await flush();
  const count = ui.calls.length + ui.closureCalls.length + ui.actorCalls.length + ui.projectCalls.length + ui.memberCalls.length;
  for (const locale of ['zh-CN', 'en', 'zh-CN']) {
    ui.locale(locale);
    assert.match(ui.$('#defect-action-status').text(), locale === 'en' ? /later or unordered non-PASS/ : /后续或时序不明的非 PASS/);
    assert.match(ui.$('#defect-closure').text(), locale === 'en' ? /No close permission can be inferred/ : /无法读取关闭资格/);
    assert.equal(button(ui, 'defect-actions', locale === 'en' ? 'Close' : '关闭').disabled, true);
    assert.equal(ui.calls.length + ui.closureCalls.length + ui.actorCalls.length + ui.projectCalls.length + ui.memberCalls.length, count);
  }
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
});

test('typed retest rollback and not-found recovery retranslate without losing the original key or draft', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui); await chooseCandidate(ui);
  ui.$('#defect-retest-note').val('Real observed later retest'); ui.$('#defect-retest-confirm').prop('checked', true);
  const pending = ui.fire(ui.nodes.get('defect-retest-form'), 'submit'); await flush(); const write = ui.calls.at(-1);
  write.reject({ status: 409, reasonCode: 'CONCURRENT_CHANGE', message: 'Conflict' }); await pending;
  ui.locale('zh-CN'); assert.match(ui.$('#defect-action-status').text(), /事务已回滚/);
  ui.locale('en'); assert.match(ui.$('#defect-action-status').text(), /transaction to roll back/);
  const lookup = ui.fire(button(ui, 'defect-closure', 'Check submitted operation')); await flush();
  assert.match(ui.calls.at(-1).url, new RegExp(write.body.requestKey + '\\?action=LINK$'));
  ui.calls.at(-1).reject({ status: 404, message: 'Not found' }); await lookup;
  ui.locale('zh-CN'); assert.match(ui.$('#defect-action-status').text(), /未找到已提交的操作/);
  assert.ok(button(ui, 'defect-closure', '重放原请求'));
  assert.equal(ui.$('#defect-retest-note').val(), 'Real observed later retest'); assert.equal(ui.$('#defect-retest-confirm').prop('checked'), true);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1); assert.equal(ui.storage.size, 1);
});

test('untyped server text remains intact across locale changes without authorizing another write', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }); ui.calls[0].resolve({ defect: defect(), evidence: [] }); await flush();
  const start = ui.fire(button(ui, 'defect-actions', 'Start work')); await flush();
  ui.calls.at(-1).reject({ status: 403, message: 'Specific server-provided free text' }); await start;
  ui.locale('zh-CN'); assert.equal(ui.$('#defect-action-status').text(), 'Specific server-provided free text');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
});

test('detail member read failure exposes scoped GET Retry and recovers Tester actions only from active membership', async () => {
  for (const status of [500, 403]) {
    const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualMembers: true, actor: { id: 1, systemRole: 'USER', status: 'ACTIVE' } });
    ui.calls[0].resolve({ defect: defect(), evidence: [] }); await flush();
    ui.memberCalls[0].reject({ status, message: 'Members unavailable' }); await flush();
    assert.match(ui.$('#defect-detail-members-status').text(), /Project members are unavailable/);
    assert.equal(button(ui, 'defect-actions', 'Edit and reassign'), undefined);
    assert.doesNotMatch(ui.$('#defect-closure').text(), /An active project Tester or platform Admin must/);
    ui.locale('zh-CN'); assert.match(ui.$('#defect-detail-members-status').text(), /无法读取项目成员/);
    const retry = ui.fire(ui.nodes.get('defect-detail-members-retry')); await flush();
    assert.equal(ui.memberCalls[1].method, 'GET'); assert.equal(ui.memberCalls[1].url, 'projects/1/members');
    ui.memberCalls[1].resolve([developer(1, 'Tester', { projectRole: 'TESTER' })]); await retry;
    assert.ok(button(ui, 'defect-actions', '编辑与重新分配')); assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
    assert.doesNotMatch(ui.$('#defect-actions').text(), /无法读取项目成员/);
  }
});

test('detail member retry cannot infer Tester permission from a Developer result and obsolete Retry or response cannot revive an old detail', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualMembers: true, actor: { id: 1, systemRole: 'USER', status: 'ACTIVE' } });
  ui.calls[0].resolve({ defect: defect(), evidence: [] }); await flush();
  ui.memberCalls[0].reject({ status: 403, message: 'Forbidden' }); await flush();
  const oldButton = ui.nodes.get('defect-detail-members-retry');
  const checking = ui.fire(oldButton); await flush(); const old = ui.memberCalls[1];
  ui.nav.open('defects', { projectId: '1', defectId: '10' }); ui.calls.at(-1).resolve({ defect: defect(10), evidence: [] }); await flush();
  ui.memberCalls[2].resolve([developer(1, 'Developer')]); await flush();
  assert.equal(button(ui, 'defect-actions', 'Edit and reassign'), undefined);
  const reads = ui.memberCalls.length; await ui.fire(oldButton); assert.equal(ui.memberCalls.length, reads);
  old.resolve([developer(1, 'Former Tester', { projectRole: 'TESTER' })]); await checking;
  assert.match(ui.$('#defect-detail-title').text(), /BUG-010/); assert.equal(button(ui, 'defect-actions', 'Edit and reassign'), undefined);
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
});

test('stale-version or changed-permission close rejection cannot advertise ready-to-close even if current domain evidence is complete', async () => {
  for (const change of ['version', 'role', 'archived']) {
    const options = { manualEligibility: true }, ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, options); await openClosure(ui, eligibility({ canClose: true, failures: [] }));
    if (change === 'role') options.actor = { id: 11, systemRole: 'USER', status: 'ACTIVE' };
    if (change === 'archived') options.project = { id: 1, status: 'ARCHIVED' };
    const close = ui.fire(button(ui, 'defect-actions', 'Close')); await flush(); ui.calls.at(-1).reject({ status: change === 'role' ? 403 : 409, reasonCode: change === 'version' ? 'STALE_VERSION' : null, message: 'Rejected' }); await close;
    ui.closureCalls[1].resolve(eligibility({ canClose: true, failures: [], defectVersion: change === 'version' ? 3 : 2 })); await flush();
    const buttonNow = button(ui, 'defect-actions', 'Close'); assert.ok(!buttonNow || buttonNow.disabled);
    assert.doesNotMatch(ui.$('#defect-closure').text(), /Retest evidence is complete|Every retained FAIL/);
    assert.match(ui.$('#defect-action-status').text(), change === 'version' ? /defect changed/ : /Rejected|rejected|not allowed/);
    assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('earlier membership responses cannot restore closing permission after a fresh 403 recheck', async () => {
  const options = { manualEligibility: true, manualMembers: true }, ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, options); await openClosure(ui, eligibility({ canClose: true, failures: [] }));
  const olderMembers = ui.memberCalls[0]; options.actor = { id: 11, systemRole: 'USER', status: 'ACTIVE' };
  const close = ui.fire(button(ui, 'defect-actions', 'Close')); await flush(); ui.calls.at(-1).reject({ status: 403, message: 'Forbidden' }); await close;
  ui.memberCalls[1].resolve([developer(11, 'Developer')]); ui.closureCalls[1].resolve(eligibility({ canClose: true, failures: [] })); await flush();
  assert.equal(button(ui, 'defect-actions', 'Close'), undefined);
  olderMembers.resolve([developer(11, 'Previously a Tester', { projectRole: 'TESTER' })]); await flush();
  assert.equal(button(ui, 'defect-actions', 'Close'), undefined); assert.doesNotMatch(ui.$('#defect-closure').text(), /Retest evidence is complete/);
});

test('late rejected-close eligibility and obsolete Retry cannot change a newer detail', async () => {
  const ui = browser({ view: 'defects', projectId: '1', defectId: '9' }, { manualEligibility: true }); await openClosure(ui, eligibility({ canClose: true, failures: [] }));
  const close = ui.fire(button(ui, 'defect-actions', 'Close')); await flush(); ui.calls.at(-1).reject({ status: 409, reasonCode: 'LATER_NON_PASS', message: 'Conflict' }); await close;
  const old = ui.closureCalls[1]; old.reject({ status: 500, message: 'Unavailable' }); await flush(); const retryButton = button(ui, 'defect-closure', 'Retry');
  const oldRetry = ui.fire(retryButton); await flush(); const late = ui.closureCalls[2];
  ui.nav.open('defects', { projectId: '1', defectId: '10' }); ui.calls.at(-1).resolve({ defect: defect(10, 'RESOLVED'), evidence: [] }); await flush();
  ui.closureCalls[3].resolve(eligibility({ canClose: true, failures: [] })); await flush();
  const before = ui.closureCalls.length; await ui.fire(retryButton); assert.equal(ui.closureCalls.length, before);
  late.resolve(eligibility()); await oldRetry;
  assert.match(ui.$('#defect-detail-title').text(), /BUG-010/); assert.equal(button(ui, 'defect-actions', 'Close').disabled, false);
  assert.equal(ui.$('#defect-action-status').text(), ''); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
});
