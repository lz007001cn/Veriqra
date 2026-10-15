const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const web = path.join(root, 'src/main/webapp');
const baseline = '2427fdee76853d132df1ce48a85308bec6826a14';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const pages = git(['ls-tree', '-r', '--name-only', baseline, '--', 'src/main/webapp'])
  .trim().split(/\r?\n/).filter(file => file.endsWith('.html'));

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
const before = file => git(['show', baseline + ':' + file]);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const controls = new Set(['form', 'input', 'select', 'textarea', 'button', 'option']);
const validation = new Set(['id', 'name', 'type', 'required', 'pattern', 'maxlength',
  'minlength', 'min', 'max', 'step', 'accept', 'multiple', 'autocomplete', 'value']);

test('all eleven baseline pages retain IDs and form behavior contracts', () => {
  assert.equal(pages.length, 11, 'The baseline UI inventory must contain eleven pages.');
  for (const file of pages) {
    const previous = elements(before(file));
    const current = elements(read(file));
    const ids = current.filter(element => has(element.attributes, 'id'))
      .map(element => element.attributes.id);
    assert.equal(new Set(ids).size, ids.length, file + ': duplicate static ID');
    for (const element of previous.filter(element => has(element.attributes, 'id'))) {
      assert.ok(ids.includes(element.attributes.id), file + ': missing #' + element.attributes.id);
    }
    const available = current.filter(element => controls.has(element.tag));
    for (const element of previous.filter(element => controls.has(element.tag))) {
      // R1 deliberately replaces the two numeric-assignee inputs with real project-member selectors.
      if (file === 'src/main/webapp/index.html' && ['defect-action-assignee', 'defect-create-assignee'].includes(element.attributes.id)) {
        const id = element.attributes.id;
        const replacement = available.findIndex(candidate => candidate.tag === 'select' && candidate.attributes.id === id && candidate.attributes['aria-describedby'] === id + '-status');
        assert.ok(replacement >= 0, file + ': project-member select must preserve #' + id + ' and describe its loading/failure state');
        assert.ok(current.some(candidate => candidate.tag === 'input' && candidate.attributes.id === id + '-search' && candidate.attributes.type === 'search'), file + ': member selector must have keyboard-accessible search');
        available.splice(replacement, 1);
        continue;
      }
      const contract = Object.fromEntries(Object.entries(element.attributes)
        .filter(([name]) => validation.has(name) || name.startsWith('data-')));
      const index = available.findIndex(candidate => candidate.tag === element.tag &&
        Object.entries(contract).every(([name, value]) => has(candidate.attributes, name) && candidate.attributes[name] === value));
      assert.ok(index >= 0, file + ': lost control contract ' + JSON.stringify({ tag: element.tag, ...contract }));
      available.splice(index, 1);
    }
  }
});

test('workspace and Administration navigation preserve baseline destinations and data selectors', () => {
  for (const file of pages) {
    const previous = elements(before(file));
    const current = elements(read(file));
    for (const key of ['data-view', 'data-admin-nav', 'data-collab-area', 'data-admin-page']) {
      const links = list => list.filter(element => has(element.attributes, key))
        .map(element => ({ tag: element.tag, key: element.attributes[key],
          href: element.attributes.href, controls: element.attributes['aria-controls'] }))
        .sort((a, b) => a.key.localeCompare(b.key));
      assert.deepEqual(links(current), links(previous), file + ': changed ' + key + ' navigation');
    }
    const bases = list => list.filter(element => element.tag === 'base').map(element => element.attributes.href);
    assert.deepEqual(bases(current), bases(previous), file + ': changed context base');
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
