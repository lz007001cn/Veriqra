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

test('run progress counts every recorded outcome and completion requires all cases', async () => {
  const ui = browser(); await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED', 'SKIPPED']));
  assert.match(ui.textOf(ui.$('#execution-progress')[0]), /4 of 5 cases recorded · 1 not run/);
  assert.equal(ui.find('#execution-actions', 'Complete run').disabled, true);
  const next = ui.find('#execution-actions', 'Continue execution'); assert.match(next.attributes.href, /runCaseId=50/);
  await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED']));
  assert.equal(ui.find('#execution-actions', 'Complete run').disabled, false);
  assert.match(ui.textOf(ui.$('#execution-progress')[0]), /Every case has an attempt/);
});

test('ad-hoc runs show import provenance only after a matching import record is confirmed', async () => {
  for (const imported of [false, true]) {
    const ui = browser(); await ui.open('runs', { runId: '40' });
    const current = run(); current.run.testPlanId = null;
    await ui.respond(ui.calls.at(-1), current);
    const query = ui.calls.at(-1);
    assert.equal(query.url, 'projects/12/imports?runId=40');
    assert.equal(ui.find('#execution-context', 'View import source'), undefined);
    await ui.respond(query, imported ? [{ id: 70, testRunId: 40 }] : []);
    const link = ui.find('#execution-context', 'View import source');
    if (imported) {
      assert.ok(link); const destination = new URL(link.attributes.href);
      assert.equal(destination.hash, '#automation'); assert.equal(destination.searchParams.get('runId'), '40');
    } else assert.equal(link, undefined);
    assert.equal(ui.calls.every(call => call.method === 'GET'), true);
  }
});

test('unrelated or unavailable import records never identify an ad-hoc run as imported', async () => {
  for (const unavailable of [false, true]) {
    const ui = browser(); await ui.open('runs', { runId: '40' });
    const current = run(); current.run.testPlanId = null;
    await ui.respond(ui.calls.at(-1), current);
    const query = ui.calls.at(-1);
    if (unavailable) { query.reject({ status: 503 }); await flush(); }
    else await ui.respond(query, [{ id: 70, testRunId: 999 }]);
    assert.equal(ui.find('#execution-context', 'View import source'), undefined);
  }
});

test('a stale import query cannot add its source link to another run', async () => {
  const ui = browser(); await ui.open('runs', { runId: '40' });
  const current = run(); current.run.testPlanId = null;
  await ui.respond(ui.calls.at(-1), current); const obsolete = ui.calls.at(-1);
  await ui.open('runs', { runId: '41' });
  const other = run(); other.run.id = 41;
  await ui.respond(ui.calls.at(-1), other);
  await ui.respond(obsolete, [{ id: 70, testRunId: 40 }]);
  assert.equal(ui.find('#execution-context', 'View import source'), undefined);
  assert.equal(ui.nav.read().runId, '41');
});

test('failed cancel restores Complete eligibility instead of enabling incomplete run completion', async () => {
  for (const outcomes of [['NOT_RUN', 'PASS'], ['FAIL', 'PASS']]) {
    const ui = browser(); await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(outcomes));
    await ui.click(ui.find('#execution-actions', 'Cancel run')); const cancel = ui.calls.at(-1);
    assert.equal(cancel.url, 'projects/12/runs/40/cancel'); assert.equal(ui.find('#execution-actions', 'Complete run').disabled, true);
    cancel.reject({ status: 500, message: 'Cancel unavailable' }); await flush();
    assert.equal(ui.find('#execution-actions', 'Cancel run').disabled, false);
    assert.equal(ui.find('#execution-actions', 'Complete run').disabled, outcomes.includes('NOT_RUN'));
  }
});

test('exact case and attempt route highlights historical result and links current definition and source plan', async () => {
  const ui = browser(); await loadCase(ui, '50', [attempt(), attempt(61, 'PASS', 'key-two', 2)], run(['PASS', 'NOT_RUN']), '60');
  assert.match(ui.textOf(ui.$('#execution-snapshot')[0]), /Frozen action/);
  assert.equal(ui.$('#execution-history')[0].children.length, 2);
  assert.equal(ui.$('#execution-attempt-60').attr('aria-current'), 'true');
  assert.equal(ui.$('#execution-attempt-60')[0].focused, true);
  assert.match(ui.find('#execution-case-context', 'View current test case').attributes.href, /testCaseId=20/);
  assert.match(ui.find('#execution-case-context', 'View source plan').attributes.href, /planId=30/);
  assert.equal(ui.find('#execution-case-navigation', 'Previous case').disabled, true);
  const next = ui.find('#execution-case-navigation', 'Next case'); assert.match(next.attributes.href, /runCaseId=51/);
  const posts = ui.calls.filter(call => call.method === 'POST').length; await ui.click(next); assert.equal(ui.calls.filter(call => call.method === 'POST').length, posts);
});

test('modified contextual link click preserves native navigation', async () => {
  const ui = browser(); await loadCase(ui);
  const current = ui.find('#execution-case-context', 'View current test case'); const before = ui.navigation.length;
  assert.equal(await ui.click(current, { ctrlKey: true }), false); assert.equal(ui.navigation.length, before);
  assert.equal(await ui.click(current), true); assert.equal(ui.navigation.at(-1).view, 'test-cases');
});

test('case-origin plan creation and existing membership use only existing project endpoints', async () => {
  const ui = browser(); await ui.open('test-plans', { action: 'create', sourceTestCaseId: '20' });
  await ui.respond(ui.calls.at(-1), [{ id: 20, keyNo: 4, title: 'Current case', status: 'READY' }]);
  await ui.respond(ui.calls.at(-1), [{ id: 30, keyNo: 2, name: 'Existing', status: 'READY', version: 7 }]);
  assert.equal(ui.$('#execution-select-case-20').prop('checked'), true);
  ui.$('#execution-existing-plan').val('30'); await ui.click(ui.$('#execution-add-existing')[0]);
  assert.equal(ui.calls.at(-1).url, 'projects/12/test-plans/30');
  const latest = planDetail(30, 0); latest.plan.version = 8; await ui.respond(ui.calls.at(-1), latest);
  assert.equal(ui.calls.at(-1).url, 'projects/12/test-plans/30/test-cases/20');
  assert.equal(ui.calls.at(-1).body.expectedVersion, 8, 'Fresh scope/version, not the cached selector version');
  assert.equal(ui.calls.filter(call => call.method === 'GET').length, 3);
});

test('create-plan locale refresh translates cached source context and placeholder while preserving all inputs and selections', async () => {
  const ui = browser(); await ui.open('test-plans', { action: 'create', sourceTestCaseId: '20' });
  await ui.respond(ui.calls.at(-1), [{ id: 20, keyNo: 1, title: 'Source case', status: 'READY' }, { id: 21, keyNo: 2, title: 'Other case', status: 'READY' }]);
  await ui.respond(ui.calls.at(-1), [{ id: 30, keyNo: 1, name: 'First plan', status: 'READY' }, { id: 31, keyNo: 2, name: 'Selected plan', status: 'READY' }]);
  ui.$('#execution-name').val('Typed plan name'); ui.$('#execution-description').val('Typed plan description'); ui.$('#execution-existing-plan').val('31');
  ui.$('#execution-select-case-20').prop('checked', false); ui.$('#execution-select-case-21').prop('checked', true); const requests = ui.calls.length;
  ui.locale('zh-CN'); await flush();
  assert.match(ui.textOf(ui.$('#execution-form-context')[0]), /来源测试用例：TC-001 · Source case/);
  assert.match(ui.find('#execution-form-context', '返回来源测试用例').attributes.href, /testCaseId=20/);
  assert.equal(ui.$('#execution-existing-plan').find('option')[0].content, '选择现有计划');
  assert.equal(ui.$('#execution-name').val(), 'Typed plan name'); assert.equal(ui.$('#execution-description').val(), 'Typed plan description');
  assert.equal(ui.$('#execution-existing-plan').val(), '31'); assert.equal(ui.$('#execution-select-case-20').prop('checked'), false); assert.equal(ui.$('#execution-select-case-21').prop('checked'), true);
  ui.locale('en'); await flush(); assert.ok(ui.find('#execution-form-context', 'Back to source test case'));
  assert.equal(ui.$('#execution-existing-plan').find('option')[0].content, 'Select an existing plan'); assert.equal(ui.$('#execution-existing-plan').val(), '31');
  assert.equal(ui.calls.length, requests, 'Locale uses cached labels without extra lookups or writes');
});

