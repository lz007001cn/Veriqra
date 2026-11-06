(function ($, api) {
  'use strict';
  const viewName = 'release-acceptance';
  const navigation = window.VeriqraQaNavigation;
  const t = (key, values, fallback) => window.I18n.t(key, values, fallback);
  const tr = (key, values) => t('releaseAcceptance.' + key, values);
  const number = value => window.I18n.formatNumber(value);
  const date = value => value ? window.I18n.formatDateTime(value) : '—';
  const label = value => value === 'INCOMPLETE' ? tr('incomplete') : window.I18n.enumLabel(value);
  const validId = value => /^[1-9][0-9]{0,18}$/.test(String(value || ''));
  const verdicts = ['APPROVED', 'REJECTED'];
  const pageSize = 50;
  const maxRuns = 50;
  let project = null;
  let view = navigation.read().view;
  let scope = null;

  function node(tag, value, className) {
    return $('<' + tag + '>').text(value).addClass(className || '');
  }
  function button(title, action) {
    return $('<button type="button" class="btn btn-outline-secondary btn-sm ms-2">').text(title).on('click', action);
  }
  function option(value, title) { return $('<option>').val(value).text(title); }
  function link(s, title, viewName, values, className) {
    const destination = { projectId: s.projectId, ...values };
    return $('<a>').text(title).addClass(className || '')
      .attr('href', navigation.href(viewName, destination)).on('click', function (event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
        event.preventDefault();
        navigation.open(viewName, destination);
      });
  }
  function base(s) { return 'projects/' + encodeURIComponent(s.projectId); }
  function resource(s) { return base(s) + '/release-acceptances'; }
  function draft() {
    return { build: '', selected: new Set(), verdict: '', notes: '', evidence: null, previewState: '',
      request: 0, intent: null, saving: false, feedback: '', prefilled: false };
  }
  function active(s) { return scope === s; }
  function currentDraft(s, form) { return active(s) && s.form === form && !s.recordId; }
  function verdictBadge(value) {
    return node('span', tr(value), 'badge ' + (value === 'APPROVED' ? 'text-bg-success' : 'text-bg-danger'));
  }
  function showFeedback(target, key, action, actionLabel) {
    target.empty();
    if (key) target.append(node('span', tr(key)));
    if (action) target.append(button(actionLabel || t('common.retry'), action));
  }

  function renderEvidence(s, value) {
    const runs = $('<div>').append(node('h3', tr('runResults'), 'fs-6'));
    value.runs.forEach(function (run) {
      const heading = $('<div class="d-flex flex-wrap gap-2 align-items-center">')
        .append(link(s, run.name, 'runs', { runId: String(run.id) }, 'fw-semibold'),
          node('span', label(run.status), 'badge text-bg-light'));
      if (run.outcome) heading.append(node('span', label(run.outcome), 'badge text-bg-light'));
      if (run.environment) heading.append(node('span', run.environment, 'small text-secondary'));
      const counts = run.counts;
      runs.append($('<div class="asset-step mb-2">').append(heading, node('p', tr('runCounts', {
        recorded: number(counts.recorded), total: number(counts.total), pass: number(counts.passed),
        fail: number(counts.failed), blocked: number(counts.blocked), skipped: number(counts.skipped), notRun: number(counts.notRun)
      }), 'small mb-0 mt-1')));
    });
    const defects = $('<div class="mt-3">').append(node('h3', tr('unclosedDefects', {
      count: number(value.unclosedDefects.length)
    }), 'fs-6'));
    if (!value.unclosedDefects.length) defects.append(node('p', tr('noUnclosedDefects'), 'small text-secondary mb-0'));
    else {
      const items = $('<ul class="list-unstyled mb-0">');
      value.unclosedDefects.forEach(function (defect) {
        items.append($('<li class="mb-2">').append(link(s, 'BUG-' + String(defect.keyNo).padStart(3, '0') + ' · ' + defect.title,
          'defects', { defectId: String(defect.id) }), node('span', ' · ' + [defect.status, defect.severity, defect.priority]
          .map(label).join(' · '), 'small text-secondary')));
      });
      defects.append(items);
    }
    return $('<div>').append(runs, defects);
  }

  function renderComposer(s) {
    const form = s.form;
    const visible = s.canWrite && !s.recordId;
    $('#release-create').toggleClass('d-none', !visible);
    const access = !s.recordId && !visible ? s.accessState : '';
    $('#release-access-status').toggleClass('d-none', !access);
    showFeedback($('#release-access-status'), access, access === 'accessFailed' ? () => loadAccess(s) : null);
    if (!visible) return;

    const locked = form.saving || !!form.intent;
    $('#release-build').prop('disabled', locked || s.candidateState !== 'ready' || s.builds.size === 0);
    $('#release-run-options').toggleClass('d-none', !form.build);
    $('#release-run-list').find('input').each(function () {
      $(this).prop('disabled', locked || !this.checked && form.selected.size >= maxRuns);
    });
    const options = s.candidateState === 'ready' ? s.builds.size ? '' : 'noBuilds' : s.candidateState;
    showFeedback($('#release-options-status'), options, options === 'optionsFailed' ? () => loadCandidates(s) : null);
    $('#release-preview-trigger').toggleClass('d-none', form.selected.size === 0)
      .prop('disabled', locked || form.previewState === 'loading')
      .text(tr(form.evidence || form.feedback === 'evidenceChanged' ? 'refreshPreview' : 'preview'));
    const preview = $('#release-preview').empty().toggleClass('d-none', !form.evidence && !form.previewState);
    if (form.evidence) preview.append(renderEvidence(s, form.evidence));
    else showFeedback(preview, form.previewState);
    $('#release-decision').toggleClass('d-none', !form.evidence);
    $('#release-verdict, #release-notes').prop('disabled', locked);
    $('#release-save').text(tr(form.saving ? 'saving' : form.intent ? 'retrySave' : 'save'))
      .prop('disabled', form.saving || !form.evidence || !verdicts.includes(form.verdict));
    showFeedback($('#release-write-feedback'), form.feedback);
  }
  function renderBuilds(s) {
    const control = $('#release-build').empty().append(option('', tr('chooseBuild')));
    for (const build of s.builds.keys()) control.append(option(build, build));
    control.val(s.form.build);
    $('#release-verdict').empty().append(option('', tr('chooseVerdict')),
      ...verdicts.map(value => option(value, tr(value)))).val(s.form.verdict);
    $('#release-notes').val(s.form.notes);
    renderRunOptions(s);
  }
  function renderRunOptions(s) {
    const container = $('#release-run-list').empty();
    const form = s.form;
    (s.builds.get(form.build) || []).forEach(function (run) {
      const id = String(run.id), inputId = 'release-run-' + id;
      const checkbox = $('<input type="checkbox" class="form-check-input">')
        .attr('id', inputId).prop('checked', form.selected.has(id)).on('change', function () {
          if (!currentDraft(s, form) || form.saving || form.intent) return;
          if (this.checked && form.selected.size < maxRuns) form.selected.add(id);
          else if (!this.checked) form.selected.delete(id);
          form.prefilled = false;
          invalidateEvidence(form);
          form.feedback = '';
          renderComposer(s);
        });
      const title = [run.name, label(run.status), run.environment].filter(Boolean).join(' · ');
      container.append($('<div class="form-check mb-2">').append(checkbox,
        $('<label class="form-check-label">').attr('for', inputId).text(title)));
    });
  }

  async function loadAccess(s) {
    const request = ++s.accessRequest;
    s.accessState = 'loading';
    s.canWrite = false;
    renderComposer(s);
    try {
      const access = await window.VeriqraQaContext.load(s.projectId);
      if (!active(s) || request !== s.accessRequest) return;
      s.canWrite = access.canWriteAssets === true;
      s.accessState = s.canWrite ? '' : 'readOnly';
      if (s.canWrite && !s.recordId && s.candidateState !== 'ready') loadCandidates(s);
    } catch (_) {
      if (!active(s) || request !== s.accessRequest) return;
      s.accessState = 'accessFailed';
    }
    renderComposer(s);
  }
  async function loadCandidates(s) {
    if (!active(s) || s.candidateState === 'loading') return;
    s.candidateState = 'loading'; renderComposer(s);
    try {
      const rows = await api.get(base(s) + '/runs');
      if (!active(s)) return;
      if (!Array.isArray(rows)) throw new Error('Unexpected runs');
      const builds = new Map();
      for (const run of [...rows].reverse()) {
        const build = run.buildVersion;
        if (!validId(run.id) || !Number.isSafeInteger(Number(run.id)) || String(run.projectId) !== s.projectId
            || typeof build !== 'string' || !build.trim() || Array.from(build).length > 80) continue;
        if (!builds.has(build)) builds.set(build, []);
        builds.get(build).push(run);
      }
      s.builds = builds;
      s.candidateState = 'ready';
      prefillSourceRun(s);
      renderBuilds(s);
    } catch (_) {
      if (!active(s)) return;
      s.candidateState = 'optionsFailed';
    }
    renderComposer(s);
  }

  function prefillSourceRun(s) {
    if (!s.sourceRunId) return;
    for (const [build, runs] of s.builds) {
      if (runs.some(run => String(run.id) === s.sourceRunId && run.status === 'COMPLETED')) {
        s.form.build = build;
        s.form.selected.add(s.sourceRunId);
        s.form.prefilled = true;
        return;
      }
    }
    s.form.feedback = 'sourceRunUnavailable';
  }

  function invalidateEvidence(form) {
    form.request++;
    form.evidence = null;
    form.verdict = '';
    form.previewState = '';
    $('#release-verdict').val('');
  }
  async function loadEvidence(s) {
    const form = s?.form;
    if (!s?.canWrite || !currentDraft(s, form) || form.saving || form.intent || !form.selected.size
        || form.previewState === 'loading') return;
    invalidateEvidence(form);
    const request = form.request;
    const build = form.build, ids = [...form.selected];
    form.feedback = '';
    form.previewState = 'loading';
    renderComposer(s);
    try {
      const value = await api.post(resource(s) + '/preview', { buildVersion: build, runIds: ids.map(Number) });
      if (!currentDraft(s, form) || request !== form.request) return;
      if (!value || typeof value.reviewToken !== 'string' || !value.reviewToken || !Array.isArray(value.runs)
          || !Array.isArray(value.unclosedDefects) || value.runs.length !== ids.length
          || new Set(value.runs.map(run => String(run.id))).size !== ids.length
          || value.runs.some(run => !ids.includes(String(run.id)) || run.buildVersion !== build || !run.counts)) {
        throw new Error('Unexpected acceptance preview');
      }
      form.evidence = value;
      form.previewState = '';
    } catch (_) {
      if (!currentDraft(s, form) || request !== form.request) return;
      form.previewState = 'previewFailed';
    }
    renderComposer(s);
  }

  function renderHistory(s) {
    const rows = $('#release-history-list').empty();
    s.history.forEach(function (record) {
      rows.append($('<div class="asset-list-row">').append(
        $('<div>').append(link(s, record.buildVersion, viewName, { acceptanceId: String(record.id) }, 'fw-semibold'),
          node('p', record.reviewerName + ' · ' + date(record.createdAt), 'small text-secondary mb-0')),
        verdictBadge(record.verdict)));
    });
    const key = s.historyState || (!s.history.length ? 'noRecords' : '');
    const more = s.historyState === 'historyFailed' || s.historyState === 'moreFailed' || !s.historyState && s.more;
    showFeedback($('#release-history-feedback'), key, more ? () => loadHistory(s, s.historyState !== 'historyFailed') : null,
      s.historyState ? t('common.retry') : tr('moreRecords'));
  }
  async function loadHistory(s, older = false) {
    if (!active(s) || s.historyState === 'loading') return;
    const cursor = older ? s.history.at(-1)?.id : null;
    s.historyState = 'loading'; renderHistory(s);
    try {
      const rows = await api.get(resource(s) + (cursor ? '?beforeId=' + encodeURIComponent(cursor) : ''));
      if (!active(s)) return;
      if (!Array.isArray(rows) || rows.some(row => String(row.projectId) !== s.projectId || !validId(row.id))) {
        throw new Error('Unexpected acceptance records');
      }
      if (cursor) s.history = s.history.concat(rows);
      else s.history = s.lastSaved && !rows.some(row => String(row.id) === String(s.lastSaved.id)) ? [s.lastSaved, ...rows] : rows;
      s.more = rows.length === pageSize;
      s.historyState = '';
    } catch (_) {
      if (!active(s)) return;
      s.historyState = cursor ? 'moreFailed' : 'historyFailed';
    }
    renderHistory(s);
  }

  function renderRecord(s) {
    const target = $('#release-record').empty().toggleClass('d-none', !s.recordId);
    if (!s.recordId) return;
    target.append($('<div class="asset-panel-heading">').append(node('h2', tr('savedRecord'), 'fs-5'),
      link(s, tr('backToAcceptance'), viewName, {}, 'btn btn-outline-secondary btn-sm')));
    if (!s.record) {
      const status = $('<p role="status">');
      showFeedback(status, s.recordState, s.recordState === 'recordFailed' ? () => loadRecord(s) : null);
      target.append(status);
      return;
    }
    const row = s.record;
    target.append($('<div class="d-flex flex-wrap align-items-center gap-2 mb-2">')
      .append(node('strong', '#' + row.id + ' · ' + row.buildVersion), verdictBadge(row.verdict)),
      node('p', row.reviewerName + ' · ' + date(row.createdAt), 'small text-secondary'));
    if (row.notes) target.append(node('p', row.notes, 'defect-prewrap'));
    target.append(renderEvidence(s, row));
  }
  function isDetail(s, value, id) {
    return value && validId(value.id) && (!id || String(value.id) === id) && String(value.projectId) === s.projectId
      && Array.isArray(value.runs) && Array.isArray(value.unclosedDefects);
  }
  async function loadRecord(s) {
    const id = s.recordId, request = ++s.recordRequest;
    s.recordState = 'loading'; renderRecord(s);
    try {
      const row = await api.get(resource(s) + '/' + id);
      if (!active(s) || request !== s.recordRequest) return;
      if (!isDetail(s, row, id)) throw new Error('Unexpected acceptance detail');
      s.record = row;
      s.recordState = '';
    } catch (_) {
      if (!active(s) || request !== s.recordRequest) return;
      s.recordState = 'recordFailed';
    }
    renderRecord(s);
  }

  function requestKey() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return hex.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
  }
  async function save(s) {
    const form = s?.form;
    if (!s?.canWrite || !currentDraft(s, form) || form.saving || !form.evidence || !verdicts.includes(form.verdict)) return;
    form.intent ||= { buildVersion: form.build, runIds: [...form.selected].map(Number), verdict: form.verdict,
      notes: form.notes.trim() || null, reviewToken: form.evidence.reviewToken, requestKey: requestKey() };
    form.saving = true;
    form.feedback = '';
    renderComposer(s);
    try {
      const record = await api.post(resource(s), form.intent);
      if (!currentDraft(s, form)) return;
      if (!isDetail(s, record)) throw new Error('Unexpected saved acceptance');
      s.lastSaved = record;
      s.history = [record, ...s.history.filter(item => String(item.id) !== String(record.id))];
      s.form = draft();
      renderHistory(s);
      navigation.open(viewName, { projectId: s.projectId, acceptanceId: String(record.id) });
    } catch (error) {
      if (!currentDraft(s, form)) return;
      form.saving = false;
      if (!error.status || error.status >= 500 || error.status === 401) form.feedback = 'saveUncertain';
      else {
        form.intent = null;
        if (error.status === 403) { s.canWrite = false; s.accessState = 'saveForbidden'; }
        else if (error.status === 409 && error.code === 'RELEASE_ACCEPTANCE_EVIDENCE_CHANGED') {
          invalidateEvidence(form);
          form.feedback = 'evidenceChanged';
        }
        else form.feedback = error.status === 409 ? 'saveConflict' : 'saveFailed';
      }
      renderComposer(s);
    }
  }

  function sync(route) {
    if (view !== viewName || !project || !validId(project.id)) { scope = null; return; }
    const projectId = String(project.id);
    const recordId = validId(route.acceptanceId) ? String(route.acceptanceId) : null;
    const sourceRunId = !recordId && validId(route.sourceRunId) ? String(route.sourceRunId) : null;
    if (!scope || scope.projectId !== projectId) {
      scope = { projectId, form: draft(), builds: new Map(), canWrite: false, accessState: '', accessRequest: 0, candidateState: '',
        sourceRunId, recordId, record: null, recordState: '', recordRequest: 0, history: [], historyState: '', more: false };
      renderBuilds(scope);
      loadHistory(scope);
      loadAccess(scope);
      if (recordId) loadRecord(scope); else renderRecord(scope);
    } else if (scope.recordId !== recordId || scope.sourceRunId !== sourceRunId) {
      scope.sourceRunId = sourceRunId;
      scope.recordId = recordId;
      scope.recordRequest++;
      scope.form = draft();
      scope.record = String(scope.lastSaved?.id) === recordId ? scope.lastSaved : null;
      if (scope.candidateState === 'ready') prefillSourceRun(scope);
      renderBuilds(scope);
      renderComposer(scope);
      if (!recordId && scope.canWrite && scope.candidateState !== 'ready') loadCandidates(scope);
      if (recordId && !scope.record) loadRecord(scope); else renderRecord(scope);
    }
  }

  $('#release-build').on('change', function () {
    const s = scope;
    if (!s?.canWrite || s.form.saving || s.form.intent || this.value && !s.builds.has(this.value)) return;
    s.form = { ...draft(), build: this.value };
    renderBuilds(s); renderComposer(s);
  });
  $('#release-verdict').on('change', function () {
    if (!scope?.canWrite || scope.form.saving || scope.form.intent) return;
    scope.form.verdict = this.value;
    renderComposer(scope);
  });
  $('#release-notes').on('input', function () {
    if (scope?.canWrite && !scope.form.saving && !scope.form.intent) scope.form.notes = this.value;
  });
  $('#release-form').on('submit', function (event) { event.preventDefault(); return save(scope); });
  $('#release-preview-trigger').on('click', function () { return loadEvidence(scope); });
  $(document).on('veriqra:project', function (event) {
    project = event.originalEvent.detail.project;
    sync(navigation.read());
  });
  $(document).on('veriqra:view', function (event) {
    const detail = event.originalEvent.detail;
    view = detail.view;
    sync(detail.context || navigation.read());
  });
  document.addEventListener('veriqra:localechange', function () {
    if (!scope) return;
    renderBuilds(scope); renderComposer(scope); renderRecord(scope); renderHistory(scope);
  });
  document.addEventListener('veriqra:reauthenticated', function () {
    if (!scope) return;
    loadAccess(scope);
    if (['historyFailed', 'moreFailed'].includes(scope.historyState)) loadHistory(scope);
    if (scope.recordState === 'recordFailed') loadRecord(scope);
  });
  if (window.VeriqraDraftGuard) window.VeriqraDraftGuard.register(viewName, {
    dirty: function () {
      const form = scope?.form;
      return !!form && !!((form.build && !form.prefilled) || form.verdict || form.notes || form.intent || form.saving);
    },
    clear: function () { scope = null; }
  });
})(jQuery, window.VeriqraApi);
