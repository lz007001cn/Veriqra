// Run with: node --test src/test/js/*.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const web = path.resolve(__dirname, '../../main/webapp');
const source = name => fs.readFileSync(path.join(web, 'assets/js', name), 'utf8');
const catalogs = Object.fromEntries(['en', 'zh-CN'].map(locale =>
  [locale, JSON.parse(fs.readFileSync(path.join(web, 'i18n', locale + '.json'), 'utf8'))]));

function deferred() {
  let settled, value;
  const done = [], fail = [], always = [];
  const call = (callbacks, arg) => callbacks.forEach(callback => callback(arg));
  const result = {
    done(callback) { if (settled === 'resolved') callback(value); else done.push(callback); return result; },
    fail(callback) { if (settled === 'rejected') callback(value); else fail.push(callback); return result; },
    always(callback) { if (settled) callback(value); else always.push(callback); return result; },
    resolve(arg) { settled = 'resolved'; value = arg; call(done, arg); call(always, arg); },
    reject(arg) { settled = 'rejected'; value = arg; call(fail, arg); call(always, arg); },
    promise() { return result; }
  };
  return result;
}

function page(locale) {
  const nodes = new Map(), requests = [], navigation = [], listeners = new Map();
  class Node {
    constructor() { this.value = ''; this.content = ''; this.hidden = true; this.handlers = {}; this.children = new Map(); }
    on(name, callback) { this.handlers[name] = callback; return this; }
    text(value) { if (value === undefined) return this.content; this.content = value; return this; }
    toggleClass(name, value) { if (name === 'd-none') this.hidden = value; return this; }
    prop(name, value) { if (value === undefined) return this[name]; this[name] = value; return this; }
    find(name) { if (!this.children.has(name)) this.children.set(name, new Node()); return this.children.get(name); }
    val(value) { if (value === undefined) return this.value; this.value = value; return this; }
  }
  function $(selector) { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); }
  $.Deferred = deferred;
  $.ajax = settings => { const call = deferred(); requests.push({ settings, call }); return call; };
  const t = (key, params, fallback) => (catalogs[locale][key] || fallback || key)
    .replace(/\{(\w+)\}/g, (match, name) => params?.[name] ?? match);
  const window = {
    location: { pathname: '/login.html', replace: target => navigation.push(target) },
    I18n: { init: async () => {}, t, error: error => error.message, formatRetryDelay: seconds => seconds === 287
      ? t('auth.retryMinutesSeconds', { minutes: 4, seconds: 47 }) : null }
  };
  const document = { baseURI: 'http://localhost:8080/veriqra/login.html', addEventListener: (name, fn) => listeners.set(name, fn) };
  const context = { window, document, jQuery: $, URL, Number };
  vm.runInNewContext(source('api.js'), context);
  vm.runInNewContext(source('login.js'), context);
  return { nodes, requests, navigation, $, api: window.VeriqraApi,
    switchLocale(next) { locale = next; listeners.get('veriqra:localechange')?.(); } };
}

function failure(status, retryAfter) {
  return { status, responseJSON: { error: { code: status === 429 ? 'TOO_MANY_REQUESTS' : 'UNAUTHENTICATED' } },
    getResponseHeader: name => name === 'Retry-After' ? retryAfter : null };
}

test('unauthenticated auth/me is a normal login page, including a second visit', async () => {
  for (let visit = 0; visit < 2; visit++) {
    const browser = page('zh-CN');
    await Promise.resolve();
    assert.equal(browser.requests[0].settings.url, 'http://localhost:8080/veriqra/api/auth/me');
    browser.requests[0].call.reject(failure(401));
    assert.equal(browser.nodes.get('#login-error').content, '');
    assert.equal(browser.nodes.get('#login-error').hidden, true);
    assert.deepEqual(browser.navigation, []);
  }
});

test('wrong password and login rate limit are distinct, localized, and preserve Retry-After', async () => {
  for (const [locale, invalid, limited] of [
    ['en', 'Invalid username or password.', 'Too many login attempts. Please try again in 4 min 47 sec.'],
    ['zh-CN', '用户名或密码错误。', '登录尝试次数过多，请在 4 分 47 秒后重试。']
  ]) {
    const browser = page(locale);
    await Promise.resolve();
    browser.requests[0].call.reject(failure(401));
    browser.$('#username').val('test-user');
    browser.$('#password').val('wrong-password');
    const submit = () => browser.nodes.get('#login-form').handlers.submit({ preventDefault() {} });
    submit();
    browser.requests[1].call.reject(failure(401));
    assert.equal(browser.nodes.get('#login-error').content, invalid);
    submit();
    browser.requests[2].call.reject(failure(429, '287'));
    assert.equal(browser.nodes.get('#login-error').content, limited);
    assert.equal(browser.nodes.get('#login-error').hidden, false);
  }
});