test('READY plan origin is preselected and rapid run submission makes one POST', async () => {
  const ui = browser(); await ui.open('runs', { action: 'create', sourcePlanId: '31' });
  await ui.respond(ui.calls.at(-1), [{ id: 20, keyNo: 4, title: 'Case', status: 'READY' }]);
  await ui.respond(ui.calls.at(-1), [{ id: 30, keyNo: 1, name: 'Other', status: 'READY' }, { id: 31, keyNo: 2, name: 'Source', status: 'READY' }]);
  assert.equal(ui.$('#execution-origin').val(), 'plan'); assert.equal(ui.$('#execution-plan').val(), '31');
  assert.equal(ui.calls.at(-1).url, 'projects/12/test-plans/31'); assert.equal(ui.$('#execution-save').prop('disabled'), true);
  await ui.respond(ui.calls.at(-1), planDetail());
  await ui.respond(ui.calls.at(-1), [{ id: 20, keyNo: 1, title: 'Case A', status: 'READY' }, { id: 21, keyNo: 2, title: 'Case B', status: 'READY' }]);
  assert.match(ui.textOf(ui.$('#execution-plan-preview')[0]), /2 included case\(s\) will be captured/);
  assert.match(ui.textOf(ui.$('#execution-plan-preview')[0]), /freezes the included test cases and steps/);
  ui.$('#execution-name').val('Release'); await ui.submit('execution-form'); await ui.submit('execution-form');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0, 'Current definition is rechecked immediately before submission');
  await ui.respond(ui.calls.at(-1), planDetail());
  await ui.respond(ui.calls.at(-1), [{ id: 20, keyNo: 1, title: 'Case A', status: 'READY' }, { id: 21, keyNo: 2, title: 'Case B', status: 'READY' }]);
  const posts = ui.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 1); assert.equal(posts[0].body.testPlanId, 31); assert.equal(posts[0].body.testCaseIds, undefined);
});

test('selected plan preview rejects late selection and project responses without plan fanout', async () => {
  const ui = browser(); await ui.open('runs', { action: 'create' }); await ui.respond(ui.calls.at(-1), []);
  await ui.respond(ui.calls.at(-1), [{ id: 30, keyNo: 1, name: 'A', status: 'READY' }, { id: 31, keyNo: 2, name: 'B', status: 'READY' }]);
  const a = ui.calls.at(-1); ui.$('#execution-plan').val('31').trigger('change'); await flush(); const b = ui.calls.at(-1);
  assert.equal(a.url, 'projects/12/test-plans/30'); assert.equal(b.url, 'projects/12/test-plans/31');
  await ui.respond(b, planDetail(31, 3)); await ui.respond(ui.calls.at(-1), [20, 21, 22].map(id => ({ id, keyNo: id, title: 'Case ' + id, status: 'READY' }))); await ui.respond(a, planDetail(30, 9));
  assert.match(ui.textOf(ui.$('#execution-plan-preview')[0]), /3 included case/); assert.doesNotMatch(ui.textOf(ui.$('#execution-plan-preview')[0]), /9 included case/);
  assert.match(ui.find('#execution-plan-preview', 'View source plan').attributes.href, /planId=31/);
  ui.$('#execution-plan').val('30').trigger('change'); await flush(); const old = ui.calls.at(-1);
  ui.nav.select('runs', { projectId: '99', action: 'create' }); ui.emit('veriqra:project', { project: { id: 99 } }); await flush();
  await ui.respond(old, planDetail(30, 9)); assert.equal(ui.textOf(ui.$('#execution-plan-preview')[0]), ''); assert.equal(ui.calls.at(-1).url, 'projects/99/test-cases');
});

test('plan preview failure has a scoped retry that preserves fields and invalid readiness blocks creation', async () => {
  const ui = browser(); await ui.open('runs', { action: 'create', sourcePlanId: '31' }); await ui.respond(ui.calls.at(-1), []);
  await ui.respond(ui.calls.at(-1), [{ id: 31, keyNo: 2, name: 'Source', status: 'READY' }]);
  ui.calls.at(-1).reject({ status: 500, message: 'Preview unavailable' }); await flush(); ui.$('#execution-name').val('Typed release name');
  assert.equal(ui.$('#execution-save').prop('disabled'), true); await ui.click(ui.find('#execution-plan-preview', 'Retry loading'));
  assert.equal(ui.$('#execution-name').val(), 'Typed release name'); await ui.respond(ui.calls.at(-1), planDetail(31, 0, 'DRAFT'));
  assert.equal(ui.$('#execution-save').prop('disabled'), true); await ui.submit('execution-form'); assert.equal(ui.calls.some(call => call.method === 'POST'), false);
  ui.$('#execution-origin').val('adhoc').trigger('change'); await flush(); assert.equal(ui.textOf(ui.$('#execution-plan-preview')[0]), ''); assert.equal(ui.$('#execution-save').prop('disabled'), false);
});

test('wrong-project source case is unavailable and cannot silently create an empty source plan', async () => {
  const ui = browser(); await ui.open('test-plans', { action: 'create', sourceTestCaseId: '20' });
  await ui.respond(ui.calls.at(-1), [{ id: 21, keyNo: 2, title: 'Case in current project', status: 'READY' }]);
  assert.match(ui.$('#execution-form-error').text(), /source test case is unavailable/); assert.equal(ui.$('#execution-save').prop('disabled'), true);
  ui.$('#execution-name').val('Source plan'); await ui.submit('execution-form'); assert.equal(ui.calls.some(call => call.method === 'POST'), false);
});

test('lookup retry preserves typed form fields and edits made while the lookup is pending', async () => {
  const ui = browser(); await ui.open('test-plans', { action: 'create', sourceTestCaseId: '20' }); ui.calls.at(-1).reject({ status: 500, message: 'Cases unavailable' }); await flush();
  ui.$('#execution-name').val('Typed name'); ui.$('#execution-description').val('Typed description'); await ui.click(ui.find('#execution-form-context', 'Retry loading'));
  assert.equal(ui.$('#execution-name').val(), 'Typed name'); ui.$('#execution-name').val('Edited while retry loads');
  await ui.respond(ui.calls.at(-1), [{ id: 20, keyNo: 1, title: 'Source case', status: 'READY' }]); await ui.respond(ui.calls.at(-1), []);
  assert.equal(ui.$('#execution-name').val(), 'Edited while retry loads'); assert.equal(ui.$('#execution-description').val(), 'Typed description'); assert.equal(ui.$('#execution-select-case-20').prop('checked'), true);
});

