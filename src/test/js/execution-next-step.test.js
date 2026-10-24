const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/execution.js'), 'utf8');
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function browser(options = {}) {
  const nodes = new Map(), calls = [], impactCalls = [], defectCalls = [], handlers = new Map(), navigation = [], guards = new Map();
  let context = { actorId: 5, systemRole: 'USER', projectRole: 'TESTER', canWriteAssets: true, projectStatus: 'ACTIVE', ...options.context };
  let locale = 'en';
  const chinese = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../main/webapp/i18n/zh-CN.json'), 'utf8'));
  const formIds = ['execution-outcome', 'execution-duration', 'execution-comment', 'execution-failure'];
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.value = ''; this.content = ''; this.children = []; this.classes = new Set(); this.handlers = {}; this.attributes = {}; this.disabled = false; this.checked = false; }
    reportValidity() { return true; }
    reset() { if (this.id === 'execution-attempt-form') formIds.forEach(id => { $( '#' + id).val(id === 'execution-outcome' ? 'PASS' : ''); }); }
  }
  const descendants = node => node.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
  class Collection extends Array {
    each(fn) { this.forEach((node, index) => fn.call(node, index, node)); return this; }
    on(names, fn) { return this.each(function () { names.split(' ').forEach(name => { (this.handlers[name] ||= []).push(fn); }); }); }
    text(value) { if (value === undefined) return this[0]?.content; return this.each(function () { this.content = String(value); }); }
    val(value) { if (value === undefined) return this[0]?.value ?? ''; return this.each(function () { this.value = value == null ? '' : String(value); }); }
    empty() { return this.each(function () { this.children = []; this.content = ''; }); }
    append(...items) { return this.each(function () { items.flatMap(item => item instanceof Collection ? [...item] : [item]).forEach(item => { this.children.push(item); if (item instanceof Element) { item.parent = this; if (this.tag === 'select' && this.children.length === 1) this.value = item.value; } }); }); }
    attr(name, value) { if (value === undefined) return this[0]?.attributes[name]; return this.each(function () { this.attributes[name] = String(value); if (name === 'id') { this.id = String(value); nodes.set('#' + value, this); } }); }
    prop(name, value) { if (value === undefined) return this[0]?.[name]; return this.each(function () { this[name] = value; }); }
    addClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.add(name)); }); }
    removeClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.delete(name)); }); }
    toggleClass(names, force) { return this.each(function () { names.split(' ').forEach(name => { if (force ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name); }); }); }
    hasClass(name) { return this[0]?.classes.has(name) || false; }
    find(selector) { let items = this.flatMap(node => descendants(node)); if (selector === 'input,select,textarea') items = formIds.map(id => $('#' + id)[0]); else if (selector === ':selected') items = items.filter(node => node.tag === 'option' && node.value === this[0].value); else if (/^\[[\w-]+\]$/.test(selector)) items = items.filter(node => node.attributes[selector.slice(1, -1)] !== undefined); return collection(items); }
    map(fn) { const values = Array.from(this, (node, index) => fn.call(node, index, node)); return { get: () => values }; }
    trigger(name) { return this.each(function () { (this.handlers[name] || []).forEach(fn => fn.call(this, { preventDefault() {}, originalEvent: {} })); if (name === 'focus') this.focused = true; }); }
    remove() { return this.each(function () { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); if (this.id) nodes.delete('#' + this.id); }); }
  }
  const collection = items => Collection.from(items);
  const document = new Element();
  document.addEventListener = (name, fn) => { (handlers.get(name) || handlers.set(name, []).get(name)).push(fn); };
  document.createTextNode = value => String(value);
  document.dispatchEvent = event => emit(event.type, event.detail);
  function $(selector) {
    if (selector instanceof Element) return collection([selector]);
    if (selector instanceof Collection) return selector;
    if (selector.startsWith('<')) {
      const node = new Element(/^<([\w-]+)/.exec(selector)[1]);
      const result = collection([node]);
      for (const match of selector.matchAll(/([\w-]+)="([^"]*)"/g)) { if (match[1] === 'class') result.addClass(match[2]); else result.attr(match[1], match[2]); }
      if (selector.includes(' disabled')) node.disabled = true;
      return result;
    }
    if (selector.includes(',')) return collection(selector.split(',').flatMap(part => [...$(part.trim())]));
    if (selector === '#execution-case-selector input:checked') return collection(descendants($('#execution-case-selector')[0]).filter(node => node.tag === 'input' && node.checked));
    const optionMatch = /^(#execution-plan) option(\[value!=""\])?$/.exec(selector);
    if (optionMatch) return collection(descendants($(optionMatch[1])[0]).filter(node => node.tag === 'option' && (!optionMatch[2] || node.value !== '')));
    if (selector.includes(' button')) return collection(descendants($(selector.split(' ')[0])[0]).filter(node => node.tag === 'button'));
    if (!nodes.has(selector)) { const node = new Element(selector.endsWith('form') ? 'form' : /-(plan|existing-plan|origin|outcome)$/.test(selector) ? 'select' : 'div'); node.id = selector.slice(1); nodes.set(selector, node); }
    return collection([nodes.get(selector)]);
  }
  function emit(name, detail) {
    for (const fn of document.handlers[name] || []) fn.call(document, { originalEvent: { detail } });
    for (const fn of handlers.get(name) || []) fn({ detail });
  }
  let route = { view: 'dashboard', projectId: '12', ...options.initialRoute };
  const nav = {
    read: () => route,
    href(view, context) { const query = new URLSearchParams(context); return 'http://localhost/index.html?' + query + '#' + view; },
    select(view, context) { route = { view, ...context }; },
    open(view, context) { if (options.beforeNavigate) options.beforeNavigate(view, context, guards.get('execution')); route = { view, ...context }; navigation.push(route); emit('veriqra:view', { view, projectId: route.projectId, context: route }); }
  };
  function request(method, url, body) {
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const call = { method, url, body, resolve, reject };
    if (url.endsWith('/defects')) { defectCalls.push(call); if (!options.manualDefects) resolve(options.defects || []); }
    else if (url.endsWith('/completion-impact')) { impactCalls.push(call); if (!options.manualImpact) resolve({ runId: 40, status: 'IN_PROGRESS', outcomes: { PASS: 1, FAIL: 1, BLOCKED: 0, SKIPPED: 0, NOT_RUN: 0 }, openDefectCount: 1, pendingRetestDefectCount: 1 }); }
    else calls.push(call);
    return promise;
  }
  const api = { get: url => request('GET', url), post: (url, body) => request('POST', url, body), put: (url, body) => request('PUT', url, body) };
  const window = { VeriqraApi: api, VeriqraQaNavigation: nav, VeriqraQaContext: { load: () => options.contextFailure ? Promise.reject({ status: 403, message: 'Permissions unavailable' }) : Promise.resolve(context) }, VeriqraDraftGuard: { register: (owner, config) => guards.set(owner, config) }, confirm: () => true, I18n: {
    t: (key, values, fallback) => ((locale === 'zh-CN' && chinese[key]) || fallback || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? ''), enumLabel: value => value, formatNumber: String, formatDateTime: value => value || '—'
  } };
  let sequence = 0;
  vm.runInNewContext(source, { window, document, jQuery: $, crypto: { randomUUID: () => 'key-' + ++sequence }, location: { hash: '' }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, Map, Set, Number, String, Object, JSON });
  emit('veriqra:project', { project: { id: 12 } });
  const click = async (node, modified = {}) => { let prevented = false; for (const fn of node.handlers.click || []) fn.call(node, { button: 0, ...modified, preventDefault() { prevented = true; } }); await flush(); return prevented; };
  const submit = async (id = 'execution-attempt-form', submitter) => { for (const fn of $('#' + id)[0].handlers.submit || []) fn.call($('#' + id)[0], { preventDefault() {}, originalEvent: { submitter } }); await flush(); };
  const respond = async (call, data) => { call.resolve(data); await flush(); };
  const open = async (view, context) => { nav.open(view, { projectId: '12', ...context }); await flush(); };
  const textOf = node => node.content + node.children.map(child => child instanceof Element ? textOf(child) : String(child)).join(' ');
  const find = (selector, text) => descendants($(selector)[0]).find(node => node.content === text);
  return { $, nodes, calls, impactCalls, defectCalls, guards, emit, navigation, nav, click, submit, respond, open, textOf, find, context(value) { context = { ...context, ...value }; }, locale(name) { locale = name; emit('veriqra:localechange', {}); } };
}

