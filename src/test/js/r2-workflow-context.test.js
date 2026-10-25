const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const web = path.resolve(__dirname, '../../main/webapp');
const source = name => fs.readFileSync(path.join(web, 'assets/js', name), 'utf8');
const catalogs = Object.fromEntries(['en', 'zh-CN'].map(locale =>
  [locale, JSON.parse(fs.readFileSync(path.join(web, 'i18n', locale + '.json'), 'utf8'))]));
const plain = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let state, value;
  const callbacks = { done: [], fail: [], always: [] };
  const result = {};
  for (const key of Object.keys(callbacks)) result[key] = fn => {
    callbacks[key].push(fn);
    if (state && (state === key || key === 'always')) fn(value);
    return result;
  };
  function settle(next, arg) {
    assert.equal(state, undefined, 'The harness must not settle a request twice');
    state = next; value = arg;
    callbacks[next].forEach(fn => fn(value)); callbacks.always.forEach(fn => fn(value));
  }
  result.resolve = arg => settle('done', arg);
  result.reject = arg => settle('fail', arg);
  result.promise = () => result;
  result.then = (resolve, reject) => new Promise((ok, fail) => {
    result.done(ok); result.fail(fail);
  }).then(resolve, reject);
  return result;
}

function browser({ base = 'https://example.test/veriqra/', href = base + 'index.html?projectId=7#requirements', locale = 'en' } = {}) {
  const nodes = new Map(), requests = [], replacements = [], events = [];
  const documentHandlers = new Map(), windowHandlers = new Map();
  let confirmation = true;
  class Node {
    constructor(tag = 'div', attrs = {}) { this.tag = tag; this.attrs = attrs; this.children = []; this.handlers = new Map(); this.content = ''; this.value = ''; this.classes = new Set((attrs.class || '').split(/\s+/)); }
  }
  class Collection {
    constructor(items) { this.items = items; this.length = items.length; items.forEach((item, index) => { this[index] = item; }); }
    each(fn) { this.items.forEach((item, index) => fn.call(item, index)); return this; }
    empty() { return this.each(function () { this.children = []; this.content = ''; }); }
    text(value) { if (value === undefined) return this.items[0]?.content; return this.each(function () { this.content = String(value); }); }
    val(value) { if (value === undefined) return this.items[0]?.value; return this.each(function () { this.value = value; }); }
    find(name) { const key = 'child:' + name; return new Collection(this.items.map(item => { if (!item[key]) item[key] = new Node(); return item[key]; })); }
    append(child) { return this.each(function () { this.children.push(...(child instanceof Collection ? child.items : [child])); }); }
    prepend(child) { return this.each(function () { this.children.unshift(...child.items); child.items.forEach(node => { if (node.attrs.id) nodes.set('#' + node.attrs.id, node); }); }); }
    removeClass(name) { return this.each(function () { this.classes.delete(name); }); }
    toggleClass(name, enabled) { return this.each(function () { if (enabled) this.classes.add(name); else this.classes.delete(name); }); }
    attr(name, value) { if (value === undefined) return this.items[0]?.attrs[name]; return this.each(function () { this.attrs[name] = String(value); }); }
    prop(name, value) { if (value === undefined) return this.items[0]?.[name]; return this.each(function () { this[name] = value; }); }
    on(name, fn) { return this.each(function () { this.handlers.set(name, fn); }); }
  }
  function $(selector) {
    if (selector instanceof Node) return new Collection([selector]);
    if (selector.startsWith('<')) {
      const attrs = Object.fromEntries([...selector.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      return new Collection([new Node(selector.match(/^<(\w+)/)[1], attrs)]);
    }
    if (selector === '#session-recovery' && !nodes.has(selector)) return new Collection([]);
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return new Collection([nodes.get(selector)]);
  }
  $.Deferred = deferred;
  $.ajax = settings => { const call = deferred(); requests.push({ settings, call }); return call; };
  const t = (key, args, fallback) => (catalogs[locale][key] || fallback || key)
    .replace(/\{(\w+)\}/g, (match, field) => args?.[field] ?? match);
  const location = new URL(href);
  location.replace = target => replacements.push(target);
  const window = {
    location, I18n: { init: async () => {}, t, error: error => error.message, formatRetryDelay: () => null },
    confirm: () => confirmation,
    addEventListener(name, fn) { windowHandlers.set(name, fn); }
  };
  // Access would fail this test instead of silently allowing business drafts to become persistent.
  for (const storage of ['localStorage', 'sessionStorage']) Object.defineProperty(window, storage, { get() { throw new Error('Persistent storage is forbidden in this harness'); } });
  const document = {
    baseURI: base + 'index.html',
    addEventListener(name, fn) { documentHandlers.set(name, fn); },
    dispatchEvent(event) { events.push(event); documentHandlers.get(event.type)?.(event); }
  };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  const context = { window, document, jQuery: $, URL, CustomEvent };
  vm.runInNewContext(source('api.js'), context);
  vm.runInNewContext(source('workflow-context.js'), context);
  const fire = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  return {
    $, requests, replacements, events, window, context, fire,
    api: window.VeriqraApi, qa: window.VeriqraQaContext, guard: window.VeriqraDraftGuard, recovery: window.VeriqraSessionRecovery,
    setConfirm(value) { confirmation = value; },
    async loadLogin() { vm.runInNewContext(source('login.js'), context); await Promise.resolve(); },
    submitLogin() { const form = $('#login-form')[0]; form.handlers.get('submit').call(form, { preventDefault() {} }); },
    unload() { const event = { preventDefault() { this.defaultPrevented = true; } }; windowHandlers.get('beforeunload')(event); return event; },
    clickVerify() { const node = $('#session-recovery')[0].children.find(item => item.tag === 'button'); node.handlers.get('click').call(node); return node; },
    locale(next) { locale = next; fire('veriqra:localechange'); }
  };
}

const actor = overrides => ({ id: 1, username: 'qa', status: 'ACTIVE', systemRole: 'USER', ...overrides });
const project = overrides => ({ id: 7, status: 'ACTIVE', ...overrides });
const member = overrides => ({ userId: 1, userStatus: 'ACTIVE', status: 'ACTIVE', projectRole: 'TESTER', isPm: false, ...overrides });
const failure = (status, error = {}) => ({ status, responseJSON: { error }, getResponseHeader: () => null });
function loadContext(ui, { user = actor(), detail = project(), members = [member()] } = {}) {
  let value, rejected;
  ui.qa.load('7').done(result => { value = result; }).fail(error => { rejected = error; });
  ui.requests[0].call.resolve(user);
  ui.requests[1].call.resolve(detail);
  if (ui.requests[2]) ui.requests[2].call.resolve(members);
  return { value, rejected };
}

test('context derives capability only from fresh actor, project and active TESTER membership', () => {
  const ui = browser(), result = loadContext(ui);
  assert.deepEqual(ui.requests.map(request => new URL(request.settings.url).pathname), [
    '/veriqra/api/auth/me', '/veriqra/api/projects/7', '/veriqra/api/projects/7/members'
  ]);
  assert.equal(result.value.canWriteAssets, true);
  assert.equal(result.value.projectRole, 'TESTER'); assert.equal(result.value.projectId, 7);
  assert.equal(ui.requests.every(request => request.settings.method === 'GET'), true);
});

test('PM, DEVELOPER, inactive members and disabled users never imply asset write authority', () => {
  for (const fixture of [
    { members: [member({ projectRole: 'DEVELOPER', isPm: true })] },
    { members: [member({ projectRole: 'READER', isPm: true })] },
    { members: [member({ status: 'REMOVED' })] },
    { members: [member({ userStatus: 'DISABLED' })] },
    { members: [member({ userId: 2 })] },
    { members: [] },
    { user: actor({ status: 'DISABLED' }) },
    { detail: project({ status: 'ARCHIVED' }) }
  ]) assert.equal(loadContext(browser(), fixture).value.canWriteAssets, false, JSON.stringify(fixture));
});

test('active ADMIN can write without membership, while archived project and disabled ADMIN remain read-only', () => {
  assert.equal(loadContext(browser(), { user: actor({ systemRole: 'ADMIN' }), members: [] }).value.canWriteAssets, true);
  assert.equal(loadContext(browser(), { user: actor({ systemRole: 'ADMIN' }), detail: project({ status: 'ARCHIVED' }) }).value.canWriteAssets, false);
  assert.equal(loadContext(browser(), { user: actor({ systemRole: 'ADMIN', status: 'DISABLED' }) }).value.canWriteAssets, false);
});

test('each failed context read rejects without deriving a cached or fallback authority', () => {
  for (let rejectedAt = 0; rejectedAt < 3; rejectedAt++) {
    const ui = browser(); let resolved = false, rejected;
    ui.qa.load('7').done(() => { resolved = true; }).fail(error => { rejected = error; });
    if (rejectedAt > 0) ui.requests[0].call.resolve(actor());
    if (rejectedAt > 1) ui.requests[1].call.resolve(project());
    ui.requests[rejectedAt].call.reject(failure(503));
    assert.equal(resolved, false); assert.equal(rejected.status, 503);
    assert.equal(ui.requests.length, rejectedAt + 1);
  }
});

test('invalid project IDs are rejected before any request', () => {
  for (const id of ['', '0', '-1', '7/../8', '1e2', '7?all=true', '99999999999999999999']) {
    const ui = browser(); let rejected;
    ui.qa.load(id).fail(error => { rejected = error; });
    assert.equal(rejected.status, 404); assert.equal(ui.requests.length, 0);
  }
});

test('a mismatched project detail cannot grant capability or leak its member context', () => {
  const ui = browser(); const result = loadContext(ui, { detail: project({ id: 8 }) });
  assert.equal(result.value, undefined);
  assert.ok(result.rejected, 'A detail response for a different project must be rejected');
  assert.equal(ui.requests.length, 2, 'Do not proceed to membership after an invalid detail identity');
});

test('fresh context read detects an account change before loading or mutating the previous project', () => {
  const ui = browser(); let dirty = true, cleared = 0, rejected;
  ui.fire('veriqra:identity', { user: actor() });
  ui.guard.register('case', { dirty: () => dirty, clear: () => { cleared++; dirty = false; } });
  ui.qa.load('7').fail(error => { rejected = error; }); ui.requests[0].call.resolve(actor({ id: 2 }));
  assert.equal(rejected.code, 'IDENTITY_CHANGED'); assert.equal(rejected.status, 401);
  assert.equal(ui.requests.length, 1); assert.equal(cleared, 1); assert.equal(ui.guard.hasDirty(), false);
  assert.deepEqual(ui.replacements, ['https://example.test/veriqra/index.html']);
});

test('malformed actor identity and non-array membership fail closed without write authority', () => {
  for (const value of [null, {}, { id: 0 }, { id: 'other/user' }]) {
    const ui = browser(); let rejected, resolved = false;
    ui.qa.load('7').done(() => { resolved = true; }).fail(error => { rejected = error; });
    ui.requests[0].call.resolve(value);
    assert.equal(resolved, false); assert.equal(rejected.status, 401); assert.equal(ui.requests.length, 1);
  }
  const ui = browser(); const result = loadContext(ui, { members: { projectRole: 'TESTER' } });
  assert.equal(result.value, undefined); assert.equal(result.rejected.status, 503);
});

test('draft registrations survive confirmed leave, remain dirty, and never write persistent storage', () => {
  const ui = browser(); let dirty = true, clears = 0;
  ui.guard.register('requirements', { dirty: () => dirty, clear: () => { clears++; dirty = false; } });
  ui.setConfirm(false); assert.equal(ui.guard.allowLeave(), false);
  ui.setConfirm(true); assert.equal(ui.guard.allowLeave(), true);
  assert.equal(ui.guard.hasDirty(), true); assert.equal(clears, 0);
  assert.equal(ui.unload().defaultPrevented, true);
  dirty = false; assert.equal(ui.guard.hasDirty(), false);
  dirty = true; assert.equal(ui.guard.hasDirty(), true, 'Navigation must not silently unregister the draft owner');
  ui.guard.unregister('requirements'); assert.equal(ui.unload().defaultPrevented, undefined);
});

test('401 keeps drafts in memory and offers a new-tab login with a sanitized return URL', () => {
  const ui = browser(); let clears = 0;
  ui.guard.register('case', { dirty: () => true, clear: () => { clears++; } });
  ui.api.post('projects/7/test-cases', { title: 'Synthetic unsaved input' });
  ui.requests[0].call.reject(failure(401));
  assert.equal(ui.guard.hasDirty(), true); assert.equal(clears, 0); assert.equal(ui.recovery.paused(), true);
  assert.deepEqual(ui.replacements, []);
  const login = ui.$('#session-recovery')[0].children.find(node => node.tag === 'a');
  assert.equal(login.attrs.target, '_blank'); assert.equal(login.attrs.rel, 'noopener');
  const url = new URL(login.attrs.href); assert.equal(url.pathname, '/veriqra/login.html');
  assert.equal(new URL(url.searchParams.get('returnTo')).searchParams.get('projectId'), '7');
});

test('paused session denies JSON and XML writes locally; GET and explicit authentication remain available', () => {
  const ui = browser(); ui.api.get('auth/me'); ui.requests[0].call.reject(failure(401));
  for (const method of ['post', 'put', 'delete']) {
    let error; ui.api[method]('projects/7/test-cases', {}).fail(value => { error = value; });
    assert.equal(error.status, 401);
  }
  let xmlError; ui.api.xml('projects/7/imports', '<testsuite/>').fail(error => { xmlError = error; });
  assert.equal(xmlError.status, 401); assert.equal(ui.requests.length, 1);
  ui.api.get('projects/7'); ui.api.post('auth/login', {}); ui.api.post('auth/logout');
  assert.equal(ui.requests.length, 4);
});

test('same-actor revalidation resumes future requests without replaying the interrupted write', () => {
  const ui = browser(); let clears = 0;
  ui.fire('veriqra:identity', { user: actor() });
  ui.guard.register('case', { dirty: () => true, clear: () => { clears++; } });
  ui.api.post('projects/7/test-cases', { title: 'Still only one original POST' }); ui.requests[0].call.reject(failure(401));
  const verify = ui.clickVerify(); assert.equal(verify.disabled, true); assert.equal(ui.requests[1].settings.method, 'GET');
  ui.requests[1].call.resolve(actor());
  assert.equal(verify.disabled, false); assert.equal(ui.recovery.paused(), false); assert.equal(clears, 0);
  assert.equal(ui.guard.hasDirty(), true); assert.equal(ui.requests.length, 2);
  assert.equal(ui.events.filter(event => event.type === 'veriqra:reauthenticated').length, 1);
  ui.api.post('projects/7/test-cases', { title: 'User explicitly submits again' });
  assert.equal(ui.requests.length, 3); assert.equal(ui.requests[2].settings.method, 'POST');
});

test('different-actor revalidation clears old in-memory drafts and reloads without replaying', () => {
  const ui = browser(); let dirty = true, clears = 0;
  ui.fire('veriqra:identity', { user: actor() });
  ui.guard.register('case', { dirty: () => dirty, clear: () => { dirty = false; clears++; } });
  ui.api.post('projects/7/test-cases', {}); ui.requests[0].call.reject(failure(401));
  ui.clickVerify(); ui.requests[1].call.resolve(actor({ id: 2 }));
  assert.equal(clears, 1); assert.equal(ui.guard.hasDirty(), false);
  assert.deepEqual(ui.replacements, ['https://example.test/veriqra/index.html']);
  assert.equal(ui.requests.length, 2); assert.equal(ui.events.some(event => event.type === 'veriqra:reauthenticated'), false);
  assert.equal(ui.unload().defaultPrevented, undefined);
});

test('failed revalidation and language changes preserve draft text and pause without extra requests', () => {
  const ui = browser(); const draft = { title: 'Unsaved requirement', details: 'Synthetic multiline draft' };
  ui.guard.register('requirement', { dirty: () => true, clear: () => { draft.title = ''; } });
  ui.api.get('auth/me'); ui.requests[0].call.reject(failure(401));
  ui.clickVerify(); ui.requests[1].call.reject(failure(401));
  assert.equal(ui.recovery.paused(), true); assert.equal(draft.title, 'Unsaved requirement');
  ui.locale('zh-CN');
  assert.equal(ui.$('#session-recovery')[0].children[0].content, catalogs['zh-CN']['r2.sessionExpired']);
  assert.equal(ui.guard.hasDirty(), true); assert.equal(ui.requests.length, 2);
});

test('safe return target admits only same-origin deployment index, approved views and bounded IDs', () => {
  for (const base of ['https://example.test/', 'https://example.test/veriqra/']) {
    const ui = browser({ base }); const target = ui.recovery.safeReturnTarget(base + 'index.html?projectId=7&testCaseId=20&sourceRequirementId=10&action=create&secret=omitted&runId=0&defectId=-1#test-cases');
    const url = new URL(target);
    assert.equal(url.pathname, new URL('index.html', base).pathname);
    assert.deepEqual(Object.fromEntries(url.searchParams), { projectId: '7', testCaseId: '20', sourceRequirementId: '10', action: 'create' });
    assert.equal(url.hash, '#test-cases');
  }
});

test('login return destinations preserve project settings and translate the retired collaboration bookmark', () => {
  for (const base of ['https://example.test/', 'https://example.test/veriqra/']) {
    const ui = browser({ base });
    for (const view of ['project-settings', 'collaboration']) {
      const url = new URL(ui.recovery.safeReturnTarget(base + 'index.html?projectId=7#' + view));
      assert.equal(url.hash, '#project-settings'); assert.equal(url.searchParams.get('projectId'), '7');
    }
  }
});

test('unsafe return destinations cannot become an external redirect or arbitrary same-origin page', () => {
  const ui = browser();
  for (const candidate of [
    'https://evil.test/veriqra/index.html?projectId=7#runs', '//evil.test/index.html',
    'javascript:alert(1)', 'https://user:pass@example.test/veriqra/index.html',
    'https://example.test/index.html', 'https://example.test/veriqra/admin.html',
    'https://example.test/veriqra/index.html#admin', 'https://example.test/veriqra/index.html#runs%0aevil',
    'http://example.test/veriqra/index.html', 'http://[invalid'
  ]) assert.equal(ui.recovery.safeReturnTarget(candidate), 'https://example.test/veriqra/index.html', candidate);
});

test('actual login success restores a sanitized QA target in both ROOT and nested deployments', async () => {
  for (const base of ['https://example.test/', 'https://example.test/veriqra/']) {
    const returnTo = base + 'index.html?projectId=7&runId=40&runCaseId=50&attemptId=60&unsafe=removed#runs';
    const ui = browser({ base, href: base + 'login.html?returnTo=' + encodeURIComponent(returnTo) });
    await ui.loadLogin(); ui.requests[0].call.reject(failure(401));
    ui.$('#username').val('synthetic-user'); ui.$('#password').val('synthetic-test-value'); ui.submitLogin();
    assert.equal(ui.requests[1].settings.method, 'POST'); assert.equal(new URL(ui.requests[1].settings.url).pathname, new URL('api/auth/login', base).pathname);
    ui.requests[1].call.resolve(actor());
    assert.deepEqual(ui.replacements, [base + 'index.html?projectId=7&runId=40&runCaseId=50&attemptId=60#runs']);
    assert.equal(ui.$('#login-submit').prop('disabled'), false);
  }
});

test('already authenticated login and fresh login both reject external returnTo targets', async () => {
  for (const existing of [true, false]) {
    const ui = browser({ href: 'https://example.test/veriqra/login.html?returnTo=' + encodeURIComponent('https://evil.test/index.html#runs') });
    await ui.loadLogin();
    if (existing) ui.requests[0].call.resolve(actor());
    else {
      ui.requests[0].call.reject(failure(401)); ui.$('#username').val('synthetic-user'); ui.$('#password').val('synthetic-test-value'); ui.submitLogin();
      ui.requests[1].call.resolve(actor());
    }
    assert.deepEqual(ui.replacements, ['https://example.test/veriqra/index.html']);
  }
});

test('unknown write outcome never automatically retries and typed errors expose only safe public descriptors', () => {
  const ui = browser(); let error;
  ui.api.put('projects/7/test-cases/20', { expectedVersion: 2 }).fail(value => { error = value; });
  ui.requests[0].call.reject(failure(0)); assert.equal(ui.requests.length, 1); assert.equal(error.status, 0);
  ui.api.post('projects/7/test-runs', {}).fail(value => { error = value; });
  ui.requests[1].call.reject(failure(409, { code: 'CONFLICT', reasonCode: 'QA_CASE_NOT_READY', field: 'caseIds', message: 'internal SQL secret' }));
  assert.equal(error.reasonCode, 'QA_CASE_NOT_READY'); assert.equal(error.field, 'caseIds');
  assert.equal(error.message, catalogs.en['r2Error.QA_CASE_NOT_READY']); assert.equal(error.message.includes('SQL'), false);
  assert.equal(ui.requests.length, 2);
});