test('unchanged uncertain retry retains its UUID after leaving and returning to the same case', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('New result'); await ui.submit(); await ui.submit();
  const first = ui.calls.at(-1); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1); first.reject({ status: 0, message: 'Network error' }); await flush();
  await loadCase(ui, '51', [], run()); await loadCase(ui); assert.equal(ui.$('#execution-comment').val(), 'New result');
  await ui.submit(); const retry = ui.calls.at(-1); assert.equal(retry.body.submissionKey, first.body.submissionKey);
  retry.reject({ status: 0, message: 'Network error' }); await flush(); ui.$('#execution-comment').val('Changed result'); await ui.submit();
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 2, 'An unknown request cannot be replaced with a new key for edited values');
  assert.match(ui.$('#execution-attempt-error').text(), /unconfirmed result/);
  await ui.click(ui.find('#execution-attempt-error', 'Read current attempt history'));
  await ui.respond(ui.calls.at(-1), run(['PASS'])); await ui.respond(ui.calls.at(-1), [attempt(62, 'PASS', first.body.submissionKey)]);
  assert.equal(ui.$('#execution-comment').val(), 'Changed result'); await ui.submit(); assert.notEqual(ui.calls.at(-1).body.submissionKey, first.body.submissionKey);
});

test('successful save refreshes append-only history and a terminal run remains read-only', async () => {
  const ui = browser(); await loadCase(ui, '50', [attempt()]); ui.$('#execution-outcome').val('PASS'); await ui.submit();
  const write = ui.calls.at(-1), saved = attempt(62, 'PASS', write.body.submissionKey, 2); await ui.respond(write, saved);
  await ui.respond(ui.calls.at(-1), run(['PASS', 'NOT_RUN'])); await ui.respond(ui.calls.at(-1), [attempt(), saved]);
  assert.equal(ui.$('#execution-history')[0].children.length, 2); assert.match(ui.$('#execution-notice').text(), /Attempt #2 recorded/);
  await loadCase(ui, '50', [attempt(), saved], run(['PASS'], 'COMPLETED')); assert.equal(ui.$('#execution-attempt-form').hasClass('d-none'), true);
  assert.match(ui.textOf(ui.$('#execution-case-context')[0]), /read-only/);
  const before = ui.calls.length; await ui.submit(); assert.equal(ui.calls.length, before, 'Terminal form cannot append attempts');
});

test('record and next advances only after accepted submission and does not advance on failure', async () => {
  const ui = browser(); await loadCase(ui); const nextButton = ui.$('#execution-record-next')[0]; await ui.submit('execution-attempt-form', nextButton);
  const write = ui.calls.at(-1); assert.equal(ui.navigation.at(-1).runCaseId, '50'); write.reject({ status: 500, message: 'Unavailable' }); await flush();
  assert.equal(ui.navigation.at(-1).runCaseId, '50'); await ui.submit('execution-attempt-form', nextButton);
  await ui.respond(ui.calls.at(-1), attempt(62, 'PASS', write.body.submissionKey)); assert.equal(ui.navigation.at(-1).runCaseId, '51');
  await ui.respond(ui.calls.at(-1), run(['PASS', 'NOT_RUN', 'PASS'])); await ui.respond(ui.calls.at(-1), []);
  assert.match(ui.$('#execution-notice').text(), /Attempt #1 recorded/);
});

test('accepted record-and-next is clean only while the current values match the accepted body', async () => {
  for (const changedInFlight of [false, true]) {
    const observed = [];
    const ui = browser({ beforeNavigate: (view, context, guard) => observed.push(guard && guard.dirty()) });
    await loadCase(ui); ui.$('#execution-comment').val('Submitted result');
    await ui.submit('execution-attempt-form', ui.$('#execution-record-next')[0]);
    const write = ui.calls.at(-1);
    assert.equal(ui.guards.get('execution').dirty(), true, 'In-flight values remain protected');
    if (changedInFlight) ui.$('#execution-comment').val('New unsaved input while POST is in flight');
    await ui.respond(write, attempt(62, 'PASS', write.body.submissionKey));
    assert.equal(observed.at(-1), changedInFlight, 'Only the exact accepted values bypass the leave-draft warning');
  }
});

test('in-flight submission owns its case through navigation and accepted late response cannot duplicate', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('Owned result'); await ui.submit(); const write = ui.calls.at(-1);
  await loadCase(ui, '51'); assert.equal(ui.$('#execution-comment').val(), '');
  await loadCase(ui); assert.equal(ui.$('#execution-comment').val(), 'Owned result'); assert.equal(ui.$('#execution-submit').prop('disabled'), true);
  await ui.submit(); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  const saved = attempt(62, 'PASS', write.body.submissionKey); await ui.respond(write, saved);
  await ui.submit(); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1, 'Late accepted result refreshes instead of appending');
  await ui.respond(ui.calls.at(-1), run(['PASS'])); await ui.respond(ui.calls.at(-1), [saved]);
  assert.equal(ui.$('#execution-comment').val(), '');
});

test('verified project consumes the URL view before loading contextual creation', async () => {
  const ui = browser(); ui.nav.select('test-plans', { projectId: '99', action: 'create', sourceTestCaseId: '20' }); ui.emit('veriqra:project', { project: { id: 99 } }); await flush();
  assert.equal(ui.calls.at(-1).url, 'projects/99/test-cases'); await ui.respond(ui.calls.at(-1), [{ id: 20, keyNo: 1, title: 'Case in verified project', status: 'READY' }]);
  assert.equal(ui.calls.at(-1).url, 'projects/99/test-plans');
});

test('failed attempt history shows honest failure and explicit retry, missing referenced attempt warns', async () => {
  const ui = browser(); await ui.open('runs', { runId: '40', runCaseId: '50', attemptId: '999' }); await ui.respond(ui.calls.at(-1), run());
  ui.calls.at(-1).reject({ status: 500, message: 'History unavailable' }); await flush();
  assert.equal(ui.$('#execution-attempt-form').hasClass('d-none'), true); assert.equal(ui.$('#execution-notice').text(), 'History unavailable');
  assert.equal(ui.$('#execution-case-title').text(), 'Unavailable'); assert.equal(ui.$('#execution-history-status').text(), 'Unavailable');
  await ui.click(ui.find('#execution-case-navigation', 'Retry loading')); await ui.respond(ui.calls.at(-1), run()); await ui.respond(ui.calls.at(-1), [attempt()]);
  assert.match(ui.$('#execution-notice').text(), /referenced attempt is unavailable/);
});

test('late snapshot and locale draft responses cannot replace a newer project or case', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('Old draft'); ui.emit('veriqra:localechange', {}); await flush(); const localeRun = ui.calls.at(-1);
  await loadCase(ui, '51', [], run()); ui.$('#execution-comment').val('New draft'); await ui.respond(localeRun, run());
  assert.equal(ui.$('#execution-comment').val(), 'New draft'); assert.match(ui.$('#execution-case-title').text(), /Frozen 1/);
  await ui.open('runs', { runId: '40', runCaseId: '50' }); const old = ui.calls.at(-1);
  ui.nav.select('runs', { projectId: '99' }); ui.emit('veriqra:project', { project: { id: 99 } }); await ui.respond(old, run());
  assert.equal(ui.$('#execution-case-panel').hasClass('d-none'), true); assert.equal(ui.calls.at(-1).url, 'projects/99/runs');
});

test('locale refresh does not restore hidden previous-case input into a case still loading', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('Case A draft');
  await ui.open('runs', { runId: '40', runCaseId: '51' }); await ui.respond(ui.calls.at(-1), run()); const obsolete = ui.calls.at(-1);
  ui.emit('veriqra:localechange', {}); await flush(); await ui.respond(ui.calls.at(-1), run()); await ui.respond(ui.calls.at(-1), []); await ui.respond(obsolete, []);
  assert.equal(ui.$('#execution-comment').val(), ''); assert.equal(ui.nav.read().runCaseId, '51'); assert.match(ui.$('#execution-case-title').text(), /Frozen 1/);
});