function run(outcomes = ['NOT_RUN', 'FAIL', 'PASS'], status = 'IN_PROGRESS') {
  return { run: { id: 40, projectId: 12, testPlanId: 30, name: 'Release run', status, version: 2 }, cases: outcomes.map((outcome, index) => ({ runCaseId: 50 + index, testCaseId: 20 + index, snapshotTitle: 'Frozen ' + index, snapshotDescription: 'Captured description', snapshotPreconditions: 'Before', snapshotPriority: 'HIGH', capturedAt: '2026-10-01', steps: [{ stepOrder: 1, action: 'Frozen action', expectedResult: 'Frozen expected' }], currentOutcome: outcome, latestAttempt: outcome === 'NOT_RUN' ? null : { id: 60 + index, outcome } })) };
}
const attempt = (id = 60, outcome = 'FAIL', key = 'prior-key', number = 1) => ({ id, runCaseId: 50, attemptNo: number, outcome, submissionKey: key, comment: 'Earlier result', failureMessage: outcome === 'FAIL' ? 'Failure detail' : null });
const planDetail = (id = 31, count = 2, status = 'READY') => ({ plan: { id, keyNo: id, name: 'Plan ' + id, status }, testCaseIds: Array.from({ length: count }, (_, index) => 20 + index) });
async function loadCase(ui, caseId = '50', history = [], value = run(), targetAttempt) {
  await ui.open('runs', { runId: '40', runCaseId: caseId, attemptId: targetAttempt }); await ui.respond(ui.calls.at(-1), value); await ui.respond(ui.calls.at(-1), history);
  // Legacy positive submission tests explicitly choose an outcome as a user action. The separate R2 gate checks the unselected initial form.
  if (!ui.$('#execution-outcome').val()) ui.$('#execution-outcome').val('PASS');
}


