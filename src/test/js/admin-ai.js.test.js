const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/admin/ai.js'), 'utf8');
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };

function browser(pageName = 'ai', options = {}) {
  const calls = [], listeners = new Map(), modalInstances = new Map();
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.content = ''; this.value = ''; this.attributes = {};
      this.classes = new Set(); this.handlers = {}; this.disabled = false; this.readOnly = false;
    }
    get isConnected() { return this === document.body || !!this.parent?.isConnected; }
    contains(node) { return node === this || this.children.some(child => child instanceof Element && child.contains(node)); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    closest(selector) { let node = this; while (node) { if (matches(node, selector)) return node; node = node.parent; } return null; }
    focus() { if (this.isConnected && !this.disabled) document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    checkValidity() { return descendants(this).every(valid); }
  }
  function valid(node) {
    const value = node.value || '';
    return (!node.required || !!value) && (!value || (!node.attributes.minlength || value.length >= Number(node.attributes.minlength))
      && (!node.attributes.maxlength || value.length <= Number(node.attributes.maxlength))
      && (!node.attributes.pattern || new RegExp('^(?:' + node.attributes.pattern + ')$').test(value)));
  }
  const descendants = node => node.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
  function matches(node, selector) {
    if (selector === ':invalid') return !valid(node);
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => node.classes.has(name));
    const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) return node.attributes[attribute[1]] != null && (attribute[2] == null || node.attributes[attribute[1]] === attribute[2]);
    return node.tag === selector;
  }
  function emit(node, name, event = {}) {
    const data = { preventDefault() {}, currentTarget: node, ...event };
    return (node.handlers[name] || []).slice().map(fn => fn.call(node, data));
  }
  class Collection extends Array {
    get jquery() { return 'test'; }
    each(fn) { this.forEach((node, index) => fn.call(node, index, node)); return this; }
    on(names, fn) { return this.each(function () { names.split(' ').forEach(name => (this.handlers[name] ||= []).push(fn)); }); }
    one(name, fn) { return this.each(function () { const node = this; const once = event => { node.handlers[name] = node.handlers[name].filter(handler => handler !== once); return fn.call(node, event); }; (this.handlers[name] ||= []).push(once); }); }
    text(value) { if (value === undefined) return this[0]?.content; return this.empty().each(function () { this.content = String(value); }); }
    val(value) { if (value === undefined) return this[0]?.value; return this.each(function () { this.value = value == null ? '' : String(value); }); }
    empty() { return this.each(function () { this.children.forEach(child => { if (child instanceof Element) child.parent = null; }); this.children = []; this.content = ''; if (!document.activeElement.isConnected) document.activeElement = document.body; }); }
    append(...items) { return this.each(function () { items.flatMap(item => item instanceof Collection ? [...item] : [item]).forEach(item => { if (item instanceof Element) { if (item.parent) item.parent.children = item.parent.children.filter(child => child !== item); item.parent = this; } this.children.push(item); }); }); }
    attr(name, value) { if (typeof name === 'object') { Object.entries(name).forEach(([key, item]) => this.attr(key, item)); return this; } if (value === undefined) return this[0]?.attributes[name]; return this.each(function () { if (value == null) delete this.attributes[name]; else this.attributes[name] = String(value); if (['id', 'name', 'type'].includes(name)) this[name] = value; }); }
    prop(name, value) { if (value === undefined) return this[0]?.[name]; return this.each(function () { this[name] = value; }); }
    addClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.add(name)); }); }
    removeClass(names) { return this.each(function () { names.split(' ').forEach(name => this.classes.delete(name)); }); }
    toggleClass(names, force) { return this.each(function () { names.split(' ').forEach(name => { if (force ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name); }); }); }
    hasClass(name) { return !!this[0]?.classes.has(name); }
    find(selector) { return collection(Array.from(this).flatMap(node => descendants(node)).filter(node => selector.split(',').some(part => matches(node, part.trim())))); }
    filter(fn) { return collection(Array.from(this).filter((node, index) => fn.call(node, index, node))); }
    trigger(name) { return this.each(function () { emit(this, name); }); }
    remove() { return this.each(function () { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; if (!document.activeElement.isConnected) document.activeElement = document.body; }); }
    data(name) { return this[0]?.attributes['data-' + name]; }
    bootstrapTable(options) {
      if (options === 'destroy') { this.forEach(node => { node.tableOptions = null; }); return this; }
      this.forEach(node => {
        node.tableOptions = options;
        node.requestTable = (changes = {}) => {
          Object.assign(options, changes);
          const data = options.queryParams({ limit: options.pageSize, offset: (options.pageNumber - 1) * options.pageSize,
            sort: options.sortName, order: options.sortOrder });
          options.ajax({ data, success(result) {
            $(node).empty();
            if (!result.rows.length) $(node).append($('<p>').text(options.formatNoMatches()));
            result.rows.forEach(row => {
              const tr = $('<tr>');
              options.columns.forEach(column => {
                const td = $('<td>');
                if (column.events) {
                  const html = column.formatter();
                  for (const match of html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)) {
                    const button = $('<button type="button">').addClass(match[1]).text(match[2]);
                    for (const [name, handler] of Object.entries(column.events)) {
                      const [event, selector] = name.split(' ');
                      if (matches(button[0], selector)) button.on(event, e => handler(e, row[column.field], row));
                    }
                    td.append(button);
                  }
                } else td.text(column.formatter ? column.formatter(row[column.field], row) : row[column.field] || '');
                tr.append(td);
              });
              $(node).append(tr);
            });
          }, error() { $(node).empty(); } });
        };
        node.requestTable();
      });
      return this;
    }
  }
  const collection = items => Collection.from(items);
  const body = new Element('body');
  body.attributes['data-admin-page'] = pageName;
  document = { body, activeElement: body, baseURI: 'http://localhost/admin/users.html',
    getElementById(id) { return descendants(body).find(node => node.id === id); }, dispatchEvent(event) { listeners.get(event.type)?.(event); }, addEventListener(name, fn) { listeners.set(name, fn); },
    querySelectorAll(selector) { return descendants(body).filter(node => matches(node, selector)); } };
  function $(selector) {
    if (selector instanceof Element) return collection([selector]);
    if (selector instanceof Collection) return selector;
    if (selector.startsWith('<')) {
      const node = new Element(/^<([\w-]+)/.exec(selector)[1]); const result = collection([node]);
      for (const match of selector.matchAll(/([\w-]+)="([^"]*)"/g)) { if (match[1] === 'class') result.addClass(match[2]); else result.attr(match[1], match[2]); }
      return result;
    }
    if (selector === 'body') return collection([body]);
    return collection(descendants(body).filter(node => matches(node, selector)));
  }
  for (const id of ['admin-content', 'admin-feedback', 'admin-menu', 'admin-sidebar', 'admin-logout', 'admin-user']) $('body').append($('<div>').attr('id', id));
  function request(method, url, body) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); calls.push({ method, url, body, resolve, reject }); return promise; }
  const api = { get: url => request('GET', url), post: (url, body) => request('POST', url, body), action: request, put: (url, body) => request('PUT', url, body) };
  class Modal {
    constructor(root) { this.root = root; modalInstances.set(root, this); }
    show() { $(this.root).addClass('show'); emit(this.root, 'shown.bs.modal'); }
    hide() { $(this.root).removeClass('show'); emit(this.root, 'hidden.bs.modal'); }
    dispose() { modalInstances.delete(this.root); }
    static getInstance(root) { return modalInstances.get(root); }
  }
  const guards = new Map(); let allowLeave = true; const window = { VeriqraApi: api, VeriqraDraftGuard: { register: (key, value) => guards.set(key, value), allowLeave: () => allowLeave },
    I18n: { init: options.init || (async () => {}), t: options.t || ((key, params, fallback) => (fallback || key).replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? '')),
      getLocale: () => options.locale || 'en', error: error => error.message || 'Unavailable', formatDateTime: value => String(value),
      enumLabel: value => value, formatNumber: value => String(value) } };
  vm.runInNewContext(source, { window, document, jQuery: $, bootstrap: { Modal }, URL, URLSearchParams, location: { search: '', replace() {} } });
  const textOf = node => node.content + node.children.map(child => child instanceof Element ? textOf(child) : String(child)).join('');
  const find = (scope, label) => [...$(scope).find('button')].find(node => node.content === label);
  async function click(node) {
    assert.ok(node, 'Expected button exists'); node.focus(); emit(node, 'click');
    if (node.getAttribute('data-bs-dismiss') === 'modal') Modal.getInstance(node.closest('.modal'))?.hide();
    await flush();
  }
  function submit(form) { const pending = emit(form, 'submit'); return Promise.all(pending); }
  async function respond(call, value) { call.resolve(value); await flush(); }
  async function reject(call, message = 'Unavailable') { call.reject({ status: 503, message }); await flush(); }
  async function authorize(role = 'ADMIN') { await flush(); await respond(calls.at(-1), { id: 1, username: 'admin', systemRole: role }); }
  async function locale() { listeners.get('veriqra:localechange')(); await flush(); }
  function tableRequest(changes) { $('#admin-user-table')[0].requestTable(changes); }
  async function reauthenticate() { listeners.get('veriqra:reauthenticated')(); await flush(); }
  return { $, calls, document, textOf, find, click, submit, respond, reject, authorize, locale, Modal, tableRequest, reauthenticate, guards, emit, listeners, setAllowLeave: value => { allowLeave = value; } };
}