test('locale during a pending previous-case detail retains the selected route and rejects the obsolete run response', async () => {
  const ui = browser(); await loadCase(ui, '51'); ui.$('#execution-comment').val('Draft belongs to case B');
  await ui.click(ui.find('#execution-case-navigation', 'Previous case')); const obsolete = ui.calls.at(-1);
  assert.equal(obsolete.url, 'projects/12/runs/40'); assert.equal(ui.$('#execution-case-panel').hasClass('d-none'), true);
  ui.locale('zh-CN'); await flush(); const refresh = ui.calls.at(-1);
  assert.notEqual(refresh, obsolete); assert.equal(refresh.url, 'projects/12/runs/40');
  assert.equal(ui.nav.read().runId, '40'); assert.equal(ui.nav.read().runCaseId, '50');
  assert.equal(ui.calls.filter(call => call.url === 'projects/12/runs').length, 0, 'Pending selection never falls back to the run list');
  const requestCount = ui.calls.length; await ui.respond(obsolete, run());
  assert.equal(ui.calls.length, requestCount, 'An obsolete detail cannot start an attempt-history request');
  await ui.respond(refresh, run()); assert.equal(ui.calls.at(-1).url, 'projects/12/runs/40/cases/50/attempts');
  await ui.respond(ui.calls.at(-1), []);
  assert.equal(ui.nav.read().runId, '40'); assert.equal(ui.nav.read().runCaseId, '50');
  assert.equal(ui.$('#execution-list-panel').hasClass('d-none'), true); assert.equal(ui.$('#execution-case-panel').hasClass('d-none'), false);
  assert.match(ui.$('#execution-case-title').text(), /Frozen 0/); assert.equal(ui.$('#execution-comment').val(), '');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0); assert.equal(ui.calls.length, requestCount + 1);
});

test('rapid double locale before the first run response preserves the current draft and never writes history', async () => {
  const ui = browser(); await loadCase(ui, '50', [attempt()]);
  ui.$('#execution-outcome').val('FAIL').trigger('change'); ui.$('#execution-duration').val('123');
  ui.$('#execution-comment').val('  Actual result\nNotes remain verbatim  '); ui.$('#execution-failure').val('Failure detail typed by user');
  ui.locale('zh-CN'); await flush(); const obsolete = ui.calls.at(-1);
  ui.locale('en'); await flush(); const refresh = ui.calls.at(-1);
  assert.notEqual(refresh, obsolete); assert.equal(refresh.url, 'projects/12/runs/40');
  const requests = ui.calls.length; await ui.respond(obsolete, run()); assert.equal(ui.calls.length, requests, 'Obsolete locale cannot read or render history');
  await ui.respond(refresh, run()); await ui.respond(ui.calls.at(-1), [attempt()]);
  assert.equal(ui.$('#execution-comment').val(), '  Actual result\nNotes remain verbatim  ');
  assert.equal(ui.$('#execution-failure').val(), 'Failure detail typed by user'); assert.equal(ui.$('#execution-duration').val(), '123'); assert.equal(ui.$('#execution-outcome').val(), 'FAIL');
  assert.equal(ui.$('#execution-case-title').text(), 'Snapshot · Frozen 0'); assert.equal(ui.$('#execution-failure-wrap').hasClass('d-none'), false);
  assert.equal(ui.nav.read().runCaseId, '50'); assert.equal(ui.$('#execution-history')[0].children.length, 1);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0, 'Locale only reads immutable attempt history');
  await ui.submit(); await ui.submit(); const posts = ui.calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1); assert.equal(posts[0].body.comment, 'Actual result\nNotes remain verbatim'); assert.equal(posts[0].body.failureMessage, 'Failure detail typed by user');
});

test('double locale responses cannot restore a prior draft after a case or project switch', async () => {
  for (const destination of ['case', 'project']) {
    const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('Obsolete locale draft');
    ui.locale('zh-CN'); await flush(); const first = ui.calls.at(-1); ui.locale('en'); await flush(); const second = ui.calls.at(-1);
    if (destination === 'case') await loadCase(ui, '51');
    else {
      ui.nav.select('runs', { projectId: '99', runId: '40', runCaseId: '50' }); ui.emit('veriqra:project', { project: { id: 99 } }); await flush();
      const current = run(); current.run.projectId = 99; current.run.name = 'Other project run';
      await ui.respond(ui.calls.at(-1), current); await ui.respond(ui.calls.at(-1), []);
    }
    ui.$('#execution-comment').val('Current owner draft'); const requests = ui.calls.length;
    await ui.respond(second, run()); await ui.respond(first, run());
    assert.equal(ui.calls.length, requests); assert.equal(ui.$('#execution-comment').val(), 'Current owner draft');
    assert.equal(ui.nav.read().projectId, destination === 'project' ? '99' : '12'); assert.equal(ui.nav.read().runCaseId, destination === 'case' ? '51' : '50');
    assert.equal(ui.$('#execution-case-title').text(), 'Snapshot · Frozen ' + (destination === 'case' ? 1 : 0));
    assert.equal(ui.calls.some(call => call.method === 'POST'), false);
  }
});

test('double locale preserves an in-flight attempt without submitting it again after acceptance', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('In-flight result'); await ui.submit(); const write = ui.calls.at(-1);
  ui.locale('zh-CN'); await flush(); const obsolete = ui.calls.at(-1); ui.locale('en'); await flush(); const refresh = ui.calls.at(-1);
  await ui.respond(refresh, run()); await ui.respond(ui.calls.at(-1), []);
  assert.equal(ui.$('#execution-comment').val(), 'In-flight result'); assert.equal(ui.$('#execution-submit').prop('disabled'), true);
  await ui.submit(); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  const saved = attempt(62, 'PASS', write.body.submissionKey); await ui.respond(write, saved);
  await ui.submit(); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1, 'Accepted unchanged body refreshes instead of appending again');
  await ui.respond(ui.calls.at(-1), run(['PASS'])); await ui.respond(ui.calls.at(-1), [saved]); await ui.respond(obsolete, run());
  assert.equal(ui.$('#execution-comment').val(), ''); assert.equal(ui.$('#execution-history')[0].children.length, 1);
});

test('double locale keeps completed run history read-only and uses the latest language', async () => {
  const ui = browser(); const current = run(['PASS'], 'COMPLETED'); await loadCase(ui, '50', [attempt(60, 'PASS')], current);
  ui.locale('zh-CN'); await flush(); const obsolete = ui.calls.at(-1); ui.locale('en'); await flush(); const refresh = ui.calls.at(-1);
  await ui.respond(refresh, current); await ui.respond(ui.calls.at(-1), [attempt(60, 'PASS')]); await ui.respond(obsolete, current);
  assert.equal(ui.$('#execution-attempt-form').hasClass('d-none'), true); assert.equal(ui.$('#execution-case-title').text(), 'Snapshot · Frozen 0');
  assert.equal(ui.$('#execution-history')[0].children.length, 1); assert.match(ui.textOf(ui.$('#execution-case-context')[0]), /This run is read-only/);
  await ui.submit(); assert.equal(ui.calls.some(call => call.method === 'POST'), false);
});

test('locale refresh preserves a distinct draft after confirming an earlier accepted submission', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('Submitted result'); await ui.submit(); const write = ui.calls.at(-1);
  ui.$('#execution-comment').val('Distinct unsaved retest'); ui.emit('veriqra:localechange', {}); await flush(); const refresh = ui.calls.at(-1);
  const saved = attempt(62, 'PASS', write.body.submissionKey); await ui.respond(write, saved); await ui.respond(refresh, run(['PASS'])); await ui.respond(ui.calls.at(-1), [saved]);
  assert.equal(ui.$('#execution-comment').val(), 'Distinct unsaved retest'); await ui.submit(); assert.notEqual(ui.calls.at(-1).body.submissionKey, write.body.submissionKey);
});

