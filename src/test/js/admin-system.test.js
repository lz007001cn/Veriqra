const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/admin/system.js'), 'utf8');
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };

function browser(pageName = 'system', options = {}) {
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
  document = { body, activeElement: body, baseURI: 'http://localhost/',
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
  async function authorize(role = 'ADMIN') { await flush(); await respond(calls.at(-1), { id: 1, username: 'admin', systemRole: role, status: 'ACTIVE' }); }
  async function locale() { listeners.get('veriqra:localechange')(); await flush(); }
  function tableRequest(changes) { $('#admin-user-table')[0].requestTable(changes); }
  async function reauthenticate() { listeners.get('veriqra:reauthenticated')(); await flush(); }
  return { $, calls, document, textOf, find, click, submit, respond, reject, authorize, locale, Modal, tableRequest, reauthenticate, guards, emit, listeners, setAllowLeave: value => { allowLeave = value; } };
}

const info = (changes = {}) => ({ veriqraVersion: '0.9.0', buildCommit: 'a'.repeat(40), buildTime: '2026-11-04T01:00:00Z',
  applicationStatus: 'UP', databaseStatus: 'UP', databaseVersion: '8.0.42', databaseTableCount: 35,
  javaVersion: '21.0.12', tomcatVersion: 'Apache Tomcat/10.1.60', uptimeSeconds: 3661, serverTime: '2026-11-04T04:00:00Z', applicationTimeZone: 'Asia/Shanghai (UTC+8)',
  runtime: { javaVendor: 'Microsoft', osName: 'Windows 11', osVersion: '10.0', osArch: 'amd64', availableProcessors: 16,
    heapUsedBytes: 128 * 1024 ** 2, heapCommittedBytes: 512 * 1024 ** 2, heapMaxBytes: 1024 ** 3, jvmTimeZone: 'Asia/Singapore', fileEncoding: 'UTF-8' },
  configuration: { contextPath: '/veriqra', sessionTimeoutMinutes: 30, sessionCookieSecure: false, publicOriginConfigured: false,
    database: { initialPoolSize: 2, maxPoolSize: 12, acquireTimeoutMillis: 5000, source: 'EXTERNAL_FILE' } },
  ai: { provider: 'Vertex AI', configured: true, project: 'test-project', location: 'global', model: 'gemini-2.5-flash', settingsWritable: true, settingsSource: 'local-settings' }, ...changes });
async function ready(options) { const ui = browser('system', options); await ui.authorize(); await ui.respond(ui.calls.at(-1), info()); return ui; }

test('only an active administrator can read system information and the page fetches one initial snapshot', async () => {
  const denied = browser(); await denied.authorize('USER');
  assert.deepEqual(denied.calls.map(call => call.url), ['auth/me']);
  assert.match(denied.textOf(denied.$('#admin-content')[0]), /platform administrator/);
  const disabled = browser(); await flush(); await disabled.respond(disabled.calls.at(-1), { id: 1, username: 'disabled', systemRole: 'ADMIN', status: 'DISABLED' });
  assert.equal(disabled.calls.length, 1);
  const ui = await ready();
  assert.deepEqual(ui.calls.map(call => [call.method, call.url]), [['GET', 'auth/me'], ['GET', 'admin/system']]);
  assert.equal(ui.$('#system-version').text(), '0.9.0');
  assert.equal(ui.$('#system-application-status').text(), 'Available');
  assert.equal(ui.$('#system-database-status').text(), 'Available');
  assert.equal(ui.$('#system-uptime').text(), '1h 1m');
  assert.equal(ui.$('#system-ai-model').text(), 'gemini-2.5-flash');
});

test('runtime, configuration and AI details start closed and preserve expansion and focus across language changes', async () => {
  let locale = 'en';
  const ui = await ready({ t: (key, params, fallback) => (locale === 'zh-CN' && key === 'adminSystem.runtime' ? '运行环境' : fallback || key).replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? '') });
  for (const id of ['system-runtime', 'system-configuration', 'system-ai']) assert.equal(ui.$('#' + id).prop('open'), false);
  ui.$('#system-runtime').prop('open', true); ui.emit(ui.$('#system-runtime')[0], 'toggle');
  ui.$('#system-runtime-summary')[0].focus();
  const count = ui.calls.length; locale = 'zh-CN'; await ui.locale();
  assert.equal(ui.calls.length, count);
  assert.equal(ui.$('#system-runtime').prop('open'), true);
  assert.equal(ui.$('#system-runtime-summary').text(), '运行环境');
  assert.equal(ui.document.activeElement, ui.$('#system-runtime-summary')[0]);
  assert.equal(ui.$('#system-configuration').prop('open'), false);
});

test('manual refresh is read-only, prevents duplicate requests and retains expansion', async () => {
  const ui = await ready(); ui.$('#system-ai').prop('open', true); ui.emit(ui.$('#system-ai')[0], 'toggle');
  await ui.click(ui.$('#system-refresh')[0]); const pending = ui.calls.at(-1);
  assert.equal(ui.$('#system-refresh').prop('disabled'), true);
  await ui.click(ui.$('#system-refresh')[0]); assert.equal(ui.calls.length, 3);
  await ui.respond(pending, info({ uptimeSeconds: 0, ai: { model: 'gemini-4-argon', configured: true, settingsWritable: false } }));
  assert.equal(ui.$('#system-ai-model').text(), 'gemini-4-argon');
  assert.equal(ui.$('#system-uptime').text(), '0s');
  assert.equal(ui.$('#system-ai').prop('open'), true);
  assert.equal(ui.calls.every(call => call.method === 'GET'), true);
});