const config = (changes = {}) => ({ project: 'veriqra-test', location: 'global', model: 'gemini-current', configured: true,
  writable: true, source: 'local-settings', revision: 'revision-1', models: [{ id: 'gemini-current', label: 'Current model' }, { id: 'gemini-next', label: 'Next model' }],
  links: { vertex: 'https://console.cloud.google.com/vertex-ai', quotas: 'https://console.cloud.google.com/iam-admin/quotas', billing: 'https://console.cloud.google.com/billing', credits: 'https://console.cloud.google.com/billing/credits' }, ...changes });
const report = (changes = {}) => ({ checkedAt: '2026-11-03T10:00:00Z', connection: { status: 'CONNECTED' },
  usage: { status: 'OK', windowStart: '2026-11-02T10:00:00Z', windowEnd: '2026-11-03T10:00:00Z', requests: 0, inputTokens: 112, outputTokens: null, totalTokens: 112 },
  quotas: { status: 'OK', capacityMode: 'DSQ', items: [{ name: 'Google token limit', quotaId: 'token-limit', value: 10000, unit: '1/min', dimensions: { region: 'global' } }] },
  billing: { status: 'PERMISSION_DENIED', code: 'BILLING_PERMISSION_DENIED', remainingCredit: null, creditStatus: 'CONSOLE_ONLY', costStatus: 'EXPORT_REQUIRED' }, ...changes });