test('locale refresh preserves unresolved retry key and clears unchanged confirmed submission', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('Retry result'); await ui.submit(); const write = ui.calls.at(-1); write.reject({ status: 0, message: 'Uncertain response' }); await flush();
  ui.emit('veriqra:localechange', {}); await flush(); await ui.respond(ui.calls.at(-1), run()); await ui.respond(ui.calls.at(-1), []);
  assert.equal(ui.$('#execution-comment').val(), 'Retry result'); await ui.submit(); const retried = ui.calls.at(-1); assert.equal(retried.body.submissionKey, write.body.submissionKey);
  const saved = attempt(62, 'PASS', write.body.submissionKey); await ui.respond(retried, saved); await ui.respond(ui.calls.at(-1), run(['PASS'])); await ui.respond(ui.calls.at(-1), [saved]);
  ui.emit('veriqra:localechange', {}); await flush(); await ui.respond(ui.calls.at(-1), run(['PASS'])); await ui.respond(ui.calls.at(-1), [saved]);
  assert.equal(ui.$('#execution-comment').val(), ''); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 2);
});

test('FAIL reads persisted defect associations after refresh and retains exact source for create/link', async () => {
  const ui = browser({ defects: [{ id: 70, keyNo: 3, title: 'Persisted defect', status: 'OPEN' }] }); await loadCase(ui, '50', [attempt()]);
  assert.match(ui.find('#execution-history', 'BUG-003 · Persisted defect · OPEN').attributes.href, /defectId=70/);
  assert.equal(ui.defectCalls.length, 1); assert.equal(ui.defectCalls[0].url, 'projects/12/runs/40/cases/50/attempts/60/defects');
  await ui.click(ui.find('#execution-history', 'Link to existing defect')); assert.equal(ui.navigation.at(-1).action, 'link'); assert.equal(ui.navigation.at(-1).failureAttemptId, '60');
});

test('persisted association failure is honest, scoped Retry works and stale results cannot enter a new case', async () => {
  const ui = browser({ manualDefects: true }); await loadCase(ui, '50', [attempt()]);
  ui.defectCalls[0].reject({ status: 500, message: 'Unavailable' }); await flush();
  assert.match(ui.textOf(ui.$('#execution-history')[0]), /does not mean there are none/);
  await ui.click(ui.find('#execution-history', 'Retry loading')); const retry = ui.defectCalls.at(-1);
  await loadCase(ui, '51', [], run()); await ui.respond(retry, [{ id: 70, keyNo: 3, title: 'Old defect', status: 'CLOSED' }]);
  assert.doesNotMatch(ui.textOf(ui.$('#execution-history')[0]), /Old defect/);
  await loadCase(ui, '50', [attempt()]); await ui.respond(ui.defectCalls.at(-1), []);
  assert.match(ui.textOf(ui.$('#execution-history')[0]), /No defects are linked/);
});

test('completion confirmation refreshes real outcomes and pending defects before explicitly finishing a run containing failures', async () => {
  const ui = browser({ manualImpact: true }); await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED']));
  const impact = { runId: 40, status: 'IN_PROGRESS', outcomes: { PASS: 1, FAIL: 1, BLOCKED: 1, SKIPPED: 1, NOT_RUN: 0 }, openDefectCount: 3, pendingRetestDefectCount: 2 };
  await ui.respond(ui.impactCalls[0], impact);
  assert.match(ui.textOf(ui.$('#execution-completion-impact')[0]), /Unclosed defects: 3.*awaiting valid retest: 2/);
  assert.equal(ui.find('#execution-actions', 'Complete run').disabled, false);
  await ui.click(ui.find('#execution-actions', 'Complete run'));
  assert.equal(ui.impactCalls.length, 2); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
  await ui.respond(ui.impactCalls[1], impact);
  assert.match(ui.textOf(ui.$('#execution-finish-panel')[0]), /does not mean all cases passed/); assert.match(ui.textOf(ui.$('#execution-finish-panel')[0]), /cannot append attempts/);
  await ui.click(ui.find('#execution-finish-panel', 'Confirm completion'));
  const write = ui.calls.at(-1); assert.equal(write.method, 'POST'); assert.equal(write.url, 'projects/12/runs/40/complete'); assert.equal(write.body.expectedVersion, 2);
  write.reject({ status: 409, message: 'Changed' }); await flush();
});

test('unavailable completion impact stays unavailable, offers a scoped Retry and does not invent zero defect counts', async () => {
  const ui = browser({ manualImpact: true }); await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(['PASS', 'FAIL']));
  ui.impactCalls[0].reject({ status: 500, message: 'Impact unavailable' }); await flush();
  const text = ui.textOf(ui.$('#execution-completion-impact')[0]); assert.match(text, /cannot be assumed to be zero/); assert.doesNotMatch(text, /Unclosed defects: 0/);
  assert.equal(ui.find('#execution-actions', 'Complete run').disabled, false);
  await ui.click(ui.find('#execution-completion-impact', 'Retry loading')); assert.equal(ui.impactCalls.length, 2);
  ui.impactCalls[1].reject({ status: 500, message: 'Impact unavailable' }); await flush();
  await ui.click(ui.find('#execution-actions', 'Complete run')); ui.impactCalls[2].reject({ status: 500, message: 'Impact unavailable' }); await flush();
  assert.ok(ui.find('#execution-finish-panel', 'Confirm completion')); assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('late completion impact and terminal-run confirmation cannot affect a newly selected run', async () => {
  const ui = browser({ manualImpact: true }); await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(['FAIL']));
  const old = ui.impactCalls[0];
  await ui.open('runs', { runId: '41' }); const other = run(['PASS'], 'COMPLETED'); other.run.id = 41; await ui.respond(ui.calls.at(-1), other);
  await ui.respond(old, { runId: 40, outcomes: { PASS: 0, FAIL: 9, BLOCKED: 0, SKIPPED: 0, NOT_RUN: 0 }, openDefectCount: 88, pendingRetestDefectCount: 88 });
  assert.doesNotMatch(ui.textOf(ui.$('#execution-completion-impact')[0]), /88/); assert.equal(ui.find('#execution-actions', 'Complete run'), undefined);
  await ui.respond(ui.impactCalls[1], { runId: 41, status: 'COMPLETED', outcomes: { PASS: 1, FAIL: 0, BLOCKED: 0, SKIPPED: 0, NOT_RUN: 0 }, openDefectCount: 1, pendingRetestDefectCount: 0 });
  assert.match(ui.textOf(ui.$('#execution-progress')[0]), /compatible READY Test Case in a new run/);
});

const retestSource = () => ({ testCase: { id: 20, keyNo: 20, title: 'Frozen 0', description: 'Captured description', preconditions: 'Before', status: 'READY' }, steps: [{ stepOrder: 1, action: 'Frozen action', expectedResult: 'Frozen expected' }] });
async function sourceReads(ui, current = retestSource()) {
  const reads = ui.calls.slice(-3);
  await ui.respond(reads.find(call => call.url === 'projects/12/runs/40'), run(['FAIL'], 'COMPLETED'));
  await ui.respond(reads.find(call => call.url === 'projects/12/test-cases/20'), current);
  await ui.respond(reads.find(call => call.url.endsWith('/attempts')), [attempt(60, 'FAIL')]);
}
async function retestForm(ui, current = retestSource()) {
  await ui.open('runs', { action: 'create', sourceTestCaseId: '20', runId: '40', runCaseId: '50', failureAttemptId: '60', defectId: '9' });
  await ui.respond(ui.calls.at(-1), [current.testCase]); await sourceReads(ui, current); await ui.respond(ui.calls.at(-1), []);
}

