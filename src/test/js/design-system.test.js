const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const web = path.join(root, 'src/main/webapp');
function htmlPages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlPages(file) : file.endsWith('.html') ? [path.relative(root, file).replaceAll('\\', '/')] : [];
  });
}
// The old administration landing page only redirects to user maintenance.
const pages = htmlPages(web).filter(file => file !== 'src/main/webapp/admin/index.html');

// This small parser reads start-tag attributes only. It deliberately ignores CSS,
// text and layout, so visual changes remain free while behavior hooks stay intact.
function elements(html) {
  const result = [];
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of source.matchAll(/<([a-z][\w-]*)\b([^<>]*?)>/gi)) {
    const attributes = {};
    for (const attribute of match[2].matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
    }
    result.push({ tag: match[1].toLowerCase(), attributes, offset: match.index });
  }
  return result;
}
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
test('retained pages have unique IDs and labels target existing controls', () => {
  for (const file of pages) {
    const current = elements(read(file));
    const ids = current.filter(element => has(element.attributes, 'id')).map(element => element.attributes.id);
    assert.equal(new Set(ids).size, ids.length, file + ': duplicate static ID');
    for (const label of current.filter(element => element.tag === 'label' && element.attributes.for)) {
      assert.ok(ids.includes(label.attributes.for), file + ': missing label target #' + label.attributes.for);
    }
  }
});

test('retained pages load existing local resources and destinations', () => {
  for (const file of pages) {
    const current = elements(read(file));
    const directory = path.dirname(path.join(root, file));
    const base = current.find(element => element.tag === 'base')?.attributes.href || './';
    for (const element of current) {
      const value = element.attributes.src || (['a', 'link'].includes(element.tag) && element.attributes.href);
      if (!value || value.startsWith('#') || /^(?:https?:|data:|mailto:|\/\/)/.test(value)) continue;
      const target = path.resolve(directory, base, value.split(/[?#]/)[0]);
      assert.ok(fs.existsSync(target), file + ': missing local destination ' + value);
    }
  }
});

test('every page keeps synchronous locale bootstrap before styles and locale switches', () => {
  for (const file of pages) {
    const html = read(file);
    const tags = elements(html);
    const scripts = tags.filter(element => element.tag === 'script' &&
      element.attributes.src === 'assets/js/locale-bootstrap.js');
    assert.equal(scripts.length, 1, file + ': locale bootstrap must load exactly once');
    const script = scripts[0];
    assert.ok(!has(script.attributes, 'defer') && !has(script.attributes, 'async'), file + ': locale bootstrap must run synchronously');
    assert.notEqual(script.attributes.type, 'module', file + ': locale bootstrap cannot be deferred as a module');
    const headEnd = html.search(/<\/head\s*>/i);
    assert.ok(script.offset < headEnd, file + ': locale bootstrap must remain in the head');
    for (const stylesheet of tags.filter(element => element.tag === 'link' && element.attributes.rel === 'stylesheet')) {
      assert.ok(script.offset < stylesheet.offset, file + ': locale bootstrap must precede styles');
    }
    assert.ok(tags.some(element => has(element.attributes, 'data-locale-switch')), file + ': missing locale switch');
  }
});

test('English and Chinese catalogs cover the same keys and all static translated attributes', () => {
  const en = JSON.parse(fs.readFileSync(path.join(web, 'i18n/en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(web, 'i18n/zh-CN.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const file of pages) {
    for (const element of elements(read(file))) {
      for (const key of ['data-i18n', 'data-i18n-placeholder', 'data-i18n-title', 'data-i18n-aria-label']) {
        if (!has(element.attributes, key)) continue;
        const translation = element.attributes[key];
        assert.ok(has(en, translation) && has(zh, translation), file + ': missing translation ' + translation);
      }
    }
  }
});

const css = fs.readFileSync(path.join(web, 'assets/css/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = Object.fromEntries([...css.matchAll(/(--vq-[\w-]+)\s*:\s*([^;{}]+);/g)]
  .map(match => [match[1], match[2].trim()]));
function color(value, visited = new Set()) {
  const reference = /^var\((--vq-[\w-]+)\)$/.exec(value || '');
  if (reference) {
    assert.ok(!visited.has(reference[1]), 'Circular token reference: ' + reference[1]);
    visited.add(reference[1]);
    return color(tokens[reference[1]], visited);
  }
  assert.match(value || '', /^#[\da-f]{3}(?:[\da-f]{3})?$/i, 'Expected opaque text/surface color: ' + value);
  const hex = value.length === 4 ? [...value.slice(1)].map(digit => digit + digit).join('') : value.slice(1);
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}
function luminance(rgb) {
  const linear = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(foreground, background) {
  const a = luminance(color(foreground));
  const b = luminance(color(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
test('normal text, actions and semantic status token pairs meet 4.5:1 contrast', () => {
  const pairs = [];
  for (const text of ['--vq-text', '--vq-text-secondary', '--vq-text-muted']) {
    for (const surface of ['--vq-bg', '--vq-surface', '--vq-surface-raised', '--vq-surface-muted']) pairs.push([text, surface]);
  }
  pairs.push(['--vq-accent', '--vq-surface'], ['--vq-accent-hover', '--vq-accent-soft']);
  for (const tone of ['success', 'warning', 'danger', 'info']) pairs.push(['--vq-' + tone, '--vq-' + tone + '-soft']);
  for (const [foreground, background] of pairs) {
    const ratio = contrast(tokens[foreground], tokens[background]);
    assert.ok(ratio >= 4.5, foreground + ' on ' + background + ': ' + ratio.toFixed(3) + ':1 is below 4.5:1');
  }
  for (const background of ['--vq-accent', '--vq-accent-hover']) {
    const ratio = contrast('#fff', tokens[background]);
    assert.ok(ratio >= 4.5, 'Primary button white on ' + background + ': ' + ratio.toFixed(3) + ':1');
  }
});

test('archived projects explicitly use the neutral status palette', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = rules.find(match => match[1].split(',').some(selector =>
    selector.trim() === '.is-archived .status-pill' || /\[data-vq-state=["']?ARCHIVED["']?\]/.test(selector)) &&
    /--vq-state-text\s*:/.test(match[2]) && /--vq-state-bg\s*:/.test(match[2]));
  assert.ok(rule, 'Archived projects need an explicit neutral badge rule.');
  const declarations = Object.fromEntries([...rule[2].matchAll(/(--vq-state-(?:text|bg))\s*:\s*([^;]+);/g)]
    .map(match => [match[1], match[2].trim()]));
  assert.deepEqual(color(declarations['--vq-state-text']), color(tokens['--vq-text-secondary']));
  assert.deepEqual(color(declarations['--vq-state-bg']), color(tokens['--vq-surface-muted']));
});
