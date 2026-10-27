const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/admin/admin.js'), 'utf8');
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };

function browser(pageName = 'users', options = {}) {
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
    addEventListener(name, fn) { listeners.set(name, fn); },
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
  const api = { get: url => request('GET', url), post: (url, body) => request('POST', url, body), action: request };
  class Modal {
    constructor(root) { this.root = root; modalInstances.set(root, this); }
    show() { $(this.root).addClass('show'); emit(this.root, 'shown.bs.modal'); }
    hide() { $(this.root).removeClass('show'); emit(this.root, 'hidden.bs.modal'); }
    dispose() { modalInstances.delete(this.root); }
    static getInstance(root) { return modalInstances.get(root); }
  }
  const window = { VeriqraApi: api,
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
  async function authorize(role = 'ADMIN') { await flush(); await respond(calls.at(-1), { username: 'admin', systemRole: role }); }
  async function locale() { listeners.get('veriqra:localechange')(); await flush(); }
  function tableRequest(changes) { $('#admin-user-table')[0].requestTable(changes); }
  async function reauthenticate() { listeners.get('veriqra:reauthenticated')(); await flush(); }
  return { $, calls, document, textOf, find, click, submit, respond, reject, authorize, locale, Modal, tableRequest, reauthenticate };
}

const paged = (items = [], page = 1, total = items.length) => ({ items, page, pageSize: 25, total });
test('search, role and status filters stay on the server across sorting, paging and locale refresh', async () => {
  const ui = browser('users', { locale: 'zh-CN' }); await ui.authorize(); await ui.respond(ui.calls.at(-1), paged([], 1, 64));
  let options = ui.$('#admin-user-table')[0].tableOptions;
  assert.equal(options.sidePagination, 'server'); assert.equal(options.locale, 'zh-CN');
  ui.$('#admin-user-search').val('outside page 1'); ui.$('#admin-user-role').val('USER'); ui.$('#admin-user-status').val('DISABLED');
  const searching = ui.submit(ui.$('.admin-user-filters')[0]); await flush();
  let query = new URL(ui.calls.at(-1).url, 'http://localhost/').searchParams;
  assert.equal(query.get('search'), 'outside page 1'); assert.equal(query.get('systemRole'), 'USER'); assert.equal(query.get('status'), 'DISABLED');
  assert.equal(query.get('page'), '1');
  await ui.respond(ui.calls.at(-1), paged([], 1, 64)); await searching;
  ui.tableRequest({ pageNumber: 2, pageSize: 10, sortName: 'username', sortOrder: 'asc' });
  query = new URL(ui.calls.at(-1).url, 'http://localhost/').searchParams;
  assert.equal(query.get('page'), '2'); assert.equal(query.get('pageSize'), '10');
  assert.equal(query.get('sort'), 'username'); assert.equal(query.get('order'), 'asc'); assert.equal(query.get('search'), 'outside page 1');
  await ui.respond(ui.calls.at(-1), { items: [], total: 64, page: 2, pageSize: 10 });
  await ui.locale();
  query = new URL(ui.calls.at(-1).url, 'http://localhost/').searchParams;
  assert.equal(query.get('page'), '2'); assert.equal(query.get('sort'), 'username'); assert.equal(query.get('status'), 'DISABLED');
  assert.equal(ui.$('#admin-user-search').val(), 'outside page 1');
  await ui.respond(ui.calls.at(-1), paged());
});

test('a stale table response cannot replace a more recent sort request', async () => {
  const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), paged());
  ui.tableRequest({ sortName: 'username', sortOrder: 'asc' }); const older = ui.calls.at(-1);
  ui.tableRequest({ sortName: 'username', sortOrder: 'desc' }); const newer = ui.calls.at(-1);
  await ui.respond(newer, paged([{ id: 2, username: 'latest-row', displayName: 'Latest', systemRole: 'USER', status: 'ACTIVE' }]));
  await ui.respond(older, paged([{ id: 1, username: 'obsolete-row', displayName: 'Old', systemRole: 'USER', status: 'ACTIVE' }]));
  assert.match(ui.textOf(ui.$('#admin-user-table')[0]), /latest-row/);
  assert.doesNotMatch(ui.textOf(ui.$('#admin-user-table')[0]), /obsolete-row/);
});

test('reauthentication reloads authorization and leaves an unsaved user form intact', async () => {
  const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), paged());
  await ui.click(ui.find('#admin-content', 'Create user'));
  ui.$('[name="displayName"]').val('Unsaved user'); const form = ui.$('.modal').find('form')[0];
  await ui.reauthenticate(); assert.equal(ui.calls.at(-1).url, 'auth/me');
  await ui.respond(ui.calls.at(-1), { id: 1, username: 'admin', systemRole: 'ADMIN' });
  await ui.respond(ui.calls.at(-1), paged());
  assert.equal(ui.$('.modal').find('form')[0], form); assert.equal(ui.$('[name="displayName"]').val(), 'Unsaved user');
  assert.equal(ui.calls.some(call => call.method !== 'GET'), false);
});