test('terminal-failure retest creation verifies frozen semantics and automatically keeps the actual READY source case', async () => {
  const ui = browser(); await retestForm(ui);
  assert.equal(ui.$('#execution-name').val(), 'Retest · Frozen 0'); assert.equal(ui.$('#execution-origin').val(), 'adhoc'); assert.equal(ui.$('#execution-origin').prop('disabled'), true);
  const chosen = ui.$('#execution-select-case-20')[0]; assert.equal(chosen.checked, true); assert.equal(chosen.disabled, true);
  assert.equal(ui.$('#execution-save').prop('disabled'), false); assert.match(ui.textOf(ui.$('#execution-form-context')[0]), /matches the original frozen definition/);
  ui.$('#execution-name').val('New QA retest'); await ui.submit('execution-form');
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0, 'Compatibility is rechecked immediately before creation');
  await sourceReads(ui);
  const write = ui.calls.at(-1); assert.equal(write.method, 'POST'); assert.equal(write.url, 'projects/12/runs'); assert.deepEqual(JSON.parse(JSON.stringify(write.body)), { name: 'New QA retest', environment: null, buildVersion: null, testCaseIds: [20] });
  await ui.respond(write, { id: 45 }); const created = run(['NOT_RUN']); created.run.id = 45; await ui.respond(ui.calls.at(-1), created);
  assert.ok(ui.find('#execution-context', 'Back to defect and link the retest PASS'));
  assert.equal(ui.nav.read().defectId, '9'); assert.equal(ui.nav.read().failureAttemptId, '60');
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 1, 'Only the new run was created; the original completed run stays untouched');
});

test('changed semantics and equal-title changed steps cannot silently create incompatible retest closure evidence', async () => {
  for (const field of ['title', 'steps']) {
    const ui = browser(), changed = retestSource();
    if (field === 'title') changed.testCase.title = 'Modified login'; else changed.steps[0].expectedResult = 'Different result';
    await retestForm(ui, changed);
    assert.equal(ui.$('#execution-save').prop('disabled'), true); assert.match(ui.$('#execution-form-error').text(), /differs from the original frozen failure/);
    assert.equal(ui.calls.every(call => call.method === 'GET'), true);
  }
  const ui = browser(); await retestForm(ui); ui.$('#execution-name').val('Keep my draft'); await ui.submit('execution-form');
  const changed = retestSource(); changed.steps[0].action = 'New action'; await sourceReads(ui, changed);
  assert.equal(ui.$('#execution-name').val(), 'Keep my draft'); assert.equal(ui.$('#execution-save').prop('disabled'), true); assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

const retestIdentity = { sourceTestCaseId: '20', defectId: '9', failureAttemptId: '6' };
function expectRetestIdentity(context) {
  for (const [key, value] of Object.entries(retestIdentity)) assert.equal(context[key], value, key + ' must follow the retest workflow');
}
function routeFromHref(href) { const url = new URL(href); return { view: url.hash.slice(1), ...Object.fromEntries(url.searchParams) }; }
async function respondRunCase(ui, current, history = []) {
  await flush();
  await ui.respond(ui.calls.at(-1), current); await ui.respond(ui.calls.at(-1), history);
}

test('Continue execution and snapshot selection preserve retest identity in native hrefs, refresh and new-tab case recovery', async () => {
  const current = run(['NOT_RUN', 'NOT_RUN']), ui = browser(); await ui.open('runs', { runId: '40', ...retestIdentity }); await ui.respond(ui.calls.at(-1), current);
  const continued = ui.find('#execution-actions', 'Continue execution'); const continuation = routeFromHref(continued.attributes.href);
  expectRetestIdentity(continuation); assert.equal(continuation.runCaseId, '50');
  const selected = ui.find('#execution-items', 'View snapshot and attempts'); expectRetestIdentity(routeFromHref(selected.attributes.href));
  assert.equal(await ui.click(continued, { ctrlKey: true }), false, 'New-tab gestures retain native navigation');
  for (const nativeHref of [continued.attributes.href, selected.attributes.href]) {
    const restored = browser({ initialRoute: routeFromHref(nativeHref) }); await respondRunCase(restored, current);
    expectRetestIdentity(restored.nav.read());
    const back = restored.find('#execution-case-navigation', 'Back to defect and link the retest PASS'); assert.ok(back, 'Restored case must expose its target Defect');
    assert.equal(routeFromHref(back.attributes.href).defectId, '9');
  }
  await ui.click(continued); await respondRunCase(ui, current); expectRetestIdentity(ui.nav.read());
  assert.ok(ui.find('#execution-case-navigation', 'Back to defect and link the retest PASS'));
  const adjacent = ui.find('#execution-case-navigation', 'Next case'); expectRetestIdentity(routeFromHref(adjacent.attributes.href));
  await ui.click(adjacent); await respondRunCase(ui, current); expectRetestIdentity(ui.nav.read()); assert.equal(ui.nav.read().runCaseId, '51');
  const previous = ui.find('#execution-case-navigation', 'Previous case'); expectRetestIdentity(routeFromHref(previous.attributes.href));
  await ui.click(previous); await respondRunCase(ui, current); expectRetestIdentity(ui.nav.read());
  await ui.click(ui.$('#execution-case-back')[0]); await ui.respond(ui.calls.at(-1), current); expectRetestIdentity(ui.nav.read());
  assert.equal(ui.nav.read().runCaseId, null); assert.ok(ui.find('#execution-context', 'Back to defect and link the retest PASS'));
  assert.equal(ui.calls.every(call => call.method === 'GET'), true, 'Navigation and restoration must not produce execution facts');
});

test('recorded PASS and record-and-next retain the original FAIL independently of the newly viewed attempt', async () => {
  for (const advance of [false, true]) {
    const current = run(['NOT_RUN', 'NOT_RUN']), ui = browser(); await ui.open('runs', { runId: '40', runCaseId: '50', ...retestIdentity }); await respondRunCase(ui, current);
    ui.$('#execution-outcome').val('PASS'); ui.$('#execution-comment').val('Actual retest succeeded');
    await ui.submit('execution-attempt-form', advance ? ui.$('#execution-record-next')[0] : undefined); const write = ui.calls.at(-1);
    const saved = attempt(81, 'PASS', write.body.submissionKey, 1); await ui.respond(write, saved);
    const latest = run(['PASS', 'NOT_RUN']); latest.cases[0].latestAttempt = saved;
    await respondRunCase(ui, latest, advance ? [] : [saved]); expectRetestIdentity(ui.nav.read());
    assert.equal(ui.nav.read().failureAttemptId, '6'); assert.notEqual(ui.nav.read().failureAttemptId, String(saved.id));
    assert.equal(ui.nav.read().runCaseId, advance ? '51' : '50');
    if (!advance) assert.equal(ui.nav.read().attemptId, '81');
    assert.ok(ui.find('#execution-case-navigation', 'Back to defect and link the retest PASS'));
    assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1, 'Context restoration cannot append a duplicate attempt');
  }
});

test('plain Run navigation stays free of unrelated defect context', async () => {
  const ui = browser(); await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(['NOT_RUN']));
  const plain = routeFromHref(ui.find('#execution-actions', 'Continue execution').attributes.href);
  for (const key of Object.keys(retestIdentity)) assert.equal(key in plain, false);
});

