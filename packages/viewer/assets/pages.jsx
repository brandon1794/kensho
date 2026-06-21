/* global React, TreeDetailPage, TrendChartV2, HBars, DurationHistogram, FlakeScatter, TimelineGantt, SuiteHeatmap, RetryWaterfall */
const { useState: useStateP } = React;

// ============== GRAPHS PAGE ==============
function GraphsPage() {
  const TREND_RUNS = window.TREND_RUNS || [];
  const HISTOGRAM = window.HISTOGRAM || [];
  const RICH_TESTS = window.RICH_TESTS || {};
  const CATEGORIES = window.CATEGORIES || [];
  const fmt = window._kenshoFmtDuration || (ms => ms + 'ms');
  const [showAllSuites, setShowAllSuites] = useStateP(false);
  const SUITE_CAP = 12;

  // Highlight banner derivations — surface the three "punchiest" facts
  // about the run so a stakeholder can scan and act in 5 seconds.
  const allRich = Object.values(RICH_TESTS);
  const slowest = allRich.filter(t => t.durMs > 0).sort((a,b) => b.durMs - a.durMs)[0];
  const mostRetried = allRich.filter(t => t.retries > 0).sort((a,b) => b.retries - a.retries)[0];
  const topCategory = CATEGORIES[0];

  // Derive "Status by suite" from RICH_TESTS, grouped by first suite segment.
  const suiteBuckets = {};
  Object.values(RICH_TESTS).forEach(t => {
    const suiteName = (t.suite || '').split('›')[0].trim() || 'Default';
    if (!suiteBuckets[suiteName]) suiteBuckets[suiteName] = { passed:0, failed:0, broken:0, skipped:0 };
    if (suiteBuckets[suiteName][t.status] != null) suiteBuckets[suiteName][t.status]++;
  });
  const suiteStatusBars = Object.entries(suiteBuckets)
    .map(([label, b]) => {
      const segs = ['failed','broken','skipped','passed']
        .filter(k => b[k] > 0)
        .map(k => ({ k, n: b[k] }));
      const total = b.passed + b.failed + b.broken + b.skipped;
      return { label, segs, total, failures: b.failed + b.broken };
    })
    .sort((a, b) => b.failures - a.failures || b.total - a.total);
  const visibleSuites = showAllSuites ? suiteStatusBars : suiteStatusBars.slice(0, SUITE_CAP);
  const hiddenSuiteCount = suiteStatusBars.length - visibleSuites.length;

  const totalTests = Object.values(RICH_TESTS).length;
  const hasFlake = Object.values(RICH_TESTS).some(t => t.flakeRate > 0);

  return (
    <div>
      <h1 className="k-h1" style={{ marginBottom: 4 }}>Graphs</h1>
      <div className="k-meta" style={{ marginBottom: 18 }}>Distributions and trends across the active run · {totalTests} tests</div>

      {/* Highlight banner — three at-a-glance hero stats for the run.
          Each card is clickable when it can resolve to a target view. */}
      {(slowest || mostRetried || topCategory) && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16, marginBottom:16 }}>
          {slowest ? (
            <HighlightStat
              overline="Slowest test"
              value={slowest.dur}
              valueColor="var(--status-broken-fg)"
              subtitle={slowest.name}
              accent="var(--status-broken)"
              onClick={() => window.__openTest?.(slowest.id)}
              title={`Open ${slowest.name} →`}
            />
          ) : (
            <HighlightStat overline="Slowest test" value="—" subtitle="No timing data" accent="var(--line)"/>
          )}
          {mostRetried ? (
            <HighlightStat
              overline="Most retried"
              value={`${mostRetried.retries}×`}
              valueColor="#B69CFF"
              subtitle={mostRetried.name}
              accent="#7C5CFF"
              onClick={() => window.__openTest?.(mostRetried.id)}
              title={`Open ${mostRetried.name} →`}
            />
          ) : (
            <HighlightStat overline="Most retried" value="0" subtitle="No retries this run — clean execution" accent="var(--line)"/>
          )}
          {topCategory ? (
            <HighlightStat
              overline="Top failure category"
              value={String(topCategory.count)}
              valueColor="var(--status-failed-fg)"
              subtitle={topCategory.kind}
              accent="var(--status-failed)"
              onClick={() => window.__navTo?.('categories')}
              title="Open Categories →"
            />
          ) : (
            <HighlightStat overline="Top failure category" value="0" subtitle="No failures this run" accent="var(--status-passed)"/>
          )}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div className="card" style={{ gridColumn:'span 2' }}>
          <div className="hd"><h3>Trend · {TREND_RUNS.length} run{TREND_RUNS.length === 1 ? '' : 's'}</h3><div className="meta">stacked status counts</div></div>
          {TREND_RUNS.length > 0 ? (
            <TrendChartV2 runs={TREND_RUNS}/>
          ) : (
            <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
              No run history yet. Run kensho generate over multiple runs to populate.
            </div>
          )}
        </div>

        <div className="card">
          <div className="hd">
            <h3>Status by suite</h3>
            <div className="meta">{showAllSuites ? `all ${suiteStatusBars.length}` : `top ${visibleSuites.length} of ${suiteStatusBars.length}`} · sorted by failures</div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {visibleSuites.map((s,i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'160px 1fr 30px', alignItems:'center', gap:10 }}>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</div>
                <div style={{ height:14, background:'var(--bg-sunken)', borderRadius:3, display:'flex', overflow:'hidden' }}>
                  {s.segs.map((g,j)=>(<div key={j} style={{ width:`${(g.n/s.total)*100}%`, background:`var(--status-${g.k})` }}/>))}
                </div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', textAlign:'right' }}>{s.total}</div>
              </div>
            ))}
          </div>
          {hiddenSuiteCount > 0 && (
            <div style={{ display:'flex', justifyContent:'center', marginTop:14, paddingTop:12, borderTop:'1px solid var(--line)' }}>
              <button className="btn btn-ghost" style={{ height:28, fontSize:12 }} onClick={() => setShowAllSuites(true)}>
                Show {hiddenSuiteCount} more suites →
              </button>
            </div>
          )}
          {showAllSuites && suiteStatusBars.length > SUITE_CAP && (
            <div style={{ display:'flex', justifyContent:'center', marginTop:14, paddingTop:12, borderTop:'1px solid var(--line)' }}>
              <button className="btn btn-ghost" style={{ height:28, fontSize:12 }} onClick={() => setShowAllSuites(false)}>
                ↑ Collapse to top {SUITE_CAP}
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="hd"><h3>Duration distribution</h3><div className="meta">all {totalTests} tests</div></div>
          <DurationHistogram buckets={HISTOGRAM}/>
        </div>

        <div className="card" style={{ gridColumn:'span 2' }}>
          <div className="hd"><h3>Flake rate vs duration</h3><div className="meta">last 80 runs · circle size = sample count</div></div>
          {hasFlake ? (
            <FlakeScatter tests={Object.values(RICH_TESTS)
              .filter(t => t.flakeRate > 0)
              .map(t => ({ name: t.name, runs: 80, flakeRate: t.flakeRate, avgDur: t.avgDurMs }))
            }/>
          ) : (
            <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
              Flake-rate analysis requires run history. Run kensho generate over multiple runs to populate.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== TIMELINE PAGE ==============
function TimelinePage() {
  const TIMELINE_TESTS = window.TIMELINE_TESTS || [];
  const RICH_TESTS = window.RICH_TESTS || {};
  const KENSHO_INDEX = window.KENSHO_INDEX || {};
  const fmt = window._kenshoFmtDuration || (ms => ms + 'ms');

  // View modes — at scale (>50 tests) the Gantt becomes unreadable. Default to
  // 'top' (longest 25), with toggles for failures-only and full view.
  const [mode, setMode] = useStateP(TIMELINE_TESTS.length > 50 ? 'top' : 'all');

  const failuresOnly = TIMELINE_TESTS.filter(t => t.status === 'failed' || t.status === 'broken');
  let visibleTests;
  if (mode === 'top') {
    visibleTests = [...TIMELINE_TESTS].sort((a, b) => b.durMs - a.durMs).slice(0, 25);
  } else if (mode === 'failures') {
    visibleTests = failuresOnly;
  } else {
    visibleTests = TIMELINE_TESTS;
  }

  // Re-base start times so the Gantt fills the canvas regardless of mode —
  // showing 25 longest tests with sparse start times leaves dead space at
  // the front of the chart otherwise.
  const minStart = visibleTests.length ? Math.min(...visibleTests.map(t => t.start)) : 0;
  const rebased = visibleTests.map(t => ({ ...t, start: t.start - minStart }));
  const totalMs = rebased.length
    ? Math.max(...rebased.map(t => t.start + t.durMs)) + 200
    : 1000;
  const fullDurationMs = TIMELINE_TESTS.length
    ? Math.max(...TIMELINE_TESTS.map(t => t.start + t.durMs))
    : 0;

  const hasHistory = (KENSHO_INDEX.history?.length || 0) > 0;
  const hasRetries = Object.values(RICH_TESTS).some(t => t.retries > 0);

  const runId = KENSHO_INDEX.runId ? '#' + KENSHO_INDEX.runId : '';
  const workers = KENSHO_INDEX.env?.workers || 1;

  const MODES = [
    ['top', 'Top 25 longest', TIMELINE_TESTS.length > 0 ? Math.min(25, TIMELINE_TESTS.length) : 0],
    ['failures', 'Failures only', failuresOnly.length],
    ['all', 'All', TIMELINE_TESTS.length],
  ].filter(([id, _, n]) => n > 0);

  return (
    <div>
      <h1 className="k-h1" style={{ marginBottom: 4 }}>Timeline</h1>
      <div className="k-meta" style={{ marginBottom: 18 }}>Run {runId} · {workers} parallel worker{workers !== 1 ? 's' : ''} · total {fmt(fullDurationMs)}</div>

      <div className="card">
        <div className="hd">
          <h3>Per-test execution · Gantt</h3>
          <div className="meta">click any bar to open the test in detail</div>
        </div>
        <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
          {MODES.map(([id, label, n]) => {
            const active = mode === id;
            return (
              <button key={id} onClick={() => setMode(id)} style={{
                display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:999,
                border:'1px solid ' + (active ? 'var(--brand-blue-500)' : 'var(--line)'),
                background: active ? 'var(--brand-blue-500)' : 'var(--bg-elev)',
                color: active ? '#fff' : 'var(--fg2)',
                fontFamily:'var(--font-body)', fontSize:12, fontWeight:600, cursor:'pointer',
                transition:'all var(--dur-fast)',
              }}>
                {label}<span style={{ fontFamily:'var(--font-mono)', fontSize:11, opacity:0.9 }}>{n}</span>
              </button>
            );
          })}
        </div>
        {rebased.length > 0 ? (
          <TimelineGantt
            tests={rebased}
            totalMs={totalMs}
            onOpen={(t) => {
              if (t.id && RICH_TESTS[t.id]) { window.__openTest?.(t.id); return; }
              const match = Object.values(RICH_TESTS).find(r => r.name === t.name);
              if (match) window.__openTest?.(match.id);
            }}
          />
        ) : (
          <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
            {mode === 'failures' ? 'No failing tests in this run.' : 'No tests with timing data in this run.'}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="hd"><h3>Suite execution heatmap</h3><div className="meta">last 8 runs</div></div>
        {hasHistory ? (
          <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
            Heatmap view coming soon. History is populated.
          </div>
        ) : (
          <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
            Run history not yet populated.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="hd"><h3>Retry waterfall</h3><div className="meta">attempt-by-attempt status &amp; duration</div></div>
        {hasRetries ? (
          <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
            Retry attempt details coming soon. Open a retried test from the suites view.
          </div>
        ) : (
          <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
            Run history not yet populated.
          </div>
        )}
      </div>
    </div>
  );
}

// ============== CATEGORIES PAGE — error-type classification ==============
function CategoriesPage() {
  const ERROR_TYPES = window.CATEGORIES || [];
  const CATEGORY_GROUPS = window.CATEGORY_GROUPS || [];
  const RICH_TESTS = window.RICH_TESTS || {};

  // Two groupings: explicit case.category buckets (when the run carries them)
  // and the error-type derivation. Default to category view when available
  // since it's author-curated.
  const hasCategories = CATEGORY_GROUPS.length > 0;
  const [groupBy, setGroupBy] = useStateP(hasCategories ? 'category' : 'error');
  const GROUPS = groupBy === 'category' && hasCategories ? CATEGORY_GROUPS : ERROR_TYPES;

  // Restore the selected category from the shareable hash (?cat=…) on mount.
  const _hashCat = (window.__kvCurrentHashExtra ? window.__kvCurrentHashExtra().cat : '') || '';
  const _initialKind = (_hashCat && GROUPS.some(g => g.kind === _hashCat)) ? _hashCat : (GROUPS[0]?.kind ?? null);
  const [selectedKind, setKindRaw] = useStateP(_initialKind);
  const setKind = React.useCallback((k) => {
    setKindRaw(k);
    if (window.__kvReplaceHashExtra) window.__kvReplaceHashExtra({ cat: k || '' });
  }, []);
  // When the grouping changes the previously selected kind may not exist.
  React.useEffect(() => { setKind(GROUPS[0]?.kind ?? null); }, [groupBy]);

  if (ERROR_TYPES.length === 0 && !hasCategories) {
    return (
      <div className="card" style={{ padding:30, textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:13 }}>
        No failures in this run. Nothing to categorize.
      </div>
    );
  }

  const sel = GROUPS.find(e => e.kind === selectedKind) || GROUPS[0];
  const totalIssues = GROUPS.reduce((a,b) => a + b.count, 0);
  const subtitle = groupBy === 'category'
    ? `Grouped by category · ${GROUPS.length} categories · ${totalIssues} tests`
    : `Failures grouped by error type · ${GROUPS.length} types · ${totalIssues} tests`;

  return (
    <div>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 14, gap:16, flexWrap:'wrap' }}>
        <div>
          <h1 className="k-h1" style={{ marginBottom:2 }}>Categories</h1>
          <div className="k-meta">{subtitle}</div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          {hasCategories && (
            <div style={{ display:'inline-flex', border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
              {[['category', 'By category'], ['error', 'By error type']].map(([id, label]) => (
                <button key={id} onClick={() => setGroupBy(id)} style={{
                  padding:'5px 12px', border:'none', cursor:'pointer',
                  background: groupBy === id ? 'var(--brand-blue-500)' : 'var(--bg-elev)',
                  color: groupBy === id ? '#fff' : 'var(--fg2)',
                  fontFamily:'var(--font-body)', fontSize:12, fontWeight:600,
                }}>{label}</button>
              ))}
            </div>
          )}
          {groupBy === 'error' && (
            <div style={{ display:'flex', gap:6 }}>
              <span className="badge b-failed"><span className="dot"></span>{ERROR_TYPES.filter(e=>e.family==='failed').reduce((a,b)=>a+b.count,0)} product</span>
              <span className="badge b-broken"><span className="dot"></span>{ERROR_TYPES.filter(e=>e.family==='broken').reduce((a,b)=>a+b.count,0)} test-defects</span>
              <span className="badge b-skipped"><span className="dot"></span>{ERROR_TYPES.filter(e=>e.family==='skipped').reduce((a,b)=>a+b.count,0)} environment</span>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="hd"><h3>Distribution by {groupBy === 'category' ? 'category' : 'error type'}</h3><div className="meta">{totalIssues} tests</div></div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {GROUPS.map(e => (
            <div key={e.kind} style={{ display:'grid', gridTemplateColumns:'minmax(220px, 280px) 1fr 36px', alignItems:'center', gap:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, fontFamily:'var(--font-mono)', fontSize:12.5, color:'var(--fg1)' }}>
                <span style={{ width:8, height:8, borderRadius:2, background:e.color, flexShrink:0 }}/>
                {e.kind}
              </div>
              <div style={{ height:18, background:'var(--bg-sunken)', borderRadius:3, position:'relative', overflow:'hidden' }}>
                <div style={{ width:`${(e.count/totalIssues)*100}%`, height:'100%', background:e.color }}/>
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg2)', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{e.count}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(260px, 320px) 1fr', gap:0, background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:12, overflow:'hidden', minHeight:480 }}>
        <div style={{ borderRight:'1px solid var(--line)' }}>
          {GROUPS.map(e => (
            <div key={e.kind} onClick={()=>setKind(e.kind)} style={{
              display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:10, padding:'12px 14px',
              cursor:'pointer', borderLeft: selectedKind===e.kind ? `2px solid ${e.color}` : '2px solid transparent',
              background: selectedKind===e.kind ? 'var(--accent-soft)' : 'transparent',
              borderBottom:'1px solid var(--line)',
            }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:6, fontFamily:'var(--font-mono)', fontSize:12.5, fontWeight:600, color:'var(--fg1)' }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:e.color, flexShrink:0 }}/>{e.kind}
                </div>
                <div style={{ fontSize:11, color:'var(--fg3)', marginTop:3, textTransform:'uppercase', letterSpacing:'.08em' }}>{e.family}</div>
              </div>
              <span style={{ background:e.color, color:'#fff', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:3, fontFamily:'var(--font-mono)' }}>{e.count}</span>
            </div>
          ))}
        </div>
        <div style={{ padding:24 }}>
          {sel && (
            <>
              <div className="k-overline" style={{ marginBottom:6 }}>{sel.family} · {groupBy === 'category' ? 'category' : 'error type'}</div>
              <h2 className="k-h2" style={{ fontSize:22, fontFamily:'var(--font-mono)', fontWeight:600, marginBottom:8 }}>{sel.kind}</h2>
              <p className="k-body" style={{ marginBottom:18 }}>{sel.description}</p>

              <div className="k-overline" style={{ marginBottom:8 }}>Affected tests · {sel.count}</div>
              <div style={{ border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
                {sel.tests.map((tid, i) => {
                  const t = RICH_TESTS[tid];
                  const name = t ? t.name : tid;
                  const status = t ? t.status : sel.family;
                  const file = t ? t.file : '';
                  const msg = t?.error?.message || '';
                  const canOpen = !!t;
                  return (
                    <div
                      key={i}
                      onClick={canOpen ? () => window.__openTest?.(t.id) : undefined}
                      title={canOpen ? `Open ${name} →` : 'Test not found in this run'}
                      style={{
                        display:'grid', gridTemplateColumns:'24px 1fr auto', gap:10,
                        padding:'12px 14px', borderTop: i ? '1px solid var(--line)' : 'none',
                        alignItems:'flex-start', cursor: canOpen ? 'pointer' : 'default',
                        transition:'background 120ms',
                      }}
                      onMouseEnter={canOpen ? e => e.currentTarget.style.background='var(--bg-hover)' : undefined}
                      onMouseLeave={canOpen ? e => e.currentTarget.style.background='transparent' : undefined}
                    >
                      <span className={`s-icon ${status}`} style={{ marginTop:2 }}>{status==='passed'?'✓':status==='failed'?'✕':status==='broken'?'!':'⊘'}</span>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, color:'var(--fg1)' }}>{name}</div>
                        {file && <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', marginTop:2 }}>{file}</div>}
                        {msg && <div style={{ fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--status-failed-fg)', marginTop:6, padding:'6px 8px', background:'var(--status-failed-bg)', border:'1px solid var(--status-failed-border)', borderRadius:4 }}>{msg}</div>}
                      </div>
                      {canOpen && (
                        <span style={{
                          alignSelf:'center', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)',
                          display:'inline-flex', alignItems:'center', gap:4, whiteSpace:'nowrap',
                        }}>
                          Open <span style={{ fontSize:13 }}>→</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== FLAKY PAGE ==============
//
// Single-run flake derivation — Kensho is the OSS, single-run report; rolling
// flake-rate analysis lives in Kaizen (the SaaS platform). What we CAN derive
// from one run is meaningful enough to act on:
//
//   · "Recovered"  — passed on retry (real flake — non-deterministic test)
//   · "Broken"     — status=broken (test infra failed mid-execution)
//   · "Failed retry" — failed even after one or more retries (flaky AND broken)
//
// Each card explains the signal in plain language so users understand the
// difference between a flake and a regular failure. Severity ordering:
// recovered > broken > failed-with-retry, since recoveries are pure flakes.
function FlakyPage() {
  const RICH_TESTS = window.RICH_TESTS || {};
  const allTests = Object.values(RICH_TESTS);
  const fmt = window._kenshoFmtDuration || (ms => ms + 'ms');

  // Bucket every test into one of the flake categories (or none). A test
  // explicitly flagged flaky by the reporter (case.flaky → kensho.flaky())
  // always surfaces here even on a clean single run; it's the highest-signal
  // bucket since the author themselves marked it non-deterministic.
  const buckets = { flagged: [], recovered: [], broken: [], failedWithRetries: [] };
  for (const t of allTests) {
    if (t.flaky) buckets.flagged.push(t);
    else if (t.retries > 0 && t.status === 'passed') buckets.recovered.push(t);
    else if (t.status === 'broken') buckets.broken.push(t);
    else if (t.retries > 0 && (t.status === 'failed' || t.status === 'broken')) buckets.failedWithRetries.push(t);
  }
  const flakeTotal = buckets.flagged.length + buckets.recovered.length + buckets.broken.length + buckets.failedWithRetries.length;

  const [filter, setFilter] = useStateP('all');

  // Stable order for rendering — recoveries first (highest signal-to-noise),
  // then broken, then failed-with-retries. Within each bucket, sort by retry
  // count desc so the highest-friction tests bubble up.
  const ALL_FLAKY = [
    ...buckets.flagged.map(t => ({ ...t, _bucket:'flagged' })),
    ...buckets.recovered.map(t => ({ ...t, _bucket:'recovered' })),
    ...buckets.broken.map(t => ({ ...t, _bucket:'broken' })),
    ...buckets.failedWithRetries.map(t => ({ ...t, _bucket:'failedWithRetries' })),
  ].sort((a, b) => (b.retries || 0) - (a.retries || 0));

  const visible = filter === 'all' ? ALL_FLAKY : ALL_FLAKY.filter(t => t._bucket === filter);

  // j/k/Enter shortcuts on the Flaky list — keep selection local; pressing
  // Enter delegates to the global window.__openTest hook from app.jsx.
  const [selectedIdx, setSelectedIdx] = useStateP(-1);
  React.useEffect(() => {
    const onMove = (e) => {
      if (visible.length === 0) return;
      const delta = e.detail?.delta || 0;
      setSelectedIdx(prev => {
        const idx = prev === -1 ? (delta > 0 ? 0 : visible.length - 1) : prev + delta;
        return Math.max(0, Math.min(visible.length - 1, idx));
      });
    };
    const onOpen = () => {
      if (selectedIdx >= 0 && visible[selectedIdx]) window.__openTest?.(visible[selectedIdx].id);
    };
    window.addEventListener('kensho:move-selection', onMove);
    window.addEventListener('kensho:open-selection', onOpen);
    return () => {
      window.removeEventListener('kensho:move-selection', onMove);
      window.removeEventListener('kensho:open-selection', onOpen);
    };
  }, [selectedIdx, visible]);

  const passRate = allTests.length > 0
    ? Math.round(((allTests.length - flakeTotal) / allTests.length) * 100)
    : 100;
  const flakeRate = allTests.length > 0
    ? ((flakeTotal / allTests.length) * 100).toFixed(1)
    : '0';

  if (allTests.length === 0) {
    return <div className="card" style={{padding:30,textAlign:'center',color:'var(--fg3)'}}>No tests in this report.</div>;
  }

  if (flakeTotal === 0) {
    return (
      <div>
        <h1 className="k-h1" style={{ marginBottom: 4 }}>Flaky tests</h1>
        <div className="k-meta" style={{ marginBottom: 24 }}>Tests that retried, recovered, or broke during execution</div>
        <div className="card" style={{ padding:'48px 32px', textAlign:'center', background:'linear-gradient(180deg, var(--status-passed-bg), transparent)' }}>
          <div style={{ width:64, height:64, borderRadius:999, background:'var(--status-passed-bg)', border:'2px solid var(--status-passed-border)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:16 }}>
            <span style={{ fontSize:30, color:'var(--status-passed)' }}>✓</span>
          </div>
          <h2 className="k-h2" style={{ marginBottom:8, fontSize:22 }}>No flaky tests detected</h2>
          <p className="k-body" style={{ maxWidth:460, margin:'0 auto', color:'var(--fg2)' }}>
            Every test ran cleanly on the first attempt — no retries, no broken executions.
            Flaky-test detection here is single-run; rolling flake-rate analysis (last N runs)
            lives in the Kaizen platform.
          </p>
        </div>
      </div>
    );
  }

  const FILTERS = [
    ['all', 'All flaky', flakeTotal],
    ['flagged', 'Flagged', buckets.flagged.length],
    ['recovered', 'Recovered', buckets.recovered.length],
    ['broken', 'Broken', buckets.broken.length],
    ['failedWithRetries', 'Failed retry', buckets.failedWithRetries.length],
  ].filter(([id, _, n]) => id === 'all' || n > 0);

  return (
    <div>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 14, flexWrap:'wrap', gap:16 }}>
        <div>
          <h1 className="k-h1" style={{ marginBottom: 4 }}>Flaky tests</h1>
          <div className="k-meta">{flakeTotal} of {allTests.length} tests showed instability · {flakeRate}% flake rate</div>
        </div>
        <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', maxWidth:380, textAlign:'right', lineHeight:1.55 }}>
          Single-run signal — derived from <code style={{ color:'var(--fg2)' }}>retries</code> + <code style={{ color:'var(--fg2)' }}>broken</code>.
          For rolling flake-rate over many runs, use the Kaizen platform.
        </div>
      </div>

      {/* Hero stat band — three chunky stats with a gradient backdrop */}
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16, marginBottom:18,
      }}>
        <FlakyStatCard
          accent="var(--status-broken)"
          icon="rotate-ccw"
          label="Recovered"
          value={buckets.recovered.length}
          desc="Passed on retry — a real flake (non-deterministic). Investigate the test for hidden timing or state assumptions."
          onClick={buckets.recovered.length > 0 ? () => setFilter('recovered') : null}
        />
        <FlakyStatCard
          accent="#7C5CFF"
          icon="zap-off"
          label="Broken"
          value={buckets.broken.length}
          desc="Test infrastructure failed mid-execution (setup, teardown, or fixture). Often unrelated to product behavior."
          onClick={buckets.broken.length > 0 ? () => setFilter('broken') : null}
        />
        <FlakyStatCard
          accent="var(--status-failed)"
          icon="alert-triangle"
          label="Failed retry"
          value={buckets.failedWithRetries.length}
          desc="Failed even after one or more retries. Could be a real defect masquerading as a flake — prioritize."
          onClick={buckets.failedWithRetries.length > 0 ? () => setFilter('failedWithRetries') : null}
        />
      </div>

      {/* Filter pills */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="hd">
          <h3>Affected tests</h3>
          <div className="meta">{visible.length} shown · sorted by retry count</div>
        </div>

        <div style={{ display:'flex', gap:6, padding:'2px 0 14px', flexWrap:'wrap' }}>
          {FILTERS.map(([id, label, n]) => {
            const active = filter === id;
            return (
              <button key={id} onClick={() => setFilter(id)} style={{
                display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:999,
                border:'1px solid ' + (active ? 'var(--brand-blue-500)' : 'var(--line)'),
                background: active ? 'var(--brand-blue-500)' : 'var(--bg-elev)',
                color: active ? '#fff' : 'var(--fg2)',
                fontFamily:'var(--font-body)', fontSize:12, fontWeight:600, cursor:'pointer',
                transition:'all var(--dur-fast)',
              }}>
                {label}<span style={{ fontFamily:'var(--font-mono)', fontSize:11, opacity:0.9 }}>{n}</span>
              </button>
            );
          })}
        </div>

        {visible.length === 0 ? (
          <div style={{ padding:'30px 0', textAlign:'center', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12 }}>
            No tests in this category.
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column' }}>
            {visible.map((t, i) => (
              <FlakyTestRow key={t.id} test={t} index={i} selected={i === selectedIdx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// FlakyStatCard — stat banner card. Subtle gradient + accent stripe.
function FlakyStatCard({ accent, icon, label, value, desc, onClick }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick || undefined}
      style={{
        position:'relative', padding:'18px 20px',
        background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:12,
        cursor: clickable ? 'pointer' : 'default', overflow:'hidden',
        transition:'transform var(--dur-fast), border-color var(--dur-fast), background var(--dur-fast)',
      }}
      onMouseEnter={clickable ? e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.transform = 'translateY(-1px)'; } : undefined}
      onMouseLeave={clickable ? e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'translateY(0)'; } : undefined}
    >
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:accent }}/>
      <div style={{
        position:'absolute', right:-30, top:-30, width:120, height:120, borderRadius:'50%',
        background:`radial-gradient(circle, ${accent}22 0%, transparent 70%)`,
      }}/>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, position:'relative' }}>
        <span style={{
          width:28, height:28, borderRadius:8, background:`${accent}1F`, color:accent,
          display:'inline-flex', alignItems:'center', justifyContent:'center',
        }}>
          <Icon name={icon} size={14}/>
        </span>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:'.14em', textTransform:'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontFamily:'var(--font-display)', fontSize:42, fontWeight:700, letterSpacing:-0.8, color:'var(--fg1)', lineHeight:1, marginBottom:10 }}>
        {value}
      </div>
      <div style={{ fontFamily:'var(--font-body)', fontSize:12.5, color:'var(--fg2)', lineHeight:1.55 }}>
        {desc}
      </div>
    </div>
  );
}

// FlakyTestRow — single affected test in the list.
function FlakyTestRow({ test, index, selected }) {
  const BUCKET_META = {
    flagged:          { color:'var(--brand-blue-500)', label:'FLAGGED FLAKY', pillBg:'var(--accent-soft)',        pillFg:'var(--brand-blue-500)',    icon:'activity' },
    recovered:        { color:'var(--status-broken)',  label:'RECOVERED',     pillBg:'var(--status-broken-bg)',  pillFg:'var(--status-broken-fg)',  icon:'rotate-ccw' },
    broken:           { color:'#7C5CFF',                label:'BROKEN',        pillBg:'rgba(124,92,255,0.15)',     pillFg:'#B69CFF',                   icon:'zap-off' },
    failedWithRetries:{ color:'var(--status-failed)',  label:'FAILED RETRY',  pillBg:'var(--status-failed-bg)',  pillFg:'var(--status-failed-fg)',  icon:'alert-triangle' },
  };
  const m = BUCKET_META[test._bucket] || BUCKET_META.broken;

  // Compute a rough "stability score" for visual weight: lower = flakier.
  // 100 base, –20 per retry, –30 if broken, –10 if failed.
  let stability = 100 - (test.retries * 20);
  if (test.status === 'broken') stability -= 30;
  else if (test.status === 'failed') stability -= 10;
  stability = Math.max(0, Math.min(100, stability));
  const stColor = stability >= 60 ? 'var(--status-broken)' : 'var(--status-failed)';

  return (
    <div
      onClick={() => window.__openTest?.(test.id)}
      style={{
        display:'grid', gridTemplateColumns:'auto 110px 1fr 110px auto', gap:14,
        alignItems:'center', padding:'12px 4px', cursor:'pointer',
        borderTop: index ? '1px solid var(--line)' : 'none',
        background: selected ? 'var(--accent-soft)' : 'transparent',
        borderLeft: selected ? '2px solid var(--brand-blue-500)' : '2px solid transparent',
        transition:'background var(--dur-fast)',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background='var(--bg-hover)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background='transparent'; }}
    >
      <span style={{
        width:32, height:32, borderRadius:8, background:`${m.color}1F`, color:m.color,
        display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0,
      }}>
        <Icon name={m.icon} size={14}/>
      </span>
      <span style={{
        display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'3px 0',
        background:m.pillBg, color:m.pillFg, fontFamily:'var(--font-mono)', fontSize:10.5, fontWeight:700,
        letterSpacing:0.5, borderRadius:4,
      }}>{m.label}</span>
      <div style={{ minWidth:0 }}>
        <div style={{ fontFamily:'var(--font-body)', fontSize:13.5, fontWeight:600, color:'var(--fg1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {test.name}
        </div>
        <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {test.suite ? <span>{test.suite}</span> : null}
          {test.suite && test.file ? <span> · </span> : null}
          {test.file ? <span>{test.file}</span> : null}
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-end' }}>
        <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>
          {test.retries > 0 ? `${test.retries} ${test.retries === 1 ? 'retry' : 'retries'}` : 'no retries'}
        </div>
        <div style={{ width:90, height:4, background:'var(--bg-sunken)', borderRadius:999, overflow:'hidden' }}>
          <div style={{ width:`${stability}%`, height:'100%', background:stColor, transition:'width var(--dur-fast)' }}/>
        </div>
        <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg4)', letterSpacing:'.08em', textTransform:'uppercase' }}>
          stability {stability}%
        </div>
      </div>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg3)' }}>{test.dur}</div>
    </div>
  );
}

// ============== SUITES PAGE — uses TreeDetailPage ==============
function SuitesView({ onOpen }) {
  const tree = window.SUITE_TREE || [];
  if (tree.length === 0) {
    return <div className="card" style={{padding:30,textAlign:'center',color:'var(--fg3)'}}>No suites in this report.</div>;
  }
  return <TreeDetailPage title="Suites" subtitle="Tests grouped by suite organization" tree={tree}/>;
}

// ============== PACKAGES PAGE — file-path tree, opens detail in-place ==============
function PackagesPage() {
  const RICH_TESTS = window.RICH_TESTS || {};
  const allTests = Object.values(RICH_TESTS);

  if (allTests.length === 0) {
    return <div className="card" style={{padding:30,textAlign:'center',color:'var(--fg3)'}}>No tests in this report.</div>;
  }

  // Build a tree from RICH_TESTS file paths, e.g. src/test/auth/login.spec.ts → src › test › auth › login.spec.ts
  const root = { _children: {} };
  allTests.forEach(t => {
    if (!t.file) return;
    const parts = t.file.split(':')[0].split('/');
    let node = root;
    parts.forEach((p, i) => {
      if (!node._children[p]) node._children[p] = { _children: {}, _name: p, _isFile: i === parts.length - 1 };
      node = node._children[p];
      if (node._isFile) node._test = t.id;
    });
  });

  const toTree = (node, prefix='') => Object.entries(node._children).map(([name, child]) => {
    const id = prefix + '/' + name;
    if (child._isFile) {
      return { id, testId: child._test };
    }
    return { id, name, children: toTree(child, id) };
  });

  // Collapse single-child folders for cleaner display
  const collapse = nodes => nodes.map(n => {
    if (!n.children) return n;
    let kids = collapse(n.children);
    while (kids.length === 1 && kids[0].children) {
      n = { ...n, name: n.name + ' › ' + kids[0].name, children: kids[0].children, id: kids[0].id };
      kids = n.children;
    }
    return { ...n, children: kids };
  });

  const tree = collapse(toTree(root));

  if (tree.length === 0) {
    return <div className="card" style={{padding:30,textAlign:'center',color:'var(--fg3)'}}>No source-file metadata in this report. Add filePath to your test cases to populate this tree.</div>;
  }

  return <TreeDetailPage title="Packages" subtitle="Tests grouped by source-code package" tree={tree}/>;
}

// ============== BEHAVIORS PAGE — Epic › Feature › Story tree ==============
function BehaviorsPage() {
  const tree = window.BEHAVIOR_TREE || [];
  if (tree.length === 0) {
    return <div className="card" style={{padding:30,textAlign:'center',color:'var(--fg3)'}}>No BDD/behavior annotations in this report. Add behavior.epic/feature/scenario to your test cases to populate this tree.</div>;
  }
  return <TreeDetailPage
    title="Behaviors"
    subtitle="BDD tree · Epic › Feature › Story · Given/When/Then in test details"
    tree={tree}
  />;
}

// ============== HISTORY PAGE ==============
function HistoryPage() {
  const HISTORY_RUNS = window.HISTORY_RUNS || [];
  const TREND_RUNS = window.TREND_RUNS || [];

  return (
    <div>
      <h1 className="k-h1" style={{ marginBottom: 4 }}>History</h1>
      <div className="k-meta" style={{ marginBottom: 18 }}>Last {HISTORY_RUNS.length} run{HISTORY_RUNS.length !== 1 ? 's' : ''} · main &amp; PR branches</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="hd"><h3>Pass-rate trend</h3><div className="meta">last {TREND_RUNS.length} run{TREND_RUNS.length !== 1 ? 's' : ''}</div></div>
        {TREND_RUNS.length > 0 ? (
          <TrendChartV2 runs={TREND_RUNS}/>
        ) : (
          <div style={{ padding:30, color:'var(--fg3)', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12 }}>
            No run history yet. Run kensho generate over multiple runs to populate.
          </div>
        )}
      </div>

      <div className="card kv-flush">
        <div style={{ display:'grid', gridTemplateColumns:'24px 200px 1fr 110px 110px 80px', gap:12, padding:'10px 20px', background:'var(--bg-sunken)', borderBottom:'1px solid var(--line)', fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:700, color:'var(--fg3)' }}>
          <div></div><div>Run</div><div>Distribution</div><div>Branch · actor</div><div>Duration</div><div style={{textAlign:'right'}}>When</div>
        </div>
        {HISTORY_RUNS.map((r, i) => {
          const total = r.passed + r.failed + r.broken + r.skipped;
          return (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'24px 200px 1fr 110px 110px 80px', gap:12, padding:'12px 20px', borderBottom: i < HISTORY_RUNS.length-1 ? '1px solid var(--line)' : 'none', alignItems:'center', cursor:'pointer' }}>
              <span className={`s-icon ${r.status}`}>{r.status === 'passed' ? '✓' : '✕'}</span>
              <div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg1)' }}>{r.id}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>{r.passed} passed · {r.failed} failed · {r.broken} broken · {r.skipped} skipped</div>
              </div>
              <div style={{ height:12, background:'var(--bg-sunken)', borderRadius:3, display:'flex', overflow:'hidden' }}>
                {r.passed > 0 && <div style={{ width:`${(r.passed/total)*100}%`, background:'var(--status-passed)' }}/>}
                {r.failed > 0 && <div style={{ width:`${(r.failed/total)*100}%`, background:'var(--status-failed)' }}/>}
                {r.broken > 0 && <div style={{ width:`${(r.broken/total)*100}%`, background:'var(--status-broken)' }}/>}
                {r.skipped > 0 && <div style={{ width:`${(r.skipped/total)*100}%`, background:'var(--status-skipped)' }}/>}
              </div>
              <div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg1)' }}>{r.branch}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>{r.actor}</div>
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg2)' }}>{r.dur}</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', textAlign:'right' }}>{r.when}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { GraphsPage, TimelinePage, CategoriesPage, BehaviorsPage, PackagesPage, HistoryPage, SuitesView, FlakyPage });
