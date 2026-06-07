/* global React, ReactDOM, lucide */
// =============================================================
//  Kensho viewer — root App + router + keyboard shortcuts.
//  Loaded LAST: depends on every other window.* component.
// =============================================================

const { useState: useStateA, useEffect: useEffectA } = React;

// Stable null-context for the static-report path (mirrors the pattern in
// components.jsx / tree-detail.jsx). Always calling useContext keeps the
// hook order stable across the static and embedded mount paths.
const _kvAppNullCtx = React.createContext(null);

function fmtDuration(ms) { return window._kenshoFmtDuration ? window._kenshoFmtDuration(ms) : ms + 'ms'; }
function relTime(iso)   { return window._kenshoRelTime    ? window._kenshoRelTime(iso)    : ''; }

const PAGE_NAMES = ['overview','suites','graphs','timeline','categories','flaky','behaviors','packages','history'];

// Parse `#/case/<id>` or `#/page/<name>` (defaults: page=overview, no case).
function parseHash() {
  const h = (window.location.hash || '').replace(/^#\/?/, '');
  if (!h) return { page: 'overview', caseId: null };
  const parts = h.split('/');
  if (parts[0] === 'case' && parts[1]) return { page: null, caseId: decodeURIComponent(parts[1]) };
  if (parts[0] === 'page' && parts[1] && PAGE_NAMES.includes(parts[1])) return { page: parts[1], caseId: null };
  // Bare page name in hash (e.g. #suites) — accept for niceness.
  if (PAGE_NAMES.includes(parts[0])) return { page: parts[0], caseId: null };
  return { page: 'overview', caseId: null };
}

// Build the long URL form so users can copy a permalink to a specific case.
function caseHashHref(id) {
  return '#/case/' + encodeURIComponent(id);
}

// SummaryKpi — single tile inside the Summary hero's KPI band. Used as a
// 3×2 grid; we draw separators with `border` prop ("left" / "top" / "top-left")
// to avoid double-borders between adjacent tiles.
function SummaryKpi({ label, value, hint, accent, border, onClick }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick || undefined}
      style={{
        position:'relative', padding:'14px 18px',
        borderLeft:  border === 'left' || border === 'top-left' ? '1px solid var(--line)' : 'none',
        borderTop:   border === 'top'  || border === 'top-left' ? '1px solid var(--line)' : 'none',
        cursor: clickable ? 'pointer' : 'default',
        transition:'background var(--dur-fast)',
        minWidth:0,
      }}
      onMouseEnter={clickable ? e => e.currentTarget.style.background='var(--bg-hover)' : undefined}
      onMouseLeave={clickable ? e => e.currentTarget.style.background='transparent' : undefined}
    >
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
        <span style={{ width:6, height:6, borderRadius:999, background: accent || 'var(--fg3)' }}/>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:'.12em', textTransform:'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:700, letterSpacing:-0.4, color:'var(--fg1)', lineHeight:1, fontVariantNumeric:'tabular-nums', marginBottom: hint ? 6 : 0 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontFamily:'var(--font-body)', fontSize:11.5, color:'var(--fg3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={hint}>
          {hint}
        </div>
      )}
    </div>
  );
}

// =============================================================
//  Toast host — minimal, top-right, auto-dismiss. Used by the
//  "copy link" affordance and could be reused by future actions.
// =============================================================
function ToastHost() {
  const [toasts, setToasts] = useStateA([]);
  useEffectA(() => {
    window.__kenshoToast = (msg) => {
      const id = Math.random().toString(36).slice(2, 8);
      setToasts(t => [...t, { id, msg }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2200);
    };
    return () => { delete window.__kenshoToast; };
  }, []);
  return (
    <div style={{
      position:'fixed', top:20, right:20, display:'flex', flexDirection:'column', gap:8,
      zIndex: 700, pointerEvents:'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background:'var(--fg1)', color:'var(--bg-elev)',
          fontFamily:'var(--font-body)', fontSize:13, fontWeight:500,
          padding:'10px 14px', borderRadius:8, boxShadow:'0 6px 20px rgba(0,0,0,0.15)',
          display:'flex', alignItems:'center', gap:8,
          animation: 'kvToastIn 200ms ease-out',
        }}>
          <span style={{ color:'var(--status-passed)', fontWeight:700 }}>✓</span>{t.msg}
        </div>
      ))}
    </div>
  );
}