const member = (id, status = 'READY', title = 'Case ' + id) => ({ id, keyNo: id, title, status });
function preparedPlan(ids = [20], status = 'DRAFT', version = 3) { return { plan: { id: 31, keyNo: 1, name: 'Core checks', description: 'Scope', status, version }, testCaseIds: ids }; }
async function loadPlan(ui, current = preparedPlan(), cases = [member(20), member(21)]) {
  await ui.open('test-plans', { planId: '31' }); await ui.respond(ui.calls.at(-1), current); await ui.respond(ui.calls.at(-1), cases);
}
test('R2 READY is a saved plan state, not proof that later changed members are executable', async () => {
  const ui = browser(); await loadPlan(ui, preparedPlan([20, 21], 'READY'), [member(20), member(21, 'DRAFT', 'Edited checkout')]);
  assert.match(ui.textOf(ui.$('#execution-progress')[0]), /Saved plan status: READY/);
  assert.match(ui.textOf(ui.$('#execution-progress')[0]), /currently blocked/);
  assert.match(ui.find('#execution-progress', 'TC-021 · Edited checkout').attributes.href, /testCaseId=21/);
  assert.equal(ui.find('#execution-actions', 'Create run from this plan'), undefined);
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0, 'A status drift does not rewrite plan state');
});
test('R2 plan has an explicit readiness CTA and rechecks all members before a legal versioned PUT', async () => {
  const ui = browser(); await loadPlan(ui);
  assert.equal(ui.$('#execution-plan-ready').prop('disabled'), false); await ui.click(ui.$('#execution-plan-ready')[0]);
  await ui.respond(ui.calls.at(-1), preparedPlan([20], 'DRAFT', 8)); await ui.respond(ui.calls.at(-1), [member(20)]);
  const put = ui.calls.at(-1); assert.equal(put.method, 'PUT'); assert.equal(put.body.expectedVersion, 8); assert.equal(put.body.status, 'READY');
  await ui.respond(put, { id: 31 }); await ui.respond(ui.calls.at(-1), preparedPlan([20], 'READY', 9));
  await ui.respond(ui.calls.at(-1), preparedPlan([20], 'READY', 9)); await ui.respond(ui.calls.at(-1), [member(20)]);
  assert.ok(ui.find('#execution-actions', 'Create run from this plan'));
});
test('R2 member drift at readiness submission blocks PUT and retains the actual saved plan state', async () => {
  const ui = browser(); await loadPlan(ui); await ui.click(ui.$('#execution-plan-ready')[0]);
  await ui.respond(ui.calls.at(-1), preparedPlan()); await ui.respond(ui.calls.at(-1), [member(20, 'DRAFT')]);
  assert.equal(ui.calls.some(call => call.method === 'PUT'), false); assert.match(ui.$('#execution-notice').text(), /plan or its cases changed/);
});
test('R2 searched multi-selection uses fresh version per addition and confirms each scope before sending the next', async () => {
  const ui = browser(); await loadPlan(ui, preparedPlan([], 'DRAFT', 2), [member(20), member(21), member(22, 'DRAFT')]);
  for (const id of [20, 21, 22]) assert.equal(ui.$('#execution-add-case-' + id).prop('checked'), false);
  ui.$('#execution-plan-case-search').val('case 21').trigger('input');
  assert.equal(ui.$('#execution-add-case-20')[0].parent.classes.has('d-none'), true);
  ui.$('#execution-add-case-20').prop('checked', true); ui.$('#execution-add-case-21').prop('checked', true);
  await ui.click(ui.$('#execution-add-selected')[0]); await ui.respond(ui.calls.at(-1), preparedPlan([], 'DRAFT', 7));
  const first = ui.calls.at(-1); assert.equal(first.url, 'projects/12/test-plans/31/test-cases/20'); assert.equal(first.body.expectedVersion, 7);
  await ui.respond(first, {}); assert.equal(ui.calls.at(-1).method, 'GET'); await ui.respond(ui.calls.at(-1), preparedPlan([20], 'DRAFT', 8));
  assert.equal(ui.calls.at(-1).method, 'GET', 'The second item obtains another fresh scope'); await ui.respond(ui.calls.at(-1), preparedPlan([20], 'DRAFT', 9));
  const second = ui.calls.at(-1); assert.equal(second.url, 'projects/12/test-plans/31/test-cases/21'); assert.equal(second.body.expectedVersion, 9);
  await ui.respond(second, {}); await ui.respond(ui.calls.at(-1), preparedPlan([20, 21], 'DRAFT', 10));
  await ui.respond(ui.calls.at(-1), preparedPlan([20, 21], 'DRAFT', 10)); await ui.respond(ui.calls.at(-1), [member(20), member(21), member(22, 'DRAFT')]);
  assert.match(ui.$('#execution-notice').text(), /2 selected case\(s\) are confirmed/); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 2);
});
test('R2 unknown member addition stops the batch, reconciles by GET and does not replay after revisiting', async () => {
  const ui = browser(); await loadPlan(ui, preparedPlan([]));
  ui.$('#execution-add-case-20').prop('checked', true); ui.$('#execution-add-case-21').prop('checked', true);
  await ui.click(ui.$('#execution-add-selected')[0]); await ui.respond(ui.calls.at(-1), preparedPlan([], 'DRAFT', 4));
  const write = ui.calls.at(-1); write.reject({ status: 0, message: 'Response lost' }); await flush();
  assert.equal(ui.calls.at(-1).method, 'GET'); await ui.respond(ui.calls.at(-1), preparedPlan([], 'DRAFT', 4));
  await ui.respond(ui.calls.at(-1), preparedPlan([], 'DRAFT', 4)); await ui.respond(ui.calls.at(-1), [member(20), member(21)]);
  assert.match(ui.$('#execution-notice').text(), /Stopped after 0 confirmed/); assert.match(ui.textOf(ui.$('#execution-actions')[0]), /unconfirmed result/);
  await loadPlan(ui, preparedPlan([])); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  assert.match(ui.textOf(ui.$('#execution-actions')[0]), /will not resend/);
});
test('R2 context is fail closed, read-only roles do not receive write controls and force-check blocks identity changes', async () => {
  const unavailable = browser({ contextFailure: true }); await unavailable.open('runs', { action: 'create' });
  assert.equal(unavailable.calls.length, 0); assert.equal(unavailable.$('#execution-save').prop('disabled'), true);
  const readonly = browser({ context: { canWriteAssets: false, projectRole: 'DEVELOPER' } }); await loadPlan(readonly);
  assert.equal(readonly.find('#execution-actions', 'Edit plan'), undefined); assert.match(readonly.textOf(readonly.$('#execution-actions')[0]), /ADMIN or active TESTER/);
  const ui = browser(); await loadCase(ui); ui.context({ actorId: 99 }); await ui.submit();
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0); assert.match(ui.$('#execution-attempt-error').text(), /identity changed/);
});
test('R2 result recording starts unselected and rejects every value outside the authoritative outcome enum', async () => {
  const ui = browser(); await ui.open('runs', { runId: '40', runCaseId: '50' }); await respondRunCase(ui, run());
  assert.equal(ui.$('#execution-outcome').val(), ''); await ui.submit(); assert.match(ui.$('#execution-attempt-error').text(), /Choose the actual outcome/);
  ui.$('#execution-outcome').val('NOT_RUN'); await ui.submit(); assert.equal(ui.calls.some(call => call.method === 'POST'), false);
  ui.$('#execution-outcome').val('BLOCKED'); await ui.submit(); assert.equal(ui.calls.at(-1).body.outcome, 'BLOCKED');
});

