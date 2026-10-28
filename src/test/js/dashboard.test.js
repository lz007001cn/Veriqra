const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/dashboard.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function browser(options = {}) {
  const nodes = new Map(), requests = [], contexts = [], charts = [], navigation = [], events = new Map();
  class Node {
    constructor(tag = 'div', attrs = {}) { this.tag = tag; this.attrs = attrs; this.classes = new Set((attrs.class || '').split(/\s+/)); this.content = ''; this.value = ''; this.children = []; this.handlers = new Map(); this.clientWidth = 360; this.clientHeight = 240; }
  }
  const windowNode = new Node();
  class Collection {
    constructor(items) { this.items = items; this.length = items.length; items.forEach((item, index) => { this[index] = item; }); }
    each(fn) { this.items.forEach((item, index) => fn.call(item, index)); return this; }
    text(value) { if (value === undefined) return this[0]?.content; return this.each(function () { this.content = String(value); this.children = []; }); }
    val(value) { if (value === undefined) return this[0]?.value; return this.each(function () { this.value = String(value); }); }
    empty() { return this.each(function () { this.content = ''; this.children = []; }); }
    append(...children) { return this.each(function () { this.children.push(...children.flatMap(child => child instanceof Collection ? child.items : [child])); }); }
    attr(name, value) { if (value === undefined) return this[0]?.attrs[name]; return this.each(function () { this.attrs[name] = String(value); }); }
    prop(name, value) { if (value === undefined) return this[0]?.[name]; return this.each(function () { this[name] = value; }); }
    addClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.add(name)); }); }
    removeClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.delete(name)); }); }
    hasClass(name) { return this[0]?.classes.has(name); }
    toggleClass(name, enabled) { return enabled ? this.addClass(name) : this.removeClass(name); }
    on(name, callback) { return this.each(function () { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(callback); }); }
  }
  function $(selector) {
    if (selector === window) return new Collection([windowNode]);
    if (selector instanceof Node) return new Collection([selector]);
    if (selector.startsWith('<')) { const attrs = {}; for (const match of selector.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = match[2]; return new Collection([new Node(selector.match(/^<(\w+)/)[1], attrs)]); }
    if (selector.includes(',')) return new Collection(selector.split(',').flatMap(part => $(part.trim()).items));
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return new Collection([nodes.get(selector)]);
  }
  function fire(node, name, fields = {}) { const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields }; (node.handlers.get(name) || []).forEach(callback => callback.call(node, event)); return event; }
  function deferred() {
    const callbacks = { done: [], fail: [] }; let state, result;
    const call = { resolved: false };
    for (const name of ['done', 'fail']) call[name] = callback => { callbacks[name].push(callback); if (state === name) callback(result); return call; };
    call.resolve = value => { call.resolved = true; state = 'done'; result = value; callbacks.done.forEach(callback => callback(value)); };
    call.reject = value => { call.resolved = true; state = 'fail'; result = value; callbacks.fail.forEach(callback => callback(value)); };
    call.then = (resolve, reject) => new Promise((ok, fail) => { call.done(ok); call.fail(fail); }).then(resolve, reject);
    return call;
  }
  const api = { get(url) { const call = deferred(); requests.push({ url, ...call }); return call; } };
  const origin = options.origin || 'http://localhost:18033/veriqra/';
  const window = {
    VeriqraApi: api,
    I18n: { t(key, args, fallback) { return (fallback || key).replace(/\{(\w+)\}/g, (_, name) => args?.[name] ?? ''); }, formatNumber: String, enumLabel: String },
    VeriqraQaContext: { load(projectId) { const call = deferred(); contexts.push({ projectId, ...call }); return call; } },
    VeriqraQaNavigation: {
      href(view, context) { const target = new URL('index.html', origin); Object.entries(context).filter(([, value]) => value != null).forEach(([key, value]) => target.searchParams.set(key, value)); target.hash = view; return target.href; },
      open(view, context) { navigation.push({ view, context: plain(context) }); }
    },
    getComputedStyle() { return { getPropertyValue() { return ''; } }; },
    matchMedia(query) { return { matches: !!options.reducedMotion, addEventListener(name, callback) { events.set(query + ':' + name, callback); } }; }
  };
  if (options.echarts !== false) window.echarts = { init(element) { const chart = { element, settings: [], resizeCount: 0, disposed: false, setOption(value) { this.settings.push(value); }, resize() { this.resizeCount++; }, dispose() { this.disposed = true; } }; charts.push(chart); return chart; } };
  const document = { documentElement: {} };
  vm.runInNewContext(source, { window, jQuery: $, document });
  function context(projectId) { return { projectId: Number(projectId), actorId: 1, projectStatus: 'ACTIVE', canWriteAssets: true }; }
  function load(projectId = '7', isCurrent = () => true) { window.VeriqraDashboard.load({ projectId, isCurrent }); contexts.at(-1).resolve(context(projectId)); }
  async function lists(data, projectId = '7') { ['requirements', 'test-cases', 'test-plans', 'runs', 'defects'].forEach((area, index) => requests.findLast(call => call.url === 'projects/' + projectId + '/' + area).resolve(data[index] || [])); await flush(); }
  return { $, requests, contexts, charts, navigation, events, load, lists, dashboard: window.VeriqraDashboard,
    request: url => requests.findLast(call => call.url === url),
    click: (node, fields) => fire(node, 'click', fields),
    choose(id) { $('#dashboard-run-select').val(id); fire($('#dashboard-run-select')[0], 'change'); },
    resize() { fire(windowNode, 'resize'); } };
}
const run = (id, status = 'IN_PROGRESS', createdAt = '') => ({ id, name: 'Regression ' + id, status, createdAt });
const runCase = (id, outcome) => ({ runCaseId: id + 100, testCaseId: id, snapshotTitle: 'Case ' + id, currentOutcome: outcome,
  latestAttempt: outcome === 'NOT_RUN' ? null : { id: id + 200, outcome, comment: 'Recorded ' + id, failureMessage: outcome === 'FAIL' ? 'Actual failure ' + id : null } });
