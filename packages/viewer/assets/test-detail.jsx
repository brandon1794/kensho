// ============================================================
// TEST DETAIL — header + step tree with logs/payloads/screenshots
// Multi-platform: Web · Mobile · API · DB
// Multi-language: TS · JS · Python · Java · Kotlin · Swift · Go · Ruby · C#
// ============================================================

// ----------- helpers -----------

// ============================================================
// KvMarkdown — a tiny, SAFE Markdown subset renderer.
//
// Supports: ATX headings (#..######), **bold**, *italic* / _italic_,
// `inline code`, ```fenced code```, unordered (-, *, +) and ordered (1.)
// lists, http(s)-only links [text](url), and hard line breaks. Everything
// else is rendered as plain text. We NEVER use dangerouslySetInnerHTML — the
// source is parsed into React elements, so HTML in the source is shown
// verbatim (escaped by React) and javascript:/data: links are dropped.
//
// Zero deps. Output is wrapped in <div className="kv-md">.
// ============================================================
function _kvSafeHref(url) {
  const u = String(url || '').trim();
  // Only allow http(s) and protocol-relative / relative anchors; everything
  // else (javascript:, data:, vbscript:, file:, …) is dropped.
  if (/^https?:\/\//i.test(u)) return u;
  if (/^(#|\/|\.\/|\.\.\/)/.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // has a scheme we don't trust
  return u; // bare relative path (e.g. docs/foo.md)
}

// Inline parser → array of React nodes. Handles `code`, **bold**, *italic*,
// _italic_, and [text](href). Recurses for emphasis content.
function _kvParseInline(text, keyPrefix) {
  const nodes = [];
  let rest = String(text);
  let i = 0;
  // Order matters: code first (so emphasis inside backticks is literal).
  const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/;
  while (rest.length) {
    const m = rest.match(TOKEN);
    if (!m) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = keyPrefix + '-' + (i++);
    if (tok.startsWith('`')) {
      nodes.push(<code key={key} className="kv-md-code">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(<strong key={key}>{_kvParseInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      nodes.push(<em key={key}>{_kvParseInline(tok.slice(1, -1), key)}</em>);
    } else {
      // link [text](href)
      const lm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = lm ? _kvSafeHref(lm[2]) : null;
      if (lm && href) {
        nodes.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{lm[1]}</a>);
      } else {
        nodes.push(tok); // unsafe href → render the literal text
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

function KvMarkdown({ source }) {
  const src = String(source == null ? '' : source);
  if (!src.trim()) return null;
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let bi = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block.
    const fence = line.match(/^```\s*([\w.-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      blocks.push(
        <pre key={'b' + (bi++)} className="kv-md-pre" data-lang={lang || undefined}>
          <code>{buf.join('\n')}</code>
        </pre>
      );
      continue;
    }
    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const Tag = 'h' + Math.min(6, level + 1); // shift so report H1 stays unique
      blocks.push(React.createElement(Tag, { key: 'b' + (bi++), className: 'kv-md-h kv-md-h' + level }, _kvParseInline(h[2], 'h' + bi)));
      i++;
      continue;
    }
    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push(<ul key={'b' + (bi++)} className="kv-md-ul">{items.map((it, k) => <li key={k}>{_kvParseInline(it, 'ul' + bi + '-' + k)}</li>)}</ul>);
      continue;
    }
    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(<ol key={'b' + (bi++)} className="kv-md-ol">{items.map((it, k) => <li key={k}>{_kvParseInline(it, 'ol' + bi + '-' + k)}</li>)}</ol>);
      continue;
    }
    // Blank line → block separator.
    if (line.trim() === '') { i++; continue; }
    // Paragraph — gather consecutive non-blank, non-special lines. Two spaces
    // at EOL (or a single newline within the paragraph) become a hard break.
    const para = [];
    while (i < lines.length && lines[i].trim() !== ''
      && !/^```/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    const children = [];
    para.forEach((p, k) => {
      if (k > 0) children.push(<br key={'br' + k} />);
      children.push(<React.Fragment key={'f' + k}>{_kvParseInline(p.replace(/\s+$/, ''), 'p' + bi + '-' + k)}</React.Fragment>);
    });
    blocks.push(<p key={'b' + (bi++)} className="kv-md-p">{children}</p>);
  }
  return <div className="kv-md">{blocks}</div>;
}

// ============================================================
// KvSourceSnippet — renders case.sourceSnippet as a code block with line
// numbers, the failing line highlighted, and a language label. Renders
// nothing when no snippet is present.
// ============================================================
function KvSourceSnippet({ snippet }) {
  if (!snippet || !Array.isArray(snippet.lines) || snippet.lines.length === 0) return null;
  const lang = snippet.lang || '';
  const fileLabel = snippet.file
    ? snippet.file + (snippet.line ? ':' + snippet.line : '')
    : (snippet.line ? 'line ' + snippet.line : '');
  return (
    <div className="kv-snippet">
      <div className="kv-snippet-hd">
        <span className="kv-snippet-file">{fileLabel || 'source'}</span>
        {lang && <span className="kv-snippet-lang">{lang}</span>}
      </div>
      <pre className="kv-snippet-body"><code>
        {snippet.lines.map((ln, idx) => (
          <div key={idx} className={'kv-snippet-row' + (ln.isError ? ' kv-snippet-row--error' : '')}>
            <span className="kv-snippet-gutter">{ln.n != null ? ln.n : ''}</span>
            <span className="kv-snippet-code">{ln.text != null ? ln.text : ''}</span>
          </div>
        ))}
      </code></pre>
    </div>
  );
}

// ============================================================
// KvMarker — small inline badges for flaky / muted ("known issue") state.
// `muted` deep-links to the case's kind:'issue' link when one exists.
// Renders nothing when neither flag is set.
//   <KvMarker flaky muted links={test.links} size="sm" />
// ============================================================
function _kvIssueLink(links) {
  return (links || []).find(l => (l.kind || '').toLowerCase() === 'issue') || null;
}
function KvMarker({ flaky, muted, links, size }) {
  if (!flaky && !muted) return null;
  const cls = 'kv-marker' + (size === 'sm' ? ' kv-marker--sm' : '');
  const issue = muted ? _kvIssueLink(links) : null;
  return (
    <span className="kv-marker-group" style={{ display:'inline-flex', gap:5, alignItems:'center' }}>
      {flaky && (
        <span className={cls + ' kv-marker--flaky'} title="Flagged flaky by the test (kensho.flaky())">
          <Icon name="activity" size={size === 'sm' ? 10 : 11} />flaky
        </span>
      )}
      {muted && (issue ? (
        <a className={cls + ' kv-marker--muted'} href={_kvSafeHref(issue.url) || '#'}
           target="_blank" rel="noopener noreferrer"
           title={`Known issue · ${issue.label || issue.url}`}
           onClick={e => e.stopPropagation()}>
          <Icon name="shield-alert" size={size === 'sm' ? 10 : 11} />known issue
        </a>
      ) : (
        <span className={cls + ' kv-marker--muted'} title="Muted / known issue (kensho.muted())">
          <Icon name="shield-alert" size={size === 'sm' ? 10 : 11} />known issue
        </span>
      ))}
    </span>
  );
}

const SEVERITY_COLORS = {
  blocker:  { bg: 'var(--status-failed-bg)', fg: 'var(--status-failed-fg)', border: 'var(--status-failed-border)' },
  critical: { bg: 'var(--status-failed-bg)', fg: 'var(--status-failed-fg)', border: 'var(--status-failed-border)' },
  normal:   { bg: 'var(--status-broken-bg)', fg: 'var(--status-broken-fg)', border: 'var(--status-broken-border)' },
  minor:    { bg: 'var(--status-skipped-bg)', fg: 'var(--status-skipped-fg)', border: 'var(--status-skipped-border)' },
  trivial:  { bg: 'var(--status-skipped-bg)', fg: 'var(--status-skipped-fg)', border: 'var(--status-skipped-border)' },
};

function CopyPath({ path }) {
  const [copied, setCopied] = React.useState(false);
  const handle = () => {
    navigator.clipboard?.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handle} style={{
      display:'inline-flex', alignItems:'center', gap:6, fontFamily:'var(--font-mono)', fontSize:12,
      color:'var(--fg2)', background:'transparent', border:'none', padding:'2px 6px', borderRadius:4,
      cursor:'pointer'
    }}
    onMouseEnter={e => e.currentTarget.style.background='var(--bg-hover)'}
    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
      <span style={{ color:'var(--fg2)' }}>{path}</span>
      <Icon name={copied ? 'check' : 'copy'} size={11} />
      {copied && <span style={{ fontSize:10, color:'var(--status-passed)' }}>copied</span>}
    </button>
  );
}

// CopyPermalink — round-trip the current URL with a `#/case/<id>` fragment so
// users can paste a deep-link to a specific case into Slack/Jira/etc.
function CopyPermalink({ testId }) {
  const [copied, setCopied] = React.useState(false);
  const handle = (e) => {
    e.stopPropagation();
    const base = window.location.href.split('#')[0];
    const url  = base + '#/case/' + encodeURIComponent(testId);
    navigator.clipboard?.writeText(url);
    setCopied(true);
    window.__kenshoToast?.('Link copied to clipboard');
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handle} title="Copy permalink to this test"
      style={{
        display:'inline-flex', alignItems:'center', gap:5,
        fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600,
        color: copied ? 'var(--status-passed)' : 'var(--fg3)',
        background:'transparent', border:'1px solid var(--line)',
        padding:'2px 8px', borderRadius:4, cursor:'pointer',
        transition:'background var(--dur-fast), color var(--dur-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.background='var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
      <Icon name={copied ? 'check' : 'link'} size={11} />
      {copied ? 'copied' : 'copy link'}
    </button>
  );
}

function StatusPill({ status }) {
  const map = {
    passed:  { label:'PASSED',  fg:'var(--status-passed)',  bg:'var(--status-passed-bg)' },
    failed:  { label:'FAILED',  fg:'var(--status-failed)',  bg:'var(--status-failed-bg)' },
    broken:  { label:'BROKEN',  fg:'var(--status-broken)',  bg:'var(--status-broken-bg)' },
    skipped: { label:'SKIPPED', fg:'var(--status-skipped)', bg:'var(--status-skipped-bg)' },
  };
  const m = map[status] || map.passed;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6, padding:'3px 8px', borderRadius:4,
      background:m.bg, color:m.fg, fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700,
      letterSpacing:0.5
    }}>
      <span style={{ width:6, height:6, borderRadius:999, background:m.fg }} />
      {m.label}
    </span>
  );
}

function MetaField({ label, children }) {
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
      <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:1, textTransform:'uppercase' }}>{label}</span>
      <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg1)' }}>{children}</span>
    </div>
  );
}

function Tag({ children }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', padding:'2px 8px', borderRadius:4,
      background:'var(--bg-2)', border:'1px solid var(--line)', color:'var(--fg2)',
      fontFamily:'var(--font-mono)', fontSize:11, fontWeight:500
    }}>{children}</span>
  );
}