test('attempt controls stay disabled until snapshot and history finish loading, including after reauthentication', async () => {
  const ui = browser();
  for (const id of ['execution-outcome', 'execution-comment', 'execution-duration', 'execution-failure', 'execution-submit'])
    assert.equal(ui.$('#' + id).prop('disabled'), true, id + ' starts disabled');
  await ui.open('runs', { runId: '40', runCaseId: '50' });
  await ui.respond(ui.calls.at(-1), run(['NOT_RUN']));
  const history = ui.calls.at(-1);
  assert.match(history.url, /\/cases\/50\/attempts$/);
  assert.equal(ui.$('#execution-attempt-form').hasClass('d-none'), true);
  ui.emit('veriqra:reauthenticated', { user: { id: 5 } }); await flush();
  assert.equal(ui.$('#execution-outcome').prop('disabled'), true);
  assert.equal(ui.$('#execution-comment').prop('disabled'), true);
  assert.equal(ui.$('#execution-submit').prop('disabled'), true);
  ui.$('#execution-outcome').val('BLOCKED'); ui.$('#execution-comment').val('Too early'); await ui.submit();
  assert.equal(ui.calls.some(call => call.method === 'POST'), false);
  await ui.respond(history, []);
  assert.equal(ui.$('#execution-attempt-form').hasClass('d-none'), false);
  assert.equal(ui.$('#execution-outcome').prop('disabled'), false);
  assert.equal(ui.$('#execution-comment').prop('disabled'), false);
  assert.equal(ui.$('#execution-outcome').val(), '');
  ui.$('#execution-outcome').val('BLOCKED'); ui.$('#execution-comment').val('Selected after load'); await flush(); await ui.submit();
  assert.equal(ui.calls.at(-1).method, 'POST');
  assert.equal(ui.calls.at(-1).body.outcome, 'BLOCKED');
  assert.equal(ui.calls.at(-1).body.comment, 'Selected after load');
});
test('R2 run list filters current NOT_RUN cases without rewriting snapshots or attempting requests', async () => {
  const ui = browser(); await ui.open('runs', { runId: '40' }); await ui.respond(ui.calls.at(-1), run(['NOT_RUN', 'FAIL', 'PASS']));
  const filter = ui.$('#execution-items')[0].children[0]; filter.value = 'NOT_RUN'; ui.$(filter).trigger('change');
  const rows = ui.$('#execution-items')[0].children.slice(1); assert.equal(rows[0].classes.has('d-none'), false); assert.equal(rows[1].classes.has('d-none'), true); assert.equal(rows[2].classes.has('d-none'), true);
  assert.equal(ui.calls.filter(call => call.method !== 'GET').length, 0);
});
test('R2 unsubmitted attempt draft remains scoped to case and actor, survives navigation and safe reauthentication', async () => {
  const ui = browser(); await loadCase(ui); ui.$('#execution-comment').val('Unsaved long result'); ui.$('#execution-outcome').val('FAIL');
  assert.equal(ui.guards.get('execution').dirty(), true); await loadCase(ui, '51'); assert.equal(ui.$('#execution-comment').val(), '');
  await loadCase(ui); assert.equal(ui.$('#execution-comment').val(), 'Unsaved long result'); assert.equal(ui.$('#execution-outcome').val(), 'FAIL');
  ui.emit('veriqra:reauthenticated', { user: { id: 5 } }); await flush(); assert.equal(ui.$('#execution-comment').val(), 'Unsaved long result'); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 0);
  ui.context({ actorId: 99 }); await loadCase(ui, '51'); await loadCase(ui); assert.equal(ui.$('#execution-comment').val(), '');
});
test('R2 uncertain non-idempotent create preserves input and locks automatic resubmission across revisits', async () => {
  const ui = browser(); await ui.open('test-plans', { action: 'create' }); await ui.respond(ui.calls.at(-1), [member(20)]);
  ui.$('#execution-name').val('My uncertain plan'); await ui.submit('execution-form'); const write = ui.calls.at(-1); assert.equal(write.method, 'POST');
  write.reject({ status: 0, message: 'No response' }); await flush(); assert.equal(ui.$('#execution-name').val(), 'My uncertain plan'); assert.equal(ui.$('#execution-save').prop('disabled'), true);
  assert.match(ui.$('#execution-form-error').text(), /no confirmed result/); await ui.submit('execution-form'); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  await ui.open('runs', {}); await ui.open('test-plans', { action: 'create' }); await ui.respond(ui.calls.at(-1), [member(20)]);
  assert.equal(ui.$('#execution-name').val(), 'My uncertain plan'); assert.equal(ui.$('#execution-save').prop('disabled'), true);
});
test('R2 conflict recovery shows the saved version, requires acknowledgement and retains every typed field', async () => {
  const ui = browser(); await loadPlan(ui); await ui.click(ui.find('#execution-actions', 'Edit plan'));
  ui.$('#execution-name').val('My revised scope'); ui.$('#execution-description').val('Long draft survives conflict'); ui.$('#execution-status').val('DRAFT');
  await ui.submit('execution-form'); const write = ui.calls.at(-1); assert.equal(write.body.expectedVersion, 3); write.reject({ status: 409, message: 'Version changed' }); await flush();
  assert.equal(ui.$('#execution-description').val(), 'Long draft survives conflict');
  await ui.click(ui.find('#execution-form-context', 'Review latest saved version; keep my draft'));
  const latest = preparedPlan([20], 'DRAFT', 8); latest.plan.name = 'Other editor scope'; await ui.respond(ui.calls.at(-1), latest);
  assert.match(ui.textOf(ui.$('#execution-form-context')[0]), /Saved version 8: Other editor scope/);
  assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 1);
  await ui.click(ui.find('#execution-form-context', 'I reviewed this version; keep my inputs for a new save'));
  assert.equal(ui.$('#execution-name').val(), 'My revised scope'); await ui.submit('execution-form');
  assert.equal(ui.calls.at(-1).body.expectedVersion, 8); assert.equal(ui.calls.at(-1).body.description, 'Long draft survives conflict');
});
test('R2 a case becoming DRAFT between preview and run submit blocks the POST while retaining the typed run', async () => {
  const ui = browser(); await ui.open('runs', { action: 'create', sourcePlanId: '31' }); await ui.respond(ui.calls.at(-1), [member(20)]);
  await ui.respond(ui.calls.at(-1), [preparedPlan([20], 'READY').plan]); await ui.respond(ui.calls.at(-1), preparedPlan([20], 'READY')); await ui.respond(ui.calls.at(-1), [member(20)]);
  ui.$('#execution-name').val('Specific run name'); ui.$('#execution-environment').val('QA sandbox'); await ui.submit('execution-form');
  await ui.respond(ui.calls.at(-1), preparedPlan([20], 'READY')); await ui.respond(ui.calls.at(-1), [member(20, 'DRAFT')]);
  assert.equal(ui.calls.some(call => call.method === 'POST'), false); assert.equal(ui.$('#execution-name').val(), 'Specific run name');
  assert.equal(ui.$('#execution-environment').val(), 'QA sandbox'); assert.equal(ui.$('#execution-save').prop('disabled'), true);
  assert.match(ui.textOf(ui.$('#execution-plan-preview')[0]), /DRAFT.*review this case/);
});
test('R2 a rejected second addition reports the confirmed partial scope and never sends the third selection', async () => {
  const ui = browser(); await loadPlan(ui, preparedPlan([]), [member(20), member(21), member(22)]);
  [20, 21, 22].forEach(id => ui.$('#execution-add-case-' + id).prop('checked', true)); await ui.click(ui.$('#execution-add-selected')[0]);
  await ui.respond(ui.calls.at(-1), preparedPlan([], 'DRAFT', 3)); await ui.respond(ui.calls.at(-1), {}); await ui.respond(ui.calls.at(-1), preparedPlan([20], 'DRAFT', 4));
  await ui.respond(ui.calls.at(-1), preparedPlan([20], 'DRAFT', 4)); ui.calls.at(-1).reject({ status: 409, message: 'Changed by another editor' }); await flush();
  await ui.respond(ui.calls.at(-1), preparedPlan([20], 'DRAFT', 5)); await ui.respond(ui.calls.at(-1), preparedPlan([20], 'DRAFT', 5)); await ui.respond(ui.calls.at(-1), [member(20), member(21), member(22)]);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 2); assert.equal(ui.calls.some(call => call.url.endsWith('/test-cases/22')), false);
  assert.match(ui.$('#execution-notice').text(), /Stopped after 1 confirmed/);
});