test('a failed refresh identifies the retained snapshot and offers a usable refresh control', async () => {
  const ui = await ready(); await ui.click(ui.$('#system-refresh')[0]); await ui.reject(ui.calls.at(-1), 'Service unavailable');
  assert.equal(ui.$('#system-version').text(), '0.9.0');
  assert.match(ui.textOf(ui.$('#admin-feedback')[0]), /previously retrieved snapshot/);
  assert.equal(ui.$('#admin-feedback').attr('role'), 'alert');
  assert.equal(ui.$('#system-refresh').prop('disabled'), false);
});

test('initial load failures can be retried without an empty healthy dashboard', async () => {
  const ui = browser(); await ui.authorize(); await ui.reject(ui.calls.at(-1), 'Unavailable');
  assert.equal(ui.$('#system-overview').length, 0); assert.equal(ui.$('#system-retry').length, 1);
  await ui.click(ui.$('#system-retry')[0]); await ui.respond(ui.calls.at(-1), info());
  assert.equal(ui.$('#system-version').text(), '0.9.0');
});

test('missing fields remain unknown and do not turn into healthy states or zero metrics', async () => {
  const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), { runtime: {}, configuration: {}, ai: {} });
  assert.equal(ui.$('#system-version').text(), '—');
  assert.equal(ui.$('#system-application-status').text(), 'Unknown');
  assert.equal(ui.$('#system-database-status').text(), 'Unknown');
  assert.equal(ui.$('#system-uptime').text(), '—');
  assert.doesNotMatch(ui.textOf(ui.$('#admin-content')[0]), /undefined|NaN|0 MiB/);
});

test('invalid snapshot payloads do not produce a healthy dashboard', async () => {
  for (const value of [null, [], 'ok']) {
    const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), value);
    assert.equal(ui.$('#system-overview').length, 0); assert.equal(ui.$('#system-retry').length, 1);
  }
});

test('loss of authorization hides cached metadata and discards outstanding replies', async () => {
  const ui = await ready(); await ui.click(ui.$('#system-refresh')[0]); const stale = ui.calls.at(-1);
  await ui.reauthenticate(); await ui.respond(ui.calls.at(-1), { id: 1, username: 'former-admin', systemRole: 'USER', status: 'ACTIVE' });
  await ui.respond(stale, info({ veriqraVersion: 'should-not-appear' }));
  assert.equal(ui.$('#system-overview').length, 0);
  assert.doesNotMatch(ui.textOf(ui.$('#admin-content')[0]), /should-not-appear|0.9.0/);
  assert.match(ui.textOf(ui.$('#admin-content')[0]), /platform administrator/);
});

test('401 from the data endpoint clears metadata until a fresh admin check succeeds', async () => {
  const ui = await ready(); await ui.click(ui.$('#system-refresh')[0]); ui.calls.at(-1).reject({ status: 401, message: 'Expired' }); await flush();
  assert.equal(ui.$('#system-overview').length, 0);
  await ui.click(ui.$('#system-access-retry')[0]); assert.equal(ui.calls.at(-1).url, 'auth/me');
  await ui.respond(ui.calls.at(-1), { id: 1, username: 'admin', systemRole: 'ADMIN', status: 'ACTIVE' });
  assert.equal(ui.calls.at(-1).url, 'admin/system'); await ui.respond(ui.calls.at(-1), info());
  assert.equal(ui.$('#system-version').text(), '0.9.0');
});

test('server strings render as text, only allowlisted fields display and the AI link is fixed locally', async () => {
  const ui = browser(); await ui.authorize(); const html = '<img src=x onerror=alert(1)>';
  await ui.respond(ui.calls.at(-1), info({ veriqraVersion: html, buildCommit: html, environment: { SECRET_TOKEN: 'secret-value' },
    jdbcUrl: 'mysql://private-host:3306/private', ai: { provider: html, model: html, credentials: 'private-key-value', links: { ai: 'javascript:alert(1)' } } }));
  assert.match(ui.textOf(ui.$('#admin-content')[0]), /<img/);
  assert.equal(ui.$('#admin-content').find('img').length, 0);
  assert.doesNotMatch(ui.textOf(ui.$('#admin-content')[0]), /secret-value|private-host|private-key-value|javascript:/);
  assert.equal(ui.$('#admin-content').find('a')[0].attributes.href, 'admin/ai.html');
});

test('false flags and observed zero values remain meaningful rather than becoming missing', async () => {
  const ui = await ready();
  const value = ui.textOf(ui.$('#system-configuration')[0]);
  assert.match(value, /No/); assert.match(value, /External configuration/);
  assert.match(ui.textOf(ui.$('#system-runtime')[0]), /128 MiB/);
  assert.match(ui.textOf(ui.$('#system-runtime')[0]), /1 GiB/);
});