// LinkChip — renders external test links (Jira ticket, GitHub PR, runbook,
// design doc, defect, etc.) as clickable, color-coded chips next to tags.
// Each kind gets a distinct tint so users can scan visually. Falls back to
// the URL host when no label is provided.
const LINK_KIND_STYLE = {
  jira:    { bg:'#E7F0FB', fg:'#1D4ED8', border:'#BCD3F0', icon:'square-pen' },
  github:  { bg:'#F4EFFF', fg:'#5B21B6', border:'#D4C4F4', icon:'github' },
  gitlab:  { bg:'#FFF4EC', fg:'#B7430C', border:'#F4D2BC', icon:'git-branch' },
  linear:  { bg:'#EEEDFB', fg:'#3F3DB7', border:'#C8C5F0', icon:'square-arrow-out-up-right' },
  pr:      { bg:'#F4EFFF', fg:'#5B21B6', border:'#D4C4F4', icon:'git-pull-request' },
  bug:     { bg:'#FCEBEC', fg:'#B91C1C', border:'#F2C8CB', icon:'bug' },
  defect:  { bg:'#FCEBEC', fg:'#B91C1C', border:'#F2C8CB', icon:'bug' },
  doc:     { bg:'#FFF4DD', fg:'#92400E', border:'#F4DDA8', icon:'book-open' },
  runbook: { bg:'#FFF4DD', fg:'#92400E', border:'#F4DDA8', icon:'play-square' },
  slack:   { bg:'#EAFBF1', fg:'#0E5C39', border:'#C5E5D2', icon:'message-square' },
  other:   { bg:'var(--bg-sunken)', fg:'var(--fg2)', border:'var(--line)', icon:'link-2' },
};
function LinkChip({ link }) {
  const kind = (link.kind || 'other').toLowerCase();
  const s = LINK_KIND_STYLE[kind] || LINK_KIND_STYLE.other;
  const label = link.label || (() => {
    try { return new URL(link.url).hostname.replace(/^www\./, ''); }
    catch { return link.url; }
  })();
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${(link.kind || 'link').toUpperCase()} · ${link.url}`}
      style={{
        display:'inline-flex', alignItems:'center', gap:6, padding:'2px 8px',
        borderRadius:4, background:s.bg, color:s.fg, border:`1px solid ${s.border}`,
        fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, textDecoration:'none',
        transition:'background var(--dur-fast)',
      }}
    >
      <Icon name={s.icon} size={11} />
      {label}
    </a>
  );
}

function SeverityBadge({ level }) {
  const c = SEVERITY_COLORS[level] || SEVERITY_COLORS.normal;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', padding:'1px 7px', borderRadius:3,
      background:c.bg, color:c.fg, border:`1px solid ${c.border}`,
      fontFamily:'var(--font-mono)', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5
    }}>{level}</span>
  );
}

// ----------- header -----------

function TestHeader({ test, onCopyId }) {
  // Visual hierarchy:
  //   1) file path (copyable, monospace, deemphasized)
  //   2) title row: status pill · title · tags right-aligned
  //   3) facts grid — vertical key-value stack, 2 cols on wide, 1 col on narrow
  //
  // Why: the previous horizontal strip wrapped clumsily. A definition-list
  // style grid stays readable at any width, and a vertical cascade is what
  // real test-report tools (Allure, Cypress dashboard, BrowserStack) use.

  // Conditional metadata — only render fields the user actually provided.
  // Empty/null/'unassigned'/'—' all suppress the row so the grid stays clean.
  // Severity, Duration and Test ID are always shown (core identity).
  const isBlank = (v) => v == null || v === '' || v === '—' || v === 'unassigned';
  const facts = [
    { k:'Severity', v:<SeverityBadge level={test.severity}/>, always:true },
    { k:'Duration', v:<b style={{ fontWeight:600 }}>{test.duration}</b>, always:true },
    !isBlank(test.owner)    && { k:'Owner',    v:<span style={{ color:'var(--accent)' }}>@{test.owner}</span> },
    !isBlank(test.suite)    && { k:'Suite',    v:test.suite },
    !isBlank(test.lastRun)  && { k:'Last run', v:test.lastRun },
    !isBlank(test.platform) && { k:'Platform', v:test.platform },
    !isBlank(test.epic)     && { k:'Epic',     v:test.epic },
    !isBlank(test.feature)  && { k:'Feature',  v:test.feature },
    !isBlank(test.story)    && { k:'Story',    v:test.story },
    !isBlank(test.language) && { k:'Language', v:test.language },
    !isBlank(test.framework)&& { k:'Framework',v:test.framework },
    { k:'Test ID',  v:<span style={{ fontFamily:'var(--font-mono)', fontSize:11.5 }}>{test.id}</span>, always:true },
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: 22 }}>
      {/* file path + copy-link permalink */}
      <div style={{ marginBottom: 8, marginLeft: -6, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <CopyPath path={test.file} />
        <CopyPermalink testId={test.id} />
      </div>

      {/* title row */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:14, flexWrap:'wrap', marginBottom: 14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', flex:1, minWidth:0 }}>
          <StatusPill status={test.status} />
          {test.retries > 0 && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontFamily:'var(--font-mono)', fontSize:12, color:'var(--fg2)' }}>
              <Icon name="rotate-ccw" size={12} />
              {test.retries} {test.retries === 1 ? 'retry' : 'retries'}
            </span>
          )}
          <h1 style={{ fontSize:26, fontWeight:600, color:'var(--fg1)', margin:0, letterSpacing:-0.3, lineHeight:1.2 }}>{test.title}</h1>
          <KvMarker flaky={test.flaky} muted={test.muted} links={test.links} />
        </div>
        {(test.tags?.length > 0 || test.links?.length > 0) && (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            {(test.links || []).map((l, i) => <LinkChip key={'L'+i} link={l}/>)}
            {test.tags?.map(t => <Tag key={t}>{t}</Tag>)}
          </div>
        )}
      </div>

      {/* facts grid — vertical cascade; columns auto-collapse. Long values
          (URL paths, long file paths, etc.) wrap onto a second line instead
          of being clipped with an ellipsis — readers should never have to
          guess what a Story or Suite was. align-items:start so the label
          sticks to the top of the row when the value wraps. */}
      <div style={{
        borderTop:'1px solid var(--line)',
        paddingTop:14,
        display:'grid',
        gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',
        gap:'10px 28px',
      }}>
        {facts.map(f => (
          <div key={f.k} style={{ display:'grid', gridTemplateColumns:'88px 1fr', alignItems:'start', gap:10, minWidth:0 }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:1, textTransform:'uppercase', paddingTop:2 }}>{f.k}</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:12.5, color:'var(--fg1)', wordBreak:'break-word', overflowWrap:'anywhere', minWidth:0 }}>{f.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------- step tree v2 -----------
//
// A step has: { name, status, duration, type?, kind?, body?, logs?, payload?, screenshot?, request?, response?, assertion?, children? }
// type: 'action' (default) | 'assertion' | 'http' | 'screenshot' | 'device' | 'db' | 'group'
// logs: [{ ts, lvl: info|warn|err|debug, msg }]

const STEP_TYPE_ICON = {
  action: 'mouse-pointer-2',
  assertion: 'check-check',
  http: 'globe',
  screenshot: 'image',
  device: 'smartphone',
  db: 'database',
  group: 'folder',
  navigation: 'navigation',
  api: 'globe',
  setup: 'wrench',
  teardown: 'eraser',
};

function StepIcon({ type }) {
  const name = STEP_TYPE_ICON[type] || 'chevron-right';
  return <Icon name={name} size={12} />;
}

function LogLine({ log }) {
  const lvlColor = { info:'var(--fg2)', warn:'var(--status-broken-fg)', err:'var(--status-failed)', debug:'var(--fg3)' }[log.lvl] || 'var(--fg2)';
  const lvlBg    = { info:'transparent', warn:'var(--status-broken-bg)', err:'var(--status-failed-bg)', debug:'transparent' }[log.lvl] || 'transparent';
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'90px 50px 1fr', gap:10, padding:'3px 8px', borderRadius:3,
      background:lvlBg, fontFamily:'var(--font-mono)', fontSize:11.5, lineHeight:1.55
    }}>
      <span style={{ color:'var(--fg3)' }}>{log.ts}</span>
      <span style={{ color:lvlColor, fontWeight:700, letterSpacing:0.5 }}>{log.lvl.toUpperCase()}</span>
      <span style={{ color:'var(--fg1)', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{log.msg}</span>
    </div>
  );
}

function HttpBlock({ request, response }) {
  const statusColor = response.status >= 500 ? 'var(--status-failed)' : response.status >= 400 ? 'var(--status-broken)' : 'var(--status-passed)';
  return (
    <div style={{ border:'1px solid var(--line)', borderRadius:6, overflow:'hidden', fontFamily:'var(--font-mono)', fontSize:11.5 }}>
      {/* request */}
      <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--line)', background:'var(--bg-2)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ padding:'1px 6px', borderRadius:3, background:'var(--dark-bg)', color:'#fff', fontSize:10, fontWeight:700 }}>{request.method}</span>
          <span style={{ color:'var(--fg1)' }}>{request.url}</span>
          <span style={{ marginLeft:'auto', color:'var(--fg3)' }}>{request.duration}</span>
        </div>
        {request.headers && (
          <details style={{ marginTop:6 }}>
            <summary style={{ cursor:'pointer', color:'var(--fg3)', fontSize:10.5, letterSpacing:0.5, textTransform:'uppercase' }}>Request headers ({Object.keys(request.headers).length})</summary>
            <pre style={{ margin:'6px 0 0', padding:8, background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:4, fontSize:11, color:'var(--fg2)', overflow:'auto' }}>{Object.entries(request.headers).map(([k,v]) => `${k}: ${v}`).join('\n')}</pre>
          </details>
        )}
        {request.body && (
          <details style={{ marginTop:6 }} open>
            <summary style={{ cursor:'pointer', color:'var(--fg3)', fontSize:10.5, letterSpacing:0.5, textTransform:'uppercase' }}>Request body</summary>
            <pre style={{ margin:'6px 0 0', padding:8, background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:4, fontSize:11, color:'var(--fg2)', overflow:'auto' }}>{typeof request.body === 'string' ? request.body : JSON.stringify(request.body, null, 2)}</pre>
          </details>
        )}
      </div>
      {/* response */}
      <div style={{ padding:'8px 12px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ padding:'1px 6px', borderRadius:3, background:statusColor, color:'#fff', fontSize:10, fontWeight:700 }}>{response.status} {response.statusText}</span>
          <span style={{ color:'var(--fg3)' }}>{response.size}</span>
        </div>
        {response.body && (
          <details style={{ marginTop:6 }} open>
            <summary style={{ cursor:'pointer', color:'var(--fg3)', fontSize:10.5, letterSpacing:0.5, textTransform:'uppercase' }}>Response body</summary>
            <pre style={{ margin:'6px 0 0', padding:8, background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius:4, fontSize:11, color:'var(--fg2)', overflow:'auto', maxHeight:200 }}>{typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function AssertionBlock({ assertion }) {
  const ok = assertion.passed;
  const c = ok ? { fg:'var(--status-passed)', bg:'var(--status-passed-bg)', border:'var(--status-passed-border)' } : { fg:'var(--status-failed)', bg:'var(--status-failed-bg)', border:'var(--status-failed-border)' };
  return (
    <div style={{ border:`1px solid ${c.border}`, background:c.bg, borderRadius:6, padding:10, fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--fg1)' }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6 }}>
        <span style={{ color:c.fg, fontWeight:700, letterSpacing:0.5 }}>{ok ? '✓ ASSERTION PASSED' : '✕ ASSERTION FAILED'}</span>
        <span style={{ color:'var(--fg3)' }}>{assertion.matcher}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'70px 1fr', gap:'4px 10px' }}>
        <span style={{ color:'var(--fg3)' }}>expected</span>
        <span style={{ color:'var(--status-passed)' }}>{assertion.expected}</span>
        <span style={{ color:'var(--fg3)' }}>actual</span>
        <span style={{ color: ok ? 'var(--status-passed)' : 'var(--status-failed)' }}>{assertion.actual}</span>
      </div>
    </div>
  );
}

function ScreenshotBlock({ screenshot }) {
  // `screenshot.url` (if present) is the direct path to the image file. When
  // the bridge maps `step.attachments[]` to this shape it sets `.url` to
  // `data/<relativePath>`. Falls back to the placeholder hatching when the
  // adapter only described the screenshot without copying it through.
  const url = screenshot.url;
  return (
    <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
      <a href={url || '#'} target="_blank" rel="noopener noreferrer" onClick={url ? undefined : (e => e.preventDefault())}
         style={{ flexShrink:0, display:'block' }} title={url ? 'Open full-size in new tab' : screenshot.name}>
        {url ? (
          <img src={url} alt={screenshot.name || 'screenshot'}
            style={{ width:200, height:120, objectFit:'cover', borderRadius:6, border:'1px solid var(--line)', display:'block', cursor:'zoom-in' }}
            onError={e => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <div style={{
            width:160, height:100, borderRadius:6, border:'1px solid var(--line)',
            background:`repeating-linear-gradient(135deg, var(--bg-sunken) 0 12px, var(--bg-hover) 12px 24px)`,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <Icon name="image" size={20} />
          </div>
        )}
      </a>
      <div style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--fg2)', minWidth:0 }}>
        <div style={{ color:'var(--fg1)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{screenshot.name}</div>
        <div style={{ color:'var(--fg3)', marginTop:2 }}>{[screenshot.size, screenshot.dimensions].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

function StepNode({ step, depth = 0, defaultOpen }) {
  const hasContent = step.logs?.length || step.body || step.children?.length || step.request || step.response || step.assertion || step.screenshot || step.payload;
  const isProblem = step.status === 'failed' || step.status === 'broken';
  const [open, setOpen] = React.useState(defaultOpen ?? isProblem);
  const [hover, setHover] = React.useState(false);
  const stepIcon = step.status === 'passed' ? '✓' : step.status === 'failed' ? '✕' : step.status === 'broken' ? '!' : '⊘';

  // What's behind this row? Build a hint string so users know it's clickable.
  const hints = [];
  if (step.children?.length) hints.push(`${step.children.length} sub-step${step.children.length===1?'':'s'}`);
  if (step.request || step.response) hints.push('request');
  if (step.assertion) hints.push('assertion');
  if (step.screenshot) hints.push('screenshot');
  if (step.logs?.length) hints.push(`${step.logs.length} log${step.logs.length===1?'':'s'}`);
  if (step.body) hints.push('details');
  if (step.payload && hints.length === 0) hints.push('params');

  return (
    <div className={`step ${step.status}`}>
      <div
        className="head"
        onClick={() => hasContent && setOpen(o => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          cursor: hasContent ? 'pointer' : 'default',
          userSelect:'none',
          background: hasContent && hover ? 'var(--bg-hover)' : 'transparent',
          borderRadius: 4,
          padding: '4px 6px',
          margin: '-4px -6px',
          transition: 'background 120ms',
        }}
      >
        {/* Chevron — CSS triangle so it never depends on icon font hydration.
            Always present (12px slot) so step rows align; rendered only when expandable. */}
        <span style={{
          width:12, height:12, display:'inline-flex', alignItems:'center', justifyContent:'center',
          color: hasContent ? (open ? 'var(--fg1)' : 'var(--fg2)') : 'transparent',
          transition: 'transform 140ms, color 120ms',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 10, lineHeight: 1, fontFamily: 'var(--font-mono)',
        }}>
          {hasContent ? '▶' : ''}
        </span>
        <span className={`s-icon ${step.status}`} style={{ width:14, height:14, fontSize:9 }}>{stepIcon}</span>
        {step.type && step.type !== 'action' && (
          <span style={{ color:'var(--fg3)', display:'inline-flex', alignItems:'center' }}><StepIcon type={step.type}/></span>
        )}
        <span className="name" style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{step.name}</span>

        {/* Content hint — tells the user what's hidden behind the click.
            Only rendered when there's something useful to expand. */}
        {hasContent && hints.length > 0 && (
          <span style={{
            fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg3)',
            padding:'1px 6px', background:'var(--bg-2)', borderRadius:3,
            border:'1px solid var(--line)',
          }}>
            {hints.join(' · ')}
          </span>
        )}
        <span className="dur">{step.duration}</span>
      </div>

      {open && (
        <div style={{ marginTop:6, marginLeft:14, display:'flex', flexDirection:'column', gap:8 }}>
          {/* body / failure trace */}
          {step.body && (
            <pre style={{
              margin:0, padding:'10px 12px', background:isProblem ? 'var(--status-failed-bg)' : 'var(--bg-2)',
              border:`1px solid ${isProblem ? 'var(--status-failed-border)' : 'var(--line)'}`, borderRadius:6,
              fontFamily:'var(--font-mono)', fontSize:11.5, color: isProblem ? 'var(--status-failed-fg)' : 'var(--fg2)',
              whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.55
            }}>{step.body}</pre>
          )}

          {/* http */}
          {step.request && step.response && <HttpBlock request={step.request} response={step.response} />}

          {/* assertion */}
          {step.assertion && <AssertionBlock assertion={step.assertion} />}

          {/* screenshot */}
          {step.screenshot && <ScreenshotBlock screenshot={step.screenshot} />}

          {/* payload (DB, device, generic) */}
          {step.payload && (
            <pre style={{ margin:0, padding:'8px 12px', background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius:6, fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--fg2)', overflow:'auto' }}>{step.payload}</pre>
          )}

          {/* logs — wrapper uses --bg-sunken so it adapts to light/dark theme
              (light: pale gray strip; dark: near-black strip) and never clashes
              against the surrounding card background. */}
          {step.logs?.length > 0 && (
            <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--line)', borderRadius:6, padding:'6px 4px' }}>
              <div style={{ padding:'4px 10px', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg3)', letterSpacing:1, textTransform:'uppercase' }}>Logs · {step.logs.length}</div>
              <div style={{ background:'var(--bg-elev)', border:'1px solid var(--line)', borderRadius:4, margin:'4px', padding:'4px 0' }}>
                {step.logs.map((l,i) => <LogLine key={i} log={l}/>)}
              </div>
            </div>
          )}

          {/* children */}
          {step.children?.length > 0 && (
            <div className="children">
              <StepTreeV2 steps={step.children} depth={depth+1} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepTreeV2({ steps, depth = 0 }) {
  return (
    <div>
      {steps.map((s, i) => <StepNode key={i} step={s} depth={depth} />)}
    </div>
  );
}

Object.assign(window, {
  TestHeader, StepTreeV2, StatusPill, Tag, SeverityBadge, MetaField, CopyPath, CopyPermalink, LinkChip,
  KvMarkdown, KvSourceSnippet, KvMarker
});