test('create and reset password fields share backend format limits before submission', async () => {
  const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), paged());
  await ui.click(ui.find('#admin-content', 'Create user'));
  const form = ui.$('.modal').find('form')[0];
  assert.equal(ui.$('[name="username"]').attr('pattern'), '[A-Za-z0-9._-]{3,64}');
  assert.equal(ui.$('[name="username"]').attr('maxlength'), '64');
  assert.equal(ui.$('[name="displayName"]').attr('maxlength'), '80');
  assert.equal(ui.$('[name="password"]').attr('minlength'), '12'); assert.equal(ui.$('[name="password"]').attr('maxlength'), '1024');
  ui.$('[name="username"]').val('invalid user'); ui.$('[name="displayName"]').val('Tester'); ui.$('[name="password"]').val('short');
  await ui.submit(form); assert.equal(ui.calls.some(call => call.method !== 'GET'), false);
  assert.match(ui.textOf(ui.$('.modal')[0]), /Complete the required fields/);
});

test('user status edits and password resets use their account endpoints', async () => {
  const ui = browser(); await ui.authorize();
  const user = { id: 7, username: 'tester', displayName: 'Tester', systemRole: 'USER', status: 'ACTIVE', lockVersion: 2 };
  await ui.respond(ui.calls.at(-1), paged([user]));
  await ui.click(ui.find('#admin-content', 'Edit'));
  ui.$('[name="status"]').val('DISABLED');
  const editing = ui.submit(ui.$('.modal').find('form')[0]); await flush();
  const update = ui.calls.at(-1);
  assert.equal(update.method, 'PATCH'); assert.equal(update.url, 'admin/users/7');
  assert.equal(update.body.status, 'DISABLED'); assert.equal(update.body.lockVersion, 2);
  await ui.respond(update, { ...user, status: 'DISABLED', lockVersion: 3 });
  await ui.respond(ui.calls.at(-1), paged([{ ...user, status: 'DISABLED', lockVersion: 3 }])); await editing;
  await ui.click(ui.find('#admin-content', 'Reset password'));
  ui.$('[name="password"]').val('new-user-password');
  const resetting = ui.submit(ui.$('.modal').find('form')[0]); await flush();
  const reset = ui.calls.at(-1);
  assert.equal(reset.method, 'POST'); assert.equal(reset.url, 'admin/users/7/reset-password');
  assert.equal(reset.body.password, 'new-user-password');
  await ui.respond(reset, undefined); await ui.respond(ui.calls.at(-1), paged([user])); await resetting;
});

test('authorization waits for the locale catalog before displaying its loading message', async () => {
  let ready = false, resolveInit;
  const initialization = new Promise(resolve => { resolveInit = () => { ready = true; resolve(); }; });
  const ui = browser('users', { init: () => initialization,
    t: (key, params, fallback) => key === 'admin.checkingAdministratorAccess' && ready ? '正在检查管理员权限…' : fallback || key });
  await flush();
  assert.equal(ui.textOf(ui.$('#admin-content')[0]), '');
  assert.equal(ui.$('#admin-content').attr('aria-busy'), 'true');
  assert.equal(ui.calls.length, 0, 'Authorization GET waits for initialization');
  resolveInit(); await flush();
  assert.equal(ui.textOf(ui.$('#admin-content')[0]), '正在检查管理员权限…');
  assert.doesNotMatch(ui.textOf(ui.$('#admin-content')[0]), /Checking administrator access/);
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].url, 'auth/me');
  await ui.respond(ui.calls[0], { username: 'tester', systemRole: 'USER' });
});

test('authorization failure ends checking state and Retry verifies authorization before rendering', async () => {
  const ui = browser(); await flush(); await ui.reject(ui.calls[0], 'Authorization unavailable');
  assert.match(ui.textOf(ui.$('#admin-content')[0]), /Authorization unavailable/);
  assert.doesNotMatch(ui.textOf(ui.$('#admin-content')[0]), /Checking/);
  assert.equal(ui.$('#admin-content').attr('aria-busy'), 'false');
  await ui.click(ui.find('#admin-content', 'Retry'));
  assert.equal(ui.calls.at(-1).url, 'auth/me');
  await ui.respond(ui.calls.at(-1), { username: 'tester', systemRole: 'USER' });
  assert.match(ui.textOf(ui.$('#admin-content')[0]), /Forbidden/);
  assert.equal(ui.calls.some(call => call.url.startsWith('admin/')), false);
});