async function ready(options) { const ui = browser('ai', options); await ui.authorize(); await ui.respond(ui.calls.at(-1), config()); return ui; }
async function select(ui, value) { ui.$('#ai-model').val(value); ui.emit(ui.$('#ai-model')[0], 'change'); await flush(); }
async function custom(ui, value) { await select(ui, '__custom_model__'); ui.$('#ai-custom-model').val(value); ui.emit(ui.$('#ai-custom-model')[0], 'input'); await flush(); }

test('only an authorized administrator can load settings; initial load never calls Google or generation', async () => {
  const denied = browser(); await denied.authorize('USER');
  assert.deepEqual(denied.calls.map(call => call.url), ['auth/me']);
  assert.match(denied.textOf(denied.$('#admin-content')[0]), /platform administrator/);
  const ui = await ready();
  assert.deepEqual(ui.calls.map(call => [call.method, call.url]), [['GET', 'auth/me'], ['GET', 'admin/ai']]);
  assert.equal(ui.$('#ai-effective-model').text(), 'gemini-current');
  assert.equal(ui.$('#ai-save').prop('disabled'), true);
  assert.equal(ui.guards.get('admin-ai').dirty(), false);
});

test('configuration source uses localized user-facing names and matching model labels do not repeat the ID', async () => {
  const labels = { 'adminAi.sourceServerConfiguration': '服务器配置', 'adminAi.sourceAdminSelection': '后台保存' };
  for (const [sourceName, label] of [['configuration', '服务器配置'], ['local-settings', '后台保存']]) {
    const ui = browser('ai', { t: (key, params, fallback) => labels[key] || fallback || key }); await ui.authorize();
    await ui.respond(ui.calls.at(-1), config({ source: sourceName, models: [{ id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }] }));
    assert.match(ui.textOf(ui.$('#ai-model-card')[0]), new RegExp(label));
    assert.doesNotMatch(ui.textOf(ui.$('#ai-model-card')[0]), /local-settings|>configuration</);
    const modelOption = [...ui.$('#ai-model').find('option')].find(option => option.value === 'gemini-2.5-flash');
    assert.equal(ui.textOf(modelOption), 'gemini-2.5-flash');
  }
  const ui = await ready(); assert.match(ui.textOf(ui.$('#ai-model-card')[0]), /Admin selection/);
});

