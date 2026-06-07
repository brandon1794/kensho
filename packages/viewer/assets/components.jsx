/* global React */
const { useState } = React;

// Stable no-op context for the static-report path. Hooks must be called
// unconditionally; passing this when window.__KenshoContext is undefined
// keeps consumers seeing `null` and behaving exactly as the static OSS
// report did before the embed refactor.
const _kvCompNullCtx = React.createContext(null);

// Icon wrapper — renders the SVG directly from lucide's icon registry rather
// than dropping an `<i data-lucide="…">` placeholder + relying on a global
// `lucide.createIcons()` pass. The global pass scans the whole document and
// rewrites <i> elements anywhere it finds them — fine for the static report
// (we own the page) but breaks when the viewer is embedded in a host page
// that uses its own icon library: lucide rewrites the host's <i> tags, the
// host's React reconciler then crashes with "removeChild: not a child of
// this node". Self-contained inline SVG sidesteps the whole class of bugs.
const _kvIconCache = new Map();
// Inline-SVG fallbacks for the icons the viewer cares about, used when the
// lucide UMD bundle either failed to load or rearranged its registry shape.
// Without this fallback the theme-toggle, export, and run-id chip render as
// blank squares — the user sees an "empty box" between the breadcrumb and
// the Export button.
const _KV_ICON_FALLBACKS = {
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
  'circle': '<circle cx="12" cy="12" r="10"/>',
  'layout-dashboard': '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  'folder-tree': '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  'bar-chart-3': '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'tags': '<path d="m20.59 13.41-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  'activity': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  'list-tree': '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
  'package': '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
};
function _kvFallbackSvg(name, size) {
  const inner = _KV_ICON_FALLBACKS[name];
  if (!inner) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
function lucideSvg(name, size) {
  const cacheKey = name + ':' + size;
  if (_kvIconCache.has(cacheKey)) return _kvIconCache.get(cacheKey);
  // Prefer the inline fallback — lucide's UMD bundle has shifted shapes
  // across versions (sometimes [tag,attrs,children], sometimes a string,
  // sometimes an icon factory). The fallback set covers every icon the
  // viewer renders, so we use it deterministically.
  const fallback = _kvFallbackSvg(name, size);
  if (fallback) {
    _kvIconCache.set(cacheKey, fallback);
    return fallback;
  }
  let svg = '';
  try {
    const reg = window.lucide && (window.lucide.icons || window.lucide);
    const pascal = name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
    const node = reg && (reg[pascal] || reg[name]);
    if (node && Array.isArray(node)) {
      const [tag, attrs, children] = node;
      const attrStr = Object.entries({
        ...attrs, width: size, height: size,
      }).map(([k, v]) => `${k}="${v}"`).join(' ');
      const inner = (children || []).map(c => {
        const [ct, ca] = c;
        const at = Object.entries(ca).map(([k, v]) => `${k}="${v}"`).join(' ');
        return `<${ct} ${at}/>`;
      }).join('');
      if (inner) svg = `<${tag} ${attrStr}>${inner}</${tag}>`;
    }
  } catch (_e) {}
  if (!svg) svg = `<svg width="${size}" height="${size}"></svg>`;
  _kvIconCache.set(cacheKey, svg);
  return svg;
}
const Icon = ({ name, size = 16 }) => (
  <span
    style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width: size, height: size, lineHeight: 0, verticalAlign:'middle' }}
    dangerouslySetInnerHTML={{ __html: lucideSvg(name, size) }}
  />
);