test('page failure offers a GET Retry and ends loading', async () => {
  const ui = browser(); await ui.authorize(); await ui.reject(ui.calls.at(-1), 'Users unavailable');
  assert.match(ui.textOf(ui.$('#admin-content')[0]), /Users unavailable/);
  assert.equal(ui.$('#admin-content').attr('aria-busy'), 'false');
  await ui.click(ui.find('#admin-content', 'Retry'));
  assert.equal(ui.calls.at(-1).method, 'GET'); assert.match(ui.calls.at(-1).url, /^admin\/users\?/);
  await ui.respond(ui.calls.at(-1), paged());
  assert.match(ui.textOf(ui.$('#admin-content')[0]), /No matching records/);
  assert.equal(ui.calls.some(call => call.method !== 'GET'), false);
});
test('accepted user mutation plus failed refresh is explicit and Retry never repeats the write', async () => {
  const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), paged());
  await ui.click(ui.find('#admin-content', 'Create user'));
  const form = ui.$('.modal').find('form')[0];
  ui.$(form).find('[name="username"]').val('new-user'); ui.$(form).find('[name="displayName"]').val('New user'); ui.$(form).find('[name="password"]').val('TemporaryPassword123!');
  const saving = ui.submit(form); ui.submit(form); await flush();
  const write = ui.calls.at(-1); assert.equal(write.method, 'POST'); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  await ui.respond(write, { id: 10 });
  assert.equal(ui.$('.modal').length, 0);
  await ui.reject(ui.calls.at(-1), 'Refresh unavailable'); await saving;
  assert.match(ui.textOf(ui.$('#admin-feedback')[0]), /Change saved, but the page could not be refreshed/);
  await ui.click(ui.find('#admin-feedback', 'Retry'));
  assert.equal(ui.calls.at(-1).method, 'GET'); await ui.respond(ui.calls.at(-1), paged());
  assert.equal(ui.$('#admin-feedback').text(), 'Change saved.'); assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
});

test('rejected mutation keeps editable modal values and re-enables submission without a refresh', async () => {
  const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), paged()); await ui.click(ui.find('#admin-content', 'Create user'));
  const form = ui.$('.modal').find('form')[0];
  ui.$(form).find('[name="username"]').val('new-user'); ui.$(form).find('[name="displayName"]').val('Typed display name'); ui.$(form).find('[name="password"]').val('TemporaryPassword123!');
  const saving = ui.submit(form); await flush(); const before = ui.calls.length;
  await ui.reject(ui.calls.at(-1), 'User creation rejected'); await saving;
  assert.equal(ui.calls.length, before); assert.equal(ui.$('.modal').length, 1);
  assert.equal(ui.$(form).find('[name="displayName"]').val(), 'Typed display name');
  assert.match(ui.textOf(ui.$('.modal')[0]), /User creation rejected/);
  assert.equal(ui.find('.modal', 'Create user').disabled, false);
  assert.doesNotMatch(ui.textOf(ui.$('#admin-feedback')[0]), /Change saved/);
});

test('modal has a visible programmatic title, direct flex sections, autofocus and dismissal focus', async () => {
  const ui = browser(); await ui.authorize(); await ui.respond(ui.calls.at(-1), paged());
  const opener = ui.find('#admin-content', 'Create user'); await ui.click(opener);
  let root = ui.$('.modal')[0], form = ui.$(root).find('form')[0];
  const title = ui.$(root).find('.modal-title')[0];
  assert.equal(root.getAttribute('aria-labelledby'), title.id); assert.equal(title.content, 'Create user');
  assert.ok(form.classes.has('modal-content')); assert.equal(form.parent.tag, 'div'); assert.ok(form.parent.classes.has('modal-dialog'));
  assert.deepEqual(form.children.map(node => [...node.classes][0]), ['modal-header', 'modal-body', 'modal-footer']);
  assert.equal(ui.document.activeElement.name, 'username');
  await ui.click(ui.find('.modal', 'Cancel')); assert.equal(ui.document.activeElement, opener); assert.equal(ui.$('.modal').length, 0);
  await ui.click(opener); root = ui.$('.modal')[0]; ui.Modal.getInstance(root).hide();
  assert.equal(ui.document.activeElement, opener, 'Escape/hidden dismissal restores the connected opener');
  await ui.click(opener); ui.$(opener).remove(); await ui.click(ui.find('.modal', 'Cancel'));
  assert.equal(ui.document.activeElement, ui.$('#admin-content')[0], 'A detached opener uses the connected page fallback');
  assert.equal(ui.calls.some(call => call.method !== 'GET'), false);
});