test('manual refresh uses the effective server configuration while keeping the unsaved choice', async () => {
  const ui = await ready(); await select(ui, 'gemini-next');
  assert.equal(ui.$('#ai-effective-model').text(), 'gemini-current');
  assert.equal(ui.guards.get('admin-ai').dirty(), true);
  assert.equal(ui.calls.length, 2);
  await ui.click(ui.$('#ai-refresh')[0]); const call = ui.calls.at(-1);
  assert.equal(call.method, 'POST'); assert.equal(call.url, 'admin/ai/refresh'); assert.equal(call.body, undefined);
  await ui.respond(call, report());
  assert.equal(ui.$('#ai-model').val(), 'gemini-next'); assert.equal(ui.$('#ai-effective-model').text(), 'gemini-current');
  assert.equal(ui.$('#ai-usage-requests').text(), '0'); assert.equal(ui.$('#ai-usage-outputTokens').text(), '—');
  assert.match(ui.textOf(ui.$('#ai-billing-card')[0]), /Permission required/);
  assert.match(ui.textOf(ui.$('#ai-quota-card')[0]), /no fixed remaining request count/);
  assert.match(ui.textOf(ui.$('#ai-billing-card')[0]), /do not return the remaining promotional credit/);
  assert.equal(ui.$('#ai-connection-card').find('a').length, 5);
  assert.match(ui.textOf(ui.$('#ai-connection-card')[0]), /Google project connection successful/);
  assert.doesNotMatch(ui.textOf(ui.$('#ai-connection-card')[0]), /Model token-count check passed/);
});

test('query setup is shown for actual API or permission errors and links to the configured Google project', async () => {
  const ui = await ready();
  assert.equal(ui.$('#ai-query-setup').length, 0);
  await ui.click(ui.$('#ai-refresh')[0]);
  await ui.respond(ui.calls.at(-1), report({ connection: { status: 'API_DISABLED', code: 'SERVICE_DISABLED' } }));
  const setup = ui.$('#ai-query-setup');
  assert.match(ui.textOf(setup[0]), /separate permissions/);
  const anchors = Array.from(setup.find('a'));
  assert.equal(anchors.length, 4);
  for (const anchor of anchors) {
    const url = new URL(anchor.attributes.href);
    assert.equal(url.origin, 'https://console.cloud.google.com');
    assert.equal(url.searchParams.get('project'), 'veriqra-test');
    assert.ok(url.pathname.startsWith('/apis/library/'));
  }
  assert.deepEqual(ui.calls.map(call => call.url), ['auth/me','admin/ai','admin/ai/refresh']);
});

test('partial usage preserves available requests while missing token metrics stay unavailable with the Google error code', async () => {
  const ui = await ready(); await ui.click(ui.$('#ai-refresh')[0]);
  await ui.respond(ui.calls.at(-1), report({ usage: { status: 'PARTIAL', code: 'TOKEN_METRICS_PERMISSION_DENIED', requests: 27,
    inputTokens: null, outputTokens: null, totalTokens: null } }));
  assert.match(ui.textOf(ui.$('#ai-usage-card')[0]), /Some data retrieved/);
  assert.match(ui.textOf(ui.$('#ai-usage-card')[0]), /TOKEN_METRICS_PERMISSION_DENIED/);
  assert.equal(ui.$('#ai-usage-requests').text(), '27');
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) assert.equal(ui.$('#ai-usage-' + key).text(), '—');
});

test('save sends only the explicit model and revision, then marks the returned model active', async () => {
  const ui = await ready(); await custom(ui, ' gemini-custom-2026 ');
  ui.submit(ui.$('#ai-model-form')[0]); await flush(); const call = ui.calls.at(-1);
  assert.equal(call.method, 'PUT'); assert.equal(call.url, 'admin/ai');
  assert.equal(call.body.model, 'gemini-custom-2026'); assert.equal(call.body.expectedRevision, 'revision-1');
  assert.equal(ui.$('#ai-save').prop('disabled'), true);
  await ui.respond(call, config({ model: 'gemini-custom-2026', revision: 'revision-2' }));
  assert.equal(ui.$('#ai-effective-model').text(), 'gemini-custom-2026');
  assert.equal(ui.guards.get('admin-ai').dirty(), false); assert.match(ui.$('#admin-feedback').text(), /saved and active/);
  assert.equal(ui.calls.filter(call => call.url === 'admin/ai/refresh').length, 0);
});