// =============================================================
//  ShortcutsOverlay — opened by `?`. Plain modal, dismiss on Esc/click.
// =============================================================
function ShortcutsOverlay({ open, onClose }) {
  if (!open) return null;
  const ROWS = [
    ['Navigation', [
      ['/', 'Focus search on the current tree page'],
      ['j / k', 'Move selection down / up among visible tests'],
      ['Enter', 'Open the selected test in the detail pane'],
      ['Esc', 'Close detail pane or clear search'],
    ]],
    ['Go to page', [
      ['g o', 'Overview'],
      ['g s', 'Suites'],
      ['g g', 'Graphs'],
      ['g f', 'Flaky'],
      ['g h', 'History'],
    ]],
    ['Help', [
      ['?', 'Toggle this overlay'],
    ]],
  ];
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.45)',
        display:'flex', alignItems:'center', justifyContent:'center',
        zIndex: 600,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:12,
          width:'min(540px, 92vw)', padding:'24px 28px',
          boxShadow:'0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:18 }}>
          <h2 style={{ margin:0, fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, color:'var(--fg1)' }}>Keyboard shortcuts</h2>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>press <kbd style={kbdStyle()}>Esc</kbd> to close</span>
        </div>
        {ROWS.map(([group, items]) => (
          <div key={group} style={{ marginBottom:16 }}>
            <div className="k-overline" style={{ marginBottom:8 }}>{group}</div>
            <div style={{ display:'grid', gridTemplateColumns:'120px 1fr', rowGap:6, columnGap:14 }}>
              {items.map(([keys, desc]) => (
                <React.Fragment key={keys}>
                  <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                    {keys.split(' ').map((k, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg3)' }}>then</span>}
                        <kbd style={kbdStyle()}>{k}</kbd>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ fontFamily:'var(--font-body)', fontSize:13, color:'var(--fg2)' }}>{desc}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function kbdStyle() {
  return {
    fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600,
    padding:'2px 6px', borderRadius:4,
    border:'1px solid var(--line)', background:'var(--bg-sunken)', color:'var(--fg1)',
    minWidth:18, display:'inline-flex', justifyContent:'center', alignItems:'center',
  };
}

// =============================================================
//  App — root component.
// =============================================================
function App() {
  // Pull embed-mode extras / callbacks from the host's context (if any).
  // Static-report path: ctx === null → behave as before (hash routing,
  // keyboard shortcuts, no extras).
  const ctx = React.useContext(window.__KenshoContext || _kvAppNullCtx);
  const ownKeyboard = !!ctx?.ownKeyboard;
  const extraSidebar = ctx?.extraSidebar || [];

  const initial = parseHash();
  const [page, setPage] = useStateA(ctx?.page ?? (initial.page || 'overview'));
  const [selected, setSelected] = useStateA(null);
  const [tab, setTab] = useStateA('steps');
  const [shortcutsOpen, setShortcutsOpen] = useStateA(false);

  // Icons render inline via the Icon component (see components.jsx); no
  // global lucide.createIcons() pass — it would rewrite the host page's
  // <i data-lucide=> elements when embedded inside another React app.

  // When the host pushes a new page/case via context (controlled mode),
  // sync local state. Only active when ownKeyboard is set.
  useEffectA(() => {
    if (!ownKeyboard) return;
    if (ctx?.page && ctx.page !== page) setPage(ctx.page);
  }, [ctx?.page, ownKeyboard]);

  // Open a test by id, returning whether we found one.
  const openTestById = React.useCallback((testId) => {
    const t = window.RICH_TESTS?.[testId];
    if (!t) return false;
    setSelected({ ns: '', name: t.name, status: t.status, duration: t.dur, retries: t.retries, richId: t.id });
    setTab('steps');
    return true;
  }, []);

  // ---- Hash router ----
  // Treat the URL hash as the source of truth for "page" + "open case" so
  // the back/forward buttons and copyable permalinks both work without
  // pulling in a routing library.
  // When the host owns navigation (`ownKeyboard: true`), skip hash routing
  // — the host updates the URL itself and we react to its callbacks.
  useEffectA(() => {
    if (ownKeyboard) return;
    const onHash = () => {
      const { page: p, caseId } = parseHash();
      if (caseId) {
        const ok = openTestById(caseId);
        if (!ok) setSelected(null);
      } else if (p) {
        setSelected(null);
        setPage(p);
      }
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, [openTestById, ownKeyboard]);

  // ---- Global navigation hooks ----
  // Mirror page/test changes back into the URL hash so refreshes preserve state.
  // Embed-mode (ownKeyboard) skips the URL write and fires onCaseOpen /
  // onPageChange instead.
  useEffectA(() => {
    const navTo = (p) => {
      setSelected(null);
      setPage(p);
      if (ownKeyboard) {
        ctx?.onPageChange?.(p);
      } else {
        const next = '#/page/' + p;
        if (window.location.hash !== next) history.pushState(null, '', next);
      }
    };
    const openTest = (testId) => {
      if (!openTestById(testId)) return;
      if (ownKeyboard) {
        ctx?.onCaseOpen?.(testId);
      } else {
        const next = caseHashHref(testId);
        if (window.location.hash !== next) history.pushState(null, '', next);
      }
    };
    window.__navTo = navTo;
    window.__openTest = openTest;
    return () => { delete window.__navTo; delete window.__openTest; };
  }, [openTestById, ownKeyboard, ctx]);

  // ---- Keyboard shortcuts ----
  // Skipped entirely when the host owns the keyboard (embed mode) so we
  // don't intercept their app-level chords.
  useEffectA(() => {
    if (ownKeyboard) return;
    let pendingG = false;
    let gTimer = null;
    const isTextInput = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const focusTreeSearch = () => {
      const el = document.querySelector('.kv-tree-search input, [data-kv-search] input');
      if (el) { el.focus(); el.select?.(); return true; }
      return false;
    };
    const moveSelection = (delta) => {
      const ev = new CustomEvent('kensho:move-selection', { detail: { delta } });
      window.dispatchEvent(ev);
    };
    const enterSelection = () => {
      const ev = new CustomEvent('kensho:open-selection');
      window.dispatchEvent(ev);
    };
    const escapeAction = () => {
      // 1. close shortcuts overlay if open
      // 2. close detail pane (back to tree placeholder)
      // 3. otherwise dispatch clear-search to active tree page
      if (shortcutsOpen) { setShortcutsOpen(false); return; }
      if (selected) { setSelected(null); history.pushState(null, '', '#/page/' + page); return; }
      window.dispatchEvent(new CustomEvent('kensho:clear-search'));
    };

    const onKeyDown = (e) => {
      if (isTextInput(e.target)) {
        // Allow Esc in text input → blur + clear search via custom event.
        if (e.key === 'Escape') {
          e.target.blur();
          window.dispatchEvent(new CustomEvent('kensho:clear-search'));
        }
        return;
      }
      // Modifier-laden combos belong to the browser/OS.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // `g` chord — wait up to 1.5s for the next key.
      if (pendingG) {
        const code = e.key.toLowerCase();
        const map = { o:'overview', s:'suites', g:'graphs', f:'flaky', h:'history' };
        if (map[code]) {
          e.preventDefault();
          window.__navTo?.(map[code]);
        }
        pendingG = false;
        clearTimeout(gTimer);
        return;
      }

      switch (e.key) {
        case '/': {
          e.preventDefault();
          if (!focusTreeSearch()) {
            // No tree search on the current page — jump to Suites and try again.
            window.__navTo?.('suites');
            setTimeout(focusTreeSearch, 50);
          }
          return;
        }
        case 'j': e.preventDefault(); moveSelection(+1); return;
        case 'k': e.preventDefault(); moveSelection(-1); return;
        case 'Enter': e.preventDefault(); enterSelection(); return;
        case 'Escape': e.preventDefault(); escapeAction(); return;
        case '?': e.preventDefault(); setShortcutsOpen(o => !o); return;
        case 'g': pendingG = true; gTimer = setTimeout(() => { pendingG = false; }, 1500); return;
        default: return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); clearTimeout(gTimer); };
  }, [page, selected, shortcutsOpen, ownKeyboard]);

  const RUN = window.RUN;
  const project = window.KENSHO_INDEX?.project || { name: 'Kensho' };

  return (
    <div className="app">
      <Sidebar active={page} onNav={p => { window.__navTo?.(p); }} />
      <div className="right-col">
        <TopBar
          crumbs={selected
            ? ['Run ' + RUN.id, 'Tests', selected.ns + selected.name]
            : ['Run ' + RUN.id, page === 'flaky' ? 'Flaky tests' : page[0].toUpperCase() + page.slice(1)]}
          onRerun={() => alert('Re-run hooks are configured by the integrating CI. Wire to your runner.')}
          project={project}
        />
        <div className="main">
          {(() => {
            if (selected) return <Detail test={selected} onBack={() => { setSelected(null); if (!ownKeyboard) history.pushState(null, '', '#/page/' + page); }} />;
            const ex = extraSidebar.find(x => x.id === page);
            if (ex) return ex.render();
            switch (page) {
              case 'graphs': return <GraphsPage/>;
              case 'timeline': return <TimelinePage/>;
              case 'categories': return <CategoriesPage/>;
              case 'flaky': return <FlakyPage/>;
              case 'behaviors': return <BehaviorsPage/>;
              case 'packages': return <PackagesPage/>;
              case 'history': return <HistoryPage/>;
              case 'suites': return <SuitesView onOpen={(t) => window.__openTest?.(t.richId)} />;
              default: return <Overview onOpen={(t) => window.__openTest?.(t.richId)} />;
            }
          })()}
        </div>
      </div>
      <ToastHost/>
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)}/>
    </div>
  );
}

// =============================================================
//  Overview — drag-to-reorder card grid.
// =============================================================
function SingleRunTrend() {
  const RUN = window.RUN;
  const c = RUN.counts;
  const total = c.passed + c.failed + c.broken + c.skipped || 1;
  const passRate = Math.round((c.passed / total) * 100);
  const SEGS = [
    ['passed', c.passed, 'var(--status-passed)'],
    ['skipped', c.skipped, 'var(--status-skipped)'],
    ['broken', c.broken, 'var(--status-broken)'],
    ['failed', c.failed, 'var(--status-failed)'],
  ].filter(([, n]) => n > 0);
  return (
    <div>
      <div style={{
        display:'grid', gridTemplateColumns:'1fr auto auto auto auto', gap:18,
        alignItems:'baseline', padding:'4px 4px 14px', borderBottom:'1px solid var(--line)',
        marginBottom:14,
      }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:1.2, textTransform:'uppercase' }}>Current run</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginTop:4 }}>
            <span style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:700, color:'var(--fg1)', letterSpacing:-0.5, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>
              {passRate}<span style={{ fontSize:14, color:'var(--fg3)', marginLeft:2 }}>%</span>
            </span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>pass rate</span>
          </div>
        </div>
        {[
          ['passed', c.passed, 'var(--status-passed)'],
          ['skipped', c.skipped, 'var(--status-skipped)'],
          ['broken', c.broken, 'var(--status-broken)'],
          ['failed', c.failed, 'var(--status-failed)'],
        ].map(([k, n, color]) => (
          <div key={k} style={{ textAlign:'right', minWidth:60 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, justifyContent:'flex-end', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg3)', textTransform:'uppercase', letterSpacing:0.5 }}>
              <span style={{ width:8, height:8, borderRadius:2, background:color }}/>{k}
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:600, color:'var(--fg1)', fontVariantNumeric:'tabular-nums', marginTop:2 }}>{n}</div>
          </div>
        ))}
      </div>

      <div style={{ height:48, background:'var(--bg-sunken)', borderRadius:6, display:'flex', overflow:'hidden', border:'1px solid var(--line)' }}>
        {SEGS.map(([k, n, color]) => (
          <div key={k} title={`${n} ${k}`}
            style={{
              width: `${(n/total)*100}%`, background: color,
              display:'flex', alignItems:'center', justifyContent:'flex-start',
              padding:'0 10px', color:'#fff', fontFamily:'var(--font-mono)', fontSize:12, fontWeight:700,
            }}>
            {(n/total) >= 0.05 ? n : ''}
          </div>
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>
        <span>{total} test{total === 1 ? '' : 's'} · 1 run total</span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
          <span style={{ width:6, height:6, borderRadius:999, background:'var(--brand-blue-500)' }}/>
          History will populate after the next <code style={{ fontFamily:'var(--font-mono)', fontSize:10.5, background:'var(--bg-sunken)', padding:'1px 6px', borderRadius:3, color:'var(--fg2)' }}>kensho generate</code>
        </span>
      </div>
    </div>
  );
}

function EnvEmptyState() {
  const SUPPORTED = [
    ['Source control',  ['branch', 'commit', 'author', 'commitMsg', 'repoUrl']],
    ['CI',              ['ci', 'runUrl', 'workers', 'trigger']],
    ['App under test',  ['stage', 'baseUrl', 'appVersion', 'release']],
    ['Browser / device',['browsers', 'device', 'viewport', 'locale']],
    ['System',          ['os', 'osVersion', 'arch', 'timezone']],
    ['Custom',          ['vars (open key/value bag)']],
  ];
  return (
    <div style={{ padding:'8px 0 4px' }}>
      <div style={{ color:'var(--fg2)', fontFamily:'var(--font-body)', fontSize:13, marginBottom:14, lineHeight:1.5 }}>
        No environment variables in this run.
        Populate <code style={{ fontFamily:'var(--font-mono)', fontSize:12, background:'var(--bg-sunken)', padding:'1px 6px', borderRadius:3 }}>run.env.*</code> from your reporter to see them here.
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {SUPPORTED.map(([group, keys]) => (
          <div key={group}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:4 }}>{group}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
              {keys.map(k => (
                <span key={k} style={{
                  fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg2)',
                  background:'var(--bg-sunken)', border:'1px solid var(--line)',
                  borderRadius:4, padding:'2px 6px',
                }}>{k}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TestsCard({ tests, onOpen }) {
  const [filter, setFilter] = useStateA('all');
  const [page, setPage] = useStateA(0);
  const PAGE_SIZE = 20;

  const counts = { all: tests.length, passed:0, failed:0, broken:0, skipped:0 };
  for (const t of tests) counts[t.status] = (counts[t.status] || 0) + 1;

  const SEV_RANK = { blocker:0, critical:1, normal:2, minor:3, trivial:4 };
  const STATUS_RANK = { failed:0, broken:1, skipped:2, passed:3 };

  const filtered = filter === 'all'
    ? [...tests].sort((a,b) => {
        const oa = STATUS_RANK[a.status] ?? 9;
        const ob = STATUS_RANK[b.status] ?? 9;
        if (oa !== ob) return oa - ob;
        if (a.status === 'failed' || a.status === 'broken') {
          return (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9);
        }
        return (a.order || 0) - (b.order || 0);
      })
    : tests.filter(t => t.status === filter);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(total, start + PAGE_SIZE);
  const visible = filtered.slice(start, end);

  const PILLS = [
    ['all', 'All'],
    ['failed', 'Failed'],
    ['broken', 'Broken'],
    ['skipped', 'Skipped'],
    ['passed', 'Passed'],
  ].filter(([id]) => id === 'all' || (counts[id] || 0) > 0);

  const setF = f => { setFilter(f); setPage(0); };

  return (
    <div>
      <div style={{ display:'flex', gap:6, padding:'2px 0 12px', flexWrap:'wrap' }}>
        {PILLS.map(([id, label]) => {
          const active = filter === id;
          const tone = id === 'all' ? null : id;
          return (
            <button
              key={id}
              onClick={() => setF(id)}
              style={{
                display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:999,
                border: '1px solid ' + (active ? 'var(--brand-blue-500)' : 'var(--line)'),
                background: active
                  ? 'var(--brand-blue-500)'
                  : (tone ? `var(--status-${tone}-bg)` : 'var(--bg-elev)'),
                color: active
                  ? '#fff'
                  : (tone ? `var(--status-${tone})` : 'var(--fg2)'),
                fontFamily:'var(--font-body)', fontSize:12, fontWeight:600, cursor:'pointer',
                transition:'background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast)',
              }}
            >
              {label}
              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, opacity:0.9 }}>{counts[id]}</span>
            </button>
          );
        })}
      </div>

      <div style={{ marginLeft:-20, marginRight:-20 }}>
        {visible.length === 0 ? (
          <div style={{ padding:'30px 20px', textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12 }}>
            No {filter === 'all' ? '' : filter + ' '}tests in this run.
          </div>
        ) : visible.map((t) => (
          <TestRow key={t.id} test={{
            ns: '', name: t.name, status: t.status, duration: t.dur, last: t.lastRun, retries: t.retries,
            richId: t.id,
          }} onOpen={() => onOpen({ ns:'', name: t.name, status: t.status, duration: t.dur, retries: t.retries, richId: t.id })}/>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0 0', marginTop:8, borderTop:'1px solid var(--line)', flexWrap:'wrap', gap:8 }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg3)' }}>
            Showing <b style={{ color:'var(--fg1)' }}>{start+1}–{end}</b> of <b style={{ color:'var(--fg1)' }}>{total}</b>
            {filter !== 'all' ? ' ' + filter : ''}
            {filter !== 'all' ? <span> · </span> : null}
            {filter !== 'all' ? <span>{tests.length} total</span> : null}
          </div>
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            <button className="btn btn-ghost" style={{ height:28, fontSize:12 }} disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p-1))}>← Prev</button>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', padding:'0 6px' }}>page {safePage + 1} / {pages}</span>
            <button className="btn btn-ghost" style={{ height:28, fontSize:12 }} disabled={safePage >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p+1))}>Next →</button>
            <button className="btn btn-secondary" style={{ height:28, fontSize:12, marginLeft:8 }} onClick={() => window.__navTo?.('suites')}>View all in Suites →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Overview({ onOpen }) {
  const RUN = window.RUN;
  const SUITES = window.SUITES || [];
  const ENV = window.ENV || [];
  const allTests = Object.values(window.RICH_TESTS || {}).sort((a,b) => a.order - b.order);
  const counts = { passed:0, failed:0, broken:0, skipped:0 };
  for (const t of allTests) counts[t.status] = (counts[t.status] || 0) + 1;

  const sevCounts = { blocker:0, critical:0, normal:0, minor:0, trivial:0 };
  for (const t of allTests) {
    const s = (t.severity || 'normal').toLowerCase();
    if (sevCounts[s] != null) sevCounts[s]++; else sevCounts.normal++;
  }
  const sevTotal = Object.values(sevCounts).reduce((a,b) => a+b, 0);

  const total = allTests.length || 1;
  const passRate = Math.round((counts.passed / total) * 100);
  const durSamples = allTests.filter(t => t.durMs > 0).map(t => t.durMs);
  const meanDur = durSamples.length ? Math.round(durSamples.reduce((a,b) => a+b, 0) / durSamples.length) : 0;
  const slowest = [...allTests].filter(t => t.durMs > 0).sort((a,b) => b.durMs - a.durMs)[0];
  const retriedCount = allTests.filter(t => (t.retries || 0) > 0).length;
  const flakyCount = allTests.filter(t => (t.retries || 0) > 0 || t.status === 'broken').length;
  const fmt = window._kenshoFmtDuration || (ms => ms + 'ms');

  const cards = {
    summary: {
      title:'Run summary', meta: RUN.duration, span:2,
      body: (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(280px, 360px) 1fr', gap:28, alignItems:'center' }}>
          <div style={{ display:'flex', gap:18, alignItems:'center' }}>
            <div>
              <div className="statnum">{allTests.length}</div>
              <div className="statlbl">test cases</div>
            </div>
            <div style={{ flex:1 }}><StatusDonut counts={counts} /></div>
          </div>

          <div style={{
            display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:0,
            border:'1px solid var(--line)', borderRadius:10, overflow:'hidden',
            background:'var(--bg-elev)',
          }}>
            <SummaryKpi
              label="Pass rate" value={`${passRate}%`}
              accent={passRate >= 95 ? 'var(--status-passed)' : passRate >= 80 ? 'var(--status-broken)' : 'var(--status-failed)'}
            />
            <SummaryKpi
              label="Mean duration" value={meanDur ? fmt(meanDur) : '—'}
              accent="var(--brand-blue-500)"
              border="left"
            />
            <SummaryKpi
              label="Slowest"
              value={slowest ? slowest.dur : '—'}
              hint={slowest ? slowest.name : ''}
              accent="var(--status-broken)"
              border="left"
              onClick={slowest ? () => window.__openTest?.(slowest.id) : null}
            />
            <SummaryKpi
              label="Failures" value={counts.failed}
              accent="var(--status-failed)"
              border="top"
              onClick={counts.failed > 0 ? () => window.__navTo?.('categories') : null}
            />
            <SummaryKpi
              label="Skipped" value={counts.skipped}
              accent="var(--status-skipped-fg)"
              border="top-left"
            />
            <SummaryKpi
              label="Flaky" value={flakyCount}
              hint={flakyCount > 0 ? `${retriedCount} retried · ${counts.broken} broken` : 'clean run'}
              accent={flakyCount > 0 ? 'var(--status-broken)' : 'var(--status-passed)'}
              border="top-left"
              onClick={flakyCount > 0 ? () => window.__navTo?.('flaky') : null}
            />
          </div>
        </div>
      ),
    },
    trend: {
      title:'Trend', meta: (window.TREND_RUNS?.length || 0) + ' run' + (window.TREND_RUNS?.length === 1 ? '' : 's') + ' · stacked', span:1,
      body: window.TREND_RUNS?.length
        ? <TrendChartV2 runs={window.TREND_RUNS}/>
        : <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>Run history will populate after the next generate.</div>,
    },
    severity: {
      title:'Severity distribution', meta: `${sevTotal} test${sevTotal === 1 ? '' : 's'}`, span:1,
      body: <SeverityDistribution tests={allTests}/>,
    },
    slowest: {
      title:'Slowest tests', meta: 'top 6 by duration', span:1,
      action: (
        <a className="btn btn-ghost" style={{height:24,padding:'0 8px',fontSize:12,cursor:'pointer'}}
           onClick={(e) => { e.stopPropagation(); window.__navTo?.('timeline'); }}>
          See timeline →
        </a>
      ),
      body: <SlowestTestsList tests={allTests} limit={6} onOpen={onOpen}/>,
    },
    suites: {
      title:`Suites · ${SUITES.length} items total`, span:1,
      action: <a className="btn btn-ghost" style={{height:24,padding:'0 8px',fontSize:12,cursor:'pointer'}} onClick={(e) => { e.stopPropagation(); window.__navTo?.('suites'); }}>Show all →</a>,
      body: <>{SUITES.slice(0, 8).map(s => <SuiteBar key={s.name} {...s} />)}</>,
    },
    environment: {
      title:'Environment', meta: ENV.length ? ENV.length + ' vars' : 'no vars', span:1,
      body: ENV.length ? <EnvTable env={ENV} /> : <EnvEmptyState/>,
    },
    tests: {
      title:`Tests · ${allTests.length} items total`, span:2,
      action: (
        <a className="btn btn-ghost" style={{height:24,padding:'0 8px',fontSize:12,cursor:'pointer'}}
           onClick={(e) => { e.stopPropagation(); window.__navTo?.('suites'); }}>
          View all in Suites →
        </a>
      ),
      body: <TestsCard tests={allTests} onOpen={onOpen} />,
    },
  };

  const DEFAULT_ORDER = ['summary','trend','severity','slowest','suites','environment','tests'];
  const [order, setOrder] = useStateA(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('kensho.overview.order') || 'null');
      if (!Array.isArray(stored)) return DEFAULT_ORDER;
      const valid = stored.filter(id => DEFAULT_ORDER.includes(id));
      const missing = DEFAULT_ORDER.filter(id => !valid.includes(id));
      return [...valid, ...missing];
    } catch { return DEFAULT_ORDER; }
  });
  const [dragId, setDragId] = useStateA(null);
  const [overId, setOverId] = useStateA(null);

  React.useEffect(() => { localStorage.setItem('kensho.overview.order', JSON.stringify(order)); }, [order]);

  const onDragStart = (id) => (e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); };
  const onDragOver = (id) => (e) => { e.preventDefault(); if (id !== dragId) setOverId(id); };
  const onDragEnd = () => { setDragId(null); setOverId(null); };
  const onDrop = (id) => (e) => {
    e.preventDefault();
    if (!dragId || dragId === id) { onDragEnd(); return; }
    const next = [...order];
    const fromIdx = next.indexOf(dragId);
    const toIdx = next.indexOf(id);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragId);
    setOrder(next);
    onDragEnd();
  };

  const project = window.KENSHO_INDEX?.project || {};

  return (
    <div>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 18 }}>
        <div>
          <div className="k-overline">{project.name || 'Kensho'} · {RUN.startedAt}</div>
          <h1 className="k-h1" style={{ marginTop: 4 }}>Run {RUN.id} <span style={{ color:'var(--fg3)', fontWeight:500 }}>· {RUN.branch}{RUN.commit ? ' · ' + RUN.commit : ''}</span></h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {/* Branch + commit chips ONLY render when env.repoUrl is set so they
              can actually link somewhere. Locally (no repoUrl) the same info
              still appears as inline metadata in the H1 above; rendering
              dead buttons would add chrome without adding affordance. */}
          {(() => {
            const repo = (RUN.repoUrl || '').replace(/\/$/, '');
            if (!repo) return null;
            const branchUrl = `${repo}/tree/${encodeURIComponent(RUN.branch)}`;
            const commitUrl = RUN.commitFull ? `${repo}/commit/${RUN.commitFull}` : '';
            return (
              <>
                <a className="btn btn-secondary" href={branchUrl} target="_blank" rel="noopener noreferrer" title={`Open ${RUN.branch} on the repo`}><Icon name="git-branch" />{RUN.branch}</a>
                {commitUrl && <a className="btn btn-secondary" href={commitUrl} target="_blank" rel="noopener noreferrer" title={`Open commit ${RUN.commit}`}><Icon name="git-commit" />{RUN.commit}</a>}
              </>
            );
          })()}
          <button className="btn btn-ghost" title="Reset card order" onClick={() => setOrder(DEFAULT_ORDER)}><Icon name="rotate-ccw" size={14}/></button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.1fr 1.6fr', gap: 16, alignItems:'start' }}>
        {order.map(id => {
          const c = cards[id];
          if (!c) return null;
          const isDrag = dragId === id;
          const isOver = overId === id;
          return (
            <div
              key={id}
              draggable
              onDragStart={onDragStart(id)}
              onDragOver={onDragOver(id)}
              onDrop={onDrop(id)}
              onDragEnd={onDragEnd}
              className="card"
              style={{
                gridColumn: c.span === 2 ? 'span 2' : 'auto',
                opacity: isDrag ? 0.4 : 1,
                outline: isOver ? '2px solid var(--accent)' : 'none',
                outlineOffset: isOver ? -2 : 0,
                transition:'outline var(--dur-fast), opacity var(--dur-fast)',
                cursor: 'default',
              }}
            >
              <div className="hd" style={{ alignItems:'center' }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'grab', color:'var(--fg3)', userSelect:'none' }} title="Drag to reorder">
                  <Icon name="grip-vertical" size={14}/>
                </span>
                <h3 style={{ margin:0, flex:1 }}>{c.title}</h3>
                {c.meta && <div className="meta">{c.meta}</div>}
                {c.action}
              </div>
              {c.body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ test, onBack }) {
  const richId = test.richId || test.id;
  const richTest = window.RICH_TESTS?.[richId];
  if (!richTest) return (
    <div className="card" style={{ padding:30, textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:13 }}>
      Test not found in this run.
      <div><button className="btn btn-ghost" onClick={onBack} style={{marginTop:14}}><Icon name="arrow-left"/>Back</button></div>
    </div>
  );
  return (
    <div>
      <button className="btn btn-ghost" style={{ marginBottom: 12 }} onClick={onBack}>
        <Icon name="arrow-left" />Back to overview
      </button>
      <div style={{ background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:'var(--r-lg)', display:'flex', flexDirection:'column', minHeight:'calc(100vh - 220px)', overflow:'hidden' }}>
        <DetailPane test={richTest} defaultTab="steps"/>
      </div>
    </div>
  );
}

// Boot: wait for data-bridge to populate window globals, THEN mount React.
// Mount target is configurable so embedders can host the viewer without
// renaming their own #app root. The static report ships index.html with
// `<div id="app">` and no override, so this still defaults correctly.
window.__KENSHO_BOOT.then(() => {
  const target = window.__KENSHO_MOUNT
    || document.querySelector('[data-kensho-viewer-mount]')
    || document.getElementById('app');
  if (!target) { console.error('[kensho] no mount target found'); return; }
  ReactDOM.createRoot(target).render(<App />);
});

// Tiny CSS for the toast animation — injected at boot so we don't need a
// separate stylesheet just for one keyframe.
const _styleEl = document.createElement('style');
_styleEl.textContent = `@keyframes kvToastIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }`;
document.head.appendChild(_styleEl);