const plan = (ids = [20], status = 'DRAFT') => ({ plan: { id: 31, keyNo: 1, name: 'Demo plan', status, version: 3 }, testCaseIds: ids });
const member = (id = 20, status = 'READY') => ({ id, keyNo: id, title: 'Case ' + id, status });
async function openPlan(ui, current, cases, context = {}) {
  await ui.open('test-plans', { planId: '31', ...context });
  await ui.respond(ui.calls.at(-1), current);
  await ui.respond(ui.calls.at(-1), cases);
}

test('plan next action distinguishes marking Ready from creating a run without writing during navigation', async () => {
  const ui = browser(); await openPlan(ui, plan(), [member()]);
  assert.match(ui.textOf(ui.$('#execution-actions')[0]), /Next: mark this plan Ready/);
  assert.equal(ui.$('#execution-plan-ready').prop('disabled'), false);
  assert.equal(ui.find('#execution-actions', 'Create run from this plan'), undefined);
  await openPlan(ui, plan([20], 'READY'), [member()]);
  assert.match(ui.textOf(ui.$('#execution-actions')[0]), /record results for these 1 cases/);
  const create = ui.find('#execution-actions', 'Create run from this plan');
  const destination = new URL(create.attributes.href);
  assert.equal(destination.hash, '#runs'); assert.equal(destination.searchParams.get('sourcePlanId'), '31');
  assert.equal(destination.searchParams.get('action'), 'create');
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('an empty plan points to available selection or the first case creation', async () => {
  const ui = browser(); await openPlan(ui, plan([]), [member()]);
  const choose = ui.find('#execution-actions', 'Choose cases to add'); assert.ok(choose);
  await ui.click(choose); assert.equal(ui.$('#execution-plan-case-search')[0].focused, true);
  assert.equal(ui.$('#execution-plan-ready').prop('disabled'), true);
  await openPlan(ui, plan([]), []);
  const create = ui.find('#execution-actions', 'Create a test case first'); assert.ok(create);
  const destination = new URL(create.attributes.href);
  assert.equal(destination.hash, '#test-cases'); assert.equal(destination.searchParams.get('sourcePlanId'), '31');
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('a changed plan points to the precise case and never offers run creation', async () => {
  const ui = browser(); await openPlan(ui, plan([20, 21], 'READY'), [member(), member(21, 'DRAFT')]);
  const blocked = ui.find('#execution-progress', 'TC-021 · Case 21'); assert.ok(blocked);
  assert.equal(new URL(blocked.attributes.href).searchParams.get('testCaseId'), '21');
  assert.match(ui.textOf(ui.$('#execution-progress')[0]), /DRAFT.*review this case/);
  assert.equal(ui.find('#execution-actions', 'Create run from this plan'), undefined);
});

test('run continuation names and opens the first pending case instead of a completed case', async () => {
  const ui = browser(); await ui.open('runs', { runId: '40' });
  await ui.respond(ui.calls.at(-1), run(['PASS', 'NOT_RUN', 'NOT_RUN']));
  assert.match(ui.textOf(ui.$('#execution-actions')[0]), /record the result for “Frozen 1”/);
  const next = ui.find('#execution-actions', 'Continue execution');
  assert.equal(new URL(next.attributes.href).searchParams.get('runCaseId'), '51');
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('record-result shortcut focuses the outcome and does not submit an attempt', async () => {
  const ui = browser(); await loadCase(ui, '50', [], run(['NOT_RUN']));
  assert.match(ui.textOf(ui.$('#execution-case-progress')[0]), /follow the frozen steps below/);
  await ui.click(ui.find('#execution-case-navigation', 'Record a result'));
  assert.equal(ui.$('#execution-outcome')[0].focused, true);
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('recorded result points to the next unrecorded case, wrapping past earlier completed cases', async () => {
  const ui = browser(); const current = run(['NOT_RUN', 'PASS', 'PASS']);
  await loadCase(ui, '52', [{ ...attempt(62, 'PASS'), runCaseId: 52 }], current);
  const next = ui.find('#execution-case-progress', 'Next unrecorded case: Frozen 0'); assert.ok(next);
  assert.equal(new URL(next.attributes.href).searchParams.get('runCaseId'), '50');
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('after the final recorded result the completion shortcut returns to the run without completing automatically', async () => {
  const ui = browser(); await loadCase(ui, '50', [attempt(60, 'PASS')], run(['PASS']));
  const review = ui.find('#execution-case-progress', 'Review results and complete the run'); assert.ok(review);
  const destination = new URL(review.attributes.href);
  assert.equal(destination.searchParams.get('runId'), '40'); assert.equal(destination.searchParams.has('runCaseId'), false);
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('read-only and terminal run cases do not offer result entry or completion shortcuts', async () => {
  for (const [ui, status] of [[browser({ context: { canWriteAssets: false } }), 'IN_PROGRESS'], [browser(), 'COMPLETED']]) {
    await loadCase(ui, '50', [attempt(60, 'PASS')], run(['PASS'], status));
    assert.equal(ui.find('#execution-case-navigation', 'Record a result'), undefined);
    assert.equal(ui.find('#execution-case-progress', 'Review results and complete the run'), undefined);
  }
});

test('only the latest FAIL is promoted to defect creation while historical failure actions stay available after PASS', async () => {
  const ui = browser(), failed = attempt(60, 'FAIL');
  await loadCase(ui, '50', [failed], run(['FAIL', 'NOT_RUN']));
  const shortcut = ui.find('#execution-case-progress', 'Create defect from this FAIL'); assert.ok(shortcut);
  const destination = new URL(shortcut.attributes.href);
  assert.equal(destination.hash, '#defects');
  for (const [key, value] of Object.entries({ action: 'create', projectId: '12', runId: '40', runCaseId: '50', attemptId: '60', failureAttemptId: '60' }))
    assert.equal(destination.searchParams.get(key), value);
  assert.ok(ui.find('#execution-case-progress', 'Next unrecorded case: Frozen 1'));
  assert.ok(ui.find('#execution-history', 'Create defect from this FAIL'));
  await loadCase(ui, '50', [failed, attempt(61, 'PASS', 'next-key', 2)], run(['PASS', 'NOT_RUN']), '60');
  assert.equal(ui.find('#execution-case-progress', 'Create defect from this FAIL'), undefined);
  assert.ok(ui.find('#execution-history', 'Create defect from this FAIL'), 'Historical FAIL retains its own explicit action');
  assert.ok(ui.find('#execution-case-progress', 'Next unrecorded case: Frozen 1'));
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('returning with a new source case adds it to the original plan with a fresh version and omits unavailable or existing sources', async () => {
  const ui = browser(); await openPlan(ui, plan([]), [member()], { sourceTestCaseId: '20' });
  const add = ui.find('#execution-actions', 'Add this case to the plan'); assert.ok(add);
  assert.equal(ui.calls.every(call => call.method === 'GET'), true, 'Returning to the plan alone does not add anything');
  await ui.click(add);
  const latest = plan([]); latest.plan.version = 8; await ui.respond(ui.calls.at(-1), latest);
  const write = ui.calls.at(-1);
  assert.equal(write.method, 'POST'); assert.equal(write.url, 'projects/12/test-plans/31/test-cases/20'); assert.equal(write.body.expectedVersion, 8);
  await ui.respond(write, {}); await ui.respond(ui.calls.at(-1), plan([20]));
  await ui.respond(ui.calls.at(-1), plan([20])); await ui.respond(ui.calls.at(-1), [member()]);
  assert.equal(ui.find('#execution-actions', 'Add this case to the plan'), undefined, 'An included source cannot be added again');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  for (const [options, current, cases] of [
    [{}, plan([]), []], [{}, plan([]), [member(20, 'ARCHIVED')]], [{}, plan([], 'ARCHIVED'), [member()]],
    [{ context: { canWriteAssets: false } }, plan([]), [member()]]
  ]) {
    const unavailable = browser(options); await openPlan(unavailable, current, cases, { sourceTestCaseId: '20' });
    assert.equal(unavailable.find('#execution-actions', 'Add this case to the plan'), undefined);
    assert.equal(unavailable.calls.every(call => call.method === 'GET'), true);
  }
});