test('model check is explicit, checks the saved model and never claims content generation was verified', async () => {
  const ui = await ready(); await select(ui, 'gemini-next');
  await ui.click(ui.$('#ai-check-model')[0]); const check = ui.calls.at(-1);
  assert.equal(check.method, 'POST'); assert.equal(check.url, 'admin/ai/check-model'); assert.equal(check.body, undefined);
  await ui.respond(check, { model: 'gemini-current', status: 'OK', checkedAt: '2026-11-03T10:00:00Z', totalTokens: 4 });
  assert.match(ui.textOf(ui.$('#ai-connection-card')[0]), /Model token-count check passed/);
  assert.match(ui.textOf(ui.$('#ai-connection-card')[0]), /Checked model: gemini-current/);
  assert.match(ui.textOf(ui.$('#ai-connection-card')[0]), /does not verify content generation/);
  assert.equal(ui.$('#ai-model').val(), 'gemini-next'); assert.equal(ui.calls.filter(call => call.url === 'admin/ai/refresh').length, 0);
});

test('an old model-check result is discarded when the active model is saved', async () => {
  const ui = await ready(); await ui.click(ui.$('#ai-check-model')[0]); const check = ui.calls.at(-1);
  await select(ui, 'gemini-next'); ui.submit(ui.$('#ai-model-form')[0]); await flush();
  await ui.respond(ui.calls.at(-1), config({ model: 'gemini-next', revision: 'revision-2' }));
  await ui.respond(check, { model: 'gemini-current', status: 'OK', checkedAt: '2026-11-03T10:00:00Z' });
  assert.doesNotMatch(ui.textOf(ui.$('#ai-connection-card')[0]), /Model token-count check passed/);
});

test('a conflict retains the custom draft and requires an explicit current-settings read before another save', async () => {
  const ui = await ready(); await custom(ui, 'gemini-custom'); ui.submit(ui.$('#ai-model-form')[0]); await flush();
  ui.calls.at(-1).reject({ status: 409, message: 'Conflict' }); await flush();
  assert.equal(ui.$('#ai-custom-model').val(), 'gemini-custom'); assert.equal(ui.$('#ai-save').prop('disabled'), true);
  await ui.click(ui.$('#ai-review-current')[0]);
  assert.equal(ui.calls.at(-1).method, 'GET');
  await ui.respond(ui.calls.at(-1), config({ model: 'gemini-next', revision: 'revision-7' }));
  assert.equal(ui.$('#ai-effective-model').text(), 'gemini-next'); assert.equal(ui.$('#ai-custom-model').val(), 'gemini-custom');
  assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 1);
  ui.submit(ui.$('#ai-model-form')[0]); await flush();
  assert.equal(ui.calls.at(-1).body.expectedRevision, 'revision-7');
  await ui.respond(ui.calls.at(-1), config({ model: 'gemini-custom', revision: 'revision-8' }));
});

test('an uncertain save is not repeated and a current-settings read resolves an already applied result', async () => {
  const ui = await ready(); await select(ui, 'gemini-next'); ui.submit(ui.$('#ai-model-form')[0]); await flush();
  ui.calls.at(-1).reject({ status: 503, message: 'Connection lost' }); await flush();
  assert.equal(ui.$('#ai-save').prop('disabled'), true); assert.equal(ui.guards.get('admin-ai').dirty(), true);
  assert.match(ui.$('#admin-feedback').text(), /could not be confirmed/);
  await ui.click(ui.$('#ai-review-current')[0]); await ui.respond(ui.calls.at(-1), config({ model: 'gemini-next', revision: 'revision-2' }));
  assert.equal(ui.guards.get('admin-ai').dirty(), false); assert.equal(ui.$('#ai-save').prop('disabled'), true);
  assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 1);
});

test('a refresh response for the previous configuration cannot overwrite a newly saved model', async () => {
  const ui = await ready(); await ui.click(ui.$('#ai-refresh')[0]); const oldRefresh = ui.calls.at(-1);
  await select(ui, 'gemini-next'); ui.submit(ui.$('#ai-model-form')[0]); await flush();
  await ui.respond(ui.calls.at(-1), config({ model: 'gemini-next', revision: 'revision-2' }));
  await ui.respond(oldRefresh, report({ usage: { status: 'OK', requests: 987654 } }));
  assert.equal(ui.$('#ai-effective-model').text(), 'gemini-next'); assert.equal(ui.$('#ai-usage-requests').text(), '—');
});