test('existing validation and wrong-password feedback retranslate both ways without another request', async () => {
  const browser = page('en'); await Promise.resolve();
  browser.requests[0].call.reject(failure(401));
  const submit = () => browser.nodes.get('#login-form').handlers.submit({ preventDefault() {} });
  submit();
  assert.equal(browser.$('#login-error').text(), catalogs.en['auth.enterYourUsernameAndPassword']);
  browser.switchLocale('zh-CN');
  assert.equal(browser.$('#login-error').text(), catalogs['zh-CN']['auth.enterYourUsernameAndPassword']);
  browser.$('#username').val('test-user'); browser.$('#password').val('wrong-password'); submit();
  browser.requests[1].call.reject(failure(401));
  assert.equal(browser.$('#login-error').text(), catalogs['zh-CN']['auth.invalidUsernameOrPassword']);
  browser.switchLocale('en');
  assert.equal(browser.$('#login-error').text(), catalogs.en['auth.invalidUsernameOrPassword']);
  assert.equal(browser.requests.length, 2);
  assert.deepEqual(browser.navigation, []);
});

test('language switch retains the pending login lock and immediately translates the busy label', async () => {
  const browser = page('en'); await Promise.resolve(); browser.requests[0].call.reject(failure(401));
  browser.$('#username').val('test-user'); browser.$('#password').val('wrong-password');
  const submit = () => browser.nodes.get('#login-form').handlers.submit({ preventDefault() {} });
  submit(); browser.switchLocale('zh-CN'); submit();
  assert.equal(browser.$('#login-submit').prop('disabled'), true);
  assert.equal(browser.$('#login-submit').find('.spinner-border').hidden, false);
  assert.equal(browser.$('#login-submit').find('.button-label').text(), catalogs['zh-CN']['auth.signingIn']);
  assert.equal(browser.requests.length, 2, 'Switching languages cannot create or replay a login attempt');
  browser.requests[1].call.reject(failure(503));
  assert.equal(browser.$('#login-submit').prop('disabled'), false);
  assert.equal(browser.$('#login-submit').find('.spinner-border').hidden, true);
  assert.equal(browser.$('#login-submit').find('.button-label').text(), catalogs['zh-CN']['common.signIn']);
});

test('visible rate-limit, network and server failures follow locale switches without replaying requests', async () => {
  for (const [status, retryAfter, key, time] of [
    [429, '287', 'auth.loginRateLimited', ['4 min 47 sec', '4 分 47 秒']],
    [429, null, 'auth.loginRateLimitedGeneric'],
    [0, null, 'http.theRequestCouldNotBeCompleted'],
    [503, null, 'http.theServerIsUnavailablePleaseTryAgainLater']
  ]) {
    const browser = page('en'); await Promise.resolve(); browser.requests[0].call.reject(failure(401));
    browser.$('#username').val('test-user'); browser.$('#password').val('wrong-password');
    browser.nodes.get('#login-form').handlers.submit({ preventDefault() {} });
    browser.requests[1].call.reject(failure(status, retryAfter));
    for (const locale of ['en', 'zh-CN', 'en']) {
      browser.switchLocale(locale);
      assert.equal(browser.$('#login-error').text(), catalogs[locale][key].replace('{time}', time?.[locale === 'en' ? 0 : 1]));
      assert.equal(browser.$('#login-error').hidden, false);
    }
    assert.equal(browser.requests.length, 2);
    assert.deepEqual(browser.navigation, []);
  }
});

test('auth/me read failures retranslate while a 401 remains the normal silent login state', async () => {
  const browser = page('en'); await Promise.resolve(); browser.requests[0].call.reject(failure(503));
  browser.switchLocale('zh-CN');
  assert.equal(browser.$('#login-error').text(), catalogs['zh-CN']['http.theServerIsUnavailablePleaseTryAgainLater']);
  assert.equal(browser.requests.length, 1);
});

test('UI message descriptors preserve API status, code, Retry-After, and localized message semantics', async () => {
  const browser = page('en'); await Promise.resolve(); browser.requests[0].call.reject(failure(401));
  let rejected;
  browser.api.post('auth/login', {}, { authRequired: false }).fail(error => { rejected = error; });
  browser.requests[1].call.reject(failure(429, '287'));
  assert.equal(rejected.status, 429); assert.equal(rejected.code, 'TOO_MANY_REQUESTS');
  assert.equal(rejected.message, 'Too many login attempts. Please try again in 4 min 47 sec.');
  assert.equal(rejected.messageKey, 'auth.loginRateLimited');
  assert.equal(rejected.messageArgs, null, 'The translated retry duration is recomputed when rendered');
  assert.equal(rejected.retryAfterSeconds, 287);
  assert.equal(browser.requests[1].settings.method, 'POST');
  assert.deepEqual(browser.navigation, []);
});

test('API errors preserve typed retest reasons and use localized public messages', async () => {
  const browser = page('en'); await Promise.resolve(); browser.requests[0].call.reject(failure(401));
  let rejected;
  browser.api.post('projects/7/defects/70/close', { expectedVersion: 3 }).fail(error => { rejected = error; });
  const response = failure(409);
  response.responseJSON.error = { code: 'CONFLICT', reasonCode: 'LATER_NON_PASS', message: 'internal-text-is-not-ui-copy' };
  browser.requests[1].call.reject(response);
  assert.equal(rejected.code, 'CONFLICT');
  assert.equal(rejected.reasonCode, 'LATER_NON_PASS');
  assert.equal(rejected.status, 409);
  assert.equal(rejected.message, catalogs.en['http.thisItemHasChangedRefreshAndTryAgain']);
  assert.equal(rejected.message.includes('internal-text'), false);
});
