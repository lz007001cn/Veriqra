const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../main/webapp/assets/js/project-settings.js'), 'utf8');
const flush = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };

function browser() {
  const nodes = new Map(), calls = [], listeners = new Map(), guards = new Map();
  class Node {
    constructor(tag = 'div', attrs = {}) { this.tag = tag; this.attrs = attrs; this.value = ''; this.text = ''; this.children = []; this.events = {}; this.classes = new Set((attrs.class || '').split(' ')); if (attrs.id) nodes.set('#' + attrs.id, this); }
    reportValidity() { return true; }
  }
  function all(node) { return node.children.flatMap(child => [child, ...all(child)]); }
  function match(node, selector) { return selector.startsWith('#') ? node.attrs.id === selector.slice(1) : node.tag === selector; }
  class Collection extends Array {
    each(fn) { this.forEach((node, index) => fn.call(node, index, node)); return this; }
    append(...values) { return this.each(function () { values.forEach(value => this.children.push(...value)); }); }
    text(value) { if (value === undefined) return this[0]?.text; return this.each(function () { this.text = String(value); }); }
    val(value) { if (value === undefined) return this[0]?.value || ''; return this.each(function () { this.value = String(value == null ? '' : value); }); }
    empty() { return this.each(function () { this.children = []; this.text = ''; this.value = ''; }); }
    prop(key, value) { if (value === undefined) return this[0]?.[key]; return this.each(function () { this[key] = value; }); }
    on(names, fn) { return this.each(function () { names.split(' ').forEach(name => (this.events[name] ||= []).push(fn)); }); }
    toggleClass(name, enabled) { return this.each(function () { if (enabled) this.classes.add(name); else this.classes.delete(name); }); }
    addClass(name) { return this.toggleClass(name, true); }
    removeClass(name) { return this.toggleClass(name, false); }
    hasClass(name) { return this[0]?.classes.has(name) || false; }
    find(selectors) { return Collection.from(this.flatMap(node => all(node).filter(child => selectors.split(',').some(selector => match(child, selector))))); }
    trigger(name) { return this.each(function () { if (name === 'focus') this.focused = true; }); }
  }
  const document = new Node('document');
  document.addEventListener = (name, fn) => { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); };
  function $(input) {
    if (input instanceof Node) return Collection.from([input]);
    if (input.startsWith('<')) {
      const attrs = Object.fromEntries([...input.matchAll(/([\w-]+)="([^"]*)"/g)].map(value => [value[1], value[2]]));
      return Collection.from([new Node(/^<(\w+)/.exec(input)[1], attrs)]);
    }
    if (!nodes.has(input)) nodes.set(input, new Node('div', { id: input.slice(1) }));
    return Collection.from([nodes.get(input)]);
  }
  const api = {};
  for (const method of ['get', 'post', 'delete']) api[method] = (url, body) => {
    let resolve, reject; const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ method, url, body, resolve, reject }); return result;
  };
  let route = { view: 'project-settings' };
  const window = { VeriqraApi: api, VeriqraQaNavigation: { read: () => route }, VeriqraDraftGuard: { register: (name, value) => guards.set(name, value) },
    I18n: { t: (key, values, fallback) => fallback || key } };
  vm.runInNewContext(source, { jQuery: $, window, document });
  function emit(type, detail) { for (const fn of document.events[type] || []) fn({ originalEvent: { detail } }); for (const fn of listeners.get(type) || []) fn({ detail }); }
  async function fire(id, name = 'submit') { const node = $(id)[0]; await Promise.all((node.events[name] || []).map(fn => fn.call(node, { preventDefault() {} }))); }
  function project(id = 7, status = 'ACTIVE') { route = { view: 'project-settings', projectId: String(id) }; emit('veriqra:project', { project: { id, status } }); }
  async function loaded(actor, members = [], managers = []) { const offset = calls.length - 3; calls[offset].resolve(actor); calls[offset + 1].resolve(members); calls[offset + 2].resolve(managers); await flush(); }
  return { $, calls, guards, emit, fire, project, loaded, nodes, i18n: window.I18n };
}
const admin = { id: 1, username: 'admin', systemRole: 'ADMIN', status: 'ACTIVE' };
const member = (userId = 2, projectRole = 'TESTER') => ({ userId, username: 'user' + userId, displayName: 'User ' + userId, projectRole, status: 'ACTIVE', userStatus: 'ACTIVE' });

test('first project render uses the catalog loaded after script initialization', async () => {
  const ui = browser();
  const chinese = require('../../main/webapp/i18n/zh-CN.json');
  ui.i18n.t = (key, values, fallback) => chinese[key] || fallback || key;
  ui.project(); await ui.loaded(admin, [member()]);
  assert.equal(ui.$('#project-settings-members-heading').text(), '项目成员');
  assert.equal(ui.$('#project-settings-username-label').text(), '已有用户名');
  assert.equal(ui.$('#project-settings-add').text(), '添加成员');
  assert.equal(ui.$('#project-settings-appoint').text(), '任命负责人');
  assert.deepEqual(ui.nodes.get('#project-settings-role').children.map(node => node.text), ['测试者', '开发者']);
});