test('Google quota int64 limits preserve precision and minus one means no fixed limit', async () => {
  const ui = await ready(); await ui.click(ui.$('#ai-refresh')[0]);
  await ui.respond(ui.calls.at(-1), report({ quotas: { status: 'OK', capacityMode: 'SHARED_PAYGO', items: [
    { name: 'Unlimited dimension', value: '-1' }, { name: 'Large quota', value: '9223372036854775807' }] } }));
  for (const details of ui.$('#ai-quota-card').find('details')) { ui.$(details).prop('open', true); ui.emit(details, 'toggle'); }
  const value = ui.textOf(ui.$('#ai-quota-card')[0]);
  assert.match(value, /No fixed limit/); assert.match(value, /9223372036854775807/); assert.match(value, /Shared capacity \(Standard PayGo\)/);
  assert.doesNotMatch(value, /SHARED_PAYGO/); assert.match(ui.textOf(ui.$('#ai-usage-card')[0]), /may include other applications/);
});

test('large quota lists start collapsed, group scope rows and build tables only when requested', async () => {
  const ui = await ready(); await ui.click(ui.$('#ai-refresh')[0]);
  const items = Array.from({ length: 1034 }, (_, index) => ({ name: 'Token limit', quotaId: 'input-token-limit',
    value: String(1000 + index), unit: '1/min/{project}/{region}', dimensions: index ? { region: 'region-' + index } : {} }));
  items.push({ name: 'Request limit', quotaId: 'request-limit', value: '100', unit: '1/min', dimensions: {} });
  await ui.respond(ui.calls.at(-1), report({ quotas: { status: 'OK', items } }));
  assert.equal(ui.$('#ai-quota-details').prop('open'), false);
  assert.match(ui.textOf(ui.$('#ai-quota-details-summary')[0]), /2 groups · 1035 scope entries/);
  assert.equal(ui.$('#ai-quota-card').find('.admin-ai-quota-group').length, 2);
  assert.equal(ui.$('#ai-quota-card').find('td').length, 0);
  const requestCount = ui.calls.length;
  ui.$('#ai-quota-details').prop('open', true); ui.emit(ui.$('#ai-quota-details')[0], 'toggle');
  ui.$('#ai-quota-group-0').prop('open', true); ui.emit(ui.$('#ai-quota-group-0')[0], 'toggle');
  assert.equal(ui.$('#ai-quota-group-0').find('td').length, 2068);
  assert.equal(ui.$('#ai-quota-group-1').find('td').length, 0);
  assert.match(ui.textOf(ui.$('#ai-quota-group-0')[0]), /Default \(no dimension override\)/);
  assert.match(ui.textOf(ui.$('#ai-quota-group-0')[0]), /region-1033/);
  assert.equal(ui.calls.length, requestCount);
  ui.$('#ai-quota-group-0').prop('open', false); ui.emit(ui.$('#ai-quota-group-0')[0], 'toggle');
  assert.equal(ui.$('#ai-quota-group-0').prop('open'), false);
});

test('explanation disclosures and quota expansion survive language changes and Google refreshes', async () => {
  const ui = await ready();
  for (const id of ['ai-model-check-help', 'ai-usage-details', 'ai-billing-details']) assert.equal(ui.$('#' + id).prop('open'), false);
  await ui.click(ui.$('#ai-refresh')[0]); await ui.respond(ui.calls.at(-1), report());
  for (const id of ['ai-quota-details', 'ai-quota-group-0', 'ai-usage-details']) {
    ui.$('#' + id).prop('open', true); ui.emit(ui.$('#' + id)[0], 'toggle');
  }
  ui.$('#ai-quota-group-0-summary')[0].focus();
  const requestCount = ui.calls.length; await ui.locale();
  assert.equal(ui.calls.length, requestCount);
  assert.equal(ui.document.activeElement, ui.$('#ai-quota-group-0-summary')[0]);
  assert.equal(ui.$('#ai-quota-details').prop('open'), true);
  assert.equal(ui.$('#ai-quota-group-0').prop('open'), true);
  assert.equal(ui.$('#ai-usage-details').prop('open'), true);
  await ui.click(ui.$('#ai-refresh')[0]); await ui.respond(ui.calls.at(-1), report());
  assert.equal(ui.$('#ai-quota-group-0').prop('open'), true);
  assert.equal(ui.$('#ai-quota-group-0').find('td').length, 2);
  assert.equal(ui.$('#ai-usage-inputTokens').text(), '112');
});

