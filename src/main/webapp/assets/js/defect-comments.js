(function ($, api) {
  'use strict';
  const t = function (key, fallback, args) { return window.I18n.t('defectComments.' + key, args || null, fallback); };
  const maxImage = 2 * 1024 * 1024;
  const id = function (value) { return /^[1-9]\d{0,18}$/.test(String(value)); };
  const same = function (left, right) { return String(left) === String(right); };
  const panel = $('<section id="defect-comments-panel" class="asset-panel mt-3 d-none" aria-labelledby="defect-comments-title">');
  $('#defect-detail-panel').append(panel);
  let context = null;

  function path(state) { return 'projects/' + state.projectId + '/defects/' + state.defectId + '/comments'; }
  function requestKey() {
    const crypto = window.crypto;
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    return hex.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
  }
  function clear() { context = null; panel.empty().addClass('d-none'); }
  function dirty() {
    return !!context && (context.posting || context.reading || !!context.pending || !!context.image || !!context.text.trim() || !!context.logUrl.trim());
  }
  function safeLink(value) {
    if (!value || value.length > 2048) return null;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  function validComment(row) {
    return row && id(row.id) && id(row.authorId) && typeof row.authorName === 'string' && typeof row.createdAt === 'string'
      && typeof row.text === 'string' && (row.logUrl == null || typeof row.logUrl === 'string') && typeof row.hasImage === 'boolean';
  }
  function status(state, key, fallback, error) {
    state.status = key ? { key: key, fallback: fallback, error: error } : null;
    renderStatus(state);
  }
  function renderStatus(state) {
    const value = state.status;
    panel.find('.discussion-status').toggleClass('d-none', !value).toggleClass('text-danger', !!value && !!value.error)
      .text(value ? t(value.key, value.fallback) : '');
  }
  function controls(state) {
    const editing = state.writable && !state.posting && !state.pending;
    panel.find('.discussion-form').toggleClass('d-none', !state.writable);
    panel.find('.discussion-field, .discussion-remove-image').prop('disabled', !editing);
    panel.find('.discussion-post').prop('disabled', !state.writable || state.loading || state.posting || state.reading)
      .text(state.pending ? t('retryPost', 'Retry comment') : t('post', 'Post comment'));
    panel.find('.discussion-refresh, .discussion-more').prop('disabled', state.loading || state.posting);
  }
  function thumbnail(source, alt) {
    return $('<img class="rounded border object-fit-contain" width="160" height="96" loading="lazy" decoding="async">').attr('src', source).attr('alt', alt);
  }
  function renderImage(state) {
    const target = panel.find('.discussion-preview').empty();
    if (!state.image) return;
    target.append(thumbnail(state.image.url, t('screenshot', 'Screenshot')), $('<span>').text(state.image.name),
      $('<button type="button" class="btn btn-outline-secondary btn-sm discussion-remove-image">').text(t('removeImage', 'Remove screenshot'))
        .on('click', function () {
          if (context !== state || !state.writable || state.pending || state.posting) return;
          state.image = null; state.imageToken++; state.reading = false; status(state); renderImage(state); controls(state);
        }));
  }
  function renderList(state) {
    const list = panel.find('.discussion-list').empty();
    for (const row of state.rows) {
      const item = $('<article class="border rounded p-3 mb-2">').append(
        $('<div class="d-flex flex-wrap align-items-center gap-2 mb-1">').append($('<strong>').text(row.authorName),
          $('<time class="small text-secondary">').attr('datetime', row.createdAt).text(window.I18n.formatDateTime(row.createdAt))));
      if (row.text) item.append($('<p class="mb-2 text-break" style="white-space:pre-wrap">').text(row.text));
      const evidence = $('<div class="d-flex flex-wrap align-items-start gap-2">');
      const url = safeLink(row.logUrl);
      if (url) evidence.append($('<a class="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener noreferrer">').attr('href', url).text(t('viewLog', 'Open log')));
      if (row.hasImage) {
        const source = new URL('api/' + path(state) + '/' + row.id + '/image', document.baseURI).href;
        evidence.append($('<a target="_blank" rel="noopener noreferrer">').attr('href', source)
          .append(thumbnail(source, t('openScreenshot', 'Open screenshot'))));
      }
      if (evidence.children().length) item.append(evidence);
      list.append(item);
    }
    if (state.loading) list.append($('<p class="small text-secondary" role="status">').text(t('loading', 'Loading discussion…')));
    else if (state.listError) list.append($('<p class="small text-danger" role="status">').text(t('loadFailed', 'Discussion could not be loaded.')),
      $('<button type="button" class="btn btn-outline-secondary btn-sm">').text(t('retry', 'Retry'))
        .on('click', function () { load(state, state.failedCursor); }));
    else if (!state.rows.length) list.append($('<p class="small text-secondary">').text(t('empty', 'No comments yet.')));
    if (state.nextBeforeId && !state.listError) list.append($('<button type="button" class="btn btn-outline-secondary btn-sm discussion-more">')
      .text(t('older', 'Load older comments')).on('click', function () { load(state, state.nextBeforeId); }));
  }
  function accessLost(state) {
    state.writable = false; state.accessLost = true; state.rows = []; state.nextBeforeId = null;
  }
  async function load(state, beforeId) {
    if (context !== state || state.loading || state.posting) return;
    state.loading = true; state.listError = false; renderList(state); controls(state);
    try {
      const result = await api.get(path(state) + (beforeId ? '?beforeId=' + encodeURIComponent(beforeId) : ''));
      if (context !== state) return;
      if (!result || !Array.isArray(result.comments) || !result.comments.every(validComment) || (result.nextBeforeId != null && !id(result.nextBeforeId))) throw new Error('Invalid discussion');
      const rows = beforeId ? state.rows.concat(result.comments) : result.comments;
      state.rows = [...new Map(rows.map(function (row) { return [String(row.id), row]; })).values()];
      state.nextBeforeId = result.nextBeforeId;
    } catch (failure) {
      if (context !== state) return;
      state.listError = true; state.failedCursor = beforeId;
      if (failure.status === 401 || failure.status === 403) accessLost(state);
    } finally {
      if (context === state) { state.loading = false; renderList(state); controls(state); }
    }
  }
  function chooseImage(state, file) {
    if (context !== state || !state.writable || state.posting || state.pending || !file) return;
    if (file.size > maxImage) { status(state, 'tooLarge', 'Screenshot exceeds 2 MiB.', true); return; }
    if (file.size < 1 || !['image/png', 'image/jpeg'].includes(file.type)) { status(state, 'invalidImage', 'Choose a valid PNG or JPEG screenshot.', true); return; }
    const token = ++state.imageToken;
    state.reading = true; status(state, 'readingImage', 'Reading screenshot…'); controls(state);
    const reader = new window.FileReader();
    const finish = function (url) {
      if (context !== state || token !== state.imageToken) return;
      state.reading = false;
      if (typeof url === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url)) {
        state.image = { url: url, name: file.name || t('screenshot', 'Screenshot') };
        status(state); renderImage(state);
      } else status(state, 'invalidImage', 'Choose a valid PNG or JPEG screenshot.', true);
      controls(state);
    };
    reader.onload = function () { finish(reader.result); };
    reader.onerror = reader.onabort = function () { finish(null); };
    try { reader.readAsDataURL(file); }
    catch (_) { finish(null); }
  }
  async function post(state) {
    if (context !== state || !state.writable || state.loading || state.posting || state.reading) return;
    if (!state.pending) {
      const body = state.text.trim();
      const rawLink = state.logUrl.trim(), url = safeLink(rawLink);
      if (rawLink && !url) { status(state, 'invalidLink', 'Enter a valid HTTP or HTTPS log link.', true); return; }
      if (!body && !url && !state.image) { status(state, 'required', 'Enter a comment or attach evidence.', true); return; }
      if (body.length > 4000) { status(state, 'textTooLong', 'Comment exceeds 4000 characters.', true); return; }
      state.pending = { requestKey: requestKey(), text: body, logUrl: url,
        imageBase64: state.image ? state.image.url.slice(state.image.url.indexOf(',') + 1) : null };
    }
    state.posting = true; status(state, 'posting', 'Posting comment…'); controls(state);
    try {
      const value = await api.post(path(state), state.pending);
      if (context !== state) return;
      if (!value || !validComment(value.comment)) throw new Error('Invalid comment receipt');
      state.rows = [value.comment, ...state.rows.filter(function (row) { return !same(row.id, value.comment.id); })];
      state.pending = null; state.text = ''; state.logUrl = ''; state.image = null;
      panel.find('.discussion-text, .discussion-url').val('');
      renderList(state); renderImage(state); status(state, 'posted', 'Comment posted.');
    } catch (failure) {
      if (context !== state) return;
      if (!failure.status || failure.status >= 500) status(state, 'unknownPost', 'Posting could not be confirmed. Retry this comment.', true);
      else if (failure.status === 401 || failure.status === 403) {
        accessLost(state); state.listError = true; renderList(state);
        status(state, 'accessLost', 'Access changed. Reopen the defect to continue.', true);
      } else {
        state.pending = null;
        if (failure.code === 'INVALID_SCREENSHOT' || failure.status === 415) status(state, 'invalidImage', 'Choose a valid PNG or JPEG screenshot.', true);
        else if (failure.status === 413) status(state, 'tooLarge', 'Screenshot exceeds upload limits.', true);
        else status(state, 'postFailed', 'Comment could not be posted. Check the text and evidence, then try again.', true);
      }
    } finally { if (context === state) { state.posting = false; controls(state); } }
  }
  function render(state) {
    const text = $('<textarea id="defect-comment-text" class="form-control discussion-text discussion-field" rows="3" maxlength="4000">').val(state.text)
      .on('input', function () { state.text = this.value; status(state); })
      .on('paste', function (event) {
        const clipboard = (event.originalEvent || event).clipboardData;
        const item = Array.from(clipboard && clipboard.items || []).find(function (entry) { return entry.kind === 'file' && /^image\//.test(entry.type); });
        const file = item ? item.getAsFile() : Array.from(clipboard && clipboard.files || []).find(function (entry) { return /^image\//.test(entry.type); });
        if (file) { event.preventDefault(); chooseImage(state, file); }
      });
    const url = $('<input id="defect-comment-url" type="url" class="form-control discussion-url discussion-field" maxlength="2048">').val(state.logUrl)
      .on('input', function () { state.logUrl = this.value; status(state); });
    const file = $('<input id="defect-comment-image" type="file" class="form-control discussion-field" accept="image/png,image/jpeg">')
      .on('change', function () { const selected = this.files && this.files[0]; this.value = ''; chooseImage(state, selected); });
    const form = $('<form class="discussion-form mb-3" novalidate>').append(
      $('<label class="form-label" for="defect-comment-text">').text(t('comment', 'Comment')), text,
      $('<label class="form-label mt-2" for="defect-comment-url">').text(t('logLink', 'Log link')), url,
      $('<label class="form-label mt-2" for="defect-comment-image">').text(t('attach', 'Screenshot (upload or paste in comment)')), file,
      $('<div class="discussion-preview d-flex flex-wrap align-items-center gap-2 my-2">'),
      $('<button type="submit" class="btn btn-primary discussion-post">'))
      .on('submit', function (event) { event.preventDefault(); return post(state); });
    panel.empty().removeClass('d-none').append($('<div class="asset-panel-heading">').append(
      $('<h3 id="defect-comments-title" class="fs-5">').text(t('title', 'Discussion')),
      $('<button type="button" class="btn btn-outline-secondary btn-sm discussion-refresh">').text(t('refresh', 'Refresh'))
        .on('click', function () { load(state); })),
      $('<p class="discussion-status small" role="status" aria-live="polite">'), form, $('<div class="discussion-list">'));
    renderImage(state); renderList(state); renderStatus(state); controls(state);
  }
  function mount(next) {
    if (!next || !id(next.projectId) || !id(next.defectId) || !id(next.actorId)) { clear(); return; }
    if (context && same(context.projectId, next.projectId) && same(context.defectId, next.defectId) && same(context.actorId, next.actorId)) {
      context.writable = next.writable === true && !context.accessLost;
      controls(context);
      return;
    }
    const state = Object.assign({}, next, { rows: [], nextBeforeId: null, text: '', logUrl: '', image: null, imageToken: 0 });
    context = state;
    if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register('defect-comments', { dirty: dirty, clear: clear });
    render(state); load(state);
  }
  function reauthenticate() {
    if (!context) return;
    context.accessLost = false; context.writable = false;
    controls(context);
  }
  document.addEventListener('veriqra:localechange', function () { if (context) render(context); });
  window.VeriqraDefectComments = Object.freeze({ mount: mount, clear: clear, reauthenticate: reauthenticate });
})(jQuery, window.VeriqraApi);
