// kensho diff — viewer renderer.
// Loads data/diff.json, renders the static diff UI. Vanilla JS, no framework.

(function () {
  const STATUS_LABEL = { pass: 'pass', fail: 'fail', broken: 'broken', skip: 'skip' };
  const STATUS_RANK = { fail: 0, broken: 1, skip: 2, pass: 3 };

  const state = {
    diff: null,
    filter: 'all',
    search: '',
    sortKey: 'group',
    sortDir: 1,
    expanded: new Set(),
  };

  // ---------- helpers ----------
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') node.className = props[k];
        else if (k === 'on' && typeof props[k] === 'object') {
          for (const ev in props[k]) node.addEventListener(ev, props[k][ev]);
        } else if (k === 'style' && typeof props[k] === 'object') {
          Object.assign(node.style, props[k]);
        } else if (k === 'dataset' && typeof props[k] === 'object') {
          Object.assign(node.dataset, props[k]);
        } else if (k in node) {
          node[k] = props[k];
        } else {
          node.setAttribute(k, props[k]);
        }
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return m + 'm ' + s + 's';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function fmtDeltaMs(prev, cur) {
    if (prev == null || cur == null) return '';
    const d = cur - prev;
    if (Math.abs(d) < 1) return '';
    const cls = d > 0 ? 'kv-up' : 'kv-down';
    const sign = d > 0 ? '+' : '−';
    return el('span', { class: cls }, sign + fmtMs(Math.abs(d)));
  }

  function pillet(status) {
    if (!status) return el('span', { class: 'kv-pillet none' }, '—');
    return el('span', { class: 'kv-pillet ' + status }, STATUS_LABEL[status] || status);
  }

  // ---------- data shaping ----------
  // Flatten the DiffResult into a single list of "rows" we can sort + filter.
  function buildRows(diff) {
    const rows = [];
    const push = (group, items, extra = {}) => {
      for (const it of items) {
        rows.push({
          group,
          id: it.id,
          name: it.fullName || it.name,
          shortName: it.name,
          suite: Array.isArray(it.suite) ? it.suite.join(' › ') : (it.suite || ''),
          filePath: it.filePath || '',
          prevStatus: it.prevStatus || extra.prevStatus || null,
          curStatus: it.curStatus || extra.curStatus || null,
          prevDuration: it.prevDuration ?? null,
          curDuration: it.curDuration ?? it.duration ?? null,
          errorPreview: it.errorPreview || it.prevErrorPreview || '',
          curError: it.curError || null,
          prevError: it.prevError || null,
          tags: it.tags || [],
          severity: it.severity || '',
          owner: it.owner || '',
          raw: it,
        });
      }
    };
    push('newlyFailing', diff.changes.newlyFailing);
    push('newlyPassing', diff.changes.newlyPassing);
    push('statusFlipped', diff.changes.statusFlipped);
    push('added', diff.changes.added, { prevStatus: null });
    push('removed', diff.changes.removed, { curStatus: null });
    push('stillFailing', diff.changes.stillFailing);
    return rows;
  }

  const GROUPS = [
    { id: 'newlyFailing',  label: 'Newly failing',     pill: 'kv-pill-fail',  rank: 0 },
    { id: 'newlyPassing',  label: 'Newly passing',     pill: 'kv-pill-pass',  rank: 1 },
    { id: 'statusFlipped', label: 'Status flipped',    pill: 'kv-pill-warn',  rank: 2 },
    { id: 'added',         label: 'Added',             pill: 'kv-pill-info',  rank: 3 },
    { id: 'removed',       label: 'Removed',           pill: 'kv-pill-mute',  rank: 4 },
    { id: 'stillFailing',  label: 'Still failing',     pill: 'kv-pill-fail',  rank: 5 },
  ];

  // ---------- header / KPIs ----------
  function renderHeader(diff, root) {
    const passDelta = diff.summary.passRateDelta;
    const passDeltaTxt = (passDelta > 0 ? '+' : passDelta < 0 ? '−' : '±') + Math.abs(passDelta) + '%';
    const passDeltaCls = passDelta > 0 ? 'kv-up' : passDelta < 0 ? 'kv-down' : '';
    const totalChanges =
      diff.summary.regressions + diff.summary.recoveries + diff.summary.flipped + diff.summary.added + diff.summary.removed;

    // Header bar
    root.appendChild(
      el('div', { class: 'kv-diff-header' },
        el('div', { class: 'kv-brand' },
          el('img', { src: 'assets/kaizen-mark.svg', alt: '' }),
          el('div', null,
            el('div', { class: 'kv-title' }, 'Kensho diff'),
            el('div', { class: 'kv-sub' }, totalChanges + ' change' + (totalChanges === 1 ? '' : 's')),
          ),
        ),
        el('div', { class: 'kv-diff-actions' },
          el('button', {
            class: 'kv-theme-toggle',
            title: 'Toggle theme',
            type: 'button',
            on: { click: toggleTheme },
          }, themeIcon()),
        ),
      ),
    );

    // KPI row
    root.appendChild(
      el('div', { class: 'kv-kpis' },
        kpi('Pass rate', diff.cur.passRate + '%', el('span', { class: passDeltaCls }, passDeltaTxt + ' vs prev'), 'pass'),
        kpi('Newly failing', diff.summary.regressions, 'tests broken since prev', 'fail'),
        kpi('Newly passing', diff.summary.recoveries, 'tests fixed since prev', 'pass'),
        kpi('Status flipped', diff.summary.flipped, 'state changed', 'warn'),
        kpi('Added · Removed', diff.summary.added + ' · ' + diff.summary.removed, 'tests added or dropped', 'info'),
      ),
    );

    // Two-run summary band
    root.appendChild(
      el('div', { class: 'kv-runs' },
        runCard(diff.prev, false),
        el('div', { class: 'kv-arrow' }, '→'),
        runCard(diff.cur, true),
      ),
    );
  }

  function kpi(label, value, hint, tone) {
    return el('div', { class: 'kv-kpi kv-kpi-' + tone },
      el('div', { class: 'kv-label' }, label),
      el('div', { class: 'kv-value' }, value),
      el('div', { class: 'kv-hint' }, hint || ''),
    );
  }

  function runCard(meta, isCur) {
    const t = meta.totals || {};
    return el('div', { class: 'kv-run-card ' + (isCur ? 'kv-run-cur' : 'kv-run-prev') },
      el('div', { class: 'kv-run-tag' },
        el('span', { class: 'kv-dot' }),
        isCur ? 'Current run' : 'Previous run',
      ),
      el('div', { class: 'kv-run-id' }, meta.id || '—'),
      el('div', { class: 'kv-run-meta' },
        [
          fmtDate(meta.startedAt),
          meta.env?.branch && ('branch: ' + meta.env.branch),
          meta.env?.commit && ('commit: ' + meta.env.commit),
        ].filter(Boolean).join(' · ') || '—',
      ),
      el('div', { class: 'kv-run-totals' },
        el('span', { class: 'kv-tot pass' }, el('span', { class: 'kv-bullet' }), (t.pass || 0) + ' pass'),
        el('span', { class: 'kv-tot fail' }, el('span', { class: 'kv-bullet' }), (t.fail || 0) + ' fail'),
        el('span', { class: 'kv-tot broken' }, el('span', { class: 'kv-bullet' }), (t.broken || 0) + ' broken'),
        el('span', { class: 'kv-tot skip' }, el('span', { class: 'kv-bullet' }), (t.skip || 0) + ' skip'),
        el('span', { class: 'kv-tot' }, 'pass rate: ' + meta.passRate + '%'),
      ),
    );
  }

  // ---------- filter / sort + table ----------
  function renderToolbar(diff, root) {
    const counts = {
      all: 0,
      newlyFailing: diff.changes.newlyFailing.length,
      newlyPassing: diff.changes.newlyPassing.length,
      statusFlipped: diff.changes.statusFlipped.length,
      added: diff.changes.added.length,
      removed: diff.changes.removed.length,
      stillFailing: diff.changes.stillFailing.length,
    };
    counts.all = counts.newlyFailing + counts.newlyPassing + counts.statusFlipped + counts.added + counts.removed + counts.stillFailing;

    const PILLS = [
      ['all',           'All',            ''],
      ['newlyFailing',  'Newly failing',  'kv-pill-fail'],
      ['newlyPassing',  'Newly passing',  'kv-pill-pass'],
      ['statusFlipped', 'Status flipped', 'kv-pill-warn'],
      ['added',         'Added',          'kv-pill-info'],
      ['removed',       'Removed',        'kv-pill-mute'],
      ['stillFailing',  'Still failing',  'kv-pill-fail'],
    ];

    const pills = el('div', { class: 'kv-pills' },
      PILLS.map(([id, label, cls]) => {
        const active = state.filter === id;
        return el('button', {
          type: 'button',
          class: 'kv-pill ' + cls + (active ? ' kv-active' : ''),
          on: { click: () => { state.filter = id; rerenderTable(); } },
        }, label, el('span', { class: 'kv-count' }, counts[id]));
      }),
    );

    const search = el('input', {
      type: 'search',
      class: 'kv-search',
      placeholder: 'Filter by test name, file, or suite…',
      value: state.search,
      on: {
        input: (e) => {
          state.search = e.target.value;
          rerenderTable();
        },
      },
    });

    root.appendChild(el('div', { class: 'kv-toolbar' }, pills, search));
  }

  function applyFilters(rows) {
    const q = state.search.trim().toLowerCase();
    return rows.filter(r => {
      if (state.filter !== 'all' && r.group !== state.filter) return false;
      if (q) {
        const hay = (r.name + ' ' + r.filePath + ' ' + r.suite).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sortRows(rows) {
    const dir = state.sortDir;
    const key = state.sortKey;
    const out = [...rows];
    out.sort((a, b) => {
      if (key === 'group') {
        const ga = (GROUPS.find(g => g.id === a.group)?.rank ?? 9);
        const gb = (GROUPS.find(g => g.id === b.group)?.rank ?? 9);
        if (ga !== gb) return (ga - gb) * dir;
        return a.name.localeCompare(b.name);
      }
      if (key === 'name') return a.name.localeCompare(b.name) * dir;
      if (key === 'duration') {
        const da = (a.curDuration ?? a.prevDuration) ?? 0;
        const db = (b.curDuration ?? b.prevDuration) ?? 0;
        return (da - db) * dir;
      }
      if (key === 'status') {
        const sa = STATUS_RANK[a.curStatus] ?? STATUS_RANK[a.prevStatus] ?? 9;
        const sb = STATUS_RANK[b.curStatus] ?? STATUS_RANK[b.prevStatus] ?? 9;
        return (sa - sb) * dir;
      }
      return 0;
    });
    return out;
  }

  function rerenderTable() {
    const host = document.getElementById('kv-table-host');
    if (!host) return;
    host.replaceChildren(buildTable(state.diff));
  }

  function setSort(key) {
    if (state.sortKey === key) state.sortDir = -state.sortDir;
    else { state.sortKey = key; state.sortDir = 1; }
    rerenderTable();
  }

  function buildTable(diff) {
    const all = buildRows(diff);
    let rows = applyFilters(all);
    rows = sortRows(rows);

    const head = el('div', { class: 'kv-table-head' },
      el('div', { class: 'kv-th' + (state.sortKey === 'status' ? ' kv-sorted' : ''), on: { click: () => setSort('status') } }, 'Status'),
      el('div', { class: 'kv-th' + (state.sortKey === 'name' ? ' kv-sorted' : ''), on: { click: () => setSort('name') } }, 'Test'),
      el('div', { class: 'kv-th' }, 'Error'),
      el('div', { class: 'kv-th' + (state.sortKey === 'duration' ? ' kv-sorted' : ''), on: { click: () => setSort('duration') }, style: { textAlign: 'right' } }, 'Duration'),
      el('div', { class: 'kv-th' }, ''),
    );

    const body = el('div', { class: 'kv-table-body' });
    if (!rows.length) {
      body.appendChild(
        el('div', { class: 'kv-empty-state' },
          'No tests match the current filter.',
        ),
      );
    } else if (state.sortKey === 'group') {
      // Group rows by their bucket so users see "Newly failing → tests" cleanly.
      const byGroup = new Map();
      for (const r of rows) {
        if (!byGroup.has(r.group)) byGroup.set(r.group, []);
        byGroup.get(r.group).push(r);
      }
      for (const g of GROUPS) {
        const items = byGroup.get(g.id);
        if (!items?.length) continue;
        body.appendChild(el('div', { class: 'kv-section-head' },
          g.label,
          el('span', { class: 'kv-section-count' }, items.length),
        ));
        for (const r of items) body.appendChild(rowEl(r));
      }
    } else {
      for (const r of rows) body.appendChild(rowEl(r));
    }

    return el('div', { class: 'kv-table' }, head, body);
  }

  function rowEl(r) {
    const isOpen = state.expanded.has(r.id);
    const row = el('div', {
      class: 'kv-row' + (isOpen ? ' kv-open' : ''),
      on: {
        click: () => {
          if (isOpen) state.expanded.delete(r.id);
          else state.expanded.add(r.id);
          rerenderTable();
        },
      },
    },
      el('div', { class: 'kv-status-cell' },
        pillet(r.prevStatus),
        el('span', { class: 'kv-arrow' }, '→'),
        pillet(r.curStatus),
      ),
      el('div', { class: 'kv-name-cell' },
        el('div', { class: 'kv-name', title: r.name }, r.name),
        el('div', { class: 'kv-meta' },
          [r.suite, r.filePath].filter(Boolean).join(' · ') || '—',
        ),
      ),
      el('div', { class: 'kv-error-cell', title: r.errorPreview || '' }, r.errorPreview || ''),
      el('div', { class: 'kv-dur-cell' },
        el('div', null, fmtMs(r.curDuration ?? r.prevDuration)),
        r.prevDuration != null && r.curDuration != null
          ? el('div', { style: { fontSize: '10.5px' } }, fmtDeltaMs(r.prevDuration, r.curDuration))
          : null,
      ),
      el('div', { class: 'kv-chev-cell' }, '›'),
    );

    if (isOpen) {
      // Expand into a separate sibling — but we still want it in the table flow.
      // Easiest: wrap row + expand together.
      const wrap = el('div', null, row, expandEl(r));
      return wrap;
    }
    return row;
  }

  function expandEl(r) {
    const prevHas = !!r.prevError;
    const curHas = !!r.curError;
    return el('div', { class: 'kv-expand', on: { click: (e) => e.stopPropagation() } },
      el('div', { class: 'kv-grid' },
        errorPane('Previous run', r.prevStatus, r.prevError, !prevHas),
        errorPane('Current run', r.curStatus, r.curError, !curHas),
      ),
      el('div', { class: 'kv-info' },
        infoRow('Test ID', r.id),
        r.suite && infoRow('Suite', r.suite),
        r.filePath && infoRow('File', r.filePath),
        r.severity && infoRow('Severity', r.severity),
        r.owner && infoRow('Owner', r.owner),
        r.tags?.length ? infoRow('Tags', r.tags.join(', ')) : null,
        infoRow('Prev duration', fmtMs(r.prevDuration)),
        infoRow('Cur duration', fmtMs(r.curDuration)),
      ),
    );
  }

  function infoRow(k, v) {
    return [
      el('div', { class: 'kv-k' }, k),
      el('div', { class: 'kv-v' }, v ?? '—'),
    ];
  }

  function errorPane(title, status, err, empty) {
    return el('div', { class: 'kv-pane' },
      el('div', { class: 'kv-pane-head' },
        title,
        el('span', { class: 'kv-tag' }, status ? pillet(status) : '—'),
      ),
      empty
        ? el('div', { class: 'kv-pane-body kv-empty' }, 'No error captured for this run.')
        : el('div', { class: 'kv-pane-body' },
            err.message
              ? el('div', { class: 'kv-err-msg' }, (err.type ? '[' + err.type + '] ' : '') + err.message)
              : null,
            err.stack
              ? el('div', { class: 'kv-stack' }, err.stack)
              : null,
          ),
    );
  }

  // ---------- theme ----------
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('kensho-diff.theme', next); } catch {}
    const btn = document.querySelector('.kv-theme-toggle');
    if (btn) {
      btn.replaceChildren(themeIcon());
    }
  }

  function themeIcon() {
    const dark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';
    return el('span', null, dark ? '☀' : '☾');
  }

  function loadTheme() {
    try {
      const t = localStorage.getItem('kensho-diff.theme');
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch {}
  }

  // ---------- footer ----------
  function renderFooter(diff, root) {
    root.appendChild(el('div', { class: 'kv-foot' },
      el('div', null, 'Generated ' + fmtDate(diff.generatedAt) + ' · schema ' + diff.schemaVersion),
      el('a', { href: 'data/diff.json' }, 'data/diff.json'),
    ));
  }

  // ---------- boot ----------
  async function boot() {
    loadTheme();
    const root = document.getElementById('app');
    root.replaceChildren(
      el('div', { class: 'kv-boot-wrap' },
        el('div', { class: 'kv-boot-mark' }, el('img', { src: 'assets/kaizen-mark.svg', width: 40, height: 40, alt: '' })),
        el('div', { class: 'kv-boot-text' }, 'Loading diff…'),
      ),
    );
    let diff;
    try {
      const res = await fetch('data/diff.json');
      diff = await res.json();
    } catch (e) {
      root.replaceChildren(el('div', { class: 'kv-empty-state' }, 'Failed to load data/diff.json — ' + (e.message || e)));
      return;
    }
    state.diff = diff;
    const shell = el('div', { class: 'kv-diff-shell' });
    renderHeader(diff, shell);
    renderToolbar(diff, shell);
    const tableHost = el('div', { id: 'kv-table-host' }, buildTable(diff));
    shell.appendChild(tableHost);
    renderFooter(diff, shell);
    root.replaceChildren(shell);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