test('project settings retains members and managers without any retired workflow requests', async () => {
  const ui = browser(); ui.project(); await ui.loaded(admin, [member()]);
  assert.deepEqual(ui.calls.map(call => call.url), ['auth/me', 'projects/7/members', 'projects/7/managers']);
  assert.equal(ui.$('#project-settings-member-form').hasClass('d-none'), false);
  assert.equal(ui.$('#project-settings-manager-form').hasClass('d-none'), false);
  assert.deepEqual(ui.nodes.get('#project-settings-role').children.map(node => node.value), ['TESTER', 'DEVELOPER']);
  ui.$('#project-settings-username').val('existing-user'); ui.$('#project-settings-role').val('DEVELOPER');
  const work = ui.fire('#project-settings-member-form'); await flush();
  const write = ui.calls.at(-1); assert.equal(write.url, 'projects/7/members');
  assert.deepEqual(JSON.parse(JSON.stringify(write.body)), { username: 'existing-user', projectRole: 'DEVELOPER' });
  write.resolve(member(3, 'DEVELOPER')); await flush(); await ui.loaded(admin, [member(), member(3, 'DEVELOPER')]); await work;
  assert.equal(ui.$('#project-settings-username').val(), ''); assert.equal(ui.guards.get('project-settings').dirty(), false);
});

test('project managers can add members while appointment remains administrator maintenance', async () => {
  const ui = browser(); ui.project(); await ui.loaded({ id: 2, systemRole: 'USER', status: 'ACTIVE' }, [member()], [{ userId: 2, status: 'ACTIVE' }]);
  assert.equal(ui.$('#project-settings-member-form').hasClass('d-none'), false);
  assert.equal(ui.$('#project-settings-manager-form').hasClass('d-none'), true);
  const reader = browser(); reader.project(); await reader.loaded({ id: 2, systemRole: 'USER', status: 'ACTIVE' }, [member(2, 'TESTER')]);
  assert.equal(reader.$('#project-settings-member-form').hasClass('d-none'), true);
  reader.$('#project-settings-username').val('blocked'); await reader.fire('#project-settings-member-form');
  assert.equal(reader.calls.length, 3);
});

test('manager appointment sends a numeric ID and archived projects keep maintenance read only', async () => {
  const ui = browser(); ui.project(); await ui.loaded(admin, [member()]);
  ui.$('#project-settings-manager').val('2'); await ui.fire('#project-settings-manager', 'change');
  assert.equal(ui.$('#project-settings-appoint').prop('disabled'), false);
  const work = ui.fire('#project-settings-manager-form'); await flush();
  const write = ui.calls.at(-1); assert.equal(write.url, 'projects/7/managers'); assert.equal(write.body.userId, 2);
  write.resolve({ userId: 2, status: 'ACTIVE' }); await flush(); await ui.loaded(admin, [member()], [{ userId: 2, status: 'ACTIVE' }]); await work;
  assert.equal(ui.$('#project-settings-manager').val(), '');
  const archived = browser(); archived.project(7, 'ARCHIVED'); await archived.loaded(admin, [member()]);
  assert.equal(archived.$('#project-settings-member-form').hasClass('d-none'), true);
  assert.equal(archived.$('#project-settings-manager-form').hasClass('d-none'), true);
  await archived.fire('#project-settings-manager-form'); assert.equal(archived.calls.length, 3);
});

test('late project responses cannot show another project or clear its new member draft', async () => {
  const ui = browser(); ui.project(7); const old = ui.calls.slice(); ui.project(8); await ui.loaded(admin, [member(8)]);
  ui.$('#project-settings-username').val('Retained entry');
  old[0].resolve(admin); old[1].resolve([member(7)]); old[2].resolve([]); await flush();
  assert.equal(ui.$('#project-settings-username').val(), 'Retained entry');
  const rendered = ui.nodes.get('#project-settings-members').children.flatMap(node => node.children).map(node => node.text).join(' ');
  assert.match(rendered, /User 8/); assert.doesNotMatch(rendered, /User 7/);
  ui.emit('veriqra:localechange'); assert.equal(ui.$('#project-settings-username').val(), 'Retained entry');
  const work = ui.fire('#project-settings-member-form'); await flush(); ui.calls.at(-1).reject({ status: 409, message: 'Already a member' }); await work;
  assert.equal(ui.$('#project-settings-username').val(), 'Retained entry'); assert.match(ui.$('#project-settings-notice').text(), /Already a member/);
});
