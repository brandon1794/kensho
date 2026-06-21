/* global React, RetryWaterfall, TestHeader, StepTreeV2 */
const { useState: useStateT } = React;

// Stable no-op context for the static-report path. We always call
// React.useContext(...) (Rules of Hooks) but pass this null-ish context when
// the embed wrapper isn't present, so consumers see `null` and behave as
// before.
const _kvNullCtx = React.createContext(null);

// RICH_TESTS is owned by data-bridge.jsx and exposed on window.RICH_TESTS
// from real Kensho run data. Do NOT redefine it here.

// ============== Tree node ==============
function TreeNode({ node, depth, openIds, onToggle, selectedId, onSelect, leafLabel }) {
  const isLeaf = !node.children;
  const open = openIds.has(node.id);
  const test = isLeaf ? window.RICH_TESTS[node.testId] : null;
  const sumCounts = node.counts || {};
  const indent = 12 + depth * 16;
  return (
    <div>
      <div
        onClick={() => isLeaf ? onSelect(node.testId) : onToggle(node.id)}
        style={{
          display:'grid',
          gridTemplateColumns:'14px 1fr auto',
          alignItems:'center',
          gap:10,
          padding:'7px 14px',
          paddingLeft: indent,
          cursor:'pointer',
          background: selectedId === node.testId ? 'var(--accent-soft)' : 'transparent',
          borderLeft: selectedId === node.testId ? '2px solid var(--brand-blue-500)' : '2px solid transparent',
          fontSize: 13,
          transition: 'background var(--dur-fast)',
        }}
        onMouseEnter={e => { if (selectedId !== node.testId) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (selectedId !== node.testId) e.currentTarget.style.background = 'transparent'; }}
      >
        {isLeaf ? (
          <span className={`s-icon ${test.status}`} style={{ width:14, height:14, fontSize:9 }}>
            {test.status === 'passed' ? '✓' : test.status === 'failed' ? '✕' : test.status === 'broken' ? '!' : '⊘'}
          </span>
        ) : (
          <span style={{ color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12, lineHeight:1, transform: open ? 'rotate(90deg)' : 'none', transition:'transform var(--dur-fast)' }}>›</span>
        )}
        <span style={{ fontFamily: isLeaf ? 'var(--font-body)' : 'var(--font-mono)', fontSize: isLeaf ? 13 : 12.5, fontWeight: isLeaf ? 500 : 600, color:'var(--fg1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {isLeaf && <span style={{ color:'var(--fg3)', marginRight:6, fontFamily:'var(--font-mono)', fontSize:11 }}>#{test.order}</span>}
          {leafLabel && isLeaf ? leafLabel(test) : (isLeaf ? test.name : node.name)}
          {isLeaf && test.retries > 0 && <span style={{ color: 'var(--status-broken)', marginLeft:6, fontSize:11, fontFamily:'var(--font-mono)' }}>↻{test.retries}</span>}
          {isLeaf && (test.flaky || test.muted) && <span style={{ marginLeft:6 }}><KvMarker flaky={test.flaky} muted={test.muted} links={test.links} size="sm" /></span>}
        </span>
        {isLeaf ? (
          <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', fontVariantNumeric:'tabular-nums' }}>{test.dur}</span>
        ) : (
          <div style={{ display:'flex', gap:3 }}>
            {sumCounts.failed  > 0 && <span style={{ background:'var(--status-failed)',  color:'#fff', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3 }}>{sumCounts.failed}</span>}
            {sumCounts.broken  > 0 && <span style={{ background:'var(--status-broken)',  color:'#fff', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3 }}>{sumCounts.broken}</span>}
            {sumCounts.passed  > 0 && <span style={{ background:'var(--status-passed)',  color:'#fff', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3 }}>{sumCounts.passed}</span>}
            {sumCounts.skipped > 0 && <span style={{ background:'var(--status-skipped)', color:'#fff', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3 }}>{sumCounts.skipped}</span>}
          </div>
        )}
      </div>
      {!isLeaf && open && (
        <div>
          {node.children.map(c => (
            <TreeNode key={c.id} node={c} depth={depth+1} openIds={openIds} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect} leafLabel={leafLabel}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ============== Status filter chips ==============
function StatusFilters({ counts, active, onToggle }) {
  const all = ['passed','failed','broken','skipped','unknown'];
  const glyph = { passed:'✓', failed:'✕', broken:'!', skipped:'⊘', unknown:'◌' };
  return (
    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
      <span style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:600, color:'var(--fg3)', marginRight:4 }}>Status</span>
      {all.map(k => (
        <button key={k} onClick={() => onToggle(k)} style={{
          display:'inline-flex', alignItems:'center', gap:5, height:24, padding:'0 8px', border:'1px solid var(--line)', borderRadius:6,
          background: active.has(k) ? `var(--status-${k})` : '#fff',
          color: active.has(k) ? '#fff' : 'var(--fg2)',
          fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, cursor:'pointer', fontVariantNumeric:'tabular-nums',
          transition:'background var(--dur-fast),color var(--dur-fast)',
        }}>
          <span style={{ fontSize: 9 }}>{glyph[k]}</span>{counts[k] || 0}
        </button>
      ))}
    </div>
  );
}

// ============== Detail pane (right) ==============

// Steps are already mapped to the V2 StepTreeV2 shape by data-bridge.jsx
// (each step has { name, status, duration, type, logs?, children?, payload?,
// assertion?, request?, response? }). This is now a near-identity pass-through —
// we only recurse into children. No name-guessing, no synthetic logs/screenshots.
function enrichSteps(steps, _test) {
  return steps.map(s => ({
    ...s,
    ...(s.children ? { children: enrichSteps(s.children, _test) } : {}),
  }));
}

function DetailPane({ test, defaultTab='steps' }) {
  // Restore the active tab from the shareable hash (?tab=…) on first mount.
  const _hashTab = (window.__kvCurrentHashExtra ? window.__kvCurrentHashExtra().tab : '') || '';
  const [tab, setTabRaw] = useStateT(_hashTab || defaultTab);
  // Wrap setTab so every tab change also updates the shareable URL (replace,
  // not push, so it doesn't spam back/forward).
  const setTab = React.useCallback((t) => {
    setTabRaw(t);
    if (window.__kvReplaceHashExtra) window.__kvReplaceHashExtra({ tab: t === 'steps' ? '' : t });
  }, []);
  const [loaded, setLoaded] = useStateT(0);
  const scrollRef = React.useRef(null);
  // Embed-mode extras. Static-report path: __KenshoContext is undefined →
  // ctx === null → no extras. Use a stable no-op context so the hook order
  // stays consistent in both modes.
  const _kvCtx = React.useContext(window.__KenshoContext || _kvNullCtx);
  const extraTabs = _kvCtx?.extraTabs || [];
  // reset scroll to top whenever the selected test changes — otherwise the
  // user can't tell the panel updated (and may think they hit a blank page)
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [test?.id]);

  // Lazy-load full case data (steps/error/attachments/history) when the
  // selection changes. data-bridge mutates the richTest in place and sets
  // _stepsLoaded=true; we bump `loaded` to force a re-render once it's ready.
  React.useEffect(() => {
    if (!test) return;
    if (test._stepsLoaded) { setLoaded(l => l + 1); return; }
    window._kenshoEnsureCase(test).then(() => setLoaded(l => l + 1));
  }, [test?.id]);

  if (!test) {
    // Useful empty state — shows run-level summary so the right pane isn't
    // visually dead while the user explores the tree on the left.
    const all = Object.values(window.RICH_TESTS || {});
    const counts = { passed:0, failed:0, broken:0, skipped:0 };
    for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;
    const RUN = window.RUN || {};
    const ROWS = [
      ['passed',  counts.passed,  'var(--status-passed)'],
      ['failed',  counts.failed,  'var(--status-failed)'],
      ['broken',  counts.broken,  'var(--status-broken)'],
      ['skipped', counts.skipped, 'var(--status-skipped)'],
    ].filter(r => r[1] > 0);
    return (
      <div style={{ flex:1, padding:'56px 40px', overflow:'auto' }}>
        <div style={{ maxWidth:420, margin:'0 auto' }}>
          <div className="k-overline" style={{ marginBottom:6 }}>This run</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:700, letterSpacing:-0.5, color:'var(--fg1)', marginBottom:6 }}>
            {all.length} <span style={{ color:'var(--fg3)', fontWeight:500 }}>test{all.length === 1 ? '' : 's'}</span>
          </div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg3)', marginBottom:24 }}>
            {RUN.duration || ''}{RUN.duration ? ' · ' : ''}{RUN.branch || ''}{RUN.commit ? ' · ' + RUN.commit : ''}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:28 }}>
            {ROWS.map(([k, n, color]) => (
              <div key={k} style={{ display:'grid', gridTemplateColumns:'14px 80px 1fr 40px', gap:10, alignItems:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
                <span style={{ width:10, height:10, borderRadius:2, background:color }}/>
                <span style={{ color:'var(--fg2)', textTransform:'uppercase', letterSpacing:'.08em', fontSize:10.5 }}>{k}</span>
                <div style={{ height:8, background:'var(--bg-sunken)', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ width: `${(n/all.length)*100}%`, height:'100%', background:color }}/>
                </div>
                <span style={{ color:'var(--fg1)', fontWeight:600, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{n}</span>
              </div>
            ))}
          </div>
          <div style={{
            border:'1px dashed var(--line)', borderRadius:8, padding:'18px 20px',
            color:'var(--fg2)', fontFamily:'var(--font-body)', fontSize:13, lineHeight:1.55,
          }}>
            Pick a test from the tree on the left to inspect its steps, attachments, history, and metadata.
            <div style={{ marginTop:6, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>
              tip: search by name above, or click <b>Expand all</b> to flatten the tree.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // adapt the rich-tree test shape into the TestHeader props
  const headerTest = {
    id: test.id,
    title: test.name,
    status: test.status,
    duration: test.dur,
    retries: test.retries,
    severity: test.severity,
    owner: (test.owner || '').replace(/^@/,''),                 // blank → row hides
    suite: test.suite,                                          // blank → row hides
    epic: test.epic,
    feature: test.feature,
    story: test.story,
    language: test.language,
    framework: test.framework,
    platform: test.platform,
    lastRun: test.lastRun,                                      // only show when supplied
    file: test.file,
    tags: test.tags || [],
    links: test.links || [],
    flaky: test.flaky,
    muted: test.muted,
  };

  // While case JSON hasn't been fetched yet, render the header (we have
  // enough metadata for it from the index) plus a skeleton placeholder.
  if (!test._stepsLoaded) return (
    <div ref={scrollRef} style={{ flex:1, overflow:'auto', padding:24 }}>
      <TestHeader test={headerTest}/>
      <div style={{ padding:30, color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12, textAlign:'center' }}>Loading steps…</div>
    </div>
  );

  const steps = test.steps || [];
  const enriched = enrichSteps(steps, test);
  const failedCount = (function count(ss) { return ss.reduce((a,s) => a + (s.status==='failed'||s.status==='broken'?1:0) + (s.children?count(s.children):0), 0); })(steps);

  return (
    <div ref={scrollRef} style={{ flex:1, overflow:'auto', padding:24, minHeight:0 }}>
      <TestHeader test={headerTest}/>

      <div className="tabs" style={{ marginBottom:18 }}>
        {/* Unified tab order — same set on Overview-click and tree-click. */}
        {['steps','overview','log','retries','history','attachments','metadata'].map(t => {
          // Hide retries tab when there were none — keeps the chrome tight.
          if (t === 'retries' && !(test.retries > 0)) return null;
          return (
            <div key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>{t[0].toUpperCase()+t.slice(1)}</div>
          );
        })}
        {/* Host-injected extras (Kaizen platform: Triage, Cluster, Defects…). */}
        {extraTabs.map(ex => (
          <div key={ex.id} className={`tab ${tab===ex.id?'active':''}`} onClick={()=>setTab(ex.id)}>{ex.label}</div>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab test={test}/>}
      {tab === 'steps' && (
        <div className="card" style={{ padding:0, marginTop:0 }}>
          <div className="hd"><h3>Steps</h3><div className="meta">{steps.length} steps · {failedCount} failed</div></div>
          <div style={{ padding:'0 14px 14px' }}>
            <StepTreeV2 steps={enriched}/>
          </div>
        </div>
      )}
      {tab === 'log' && <CaseLogTab test={test}/>}
      {tab === 'retries' && <RetriesTab test={test}/>}
      {tab === 'history' && <HistoryTab test={test}/>}
      {tab === 'attachments' && <AttachmentsTab test={test}/>}
      {tab === 'metadata' && <MetadataTab test={test}/>}
      {/* Render host-injected tab body when the active tab matches one. */}
      {(() => {
        const ex = extraTabs.find(t => t.id === tab);
        return ex ? ex.render(test) : null;
      })()}
    </div>
  );
}

// Aggregate every log line attached to a step (recursively) so the Log tab
// can present a unified case-level console even when the adapter only
// captured step-scoped logs. Each line is tagged with the step it came from
// so we can render a subtle step-context column next to it.
function collectStepLogs(steps, parentName) {
  const out = [];
  for (const s of steps || []) {
    const ctx = parentName ? `${parentName} › ${s.name}` : s.name;
    for (const l of s.logs || []) {
      out.push({ ...l, _step: ctx });
    }
    if (s.children?.length) {
      out.push(...collectStepLogs(s.children, ctx));
    }
  }
  return out;
}

// Case-level Log tab — renders the unified console for this test. Prefers
// case-level test.logs when the adapter shipped them; falls back to
// flattening every step's logs so the user sees something useful instead
// of an "empty" tab when only step-scoped logs were captured.
function CaseLogTab({ test }) {
  const caseLogs = test.logs || [];
  const stepLogs = caseLogs.length === 0 ? collectStepLogs(test.steps || []) : [];
  const logs = caseLogs.length ? caseLogs : stepLogs;
  const source = caseLogs.length ? 'case' : 'aggregated from steps';

  if (!logs.length) return (
    <div className="card" style={{ padding:30, textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12 }}>
      No console output captured for this test.
      <div style={{ marginTop:6, fontSize:11, color:'var(--fg4)', lineHeight:1.55 }}>
        Adapters can ship logs at the case level (<code style={{ background:'var(--bg-sunken)', padding:'1px 6px', borderRadius:3 }}>case.logs</code>)
        or per-step (<code style={{ background:'var(--bg-sunken)', padding:'1px 6px', borderRadius:3 }}>step.logs</code>).<br/>
        When step logs exist, they're aggregated here automatically.
      </div>
    </div>
  );

  const LVL_COLOR = { info:'var(--fg2)', warn:'var(--status-broken-fg)', err:'var(--status-failed)', error:'var(--status-failed)', debug:'var(--fg3)' };
  const LVL_BG    = { info:'transparent', warn:'var(--status-broken-bg)', err:'var(--status-failed-bg)', error:'var(--status-failed-bg)', debug:'transparent' };

  // Filter chips: All · Errors · Warnings · Info — let users zero in on
  // what failed without scrolling through hundreds of lines.
  const counts = { info:0, warn:0, err:0, debug:0 };
  for (const l of logs) {
    const lvl = l.lvl === 'error' ? 'err' : (l.lvl || 'info');
    if (counts[lvl] != null) counts[lvl]++;
  }
  const [filter, setFilter] = React.useState('all');
  const FILTERS = [
    ['all', 'All', logs.length],
    ['err', 'Errors', counts.err],
    ['warn', 'Warnings', counts.warn],
    ['info', 'Info', counts.info],
    ['debug', 'Debug', counts.debug],
  ].filter(([id, _, n]) => id === 'all' || n > 0);
  const visible = filter === 'all' ? logs : logs.filter(l => {
    const lvl = l.lvl === 'error' ? 'err' : l.lvl;
    return lvl === filter;
  });

  return (
    <div className="card" style={{ padding:0 }}>
      <div className="hd">
        <h3>Console</h3>
        <div className="meta">{logs.length} entries · {source}</div>
      </div>
      {/* Filters */}
      <div style={{ display:'flex', gap:6, padding:'0 14px 12px', flexWrap:'wrap' }}>
        {FILTERS.map(([id, label, n]) => {
          const active = filter === id;
          const tone = id === 'err' ? 'var(--status-failed)' : id === 'warn' ? 'var(--status-broken)' : null;
          return (
            <button key={id} onClick={() => setFilter(id)} style={{
              display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:999,
              border:'1px solid ' + (active ? (tone || 'var(--brand-blue-500)') : 'var(--line)'),
              background: active ? (tone || 'var(--brand-blue-500)') : 'var(--bg-elev)',
              color: active ? '#fff' : 'var(--fg2)',
              fontFamily:'var(--font-body)', fontSize:11.5, fontWeight:600, cursor:'pointer',
              transition:'all var(--dur-fast)',
            }}>
              {label}<span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, opacity:0.9 }}>{n}</span>
            </button>
          );
        })}
      </div>
      <div style={{ background:'var(--bg-sunken)', borderTop:'1px solid var(--line)', padding:'4px 0 12px', maxHeight:520, overflow:'auto' }}>
        {visible.map((l, i) => {
          const lvl = l.lvl === 'error' ? 'err' : (l.lvl || 'info');
          return (
            <div key={i} style={{
              display:'grid', gridTemplateColumns:`80px 50px ${l._step ? '180px ' : ''}1fr`, gap:10, padding:'3px 14px',
              background: LVL_BG[lvl] || 'transparent',
              fontFamily:'var(--font-mono)', fontSize:11.5, lineHeight:1.55,
            }}>
              <span style={{ color:'var(--fg3)' }}>{l.ts}</span>
              <span style={{ color: LVL_COLOR[lvl] || 'var(--fg2)', fontWeight:700, letterSpacing:0.5 }}>{lvl.toUpperCase()}</span>
              {l._step && (
                <span style={{ color:'var(--fg3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={l._step}>{l._step}</span>
              )}
              <span style={{ color:'var(--fg1)', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{l.msg}</span>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div style={{ padding:'30px 14px', textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12 }}>
            No {filter} entries.
          </div>
        )}
      </div>
    </div>
  );
}

// Metadata tab — user-supplied data only (Allure-style). The header above
// already shows the canonical fields (severity, owner, suite, epic, etc.),
// so this tab focuses on what's actually customizable per-test:
//   · Labels — free-form key/value pairs (case.labels) added by the adapter
//   · Parameters — runtime parameters (case.parameters)
//   · Tags — annotations (case.tags)
//   · Links — external references (case.links) — also chip'd in header
//   · Identity — Test ID + file path (always useful for grep + correlation)
//   · Runtime — browser/platform/worker/started (debugging context)
function MetadataTab({ test }) {
  const labels = test.labels || {};
  const labelEntries = Object.entries(labels);
  const params = test.parameters || [];
  const tags = test.tags || [];
  const links = test.links || [];
  const startedAt = test._summary?.startedAt;

  const Section = ({ title, hint, children }) => (
    <section style={{ marginBottom:18 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8 }}>
        <div className="k-overline">{title}</div>
        {hint && <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>{hint}</span>}
      </div>
      {children}
    </section>
  );

  const KVTable = ({ rows }) => (
    <div style={{ border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display:'grid', gridTemplateColumns:'200px 1fr', borderTop: i ? '1px solid var(--line)' : 'none' }}>
          <div style={{ padding:'10px 14px', background:'var(--bg-sunken)', fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--fg3)' }}>{k}</div>
          <div style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:12.5, color:'var(--fg1)', wordBreak:'break-all' }}>{v}</div>
        </div>
      ))}
    </div>
  );

  const isEmpty = labelEntries.length === 0 && params.length === 0 && tags.length === 0 && links.length === 0;

  return (
    <div className="card" style={{ padding:0 }}>
      <div className="hd">
        <h3>Metadata</h3>
        <div className="meta">user-supplied data · adapter-driven</div>
      </div>
      <div style={{ padding:'0 14px 14px' }}>

        {labelEntries.length > 0 && (
          <Section title={`Labels · ${labelEntries.length}`} hint="custom key/value pairs from your reporter">
            <KVTable rows={labelEntries.map(([k, v]) => [k, String(v)])}/>
          </Section>
        )}

        {params.length > 0 && (
          <Section title={`Parameters · ${params.length}`} hint="runtime arguments / data-row values">
            <KVTable rows={params}/>
          </Section>
        )}

        {tags.length > 0 && (
          <Section title={`Tags · ${tags.length}`}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {tags.map(t => (
                <span key={t} style={{
                  display:'inline-flex', alignItems:'center', padding:'3px 9px', borderRadius:4,
                  background:'var(--bg-sunken)', border:'1px solid var(--line)', color:'var(--fg2)',
                  fontFamily:'var(--font-mono)', fontSize:11.5, fontWeight:500,
                }}>{t}</span>
              ))}
            </div>
          </Section>
        )}

        {links.length > 0 && (
          <Section title={`External links · ${links.length}`} hint="referenced from the test header above too">
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{
                  display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                  border:'1px solid var(--line)', borderRadius:6, background:'var(--bg-elev)',
                  textDecoration:'none', fontFamily:'var(--font-mono)', fontSize:12,
                }}>
                  <span style={{
                    padding:'1px 7px', borderRadius:3, background:'var(--bg-sunken)',
                    color:'var(--fg2)', fontSize:10, fontWeight:700, letterSpacing:0.5, textTransform:'uppercase',
                  }}>{l.kind || 'link'}</span>
                  <span style={{ color:'var(--fg1)', fontWeight:600 }}>{l.label || l.url}</span>
                  <span style={{ flex:1, color:'var(--fg3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.url}</span>
                </a>
              ))}
            </div>
          </Section>
        )}

        <Section title="Identity" hint="always-shown locator info">
          <KVTable rows={[
            ['Test ID', test.id],
            ['Full name', test.fullName || test.name],
            ['File', test.file || '—'],
            startedAt ? ['Started at', new Date(startedAt).toLocaleString()] : null,
          ].filter(Boolean)}/>
        </Section>

        <Section title="Runtime" hint="execution context for debugging">
          <KVTable rows={[
            test._summary?.browser ? ['Browser', test._summary.browser] : null,
            test.platform ? ['Platform', test.platform] : null,
            test._summary?.worker != null ? ['Worker', String(test._summary.worker)] : null,
            test.retries > 0 ? ['Retries', String(test.retries)] : null,
          ].filter(Boolean)}/>
        </Section>

        {isEmpty && (
          <div style={{ padding:'30px 14px', textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12, lineHeight:1.55 }}>
            No labels / parameters / tags / links on this test.
            <div style={{ marginTop:10, fontSize:11, color:'var(--fg4)' }}>
              Adapters can attach <code style={{ background:'var(--bg-sunken)', padding:'1px 6px', borderRadius:3 }}>case.labels</code>,
              <code style={{ background:'var(--bg-sunken)', padding:'1px 6px', borderRadius:3, marginLeft:4 }}>case.parameters</code>, and
              <code style={{ background:'var(--bg-sunken)', padding:'1px 6px', borderRadius:3, marginLeft:4 }}>case.links</code> for richer metadata.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ test }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:18 }}>
      {test.description ? (
        <section>
          <div className="k-overline" style={{ marginBottom:6 }}>Description</div>
          <KvMarkdown source={test.description} />
        </section>
      ) : null}
      {test.bdd && (
        <section>
          <div className="k-overline" style={{ marginBottom:8 }}>Behavior · Given / When / Then</div>
          <div style={{ border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
            {[['GIVEN', test.bdd.given, '#0E5BD9'],['WHEN', test.bdd.when, '#5B5BD6'],['THEN', test.bdd.then, '#10864E']].map(([k,v,c],i) => (
              <div key={k} style={{ display:'grid', gridTemplateColumns:'80px 1fr', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <div style={{ padding:'10px 12px', background:'var(--bg-sunken)', fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700, color:c, letterSpacing:'.08em' }}>{k}</div>
                <div style={{ padding:'10px 12px', fontFamily:'var(--font-body)', fontSize:13, color:'var(--fg1)' }}>{v}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {test.parameters?.length > 0 && (
        <section>
          <div className="k-overline" style={{ marginBottom:8 }}>Parameters · {test.parameters.length}</div>
          <div style={{ border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
            {test.parameters.map(([k,v],i) => (
              <div key={k} style={{ display:'grid', gridTemplateColumns:'160px 1fr', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <div style={{ padding:'8px 12px', background:'var(--bg-sunken)', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg3)' }}>{k}</div>
                <div style={{ padding:'8px 12px', fontFamily:'var(--font-mono)', fontSize:12.5, color:'var(--fg1)' }}>{v}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {test.error && (
        <section>
          <div className="k-overline" style={{ marginBottom:8 }}>Failure</div>
          <div style={{ background:'var(--status-failed-bg)', border:'1px solid var(--status-failed-border)', borderRadius:8, padding:'12px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
              <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, color:'var(--status-failed)', fontSize:11, padding:'2px 7px', background:'var(--bg-elev)', border:'1px solid var(--status-failed-border)', borderRadius:3 }}>{test.error.kind}</span>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:12.5, color:'var(--status-failed-fg)' }}>{test.error.message}</span>
            </div>
            {test.error.stack && <pre style={{ margin:0, fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--status-failed-fg)', whiteSpace:'pre-wrap' }}>{test.error.stack}</pre>}
          </div>
          {test.sourceSnippet && (
            <div style={{ marginTop:12 }}>
              <div className="k-overline" style={{ marginBottom:8 }}>Source</div>
              <KvSourceSnippet snippet={test.sourceSnippet} />
            </div>
          )}
        </section>
      )}
      <section>
        <div className="k-overline" style={{ marginBottom:8 }}>Execution timeline</div>
        <StepTreeRich steps={test.steps || []}/>
      </section>
    </div>
  );
}

function StepTreeRich({ steps }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
      {steps.map((s,i) => <StepRichNode key={i} step={s} depth={0} last={i === steps.length - 1}/>)}
    </div>
  );
}
function StepRichNode({ step, depth, last }) {
  const [open, setOpen] = useStateT(true);
  const has = step.children && step.children.length;
  return (
    <div>
      <div onClick={() => has && setOpen(!open)} style={{
        display:'grid', gridTemplateColumns:'14px 1fr auto', alignItems:'center', gap:10,
        padding:'10px 14px', paddingLeft: 14 + depth * 18, cursor: has ? 'pointer' : 'default',
        borderBottom: !last || has ? '1px solid var(--line)' : 'none',
        background: depth > 0 ? 'var(--bg-sunken)' : 'transparent',
      }}>
        <span className={`s-icon ${step.status}`} style={{ width:14, height:14, fontSize:9 }}>{step.status==='passed'?'✓':step.status==='failed'?'✕':step.status==='broken'?'!':'⊘'}</span>
        <div>
          <div style={{ fontSize:13, color:'var(--fg1)', fontWeight:500, display:'flex', alignItems:'center', gap:6 }}>
            {has && <span style={{ color:'var(--fg3)', display:'inline-block', fontSize:11, transform: open ? 'rotate(90deg)' : 'none', transition:'transform var(--dur-fast)' }}>›</span>}
            {step.name}
          </div>
          {step.params && (
            <div style={{ marginTop:3, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>
              {step.params.map(([k,v],i) => <span key={i} style={{ marginRight:10 }}>{k}=<span style={{ color:'var(--fg2)' }}>{v}</span></span>)}
            </div>
          )}
        </div>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', fontVariantNumeric:'tabular-nums' }}>{step.dur || step.duration}</span>
      </div>
      {has && open && step.children.map((c,i) => <StepRichNode key={i} step={c} depth={depth+1} last={i === step.children.length - 1 && last}/>)}
    </div>
  );
}

function RetriesTab({ test }) {
  const attempts = test.retries > 0 ? Array.from({ length: test.retries + 1 }, (_, i) => ({
    status: i === test.retries ? test.status : 'failed',
    dur: 1800 + i * 400,
    label: i === test.retries
      ? `attempt ${i+1} — ${test.status === 'passed' ? 'recovered' : 'final ' + (test.error?.kind || 'error')}`
      : `attempt ${i+1} — ${test.error?.kind || 'TimeoutError'}`,
  })) : null;
  if (!attempts) return <div style={{ color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12, padding:'30px 20px', textAlign:'center', border:'1px dashed var(--line)', borderRadius:8 }}>No retries on this run.</div>;
  return <RetryWaterfall attempts={attempts}/>;
}

function HistoryTab({ test }) {
  const STATUS_MAP = { pass:'passed', fail:'failed', broken:'broken', skip:'skipped' };
  const runs = (test.history || []).map(h => ({
    id: '#' + h.runId,
    when: window._kenshoRelTime ? window._kenshoRelTime(h.startedAt) : h.startedAt,
    status: STATUS_MAP[h.status] || h.status,
    dur: window._kenshoFmtDuration ? window._kenshoFmtDuration(h.duration) : h.duration,
  }));

  if (runs.length === 0) {
    return <div style={{padding:30,textAlign:'center',color:'var(--fg3)',fontFamily:'var(--font-mono)',fontSize:12}}>No prior run history available for this test.</div>;
  }

  return (
    <div style={{ border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
      {runs.map((r,i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'24px 1fr 90px 100px', alignItems:'center', gap:10, padding:'10px 14px', borderBottom: i < runs.length-1 ? '1px solid var(--line)' : 'none' }}>
          <span className={`s-icon ${r.status}`}>{r.status==='passed'?'✓':r.status==='failed'?'✕':'!'}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:12 }}>{r.id}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg3)' }}>{r.dur}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', textAlign:'right' }}>{r.when}</span>
        </div>
      ))}
    </div>
  );
}

function AttachmentsTab({ test }) {
  const ICON_MAP = {
    screenshot: 'image',
    image: 'image',
    video: 'video',
    trace: 'terminal',
    log: 'terminal',
    text: 'terminal',
    har: 'globe',
    json: 'code',
    html: 'code',
  };

  const prettyBytes = (n) => {
    if (n == null || isNaN(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const basename = (p) => {
    if (!p) return '';
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
  };

  // Attachments are served under data/ in the static report (attachmentBase).
  const base = (window.__KENSHO_ASSETS_BASE ? '' : '') + 'data/';
  const isTrace = (a) => {
    const n = (a.relativePath || a.id || '').toLowerCase();
    return a.kind === 'trace' || /trace\.zip$/.test(n);
  };

  const items = (test.attachments || []).map(a => {
    const name = basename(a.relativePath) || a.id;
    const url = a.relativePath ? base + String(a.relativePath).replace(/^\/+/, '') : null;
    return {
      name,
      url,
      size: prettyBytes(a.sizeBytes),
      icon: isTrace(a) ? 'route' : (ICON_MAP[a.kind] || 'file'),
      preview: a.kind === 'screenshot' || a.kind === 'video' || a.kind === 'image',
      trace: isTrace(a),
    };
  });

  if (items.length === 0) {
    return <div style={{padding:30,textAlign:'center',color:'var(--fg3)',fontFamily:'var(--font-mono)',fontSize:12}}>No attachments captured for this test.</div>;
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
      {items.map(a => (
        <div key={a.name} style={{ border:'1px solid var(--line)', borderRadius:8, overflow:'hidden', background:'var(--bg-elev)' }}>
          {a.preview && a.url && (
            a.icon === 'video'
              ? <video src={a.url} controls style={{ width:'100%', height:140, objectFit:'cover', borderBottom:'1px solid var(--line)', background:'#000', display:'block' }}/>
              : <a href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} alt={a.name} style={{ width:'100%', height:140, objectFit:'cover', borderBottom:'1px solid var(--line)', display:'block', cursor:'zoom-in' }} onError={e => { e.currentTarget.style.display='none'; }}/></a>
          )}
          {a.preview && !a.url && <div style={{ height: 110, background: 'repeating-linear-gradient(135deg, var(--bg-sunken) 0 12px, var(--bg-elev) 12px 24px)', borderBottom:'1px solid var(--line)' }}/>}
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px' }}>
            <i data-lucide={a.icon} style={{ width:14, height:14 }}></i>
            <span style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>{a.size}</span>
          </div>
          {/* Playwright trace — offer a download + a hint to open it in the
              official online trace viewer. The viewer can't load a local zip
              for the user (no upload here), so we link the tool + download. */}
          {a.trace && (
            <div className="kv-trace" style={{ borderTop:'1px solid var(--line)', padding:'10px 12px', display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {a.url && (
                  <a className="btn btn-secondary" href={a.url} download style={{ height:28, fontSize:12, textDecoration:'none' }}>
                    <Icon name="download" size={13} /> Open trace
                  </a>
                )}
                <a className="btn btn-ghost" href="https://trace.playwright.dev" target="_blank" rel="noopener noreferrer" style={{ height:28, fontSize:12, textDecoration:'none' }}>
                  <Icon name="external-link" size={13} /> trace.playwright.dev
                </a>
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', lineHeight:1.5 }}>
                Download the trace, then drop it into <span style={{ color:'var(--fg2)' }}>trace.playwright.dev</span> to inspect the timeline, DOM snapshots, and network.
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============== Splitter constants ==============
const KV_SPLIT_KEY = 'kensho.tree.split';
const KV_SPLIT_MIN = 280;
const KV_SPLIT_DEFAULT = 480;
const KV_SPLIT_KEY_STEP = 16;

function readPersistedSplit() {
  try {
    const raw = window.localStorage?.getItem(KV_SPLIT_KEY);
    if (!raw) return KV_SPLIT_DEFAULT;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < KV_SPLIT_MIN) return KV_SPLIT_DEFAULT;
    return n;
  } catch (_) {
    return KV_SPLIT_DEFAULT;
  }
}

// ============== Generic Tree+Detail page ==============
function TreeDetailPage({ title, subtitle, tree, leafLabel, headerExtra, defaultOpenAll = false }) {
  const allIds = collectIds(tree);
  // Default: every branch collapsed, no leaf selected. The detail pane shows
  // a summary placeholder so the user explicitly picks what to inspect — at
  // 800+ tests, auto-loading the first leaf wastes a fetch and renders a
  // misleading "first thing alphabetically" view.
  const [openIds, setOpenIds] = useStateT(new Set(defaultOpenAll ? allIds : []));
  const [selectedId, setSelectedId] = useStateT(null);
  // Restore search query + status filter from the shareable hash on mount.
  const _hashExtra = window.__kvCurrentHashExtra ? window.__kvCurrentHashExtra() : {};
  const ALL_STATUSES = ['passed','failed','broken','skipped','unknown'];
  const [filters, setFilters] = useStateT(() => {
    const raw = (_hashExtra.status || '').split(',').map(s => s.trim()).filter(Boolean);
    const valid = raw.filter(s => ALL_STATUSES.includes(s));
    return new Set(valid.length ? valid : ALL_STATUSES);
  });
  const [query, setQuery] = useStateT(_hashExtra.q || '');

  // Mirror query + status into the URL (replaceState) so the filtered view is
  // shareable without polluting back/forward history.
  React.useEffect(() => {
    if (!window.__kvReplaceHashExtra) return;
    const allOn = filters.size === ALL_STATUSES.length;
    window.__kvReplaceHashExtra({
      q: query || '',
      status: allOn ? '' : ALL_STATUSES.filter(s => filters.has(s)).join(','),
    });
  }, [query, filters]);

  // ============== Splitter (resizable tree column) ==============
  // Width of the left tree column. Restored from localStorage on mount;
  // clamped to [MIN, 70% of parent] on every drag/key tick. We persist on
  // pointerup / keyup, not on every mousemove, to avoid hammering storage.
  const [splitWidth, setSplitWidth] = useStateT(() => readPersistedSplit());
  const [dragging, setDragging] = useStateT(false);
  const splitContainerRef = React.useRef(null);
  const dragStateRef = React.useRef(null);

  const persistSplit = React.useCallback((w) => {
    try { window.localStorage?.setItem(KV_SPLIT_KEY, String(Math.round(w))); } catch (_) {}
  }, []);

  const clampWidth = React.useCallback((w) => {
    const parentW = splitContainerRef.current?.getBoundingClientRect().width || 0;
    const max = Math.max(KV_SPLIT_MIN, Math.floor(parentW * 0.7));
    return Math.max(KV_SPLIT_MIN, Math.min(max, w));
  }, []);

  const onSplitPointerDown = React.useCallback((e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch (_) {}
    dragStateRef.current = {
      startX: e.clientX,
      startWidth: splitWidth,
      pointerId: e.pointerId,
      target,
    };
    setDragging(true);
    // Prevent text selection of the tree while dragging.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [splitWidth]);

  const onSplitPointerMove = React.useCallback((e) => {
    const ds = dragStateRef.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const next = clampWidth(ds.startWidth + dx);
    setSplitWidth(next);
  }, [clampWidth]);

  const endDrag = React.useCallback(() => {
    const ds = dragStateRef.current;
    if (!ds) return;
    try { ds.target?.releasePointerCapture?.(ds.pointerId); } catch (_) {}
    dragStateRef.current = null;
    setDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    // Persist the latest committed width (functional setter so we read the
    // freshest value, not a stale closure copy).
    setSplitWidth(w => { persistSplit(w); return w; });
  }, [persistSplit]);

  const onSplitKeyDown = React.useCallback((e) => {
    let next = null;
    if (e.key === 'ArrowLeft')      next = splitWidth - KV_SPLIT_KEY_STEP;
    else if (e.key === 'ArrowRight') next = splitWidth + KV_SPLIT_KEY_STEP;
    else if (e.key === 'Home')       next = KV_SPLIT_MIN;
    else if (e.key === 'End') {
      const parentW = splitContainerRef.current?.getBoundingClientRect().width || 0;
      next = Math.floor(parentW * 0.7);
    }
    if (next == null) return;
    e.preventDefault();
    const clamped = clampWidth(next);
    setSplitWidth(clamped);
    persistSplit(clamped);
  }, [splitWidth, clampWidth, persistSplit]);

  // Track parent width so we can publish a useful aria-valuemax to AT and
  // re-clamp on viewport changes. Falls back to current splitWidth before
  // the ref attaches (so aria-valuemax never trails aria-valuenow).
  const [parentWidth, setParentWidth] = useStateT(0);
  React.useEffect(() => {
    const measure = () => {
      const w = splitContainerRef.current?.getBoundingClientRect().width || 0;
      if (w) setParentWidth(w);
    };
    measure();
    const onResize = () => { measure(); setSplitWidth(w => clampWidth(w)); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampWidth]);

  const ariaMax = parentWidth > 0
    ? Math.max(KV_SPLIT_MIN, Math.floor(parentWidth * 0.7))
    : Math.max(KV_SPLIT_MIN, splitWidth);

  const totalCounts = countTree(tree);
  const filteredTree = filterTree(tree, filters, query);

  const toggle = id => { const n = new Set(openIds); n.has(id) ? n.delete(id) : n.add(id); setOpenIds(n); };
  const toggleFilter = k => { const n = new Set(filters); n.has(k) ? n.delete(k) : n.add(k); setFilters(n); };

  const test = selectedId ? window.RICH_TESTS[selectedId] : null;
  const totalTests = Object.values(totalCounts).reduce((a,b)=>a+b,0);

  // Visible-leaf order — recomputed on every change to filteredTree+openIds.
  // Drives `j` / `k` / Enter shortcuts: navigate among VISIBLE leaves only.
  const visibleLeafIds = React.useMemo(() => {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (!n.children) { out.push(n.testId); continue; }
        if (openIds.has(n.id)) walk(n.children);
      }
    };
    walk(filteredTree);
    return out;
  }, [filteredTree, openIds]);

  // Wire up keyboard shortcuts dispatched from app.jsx.
  React.useEffect(() => {
    const onMove = (e) => {
      const delta = e.detail?.delta || 0;
      if (visibleLeafIds.length === 0) return;
      const idx = selectedId ? visibleLeafIds.indexOf(selectedId) : -1;
      const nextIdx = idx === -1
        ? (delta > 0 ? 0 : visibleLeafIds.length - 1)
        : Math.max(0, Math.min(visibleLeafIds.length - 1, idx + delta));
      setSelectedId(visibleLeafIds[nextIdx]);
    };
    const onOpen = () => {
      if (selectedId) window.__openTest?.(selectedId);
    };
    const onClear = () => { setQuery(''); setSelectedId(null); };
    window.addEventListener('kensho:move-selection', onMove);
    window.addEventListener('kensho:open-selection', onOpen);
    window.addEventListener('kensho:clear-search', onClear);
    return () => {
      window.removeEventListener('kensho:move-selection', onMove);
      window.removeEventListener('kensho:open-selection', onOpen);
      window.removeEventListener('kensho:clear-search', onClear);
    };
  }, [selectedId, visibleLeafIds]);

  return (
    <div>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 14, gap:16, flexWrap:'wrap' }}>
        <div>
          <h1 className="k-h1" style={{ marginBottom:2 }}>{title}</h1>
          <div className="k-meta">{subtitle} · {totalTests} tests</div>
        </div>
        {headerExtra}
      </div>

      {/* Toolbar */}
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
        <div data-kv-search className="kv-tree-search" style={{ display:'flex', alignItems:'center', gap:8, height:32, padding:'0 10px', background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:6, flex:'0 0 280px' }}>
          <i data-lucide="search" style={{ width:14, height:14, color:'var(--fg3)' }}></i>
          <input placeholder="Search tests… (press /)" value={query} onChange={e=>setQuery(e.target.value)} style={{ flex:1, border:0, outline:0, fontFamily:'var(--font-body)', fontSize:13, background:'transparent' }}/>
        </div>
        <StatusFilters counts={totalCounts} active={filters} onToggle={toggleFilter}/>
        <div style={{ flex:1 }}></div>
        <button className="btn btn-secondary" onClick={() => setOpenIds(new Set(allIds))} style={{ height:30 }}>Expand all</button>
        <button className="btn btn-secondary" onClick={() => setOpenIds(new Set())} style={{ height:30 }}>Collapse all</button>
      </div>

      <div ref={splitContainerRef} style={{ display:'grid', gridTemplateColumns:`${splitWidth}px 8px 1fr`, gap:0, background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:12, overflow:'hidden', height:'calc(100vh - 220px)', minHeight:560 }}>
        <div style={{ overflow:'auto', minHeight:0 }}>
          {filteredTree.length === 0 ? (
            <div style={{ padding:30, textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12 }}>No tests match the current filter.</div>
          ) : filteredTree.map(n => (
            <TreeNode key={n.id} node={n} depth={0} openIds={openIds} onToggle={toggle} selectedId={selectedId} onSelect={setSelectedId} leafLabel={leafLabel}/>
          ))}
        </div>
        <div
          className={`kv-split-handle${dragging ? ' kv-split-handle--active' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(splitWidth)}
          aria-valuemin={KV_SPLIT_MIN}
          aria-valuemax={ariaMax}
          aria-label="Resize test tree column"
          tabIndex={0}
          onPointerDown={onSplitPointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onSplitKeyDown}
        />
        <DetailPane test={test}/>
      </div>
    </div>
  );
}

// helpers
function collectIds(tree) {
  const out = [];
  const walk = ns => ns.forEach(n => { if (n.children){ out.push(n.id); walk(n.children); } });
  walk(tree); return out;
}
function firstLeaf(tree) {
  for (const n of tree) {
    if (!n.children) return n.testId;
    const r = firstLeaf(n.children); if (r) return r;
  }
  return null;
}
function countTree(tree) {
  const c = { passed:0, failed:0, broken:0, skipped:0, unknown:0 };
  const walk = ns => ns.forEach(n => {
    if (!n.children) { const t = window.RICH_TESTS[n.testId]; if (t) c[t.status]++; }
    else walk(n.children);
  });
  walk(tree); return c;
}
function filterTree(tree, statusSet, query) {
  const q = query.trim().toLowerCase();
  const matchLeaf = n => {
    const t = window.RICH_TESTS[n.testId]; if (!t) return false;
    if (!statusSet.has(t.status)) return false;
    if (q && !(t.name.toLowerCase().includes(q))) return false;
    return true;
  };
  const recount = list => {
    const c = { passed:0, failed:0, broken:0, skipped:0 };
    const walk = ls => ls.forEach(k => { if (!k.children){ const t=window.RICH_TESTS[k.testId]; if(t && c[t.status] !== undefined) c[t.status]++; } else walk(k.children); });
    walk(list); return c;
  };
  const walk = ns => ns.map(n => {
    if (!n.children) return matchLeaf(n) ? n : null;
    const kids = walk(n.children).filter(Boolean);
    if (!kids.length) return null;
    return { ...n, children: kids, counts: recount(kids) };
  }).filter(Boolean);
  return walk(tree);
}

Object.assign(window, { TreeDetailPage, DetailPane, StepTreeRich, CaseLogTab, MetadataTab });
