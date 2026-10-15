const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/app.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function browser(href = 'http://127.0.0.1:9000/veriqra/index.html?projectId=7#dashboard', savedProject = '8') {
  const location = new URL(href), base = new URL('./', location).href;
  const nodes = new Map(), events = [], requests = [], saved = new Map(savedProject ? [['veriqra.selectedProjectId', savedProject]] : []);
  const handlers = new Map();
  class Node {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.classes = new Set((attrs.class || '').split(/\s+/));
      this.value = ''; this.content = ''; this.children = []; this.disabled = false; this.handlers = new Map();
    }
    get hash() { return new URL(this.attrs.href || '', location).hash; }
    reset() {}
    reportValidity() { return true; }
  }
  const windowNode = new Node(), documentNode = new Node();
  const sidebar = ['dashboard', 'requirements', 'test-cases', 'test-plans', 'runs', 'defects', 'automation', 'collaboration']
    .map(view => new Node('a', { href: '#' + view, 'data-view': view }));
  class Collection {
    constructor(items) { this.items = items; this.length = items.length; items.forEach((item, index) => { this[index] = item; }); }
    each(fn) { this.items.forEach((item, index) => fn.call(item, index)); return this; }
    on(names, fn) { return this.each(function () { names.split(' ').forEach(name => { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }); }); }
    text(value) { if (value === undefined) return this.items[0]?.content; return this.each(function () { this.content = String(value); this.children = []; }); }
    val(value) { if (value === undefined) return this.items[0]?.value; return this.each(function () { this.value = String(value); }); }
    empty() { return this.each(function () { this.children = []; this.content = ''; }); }
    append(...children) { return this.each(function () { this.children.push(...children.flatMap(child => child instanceof Collection ? child.items : [child])); }); }
    addClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.add(name)); }); }
    removeClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.delete(name)); }); }
    toggleClass(name, enabled) { if (enabled === undefined) enabled = !this.hasClass(name); return enabled ? this.addClass(name) : this.removeClass(name); }
    hasClass(name) { return this.items[0]?.classes.has(name); }
    attr(name, value) { if (value === undefined) return this.items[0]?.attrs[name]; return this.each(function () { this.attrs[name] = String(value); }); }
    removeAttr(name) { return this.each(function () { delete this.attrs[name]; }); }
    prop(name, value) { if (value === undefined) return this.items[0]?.[name]; return this.each(function () { this[name] = value; }); }
    trigger(name) { this.items.forEach(node => fire(node, name)); return this; }
  }
  function $(selector) {
    if (selector === window) return new Collection([windowNode]);
    if (selector === document) return new Collection([documentNode]);
    if (selector instanceof Node) return new Collection([selector]);
    if (selector.startsWith('<')) {
      const attrs = {};
      for (const match of selector.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
      return new Collection([new Node(selector.match(/^<(\w+)/)[1], attrs)]);
    }
    if (selector.includes(',')) return new Collection(selector.split(',').flatMap(part => $(part.trim()).items));
    if (selector === '[data-view]' || selector === 'a[data-view]') return new Collection(sidebar);
    const active = /^\[data-view="([^"]+)"\]$/.exec(selector);
    if (active) return new Collection(sidebar.filter(node => node.attrs['data-view'] === active[1]));
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return new Collection([nodes.get(selector)]);
  }
  function fire(node, name, fields = {}) {
    const event = { button: 0, preventDefault() { this.defaultPrevented = true; }, ...fields };
    (node.handlers.get(name) || []).forEach(fn => fn.call(node, event)); return event;
  }
  const document = {
    baseURI: base,
    dispatchEvent(event) { events.push(plain(event)); (handlers.get(event.type) || []).forEach(fn => fn(event)); },
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }
  };
  const historyEntries = [location.href]; let historyIndex = 0;
  function traverse(index) {
    const oldURL = location.href;
    location.href = historyEntries[index];
    fire(windowNode, 'popstate');
    // Browser traversal between fragments fires hashchange after popstate; push/replaceState do not.
    if (new URL(oldURL).hash !== location.hash) fire(windowNode, 'hashchange', { originalEvent: { oldURL, newURL: location.href } });
  }
  const history = {
    pushState(_, __, target) { const next = new URL(target, location); historyEntries.splice(++historyIndex); historyEntries.push(next.href); location.href = next.href; },
    replaceState(_, __, target) { const next = new URL(target, location); historyEntries[historyIndex] = next.href; location.href = next.href; },
    back() { if (historyIndex > 0) traverse(--historyIndex); },
    forward() { if (historyIndex + 1 < historyEntries.length) traverse(++historyIndex); },
    get length() { return historyEntries.length; }
  };
  function deferred() {
    const callbacks = { done: [], fail: [], always: [] }; let state, result;
    const call = {};
    for (const name of Object.keys(callbacks)) call[name] = fn => {
      callbacks[name].push(fn);
      if (state && (name === 'always' || name === state)) fn(result);
      return call;
    };
    call.resolve = value => { state = 'done'; result = value; callbacks.done.forEach(fn => fn(value)); callbacks.always.forEach(fn => fn(value)); };
    call.reject = failure => { state = 'fail'; result = failure; callbacks.fail.forEach(fn => fn(failure)); callbacks.always.forEach(fn => fn(failure)); };
    return call;
  }
  const api = {};
  for (const method of ['get', 'post']) api[method] = (url, body) => { const call = deferred(); requests.push({ method, url, body, ...call }); return call; };
  const window = { history, VeriqraApi: api, I18n: { init: async () => {}, t: (key, _, fallback) => fallback || key, enumLabel: String } };
  const sessionStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  vm.runInNewContext(source, { window, document, jQuery: $, location, sessionStorage, URL, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  const project = id => ({ id: Number(id), projectKey: 'QA' + id, name: 'Project ' + id, status: 'ACTIVE' });
  async function boot(ids = [7, 8]) {
    fire(windowNode, 'pageshow'); await flush();
    requests[0].resolve({ id: 1, username: 'tester', systemRole: 'USER' });
    requests[1].resolve(ids.map(project));
    if (requests[2]) requests[2].resolve(project(requests[2].url.split('/').pop()));
    await flush();
  }
  return { $, requests, events, location, history, sidebar, saved, project, boot, nav: window.VeriqraQaNavigation,
    click: (node, fields) => fire(node, 'click', fields), changeProject(id) { $('#project-select').val(id); fire($('#project-select')[0], 'change'); },
    fireWindow: (name, fields) => fire(windowNode, name, fields), lastView: () => events.filter(event => event.type === 'veriqra:view').at(-1),
    fireDocument: name => document.dispatchEvent({ type: name }),
    lastProject: () => events.filter(event => event.type === 'veriqra:project').at(-1) };
}

test('deep links verify their project and preserve context in ROOT and nested deployments', async () => {
  for (const base of ['http://127.0.0.1:9000/', 'http://127.0.0.1:9000/veriqra/']) {
    const ui = browser(base + 'index.html?projectId=7&testCaseId=20&sourcePlanId=30&runId=40&runCaseId=50&attemptId=60#test-cases');
    await ui.boot();
    assert.equal(ui.requests[2].url, 'projects/7'); assert.equal(ui.lastProject().detail.project.id, 7);
    assert.deepEqual(plain(ui.nav.read()), { view: 'test-cases', projectId: '7', testCaseId: '20', sourcePlanId: '30', runId: '40', runCaseId: '50', attemptId: '60' });
    const next = new URL(ui.nav.href('runs', { projectId: '7', runId: '40', runCaseId: '50', attemptId: '60' }));
    assert.equal(next.pathname, new URL('index.html', base).pathname); assert.equal(next.hash, '#runs');
    assert.equal(next.searchParams.has('testCaseId'), false); assert.equal(next.searchParams.get('runCaseId'), '50');
  }
});

test('selection replaces URL without an event; open pushes and browser back/forward dispatches current contexts', async () => {
  const ui = browser(); await ui.boot();
  const before = ui.events.length, length = ui.history.length;
  ui.nav.select('requirements', { projectId: '7', requirementId: '10' });
  assert.equal(ui.events.length, before); assert.equal(ui.history.length, length);
  ui.nav.open('test-cases', { projectId: '7', testCaseId: '20', sourceRequirementId: '10' });
  assert.equal(ui.history.length, length + 1); assert.equal(ui.lastView().detail.context.testCaseId, '20');
  ui.nav.open('test-plans', { projectId: '7', planId: '30', sourceTestCaseId: '20' });
  const viewsBeforeBack = ui.events.filter(event => event.type === 'veriqra:view').length;
  ui.history.back(); assert.equal(ui.lastView().detail.context.testCaseId, '20'); assert.equal(ui.lastView().detail.context.sourceRequirementId, '10');
  assert.equal(ui.events.filter(event => event.type === 'veriqra:view').length, viewsBeforeBack + 1,
    'popstate followed by hashchange must load the selected area only once');
  ui.history.back(); assert.equal(ui.lastView().detail.context.requirementId, '10');
  ui.history.forward(); assert.equal(ui.lastView().detail.context.testCaseId, '20');
  assert.equal(ui.requests.length, 3, 'Same-project history movement must not revalidate the project repeatedly.');
});

test('native back traversal during cross-project loading restores original project and ignores abandoned response', async () => {
  const ui = browser(); await ui.boot();
  ui.nav.open('test-cases', { projectId: '8', testCaseId: '20' }); const abandoned = ui.requests.at(-1);
  ui.history.back(); assert.deepEqual(plain(ui.nav.read()), { view: 'dashboard', projectId: '7' });
  const restored = ui.requests.at(-1); assert.equal(restored.url, 'projects/7'); restored.resolve(ui.project(7));
  const count = ui.events.length; abandoned.resolve(ui.project(8));
  assert.equal(ui.events.length, count); assert.equal(ui.lastProject().detail.project.id, 7);
  assert.equal(ui.$('#project-dashboard').hasClass('d-none'), false); assert.equal(ui.nav.read().projectId, '7');
});

test('unavailable linked project never silently falls back to a remembered or first project', async () => {
  const ui = browser('http://127.0.0.1:9000/veriqra/index.html?projectId=99&requirementId=10#requirements', '8');
  await ui.boot(); assert.equal(ui.requests.length, 2);
  assert.equal(ui.lastProject().detail.project, null); assert.equal(ui.$('#project-select').val(), '');
  assert.equal(ui.$('#page-alert').text(), 'qa.projectUnavailable'); assert.equal(ui.nav.read().projectId, '99');
  assert.equal(ui.$('#asset-workspace').hasClass('d-none'), true);
});

test('rapid cross-project navigation ignores older detail responses and only publishes verified latest project', async () => {
  const ui = browser(); await ui.boot([7, 8, 9]);
  ui.nav.open('test-cases', { projectId: '8', testCaseId: '20' });
  ui.nav.open('runs', { projectId: '9', runId: '40', runCaseId: '50' });
  assert.equal(ui.requests[3].url, 'projects/8'); assert.equal(ui.requests[4].url, 'projects/9');
  ui.requests[4].resolve(ui.project(9));
  assert.equal(ui.lastProject().detail.project.id, 9); assert.equal(ui.$('#project-select').prop('disabled'), false);
  const latestEvents = ui.events.length;
  ui.requests[3].resolve(ui.project(8));
  assert.equal(ui.events.length, latestEvents); assert.equal(ui.$('#project-select').val(), '9');
  assert.equal(ui.nav.read().projectId, '9'); assert.equal(ui.nav.read().runCaseId, '50');
  assert.equal(ui.$('#execution-workspace').hasClass('d-none'), false); assert.equal(ui.$('#asset-workspace').hasClass('d-none'), true);
});

test('pending project target survives clean sidebar navigation and announces view before verified project', async () => {
  const ui = browser(); await ui.boot();
  let oldModuleView = 'dashboard', oldModuleProject = '7';
  // A module using the original event contract learns its area from view events and queries only after project events.
  const previousEventCount = ui.events.length;
  ui.nav.open('test-cases', { projectId: '8', testCaseId: '20' });
  const switching = ui.events.slice(previousEventCount);
  for (const event of switching) {
    if (event.type === 'veriqra:project') oldModuleProject = event.detail.project?.id || null;
    if (event.type === 'veriqra:view') oldModuleView = event.detail.view;
  }
  assert.equal(oldModuleProject, null); assert.equal(oldModuleView, 'test-cases');
  assert.equal(ui.lastView().detail.projectId, null); assert.equal(ui.lastView().detail.context.projectId, '8');
  const link = ui.sidebar.find(node => node.attrs['data-view'] === 'automation');
  ui.click(link); assert.deepEqual(plain(ui.nav.read()), { view: 'automation', projectId: '8' });
  assert.equal(ui.requests.at(-1).url, 'projects/8');
  const latest = ui.requests.at(-1); latest.resolve(ui.project(8));
  assert.equal(ui.lastProject().detail.project.id, 8); assert.equal(ui.$('#automation-workspace').hasClass('d-none'), false);
  ui.requests[3].resolve(ui.project(8)); assert.equal(ui.nav.read().view, 'automation');
});

test('unavailable navigation invalidates an in-flight project switch, including its failure callback', async () => {
  const ui = browser(); await ui.boot(); ui.nav.open('test-cases', { projectId: '8', testCaseId: '20' });
  ui.nav.open('requirements', { projectId: '99', requirementId: '10' });
  const count = ui.events.length;
  ui.requests[3].reject({ status: 403, message: 'Denied' });
  assert.equal(ui.events.length, count); assert.equal(ui.requests.length, 4);
  assert.equal(ui.$('#page-alert').text(), 'qa.projectUnavailable'); assert.equal(ui.$('#project-select').val(), '');
});

test('sidebar modified clicks remain native; normal clicks clear prior selection and source fields', async () => {
  const ui = browser('http://127.0.0.1:9000/veriqra/index.html?projectId=7&testCaseId=20&sourceRequirementId=10#test-cases'); await ui.boot();
  const link = ui.sidebar.find(node => node.attrs['data-view'] === 'requirements');
  for (const fields of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const before = ui.location.href, count = ui.events.length; const event = ui.click(link, fields);
    assert.equal(event.defaultPrevented, undefined); assert.equal(ui.location.href, before); assert.equal(ui.events.length, count);
  }
  const event = ui.click(link); assert.equal(event.defaultPrevented, true);
  assert.deepEqual(plain(ui.nav.read()), { view: 'requirements', projectId: '7' });
  assert.equal(ui.lastView().detail.context.requirementId, undefined); assert.equal(link.attrs['aria-current'], 'page');
  assert.equal(ui.sidebar.filter(node => node.classes.has('active')).length, 1);
});

test('sidebar native new-tab destinations do not carry another screen creation intent', async () => {
  const ui = browser('http://127.0.0.1:9000/veriqra/index.html?projectId=7&action=create&sourceRequirementId=10#test-cases');
  await ui.boot();
  const link = ui.sidebar.find(node => node.attrs['data-view'] === 'test-plans');
  const destination = new URL(link.attrs.href);
  assert.equal(destination.searchParams.get('projectId'), '7');
  assert.equal(destination.searchParams.has('action'), false);
  assert.equal(destination.searchParams.has('sourceRequirementId'), false);
  assert.equal(destination.hash, '#test-plans');
  const event = ui.click(link, {ctrlKey: true});
  assert.equal(event.defaultPrevented, undefined);
});

test('project picker removes previous item context and only publishes its verified selected project', async () => {
  const ui = browser('http://127.0.0.1:9000/veriqra/index.html?projectId=7&testCaseId=20&sourcePlanId=30#test-cases'); await ui.boot();
  ui.changeProject('8'); assert.deepEqual(plain(ui.nav.read()), { view: 'test-cases', projectId: '8' });
  assert.equal(ui.lastProject().detail.project, null); assert.equal(ui.requests[3].url, 'projects/8');
  ui.requests[3].resolve(ui.project(8)); assert.equal(ui.lastProject().detail.project.id, 8); assert.equal(ui.saved.get('veriqra.selectedProjectId'), '8');
});

test('generated dashboard links use the verified project in native href and preserve modified clicks', async () => {
  for (const base of ['http://127.0.0.1:9000/', 'http://127.0.0.1:9000/veriqra/']) {
    const ui = browser(base + 'index.html?projectId=7#dashboard'); await ui.boot();
    const links = ui.$('#workflow')[0].children;
    assert.equal(links.length, 7);
    for (const link of links) {
      const target = new URL(link.attrs.href);
      assert.equal(target.pathname, new URL('index.html', base).pathname); assert.equal(target.searchParams.get('projectId'), '7');
      assert.equal(ui.click(link, { ctrlKey: true }).defaultPrevented, undefined);
    }
    const first = links[0]; ui.click(first); assert.deepEqual(plain(ui.nav.read()), { view: 'requirements', projectId: '7' });
    ui.changeProject('8'); ui.requests.at(-1).resolve(ui.project(8));
    for (const link of ui.$('#workflow')[0].children) assert.equal(new URL(link.attrs.href).searchParams.get('projectId'), '8');
  }
});

test('href filters invalid or irrelevant IDs and does not mutate navigation state', async () => {
  const ui = browser(); await ui.boot(); const before = ui.location.href, count = ui.events.length;
  const href = ui.nav.href('runs', { projectId: '7', runId: '40', runCaseId: '50', attemptId: '0', defectId: '90', sourceTestCaseId: '20', failureAttemptId: '60', requirementId: '10', action: 'bogus', sourcePlanId: 'abc' });
  const target = new URL(href);
  assert.deepEqual(Object.fromEntries(target.searchParams), { projectId: '7', runId: '40', runCaseId: '50', sourceTestCaseId: '20', defectId: '90', failureAttemptId: '60' });
  assert.equal(ui.location.href, before); assert.equal(ui.events.length, count);
});

test('terminal-failure retest context survives refresh, new-tab URL and Back/Forward without numeric entry', async () => {
  for (const base of ['http://127.0.0.1:9000/', 'http://127.0.0.1:9000/veriqra/']) {
    const ui = browser(base + 'index.html?projectId=7&defectId=90#defects'); await ui.boot();
    const context = { projectId: '7', action: 'create', sourceTestCaseId: '20', runId: '40', runCaseId: '50', failureAttemptId: '60', defectId: '90' };
    const href = ui.nav.href('runs', context), restored = browser(href); await restored.boot();
    assert.deepEqual(plain(restored.nav.read()), { view: 'runs', ...context });
    ui.nav.open('runs', context); ui.nav.open('defects', { projectId: '7', defectId: '90' });
    ui.history.back(); assert.deepEqual(plain(ui.nav.read()), { view: 'runs', ...context });
    ui.history.forward(); assert.deepEqual(plain(ui.nav.read()), { view: 'defects', projectId: '7', defectId: '90' });
  }
});

test('retest case and newly recorded PASS URLs keep their original FAIL on ROOT and nested refresh/new-tab restoration', async () => {
  for (const base of ['http://127.0.0.1:9000/', 'http://127.0.0.1:9000/veriqra/']) {
    const ui = browser(base + 'index.html?projectId=7&runId=55&sourceTestCaseId=20&defectId=90&failureAttemptId=60#runs'); await ui.boot();
    const context = { projectId: '7', runId: '55', runCaseId: '75', attemptId: '85', sourceTestCaseId: '20', defectId: '90', failureAttemptId: '60' };
    const href = ui.nav.href('runs', context), restored = browser(href); await restored.boot();
    assert.deepEqual(plain(restored.nav.read()), { view: 'runs', ...context });
    assert.notEqual(restored.nav.read().attemptId, restored.nav.read().failureAttemptId);
    ui.nav.open('runs', context); ui.nav.open('defects', { projectId: '7', defectId: '90' }); ui.history.back();
    assert.deepEqual(plain(ui.nav.read()), { view: 'runs', ...context });
  }
});

test('project-list network and server failures end the loading caption and retry only their GET', async () => {
  for (const status of [0, 503]) {
    const ui = browser(); ui.fireWindow('pageshow'); await flush();
    ui.requests[0].resolve({ id: 1, username: 'tester', systemRole: 'USER' });
    assert.equal(ui.$('#project-select')[0].children[0].content, 'Loading projects…');
    ui.requests[1].reject({ status, message: 'Projects unavailable' });
    assert.equal(ui.$('#project-select')[0].children[0].content, 'Projects could not be loaded');
    assert.equal(ui.$('#project-select').prop('disabled'), true);
    assert.equal(ui.$('#app-shell').hasClass('d-none'), false);
    assert.equal(ui.$('#bootstrap-screen').hasClass('d-none'), true);
    const retry = ui.$('#page-alert')[0].children.find(node => node.tag === 'button');
    assert.equal(retry.content, 'Retry'); assert.equal(retry.attrs['data-i18n'], 'common.retry');
    ui.click(retry); ui.click(retry);
    assert.equal(ui.requests.length, 3); assert.equal(ui.requests[2].url, 'projects');
    assert.equal(ui.$('#page-alert').hasClass('d-none'), true);
    assert.equal(ui.$('#project-select')[0].children[0].content, 'Loading projects…');
    ui.requests[2].resolve([ui.project(7)]);
    assert.equal(ui.requests[3].url, 'projects/7');
    assert.equal(ui.$('#project-select').prop('disabled'), true, 'Keep selection locked while its detail GET is pending');
    ui.requests[3].resolve(ui.project(7));
    assert.equal(ui.$('#project-select').prop('disabled'), false);
    assert.equal(ui.lastProject().detail.project.id, 7);
    assert.equal(ui.$('#project-dashboard').hasClass('d-none'), false);
    assert.equal(ui.requests.filter(request => request.url === 'auth/me').length, 1);
    assert.equal(ui.requests.every(request => request.method === 'get'), true);
  }
});

test('failed project detail retry stays scoped to its project and cannot revive the previous workspace on language change', async () => {
  const ui = browser(); await ui.boot(); ui.changeProject('8');
  ui.requests[3].reject({ status: 503, message: 'Project unavailable' });
  assert.equal(ui.$('#project-select').prop('disabled'), false);
  const retry = ui.$('#page-alert')[0].children.find(node => node.tag === 'button');
  ui.fireDocument('veriqra:localechange');
  assert.equal(ui.$('#project-dashboard').hasClass('d-none'), true);
  assert.equal(ui.lastProject().detail.project, null);
  ui.click(retry); ui.click(retry);
  assert.equal(ui.requests.length, 5); assert.equal(ui.requests[4].url, 'projects/8');
  assert.equal(ui.$('#project-select').prop('disabled'), true);
  ui.requests[4].resolve(ui.project(8));
  assert.equal(ui.$('#project-select').prop('disabled'), false);
  assert.equal(ui.lastProject().detail.project.id, 8);
  assert.equal(ui.$('#page-alert').hasClass('d-none'), true);
  assert.equal(ui.$('#page-alert')[0].children.length, 0);
  assert.equal(ui.requests.filter(request => request.url === 'auth/me').length, 1);
  assert.equal(ui.requests.every(request => request.method === 'get'), true);
});

test('membership revalidation keeps the picker locked until its list GET settles and supplies a scoped retry on failure', async () => {
  const ui = browser(); await ui.boot(); ui.changeProject('8');
  ui.requests[3].reject({ status: 403, message: 'Access changed' });
  assert.equal(ui.requests[4].url, 'projects');
  assert.equal(ui.$('#project-select').prop('disabled'), true);
  ui.requests[4].reject({ status: 503, message: 'Projects unavailable' });
  assert.equal(ui.$('#project-select').prop('disabled'), false);
  const retry = ui.$('#page-alert')[0].children.find(node => node.tag === 'button'); ui.click(retry);
  assert.equal(ui.requests.at(-1).url, 'projects');
  assert.equal(ui.requests.filter(request => request.url === 'auth/me').length, 1);
  assert.equal(ui.requests.every(request => request.method === 'get'), true);
});