function Sidebar({ active, onNav }) {
  // Show a small badge next to "Flaky" when this run has flaky signals
  // (retries > 0 or status === 'broken'). Helps users discover the feature.
  const flakyCount = Object.values(window.RICH_TESTS || {}).filter(t => (t.retries > 0) || t.status === 'broken').length;
  const items = [
    ['overview', 'Overview', 'layout-dashboard'],
    ['suites', 'Suites', 'folder-tree'],
    ['graphs', 'Graphs', 'bar-chart-3'],
    ['timeline', 'Timeline', 'clock'],
    ['categories', 'Categories', 'tags'],
    ['flaky', 'Flaky', 'activity', flakyCount],
    ['behaviors', 'Behaviors', 'list-tree'],
    ['packages', 'Packages', 'package'],
    ['history', 'History', 'history'],
  ];
  // Pull host-provided extras from the embed context, if present. In the
  // static-report path window.__KenshoContext is undefined → useContext on
  // the local null-ctx returns null → no extras, sidebar renders as before.
  const ctx = React.useContext(window.__KenshoContext || _kvCompNullCtx);
  const extras = ctx?.extraSidebar || [];
  return (
    <aside className="sb">
      <div className="brand">
        <img src={(window.__KENSHO_ASSETS_BASE || 'assets/') + 'kaizen-mark.svg'} alt="" style={{ width: 28, height: 28 }} />
        <div className="name" style={{ display:'inline-flex', alignItems:'baseline', gap:8 }}>
          Kensho<span className="accent">·</span>
          <span style={{
            fontSize:13, fontWeight:500, color:'var(--brand-green-400)',
            opacity:0.85, fontFamily:'sans-serif', letterSpacing:0,
          }} title="改善 · kaizen — continuous improvement">改善</span>
        </div>
      </div>
      <nav>
        {items.map(([id, label, icon, badge]) => (
          <a key={id} className={active === id ? 'active' : ''} onClick={() => onNav(id)}>
            <Icon name={icon} size={18} />
            <span style={{ flex:1 }}>{label}</span>
            {badge > 0 && (
              <span style={{
                fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700,
                padding:'1px 6px', borderRadius:999,
                background:'var(--status-broken-bg)', color:'var(--status-broken-fg)',
                border:'1px solid var(--status-broken-border)',
                lineHeight:1.4,
              }}>{badge}</span>
            )}
          </a>
        ))}
        {/* Host-injected extras (Kaizen platform: History, Triage, AI clusters…). */}
        {extras.length > 0 && (
          <div style={{ height:1, background:'var(--dark-line)', margin:'6px 12px' }}/>
        )}
        {extras.map(ex => (
          <a key={ex.id} className={active === ex.id ? 'active' : ''} onClick={() => onNav(ex.id)}>
            <Icon name={ex.icon || 'circle'} size={18} />
            <span style={{ flex:1 }}>{ex.label}</span>
          </a>
        ))}
      </nav>
      <div className="foot">v0.4.2 · build 28a91f</div>
    </aside>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = React.useState(() => {
    try { return localStorage.getItem('kensho-theme') || 'light'; } catch (e) { return 'light'; }
  });
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('kensho-theme', theme); } catch (e) {}
    // No global lucide rewrite — Icon renders inline SVG (see top of file).
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="theme-toggle"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
    </button>
  );
}

