(function (global) {
  'use strict';
  const storageKey = 'veriqra.locale';
  const displayTimeZone = 'Asia/Shanghai';
  const scriptUrl = document.currentScript && document.currentScript.src;
  const resourceBase = scriptUrl ? new URL('../../i18n/', scriptUrl) : new URL('i18n/', document.baseURI);
  const catalogs = {};
  let locale = 'en';
  let initialized = false;
  let initPromise = null;
  let localeRequest = 0;

  function resourceUrl(name) {
    const url = new URL(name + '.json', resourceBase).href;
    return global.VeriqraAssets ? global.VeriqraAssets.url(url) : url;
  }
  async function load(name) {
    if (catalogs[name]) return catalogs[name];
    const response = await global.fetch(resourceUrl(name), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Translation resource unavailable: ' + name);
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid translation resource');
    catalogs[name] = value;
    return value;
  }
  function interpolate(value, params) {
    return String(value).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, function (match, name) {
      return params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
    });
  }
  function t(key, params, fallback) {
    const value = (catalogs[locale] && catalogs[locale][key]) || (catalogs.en && catalogs.en[key]) || fallback || key;
    return interpolate(value, params);
  }
  function apply(root) {
    const parent = root || document;
    const nodes = [];
    if (parent.nodeType === 1 && parent.matches('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]')) nodes.push(parent);
    nodes.push(...parent.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]'));
    nodes.forEach(function (node) {
      [['data-i18n', 'textContent'], ['data-i18n-placeholder', 'placeholder'],
        ['data-i18n-title', 'title'], ['data-i18n-aria-label', 'aria-label']].forEach(function (entry) {
        const key = node.getAttribute(entry[0]);
        if (!key) return;
        const original = 'data-i18n-fallback-' + entry[1].toLowerCase().replace(/[^a-z]/g, '-');
        if (!node.hasAttribute(original)) node.setAttribute(original, entry[1] === 'textContent' ? node.textContent : node.getAttribute(entry[1]) || '');
        const value = t(key, null, node.getAttribute(original));
        if (entry[1] === 'textContent') node.textContent = value;
        else node.setAttribute(entry[1], value);
      });
    });
    document.documentElement.lang = locale;
  }
  function updateSwitcher() {
    document.querySelectorAll('[data-locale-switch]').forEach(function (select) { select.value = locale; });
  }
  async function setLocale(next) {
    if (next !== 'en' && next !== 'zh-CN') return false;
    const request = ++localeRequest;
    try { await load(next); } catch (error) { console.warn(error); if (request === localeRequest) updateSwitcher(); return false; }
    if (request !== localeRequest) return false;
    locale = next;
    try { global.localStorage.setItem(storageKey, next); } catch (_) { /* Preference remains in this page. */ }
    apply(); updateSwitcher();
    document.dispatchEvent(new CustomEvent('veriqra:localechange', { detail: { locale: locale } }));
    return true;
  }
  function init() {
    if (initialized) return Promise.resolve();
    if (initPromise) return initPromise;
    initPromise = (async function () {
      locale = global.VeriqraLocaleBootstrap ? global.VeriqraLocaleBootstrap.locale : 'en';
      try { await load('en'); } catch (error) { console.warn(error); }
      if (locale !== 'en') {
        try { await load(locale); } catch (error) { console.warn(error); locale = 'en'; }
      }
      apply(); updateSwitcher();
      document.addEventListener('change', function (event) {
        if (event.target.matches('[data-locale-switch]')) setLocale(event.target.value);
      });
      initialized = true;
    })();
    return initPromise;
  }
  function enumLabel(value, category) {
    if (value == null || value === '') return '—';
    const key = (category || 'status') + '.' + String(value).toLowerCase();
    return t(key, null, String(value).replaceAll('_', ' '));
  }
  const errorKeys = Object.freeze({
    LAST_ADMIN_REQUIRED: 'errors.lastAdminRequired', USERNAME_CONFLICT: 'errors.usernameConflict',
    OPTIMISTIC_LOCK_CONFLICT: 'errors.optimisticLock', FORBIDDEN: 'errors.forbidden'
  });
  function error(error, fallback) {
    const key = error && errorKeys[error.code];
    return key ? t(key, null, error.message || fallback) : (error && error.message) || t('common.unexpectedError', null, fallback || 'The request could not be completed.');
  }
  function parseTimestamp(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const text = String(value || '').trim();
    // DATETIME(6) is stored in a UTC JDBC session and serialized as LocalDateTime without Z.
    // An explicit Z/offset (for example System serverTime) already identifies its instant.
    if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)) return null;
    const normalized = text.length === 10 ? text + 'T00:00:00' : text.replace(' ', 'T');
    const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : normalized + 'Z');
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function formatDate(value) {
    if (value == null || value === '') return '—';
    const date = parseTimestamp(value);
    return date ? new Intl.DateTimeFormat(locale, { timeZone: displayTimeZone,
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : String(value);
  }
  function formatDateTime(value) {
    if (value == null || value === '') return '—';
    const date = parseTimestamp(value);
    return date ? new Intl.DateTimeFormat(locale, { timeZone: displayTimeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date) : String(value);
  }
  function formatRetryDelay(value) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds < 1) return null;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    if (!minutes) return t('auth.retrySeconds', { seconds: formatNumber(remaining) }, '{seconds} seconds');
    if (!remaining) return t('auth.retryMinutes', { minutes: formatNumber(minutes) }, '{minutes} minutes');
    return t('auth.retryMinutesSeconds', { minutes: formatNumber(minutes), seconds: formatNumber(remaining) },
      '{minutes} minutes {seconds} seconds');
  }
  function toUtcFilter(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return value;
    const target = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0));
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: displayTimeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let instant = target;
    // Resolve a wall-clock value using the IANA zone, independent of the browser's own zone.
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
      const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
      const difference = target - shown;
      if (!difference) break;
      instant += difference;
    }
    return new Date(instant).toISOString().slice(0, 19);
  }
  function formatNumber(value) {
    if (value == null || value === '') return '—';
    return new Intl.NumberFormat(locale).format(value);
  }
  global.I18n = Object.freeze({ init, t, getLocale: function () { return locale; }, setLocale, apply,
    enumLabel, error, formatDate, formatDateTime, formatNumber, formatRetryDelay, toUtcFilter,
    resourceUrl: resourceUrl });
})(window);