const rows = (runs = [], requirements = [], defects = [], cases = []) => [requirements, cases, [], runs, defects];
function descendants(node) { return [node, ...node.children.flatMap(child => child instanceof Object && child.children ? descendants(child) : [])]; }
function links(ui, id = '#dashboard-attention-list') { return descendants(ui.$(id)[0]).filter(node => node.tag === 'a'); }
function latestChart(ui) { return ui.charts.at(-1).settings.at(-1); }

test('four cards use real run outcomes, active confirmed coverage and project open defects', async () => {
  const ui = browser(); ui.load();
  await ui.lists(rows([run(40)], [{ id: 1, status: 'ACTIVE' }, { id: 2, status: 'ACTIVE' }, { id: 3, status: 'DRAFT' }, { id: 4, status: 'ARCHIVED' }],
    [{ id: 31, status: 'OPEN' }, { id: 32, status: 'RESOLVED' }, { id: 33, status: 'CLOSED' }], [{ id: 1, keyNo: 8, status: 'READY' }]));
  ui.request('projects/7/requirements/coverage').resolve([{ requirementId: 1, confirmedCaseCount: 2 }, { requirementId: 2, confirmedCaseCount: 0 }, { requirementId: 3, confirmedCaseCount: 0 }, { requirementId: 4, confirmedCaseCount: 0 }]);
  ui.request('projects/7/runs/40').resolve({ run: run(40), cases: ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT_RUN'].map((outcome, index) => runCase(index + 1, outcome)) }); await flush();
  assert.equal(ui.$('#dashboard-progress-count').text(), '4/5');
  assert.equal(ui.$('#dashboard-attention-count').text(), '2');
  assert.equal(ui.$('#dashboard-attention-detail').text(), 'FAIL 1 · BLOCKED 1');
  assert.equal(ui.$('#dashboard-defects-count').text(), '2');
  assert.equal(ui.$('#dashboard-defects-detail').text(), '1 resolved, awaiting retest');
  assert.equal(ui.$('#dashboard-coverage-count').text(), '1/2');
  assert.equal(ui.$('#dashboard-requirements-count').text(), '4');
  assert.equal(ui.$('#dashboard-cases-count').text(), '1');
  const chart = latestChart(ui);
  assert.equal(chart.graphic[0].children[0].style.text, '80%', 'The chart reports recorded/total, rather than PASS/total');
  assert.deepEqual(plain(chart.series[0].data.map(row => row.value)), [1, 1, 1, 1, 1]);
  assert.equal(chart.tooltip.renderMode, 'richText');
  assert.match(ui.$('#dashboard-results-chart').attr('aria-label'), /results recorded 4\/5/);
  assert.equal(links(ui).length, 2);
  const target = new URL(links(ui)[0].attrs.href);
  assert.equal(target.hash, '#runs'); assert.equal(target.searchParams.get('runCaseId'), '102'); assert.equal(target.searchParams.get('attemptId'), '202');
  assert.equal(ui.requests.some(call => /requirements\/\d+\/test-cases/.test(call.url)), false, 'Coverage uses one aggregate read');
});

test('defaults to latest in-progress run and lets completed runs remain selectable', async () => {
  const ui = browser(); ui.load();
  await ui.lists(rows([run(40, 'IN_PROGRESS', '2026-10-20'), run(41, 'IN_PROGRESS', '2026-10-24'), run(42, 'COMPLETED', '2026-10-25')]));
  assert.equal(ui.$('#dashboard-run-select').val(), '41');
  assert.equal(ui.$('#dashboard-run-select')[0].children.length, 3);
  ui.choose('42'); ui.request('projects/7/runs/42').resolve({ run: run(42, 'COMPLETED'), cases: [runCase(1, 'PASS')] }); await flush();
  assert.equal(ui.$('#dashboard-progress-count').text(), '1/1');
  ui.load(); await ui.lists(rows([run(40), run(42, 'COMPLETED')]));
  assert.equal(ui.$('#dashboard-run-select').val(), '42', 'Refresh retains the explicit selection for this project');
});

test('continue recommendation follows the selected in-progress run instead of the oldest one', async () => {
  const ui = browser(); ui.load();
  await ui.lists(rows([run(40, 'IN_PROGRESS', '2026-10-20'), run(41, 'IN_PROGRESS', '2026-10-24')]));
  let action = links(ui, '#qa-next-step')[0];
  assert.equal(new URL(action.attrs.href).searchParams.get('runId'), '41');
  ui.click(action);
  assert.deepEqual(ui.navigation.at(-1), { view: 'runs', context: { projectId: '7', runId: 41 } });
  ui.choose('40');
  action = links(ui, '#qa-next-step')[0];
  assert.equal(new URL(action.attrs.href).searchParams.get('runId'), '40');
  ui.click(action);
  assert.deepEqual(ui.navigation.at(-1), { view: 'runs', context: { projectId: '7', runId: 40 } });
});

test('completed and cancelled selections use the workflow next step without redirecting to another active run', async () => {
  const ui = browser(); ui.load();
  await ui.lists([[{ id: 1, status: 'ACTIVE' }], [{ id: 2, status: 'READY' }], [{ id: 3, status: 'READY' }],
    [run(40), run(41, 'COMPLETED'), run(42, 'CANCELLED')], []]);
  for (const id of ['41', '42']) {
    ui.choose(id);
    const action = links(ui, '#qa-next-step')[0];
    assert.equal(action.content, 'r2.checkPlan');
    const target = new URL(action.attrs.href);
    assert.equal(target.hash, '#test-plans');
    assert.equal(target.searchParams.get('planId'), '3');
    assert.equal(target.searchParams.has('runId'), false);
  }
});

test('switching runs ignores late results and errors from an older selection', async () => {
  const ui = browser(); ui.load(); await ui.lists(rows([run(40), run(41)]));
  const old = ui.request('projects/7/runs/41');
  ui.choose('40'); const middle = ui.request('projects/7/runs/40');
  ui.choose('41'); ui.request('projects/7/runs/41').resolve({ run: run(41), cases: [runCase(1, 'PASS')] }); await flush();
  middle.reject({ status: 503 }); old.resolve({ run: run(41), cases: [runCase(2, 'FAIL')] }); await flush();
  assert.equal(ui.$('#dashboard-progress-count').text(), '1/1'); assert.equal(ui.$('#dashboard-attention-count').text(), '0');
  assert.equal(ui.$('#dashboard-summary-status').text(), '');
});

test('coverage failure, missing rows and invalid counts never become an inferred zero', async () => {
  for (const response of [null, [], [{ requirementId: 1, confirmedCaseCount: -1 }], [{ requirementId: 1, confirmedCaseCount: 0 }, { requirementId: 1, confirmedCaseCount: 1 }]]) {
    const ui = browser(); ui.load(); await ui.lists(rows([], [{ id: 1, status: 'ACTIVE' }], [{ id: 31, status: 'OPEN' }], [{ id: 20, status: 'READY' }]));
    if (response === null) ui.request('projects/7/requirements/coverage').reject({ status: 503 }); else ui.request('projects/7/requirements/coverage').resolve(response);
    await flush();
    assert.equal(ui.$('#dashboard-coverage-count').text(), '—');
    assert.equal(ui.$('#dashboard-cases-count').text(), '1'); assert.equal(ui.$('#dashboard-defects-count').text(), '1');
    assert.equal(ui.$('#dashboard-summary-retry').hasClass('d-none'), false);
    assert.equal(ui.$('#dashboard-summary-status').hasClass('d-none'), false);
    assert.match(ui.$('#dashboard-summary-status').text(), /coverage could not be loaded/);
  }
});

test('empty project and zero active requirements have explicit empty states without misleading ratios', async () => {
  const ui = browser(); ui.load(); await ui.lists(rows([], [{ id: 1, status: 'DRAFT' }, { id: 2, status: 'ARCHIVED' }]));
  assert.equal(ui.$('#dashboard-progress-count').text(), '—'); assert.equal(ui.$('#dashboard-attention-count').text(), '—');
  assert.equal(ui.$('#dashboard-coverage-count').text(), '—'); assert.equal(ui.$('#dashboard-coverage-detail').text(), 'No active requirements.');
  assert.equal(ui.$('#dashboard-run-select').prop('disabled'), true); assert.equal(ui.$('#dashboard-run-label').text(), 'No test runs yet.');
  assert.equal(ui.requests.length, 5); assert.equal(ui.charts.length, 0);
});

test('a run with no cases renders no percentage and cannot produce NaN', async () => {
  const ui = browser(); ui.load(); await ui.lists(rows([run(40)]));
  ui.request('projects/7/runs/40').resolve({ run: run(40), cases: [] }); await flush();
  assert.equal(ui.$('#dashboard-progress-count').text(), '—'); assert.equal(ui.$('#dashboard-progress-detail').text(), 'No cases in this run.');
  assert.equal(latestChart(ui).graphic[0].children[0].style.text, '—'); assert.equal(latestChart(ui).series[0].stillShowZeroSum, false);
  assert.equal(JSON.stringify(latestChart(ui)).includes('NaN'), false);
});

test('all-PASS run still shows actual project defects and offers genuine defect links', async () => {
  const ui = browser({ origin: 'https://example.org/' }); ui.load();
  await ui.lists(rows([run(40, 'COMPLETED')], [], [{ id: 31, keyNo: 5, title: '<img src=x onerror=alert(1)>', status: 'RESOLVED', resolutionNote: 'Fixed; retest pending' }]));
  ui.request('projects/7/runs/40').resolve({ run: run(40, 'COMPLETED'), cases: [runCase(1, 'PASS')] }); await flush();
  assert.equal(ui.$('#dashboard-attention-count').text(), '0'); assert.equal(ui.$('#dashboard-defects-count').text(), '1');
  assert.equal(ui.$('#dashboard-attention-title').text(), 'Project defects needing attention');
  assert.equal(descendants(ui.$('#dashboard-attention-list')[0]).find(node => node.classes.has('dashboard-issue-title')).content, '<img src=x onerror=alert(1)>');
  const target = new URL(links(ui)[0].attrs.href);
  assert.equal(target.pathname, '/index.html'); assert.equal(target.hash, '#defects'); assert.equal(target.searchParams.get('defectId'), '31');
  assert.equal(ui.click(links(ui)[0], { ctrlKey: true }).defaultPrevented, undefined);
  assert.equal(ui.navigation.length, 0);
  ui.click(links(ui)[0]); assert.deepEqual(ui.navigation[0], { view: 'defects', context: { projectId: '7', defectId: 31 } });
});

test('run read failure retains known project counts and provides retry without zero outcomes', async () => {
  const ui = browser(); ui.load(); await ui.lists(rows([run(40)], [], [{ id: 31, status: 'OPEN' }]));
  ui.request('projects/7/runs/40').reject({ status: 503 }); await flush();
  assert.equal(ui.$('#dashboard-progress-count').text(), '—'); assert.equal(ui.$('#dashboard-attention-count').text(), '—');
  assert.equal(ui.$('#dashboard-defects-count').text(), '1'); assert.equal(ui.$('#dashboard-summary-retry').hasClass('d-none'), false);
  const before = ui.contexts.length; ui.click(ui.$('#dashboard-summary-retry')[0]); assert.equal(ui.contexts.length, before + 1);
  assert.equal(ui.$('#dashboard-defects-count').text(), '—', 'A retry clears the previous snapshot until revalidated');
});

test('base business and capability failures expose no creation recommendation or invented totals', async () => {
  for (const where of ['context', 'list']) {
    const ui = browser();
    if (where === 'context') { ui.dashboard.load({ projectId: '7' }); ui.contexts[0].reject({ status: 403 }); }
    else { ui.load(); ui.requests[0].reject({ status: 503 }); }
    await flush();
    assert.equal(ui.$('#dashboard-requirements-count').text(), '—'); assert.equal(links(ui, '#qa-next-step').length, 0);
    assert.equal(ui.$('#dashboard-summary-retry').hasClass('d-none'), false); assert.match(ui.$('#dashboard-summary-status').text(), /could not be loaded/);
  }
});

test('abandoned project coverage and run responses cannot overwrite the new project', async () => {
  const ui = browser(); ui.load(); await ui.lists(rows([run(40)], [{ id: 1, status: 'ACTIVE' }]));
  const oldCoverage = ui.request('projects/7/requirements/coverage'), oldRun = ui.request('projects/7/runs/40');
  ui.load('8'); await ui.lists(rows([], [{ id: 81, status: 'ACTIVE' }]), '8');
  ui.request('projects/8/requirements/coverage').resolve([{ requirementId: 81, confirmedCaseCount: 0 }]); await flush();
  oldCoverage.resolve([{ requirementId: 1, confirmedCaseCount: 3 }]); oldRun.resolve({ run: run(40), cases: [runCase(1, 'FAIL')] }); await flush();
  assert.equal(ui.$('#dashboard-coverage-count').text(), '0/1'); assert.equal(ui.$('#dashboard-progress-count').text(), '—');
  assert.equal(ui.$('#dashboard-run-label').text(), 'No test runs yet.');
});

test('navigation invalidation discards pending results and chart lifecycle releases instances', async () => {
  const ui = browser({ reducedMotion: true }); let active = true; ui.load('7', () => active); await ui.lists(rows([run(40)]));
  ui.request('projects/7/runs/40').resolve({ run: run(40), cases: [runCase(1, 'PASS')] }); await flush();
  assert.equal(latestChart(ui).animation, false);
  const first = ui.charts[0]; ui.resize(); assert.ok(first.resizeCount > 1);
  active = false; ui.dashboard.deactivate(); assert.equal(first.disposed, true);
  const chartCount = ui.charts.length; ui.resize(); assert.equal(ui.charts.length, chartCount);
});

test('missing ECharts falls back to the same real, accessible outcome counts', async () => {
  const ui = browser({ echarts: false }); ui.load(); await ui.lists(rows([run(40)]));
  ui.request('projects/7/runs/40').resolve({ run: run(40), cases: [runCase(1, 'BLOCKED'), runCase(2, 'NOT_RUN')] }); await flush();
  assert.match(ui.$('#dashboard-results-chart').text(), /BLOCKED 1/); assert.match(ui.$('#dashboard-results-chart').text(), /results recorded 1\/2/);
  assert.equal(ui.$('#dashboard-attention-count').text(), '1');
});

test('unknown run outcomes become unavailable rather than silently becoming not-run', async () => {
  const ui = browser(); ui.load(); await ui.lists(rows([run(40)]));
  ui.request('projects/7/runs/40').resolve({ run: run(40), cases: [runCase(1, 'UNKNOWN')] }); await flush();
  assert.equal(ui.$('#dashboard-progress-count').text(), '—'); assert.equal(ui.$('#dashboard-attention-count').text(), '—');
  assert.equal(ui.charts.length, 0); assert.equal(ui.$('#dashboard-summary-retry').hasClass('d-none'), false);
});