test('a refresh from a changed server configuration reloads settings and preserves the user selection', async () => {
  const ui = await ready(); await custom(ui, 'my-pending-model'); await ui.click(ui.$('#ai-refresh')[0]);
  await ui.respond(ui.calls.at(-1), report({ model: 'gemini-other', project: 'veriqra-test', location: 'global', revision: 'revision-9' }));
  assert.equal(ui.calls.at(-1).method, 'GET'); assert.equal(ui.calls.at(-1).url, 'admin/ai');
  await ui.respond(ui.calls.at(-1), config({ model: 'gemini-other', revision: 'revision-9' }));
  assert.equal(ui.$('#ai-effective-model').text(), 'gemini-other'); assert.equal(ui.$('#ai-custom-model').val(), 'my-pending-model');
  assert.equal(ui.$('#ai-usage-requests').text(), '—'); assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 0);
});

test('reauthorization invalidates stale reads and preserves drafts only for the same administrator', async () => {
  const ui = await ready(); await custom(ui, 'private-draft');
  await ui.click(ui.$('#ai-refresh')[0]); const oldRefresh = ui.calls.at(-1);
  await ui.reauthenticate(); await ui.respond(ui.calls.at(-1), { id: 1, username: 'admin', systemRole: 'ADMIN' });
  await ui.respond(ui.calls.at(-1), config()); assert.equal(ui.$('#ai-custom-model').val(), 'private-draft');
  await ui.respond(oldRefresh, report()); assert.equal(ui.$('#ai-usage-requests').text(), '—');
  await ui.reauthenticate(); await ui.respond(ui.calls.at(-1), { id: 2, username: 'other-admin', systemRole: 'ADMIN' });
  await ui.respond(ui.calls.at(-1), config()); assert.equal(ui.$('#ai-model').val(), 'gemini-current');
  assert.equal(ui.guards.get('admin-ai').dirty(), false);
});

test('loss of authorization blocks settings and ignores outstanding Google data', async () => {
  const ui = await ready(); await ui.click(ui.$('#ai-refresh')[0]); const stale = ui.calls.at(-1);
  await ui.reauthenticate(); await ui.respond(ui.calls.at(-1), { id: 1, username: 'former-admin', systemRole: 'USER' });
  await ui.respond(stale, report());
  assert.equal(ui.$('#ai-model-card').length, 0); assert.equal(ui.$('#ai-billing-card').length, 0);
  assert.match(ui.textOf(ui.$('#admin-content')[0]), /platform administrator/);
});

test('locale changes preserve a focused draft and translate cached partial results without another request', async () => {
  let locale = 'en';
  const ui = await ready({ t: (key, params, fallback) => (locale === 'zh-CN' && key === 'adminAi.statusPermissionDenied' ? '需要权限' : fallback || key).replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? '') });
  await ui.click(ui.$('#ai-refresh')[0]); await ui.respond(ui.calls.at(-1), report());
  await custom(ui, 'gemini-unsaved'); ui.$('#ai-custom-model')[0].focus(); ui.$('#ai-custom-model')[0].setSelectionRange(3, 7);
  const count = ui.calls.length; locale = 'zh-CN'; await ui.locale();
  assert.equal(ui.calls.length, count); assert.equal(ui.$('#ai-custom-model').val(), 'gemini-unsaved');
  assert.equal(ui.document.activeElement, ui.$('#ai-custom-model')[0]); assert.equal(ui.document.activeElement.selectionStart, 3);
  assert.match(ui.textOf(ui.$('#ai-billing-card')[0]), /需要权限/); assert.equal(ui.$('#ai-usage-inputTokens').text(), '112');
});

