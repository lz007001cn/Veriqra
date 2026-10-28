/* Enhance the existing select; app.js remains the owner of project switching and draft guards. */
(function () {
  'use strict';
  const select = document.getElementById('project-select');
  if (!select) return;
  const t = (key, fallback) => window.I18n.t(key, null, fallback);
  const wrapper = document.createElement('div');
  wrapper.className = 'project-switcher';
  wrapper.innerHTML = '<button id="project-picker-toggle" type="button" class="project-switcher-toggle" aria-haspopup="dialog" aria-expanded="false" aria-controls="project-picker-popup"><span class="project-switcher-value"></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div id="project-picker-popup" class="project-switcher-popup" role="dialog" hidden><input type="search" class="form-control project-switcher-search" autocomplete="off"><div class="project-switcher-options" role="listbox"></div><p class="project-switcher-empty" role="status" hidden></p></div>';
  select.after(wrapper);
  const toggle = wrapper.querySelector('button');
  const value = wrapper.querySelector('.project-switcher-value');
  const popup = wrapper.querySelector('[role="dialog"]');
  const search = wrapper.querySelector('input');
  const list = wrapper.querySelector('[role="listbox"]');
  const empty = wrapper.querySelector('[role="status"]');
  const label = document.querySelector('label[for="project-select"]');
  if (label) label.htmlFor = toggle.id;
  select.classList.add('d-none');
  select.setAttribute('aria-hidden', 'true');
  function parts(option) {
    const text = option ? option.textContent : '';
    const split = text.indexOf(' · ');
    return split < 0 ? ['', text] : [text.slice(0, split), text.slice(split + 3)];
  }
  function content(target, option) {
    const [key, name] = parts(option);
    target.replaceChildren();
    if (key) {
      const code = document.createElement('span'); code.className = 'project-switcher-key'; code.textContent = key; target.append(code);
    }
    const title = document.createElement('span'); title.className = 'project-switcher-name'; title.textContent = name; target.append(title);
  }
  function close(restore) {
    popup.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    if (restore && !toggle.disabled) toggle.focus();
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    list.replaceChildren();
    Array.from(select.options).filter(option => option.value && !option.disabled && (!query || option.textContent.toLocaleLowerCase().includes(query))).forEach(option => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'project-switcher-option';
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(option.value === select.value));
      content(button, option);
      const check = document.createElement('span'); check.className = 'project-switcher-check'; check.textContent = option.value === select.value ? '✓' : ''; check.setAttribute('aria-hidden', 'true'); button.append(check);
      button.addEventListener('click', () => {
        if (select.disabled) return;
        close(true); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); sync();
      });
      list.append(button);
    });
    empty.hidden = !!list.children.length;
    empty.textContent = t('projectPicker.noMatches', 'No matching projects.');
  }
  function sync() {
    const current = select.options[select.selectedIndex];
    content(value, current);
    toggle.title = current ? current.textContent : '';
    toggle.setAttribute('aria-label', t('shell.currentProject', 'Current project') + ': ' + toggle.title);
    toggle.disabled = select.disabled || !Array.from(select.options).some(option => option.value && !option.disabled);
    popup.setAttribute('aria-label', t('shell.currentProject', 'Current project'));
    search.placeholder = t('projectPicker.search', 'Search projects by name or key');
    search.setAttribute('aria-label', search.placeholder);
    list.setAttribute('aria-label', t('shell.currentProject', 'Current project'));
    if (toggle.disabled) close(false);
    if (!popup.hidden) render();
  }
  function open() {
    if (toggle.disabled) return;
    search.value = ''; render();
    const rect = toggle.getBoundingClientRect(), width = Math.min(460, window.innerWidth - 32);
    popup.style.width = width + 'px';
    popup.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)) + 'px';
    const below = window.innerHeight - rect.bottom - 16;
    const above = below < 220 && rect.top > below;
    popup.style.top = above ? 'auto' : rect.bottom + 6 + 'px';
    popup.style.bottom = above ? window.innerHeight - rect.top + 6 + 'px' : 'auto';
    popup.style.maxHeight = Math.max(100, Math.min(420, above ? rect.top - 16 : below)) + 'px';
    popup.hidden = false; toggle.setAttribute('aria-expanded', 'true'); search.focus();
  }
  toggle.addEventListener('click', () => popup.hidden ? open() : close(true));
  toggle.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
  });
  search.addEventListener('input', render);
  wrapper.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (popup.hidden || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(list.children), index = options.indexOf(document.activeElement);
    if (document.activeElement === search && ['Home', 'End'].includes(event.key)) return;
    if (!options.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? (index + 1) % options.length : index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length;
    options[next].focus();
  });
  document.addEventListener('click', event => { if (!wrapper.contains(event.target)) close(false); });
  document.addEventListener('focusin', event => { if (!wrapper.contains(event.target)) close(false); });
  select.addEventListener('change', sync);
  ['veriqra:project', 'veriqra:view', 'veriqra:localechange'].forEach(name => document.addEventListener(name, () => { close(false); sync(); }));
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
  window.addEventListener('pagehide', () => close(false));
  window.addEventListener('resize', () => close(false));
  window.addEventListener('scroll', event => { if (!popup.contains(event.target)) close(false); }, true);
  sync();
})();