function TopBar({ crumbs, onRerun, project }) {
  const RUN = window.RUN;
  const failed = (RUN?.counts?.failed || 0) + (RUN?.counts?.broken || 0) > 0;
  const branch = RUN?.branch || 'local';
  const id = RUN?.id || '';
  const runUrl = RUN?.runUrl || '';

  // Export — fetch data/index.json and trigger a download.
  // Honors gzip via the browser's Accept-Encoding (Python http.server doesn't
  // emit Content-Encoding for .json so we just save the raw bytes).
  const onExport = async () => {
    try {
      const res = await fetch('data/index.json', { cache: 'no-cache' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kensho-${(RUN?.id || 'run').replace(/^#/, '')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[kensho] export failed:', e);
    }
  };

  return (
    <div className="tb">
      <div className="crumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Icon name="chevron-right" size={14} />}
            {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="grow" />
      {/* Run summary chip — static badge, not a dropdown. Multi-run history
          lives in Kaizen, so a chevron here would imply functionality the OSS
          report doesn't have. Click copies the run id to clipboard. */}
      <div
        className={`runsel${failed ? ' fail' : ''}`}
        title={`${branch} · ${id} · click to copy run id`}
        onClick={() => navigator.clipboard?.writeText(id.replace(/^#/, ''))}
        style={{ cursor:'pointer' }}
      >
        <span className="dot"></span>
        <span>{branch} · {id}</span>
      </div>
      <ThemeToggle />
      <button className="btn btn-secondary" onClick={onExport} title="Download data/index.json">
        <Icon name="download" size={14} />Export
      </button>
      {/* Re-run failed — only shown when (a) something failed AND (b) we have
          a CI run URL to open. In OSS Kensho there's no server to trigger a
          re-run from; the most useful action is to jump to the CI workflow. */}
      {failed && runUrl && (
        <a className="btn btn-primary" href={runUrl} target="_blank" rel="noopener noreferrer" title="Open the CI workflow that produced this run">
          <Icon name="external-link" size={14} />Re-run failed
        </a>
      )}
    </div>
  );
}

function StatusDonut({ counts }) {
  const total = counts.passed + counts.failed + counts.broken + counts.skipped;
  const pct = Math.round((counts.passed / total) * 100);
  const C = 2 * Math.PI * 42;
  const segs = [
    [counts.passed, 'var(--status-passed)'],
    [counts.failed, 'var(--status-failed)'],
    [counts.broken, 'var(--status-broken)'],
    [counts.skipped, 'var(--status-skipped)'],
  ];
  let off = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ position: 'relative', width: 150, height: 150 }}>
        <svg viewBox="0 0 100 100" width="150" height="150" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="50" cy="50" r="42" stroke="var(--bg-sunken)" strokeWidth="14" fill="none" />
          {segs.map(([n, color], i) => {
            const len = (n / total) * C;
            const dash = `${len} ${C}`;
            const dashoff = -off;
            off += len;
            return n > 0 ? (
              <circle key={i} cx="50" cy="50" r="42" stroke={color} strokeWidth="14" fill="none"
                strokeDasharray={dash} strokeDashoffset={dashoff} />
            ) : null;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--fg1)' }}>{pct}%</div>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg3)', fontWeight: 600 }}>passed</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[['passed', counts.passed, 'var(--status-passed)'],
          ['failed', counts.failed, 'var(--status-failed)'],
          ['broken', counts.broken, 'var(--status-broken)'],
          ['skipped', counts.skipped, 'var(--status-skipped)']].map(([k, v, c]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg2)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: c }}></span>
            <b style={{ color: 'var(--fg1)', fontFamily: 'var(--font-display)', fontWeight: 700, marginRight: 4, fontVariantNumeric: 'tabular-nums' }}>{v}</b> {k}
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendChart() {
  return (
    <svg viewBox="0 0 400 160" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 160 }}>
      {[1,2,3,4,5,6,7].map(i => (
        <line key={i} x1={i*50} y1="10" x2={i*50} y2="150" stroke="var(--line)" strokeDasharray="2 3" />
      ))}
      <path d="M0,140 L50,90 L100,30 L150,30 L200,30 L250,30 L300,30 L350,55 L400,60 L400,150 L0,150 Z"
            fill="var(--status-passed)" fillOpacity="0.7" />
      <path d="M0,150 L50,140 L100,110 L150,110 L200,105 L250,105 L300,105 L350,100 L400,98 L400,150 L0,150 Z"
            fill="var(--status-failed)" fillOpacity="0.75" />
      {[0,50,100,150,200,250,300,350].map((x,i) => (
        <text key={i} x={x+25} y="158" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg3)">#{2455086+i}</text>
      ))}
    </svg>
  );
}

function SuiteBar({ name, segs, total }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 50px', alignItems: 'center', gap: 14, padding: '6px 0' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--fg1)' }}>{name}</div>
      <div style={{ height: 18, background: 'var(--bg-sunken)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
        {segs.map((s, i) => (
          <div key={i} style={{
            width: `${(s.n/total)*100}%`,
            background: `var(--status-${s.k})`,
            color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6,
          }}>{s.n}</div>
        ))}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg3)', textAlign: 'right' }}>{total}</div>
    </div>
  );
}

function TestRow({ test, onOpen }) {
  return (
    <div className="trow" onClick={() => onOpen(test)}>
      <div><span className={`s-icon ${test.status}`}>{test.status === 'passed' ? '✓' : test.status === 'failed' ? '✕' : test.status === 'broken' ? '!' : '⊘'}</span></div>
      <div className="id"><span className="ns">{test.ns}</span>{test.name}{test.retries ? <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--status-broken)' }}>↻ {test.retries} retries</span> : null}</div>
      <div className="dur">{test.duration}</div>
      <div><span className={`badge b-${test.status}`}><span className="dot"></span>{test.status}</span></div>
      <div className="dur">{test.last}</div>
      <div style={{ color: 'var(--fg4)' }}>›</div>
    </div>
  );
}

function EnvTable({ env }) {
  return (
    <div className="env">
      {env.map(([k, v]) => (
        <React.Fragment key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

function StepTree({ steps }) {
  return (
    <div>
      {steps.map((s, i) => (
        <div key={i} className={`step ${s.status}`}>
          <div className="head">
            <span className={`s-icon ${s.status}`} style={{ width: 14, height: 14 }}>{s.status === 'passed' ? '✓' : s.status === 'failed' ? '✕' : '!'}</span>
            <span className="name">{s.name}</span>
            <span className="dur">{s.duration}</span>
          </div>
          {s.body && <div className="body">{s.body}</div>}
          {s.children && <div className="children"><StepTree steps={s.children} /></div>}
        </div>
      ))}
    </div>
  );
}

function LogPanel({ lines }) {
  return (
    <div className="log">
      {lines.map((l, i) => (
        <div key={i}>
          <span className="ts">{l.ts}</span>
          <span className={`lvl-${l.lvl}`}>{l.lvl.toUpperCase()}</span>{' '}
          <span>{l.msg}</span>
        </div>
      ))}
    </div>
  );
}

// =============================================================
//  SeverityDistribution — horizontal bar viz of test cases by
//  severity. Each row: severity label · stretched bar · count.
//  Blocker/critical use failure tones, Normal uses warning amber,
//  Minor/trivial use muted gray. Rows with zero are hidden.
// =============================================================
function SeverityDistribution({ tests }) {
  const ROWS = [
    { k:'blocker',  label:'Blocker',  fg:'var(--status-failed)',  bg:'var(--status-failed)' },
    { k:'critical', label:'Critical', fg:'var(--status-failed-fg)', bg:'#E5848A' },
    { k:'normal',   label:'Normal',   fg:'var(--status-broken-fg)', bg:'var(--status-broken)' },
    { k:'minor',    label:'Minor',    fg:'var(--fg2)', bg:'var(--fg3)' },
    { k:'trivial',  label:'Trivial',  fg:'var(--fg3)', bg:'var(--fg4)' },
  ];
  const counts = { blocker:0, critical:0, normal:0, minor:0, trivial:0 };
  for (const t of tests) {
    const sev = (t.severity || 'normal').toLowerCase();
    if (counts[sev] != null) counts[sev]++;
    else counts.normal++;
  }
  const max = Math.max(1, ...Object.values(counts));
  const visible = ROWS.filter(r => counts[r.k] > 0);
  if (visible.length === 0) {
    return <div style={{ padding:'14px 0', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12 }}>No severity metadata on tests.</div>;
  }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {visible.map(r => {
        const n = counts[r.k];
        const w = (n / max) * 100;
        return (
          <div key={r.k} style={{ display:'grid', gridTemplateColumns:'80px 1fr 40px', gap:14, alignItems:'center' }}>
            <div style={{ fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, color:r.fg }}>{r.label}</div>
            <div style={{ position:'relative', height:14, background:'var(--bg-sunken)', borderRadius:999, overflow:'hidden' }}>
              <div style={{
                position:'absolute', inset:0, width: `${w}%`, background:r.bg, borderRadius:999,
                transition:'width var(--dur-fast)',
              }}/>
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:'var(--fg1)', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{n}</div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================
//  SlowestTestsList — top N tests by duration. Each row mirrors
//  the design from the Allure / TestRail screenshots: status pill
//  on the left, test name + suite path centered, duration right.
//  Click row → opens the test detail.
// =============================================================
function SlowestTestsList({ tests, limit = 6, onOpen }) {
  const ranked = [...tests]
    .filter(t => t.durMs > 0)
    .sort((a,b) => b.durMs - a.durMs)
    .slice(0, limit);
  if (ranked.length === 0) {
    return <div style={{ padding:'14px 0', color:'var(--fg3)', fontFamily:'var(--font-mono)', fontSize:12 }}>No timing data captured for this run.</div>;
  }
  const PILL = {
    passed:  { bg:'var(--status-passed-bg)',  fg:'var(--status-passed)',  label:'PASS' },
    failed:  { bg:'var(--status-failed-bg)',  fg:'var(--status-failed)',  label:'FAIL' },
    broken:  { bg:'var(--status-broken-bg)',  fg:'var(--status-broken)',  label:'BROKEN' },
    skipped: { bg:'var(--status-skipped-bg)', fg:'var(--status-skipped-fg)', label:'SKIP' },
  };
  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {ranked.map((t, i) => {
        const p = PILL[t.status] || PILL.passed;
        return (
          <div
            key={t.id}
            onClick={() => onOpen?.({ ns:'', name:t.name, status:t.status, duration:t.dur, retries:t.retries, richId:t.id })}
            style={{
              display:'grid', gridTemplateColumns:'62px 1fr auto', alignItems:'center', gap:14,
              padding:'10px 4px', cursor:'pointer',
              borderTop: i ? '1px solid var(--line)' : 'none',
              transition:'background var(--dur-fast)',
            }}
            onMouseEnter={e => e.currentTarget.style.background='var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background='transparent'}
          >
            <span style={{
              display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'3px 0',
              background:p.bg, color:p.fg, fontFamily:'var(--font-mono)', fontSize:10.5, fontWeight:700,
              letterSpacing:0.5, borderRadius:4,
            }}>{p.label}</span>
            <div style={{ minWidth:0 }}>
              <div style={{ fontFamily:'var(--font-body)', fontSize:13, color:'var(--fg1)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {t.suite ? <span style={{ color:'var(--fg3)' }}>{t.suite} › </span> : null}{t.name}
              </div>
              {t.file && (
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.file}</div>
              )}
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:'var(--fg1)', fontVariantNumeric:'tabular-nums' }}>{t.dur}</div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================
//  HighlightStat — accent-bordered "hero" stat card. Used on the
//  Graphs page banner: Slowest test · Most retried · Top failure
//  category. Big numeric, subtle subtitle, color-coded left border.
// =============================================================
function HighlightStat({ overline, value, valueColor, subtitle, accent, onClick, title }) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        position:'relative', padding:'18px 22px',
        background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:12,
        cursor: onClick ? 'pointer' : 'default', overflow:'hidden',
        transition:'transform var(--dur-fast), border-color var(--dur-fast)',
      }}
      onMouseEnter={onClick ? e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.transform = 'translateY(-1px)'; } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'translateY(0)'; } : undefined}
    >
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:accent }}/>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:'.14em', textTransform:'uppercase', marginBottom:8 }}>
        {overline}
      </div>
      <div style={{ fontFamily:'var(--font-display)', fontSize:38, fontWeight:700, letterSpacing:-0.8, color:valueColor || 'var(--fg1)', lineHeight:1, marginBottom:10 }}>
        {value}
      </div>
      <div style={{ fontFamily:'var(--font-body)', fontSize:13, color:'var(--fg2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {subtitle}
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, TopBar, StatusDonut, TrendChart, SuiteBar, TestRow, EnvTable, StepTree, LogPanel, Icon, SeverityDistribution, SlowestTestsList, HighlightStat });