test('a visible save conflict follows language changes without another write or settings read', async () => {
  let locale = 'en';
  const ui = await ready({ t: (key, params, fallback) => (locale === 'zh-CN' && key === 'adminAi.saveConflict' ? '生效配置已被更改。' : fallback || key).replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? '') });
  await select(ui, 'gemini-next'); ui.submit(ui.$('#ai-model-form')[0]); await flush();
  ui.calls.at(-1).reject({ status: 409, message: 'Conflict' }); await flush();
  const count = ui.calls.length; locale = 'zh-CN'; await ui.locale();
  assert.equal(ui.calls.length, count); assert.match(ui.$('#admin-feedback').text(), /生效配置已被更改/);
  assert.equal(ui.$('#ai-save').prop('disabled'), true); assert.equal(ui.$('#ai-model').val(), 'gemini-next');
});

test('server values are rendered as text and only safe Google console links become anchors', async () => {
  const ui = browser(); await ui.authorize(); const malicious = '<img src=x onerror=alert(1)>';
  await ui.respond(ui.calls.at(-1), config({ project: malicious, models: [{ id: 'gemini-current', label: malicious }],
    links: { vertex: 'javascript:alert(1)', quotas: 'https://console.cloud.google.com.evil.invalid/quotas', credits: 'https://user@console.cloud.google.com/billing', billing: 'https://console.cloud.google.com/billing' } }));
  assert.match(ui.textOf(ui.$('#ai-model-card')[0]), /<img src=x onerror=alert\(1\)>/);
  assert.equal(ui.$('#admin-content').find('img').length, 0); assert.equal(ui.$('#admin-content').find('a').length, 1);
  await ui.click(ui.$('#ai-refresh')[0]); await ui.respond(ui.calls.at(-1), report({ quotas: { status: 'OK', capacityMode: malicious, items: [{ name: malicious, value: null, dimensions: { x: malicious } }] } }));
  assert.equal(ui.$('#admin-content').find('img').length, 0); assert.match(ui.textOf(ui.$('#ai-quota-card')[0]), /<img/);
});

test('invalid IDs never save; read-only and unconfigured settings keep unavailable counts empty', async () => {
  const ui = await ready(); await custom(ui, '<script>bad</script>');
  await ui.submit(ui.$('#ai-model-form')[0]); assert.equal(ui.calls.length, 2); assert.match(ui.$('#admin-feedback').text(), /Enter a model ID/);
  const restricted = browser(); await restricted.authorize(); await restricted.respond(restricted.calls.at(-1), config({ writable: false, configured: false, model: '' }));
  assert.equal(restricted.$('#ai-model').prop('disabled'), true); assert.equal(restricted.$('#ai-refresh').prop('disabled'), true);
  assert.equal(restricted.$('#ai-usage-requests').text(), '—'); assert.match(restricted.textOf(restricted.$('#ai-model-card')[0]), /cannot persist/);
});

test('custom model validation matches the server Gemini ID format and 128-character boundary', async () => {
  const ui = await ready();
  assert.equal(ui.$('#ai-custom-model').attr('maxlength'), '128');
  assert.equal(ui.$('#ai-custom-model').attr('pattern'), 'gemini-[a-z0-9][a-z0-9._-]*');
  for (const value of ['other-model', 'gemini-', 'gemini-Flash', 'gemini-flash:latest', 'gemini-flash/model', 'gemini-' + 'a'.repeat(122)]) {
    await custom(ui, value); await ui.submit(ui.$('#ai-model-form')[0]);
    assert.equal(ui.calls.length, 2, value); assert.match(ui.$('#admin-feedback').text(), /up to 128 lowercase/);
  }
  const boundary = 'gemini-' + 'a'.repeat(121);
  await custom(ui, boundary); await ui.submit(ui.$('#ai-model-form')[0]);
  assert.equal(ui.calls.length, 3); assert.equal(ui.calls.at(-1).body.model, boundary);
});

test('draft guard protects navigation and logout and reset clears a pending selection', async () => {
  const ui = await ready(); await select(ui, 'gemini-next'); ui.setAllowLeave(false);
  await ui.click(ui.$('#admin-logout')[0]); assert.equal(ui.calls.length, 2);
  const anchor = ui.$('<a href="admin/users.html">'); ui.$('body').append(anchor); let prevented = false;
  ui.listeners.get('click')({ target: anchor[0], preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  await ui.click(ui.$('#ai-reset')[0]); assert.equal(ui.guards.get('admin-ai').dirty(), false); assert.equal(ui.$('#ai-model').val(), 'gemini-current');
  ui.setAllowLeave(true); await ui.click(ui.$('#admin-logout')[0]); assert.equal(ui.calls.at(-1).url, 'auth/logout');
  await ui.respond(ui.calls.at(-1), {});
});
