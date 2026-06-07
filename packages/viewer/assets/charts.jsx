/* global React */

// ============== TREND CHART V2 ==============
// Stacked area chart: four status bands stacked over time.
// Designed to read calm at a glance — green dominance = healthy run history.
// One axis (count). Pass-rate is implicit in the green band's share.
// Hover reveals a vertical guide + tooltip with the per-status breakdown.
function TrendChartV2({ runs }) {
  const [hoverIdx, setHover] = React.useState(null);
  const W = 760, H = 240, padL = 44, padR = 24, padT = 24, padB = 40;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const totals = runs.map(r => r.passed + r.failed + r.broken + r.skipped);
  const maxY = Math.ceil(Math.max(...totals, 8) / 4) * 4;
  const xStep = runs.length > 1 ? innerW / (runs.length - 1) : 0;
  const xAt = i => padL + i * xStep;
  const yAt = v => padT + innerH - (v / maxY) * innerH;

  // Stacking order — passed at the bottom (so it dominates visually when healthy),
  // then skipped, broken, failed at the top. Cumulative band paths.
  const ORDER = [
    { key:'passed',  color:'var(--status-passed)' },
    { key:'skipped', color:'var(--status-skipped)' },
    { key:'broken',  color:'var(--status-broken)' },
    { key:'failed',  color:'var(--status-failed)' },
  ];

  // Build cumulative top-of-band y values per run.
  const stack = runs.map(r => {
    const acc = []; let c = 0;
    ORDER.forEach(o => { c += r[o.key] || 0; acc.push(c); });
    return acc; // [yPassed, yPassed+skipped, …]
  });

  const bandPath = (bandIdx) => {
    // bottom = previous band's cumulative (or 0 for first), top = this band's cumulative
    const top = runs.map((_, i) => yAt(stack[i][bandIdx]));
    const bot = runs.map((_, i) => yAt(bandIdx === 0 ? 0 : stack[i][bandIdx - 1]));
    const fwd = runs.map((_, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${top[i]}`).join(' ');
    const back = runs.map((_, i) => `L${xAt(runs.length - 1 - i)},${bot[runs.length - 1 - i]}`).join(' ');
    return `${fwd} ${back} Z`;
  };

  // y-axis ticks — 5 nice round values
  const yTicks = [0, maxY / 4, maxY / 2, (3 * maxY) / 4, maxY];

  // Run-level summary for tooltip and "current vs previous" indicator
  const hovered = hoverIdx != null ? runs[hoverIdx] : runs[runs.length - 1];
  const hoveredTotal = hovered ? hovered.passed + hovered.failed + hovered.broken + hovered.skipped : 0;
  const hoveredPassRate = hoveredTotal ? hovered.passed / hoveredTotal : 0;
  const prevIdx = (hoverIdx ?? runs.length - 1) - 1;
  const prev = prevIdx >= 0 ? runs[prevIdx] : null;
  const prevPassRate = prev ? prev.passed / Math.max(1, prev.passed + prev.failed + prev.broken + prev.skipped) : 0;
  const passRateDelta = prev ? (hoveredPassRate - prevPassRate) * 100 : 0;

  return (
    <div>
      {/* Headline strip — current/hovered run at a glance, no reliance on chart precision */}
      <div style={{
        display:'grid', gridTemplateColumns:'1fr auto auto auto auto', gap:18,
        alignItems:'baseline', padding:'4px 4px 14px', borderBottom:'1px solid var(--line)',
        marginBottom:14,
      }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--fg3)', letterSpacing:1.2, textTransform:'uppercase' }}>
            {hoverIdx == null ? 'Current run' : `Run #${hovered.short}`}
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginTop:4 }}>
            <span style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:700, color:'var(--fg1)', letterSpacing:-0.5, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>
              {Math.round(hoveredPassRate * 100)}<span style={{ fontSize:14, color:'var(--fg3)', marginLeft:2 }}>%</span>
            </span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)' }}>pass rate</span>
            {prev && (
              <span style={{
                fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600,
                color: passRateDelta >= 0 ? 'var(--status-passed)' : 'var(--status-failed)',
                fontVariantNumeric:'tabular-nums',
              }}>
                {passRateDelta >= 0 ? '↑' : '↓'} {Math.abs(passRateDelta).toFixed(1)}pp
              </span>
            )}
          </div>
        </div>
        {ORDER.map(o => (
          <div key={o.key} style={{ textAlign:'right', minWidth:60 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, justifyContent:'flex-end', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg3)', textTransform:'uppercase', letterSpacing:0.5 }}>
              <span style={{ width:8, height:8, borderRadius:2, background:o.color }}/>{o.key}
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:600, color:'var(--fg1)', fontVariantNumeric:'tabular-nums', marginTop:2 }}>
              {hovered[o.key] || 0}
            </div>
          </div>
        ))}
      </div>

      {/* Chart canvas */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block', overflow:'visible' }} onMouseLeave={() => setHover(null)}>
        {/* y-axis gridlines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--line)" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '2 4'}/>
            <text x={padL - 10} y={yAt(t) + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--fg3)" fontVariantNumeric="tabular-nums">{t}</text>
          </g>
        ))}
        <text x={padL - 30} y={padT - 8} fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg3)" letterSpacing="1.2" textAnchor="start">TESTS</text>

        {/* stacked area bands — bottom up */}
        {ORDER.map((o, i) => (
          <path key={o.key} d={bandPath(i)} fill={o.color} fillOpacity="0.85"/>
        ))}

        {/* top edge stroke for contrast */}
        <path
          d={runs.map((_, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(stack[i][ORDER.length - 1])}`).join(' ')}
          fill="none" stroke="var(--fg1)" strokeOpacity="0.18" strokeWidth="1"
        />

        {/* hover guide */}
        {hoverIdx != null && (
          <g>
            <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={padT} y2={padT + innerH} stroke="var(--fg1)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 3"/>
            <circle cx={xAt(hoverIdx)} cy={yAt(stack[hoverIdx][ORDER.length - 1])} r="4" fill="var(--bg-elev)" stroke="var(--fg1)" strokeWidth="1.5"/>
          </g>
        )}

        {/* invisible hit-zones per run for hover */}
        {runs.map((r, i) => (
          <rect
            key={i}
            x={xAt(i) - xStep / 2}
            y={padT}
            width={xStep || innerW}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {/* x-axis tick labels */}
        {runs.map((r, i) => {
          const isHover = hoverIdx === i;
          const isLast = i === runs.length - 1;
          // sparse labels: first, last, every 2nd otherwise
          const show = i === 0 || isLast || isHover || i % 2 === 0;
          if (!show) return null;
          return (
            <text
              key={i}
              x={xAt(i)}
              y={H - padB + 16}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="10.5"
              fill={isHover || isLast ? 'var(--fg1)' : 'var(--fg3)'}
              fontWeight={isHover || isLast ? 600 : 400}
            >
              #{r.short}
            </text>
          );
        })}
        {/* "now" marker on the last run */}
        <text x={xAt(runs.length - 1)} y={H - padB + 30} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--fg3)" letterSpacing="0.5" textTransform="uppercase">now</text>

        {/* axis frame */}
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke="var(--line-strong)" strokeWidth="1"/>
      </svg>
    </div>
  );
}

// ============== TIMELINE (Gantt by suite) ==============
//
// Rows = suites (each suite groups its tests on its own row, time-axis horizontal).
// X axis = wall-clock ms since run start.
// Bars = individual tests; gaps between bars = idle time within suite.
// Hover any bar → details fill the right sidebar (no floating tooltips that overflow).
function TimelineGantt({ tests, totalMs, onOpen }) {
  const [hover, setHover] = React.useState(null);

  // group tests by suite, preserve order, map to rows
  const bySuite = {};
  tests.forEach(t => {
    if (!bySuite[t.suite]) bySuite[t.suite] = [];
    bySuite[t.suite].push(t);
  });
  const suiteRows = Object.entries(bySuite); // [[suiteName, [tests]], ...]

  const rowH = 44;
  const padL = 220, padR = 16, padT = 22, padB = 28;
  const W = 1000;
  const H = padT + suiteRows.length * rowH + padB;
  const innerW = W - padL - padR;
  const x = ms => padL + (ms / totalMs) * innerW;

  // tick spacing — aim for 6-8 evenly-spaced ticks regardless of scale, so
  // the label row stays legible whether the run is 200ms or 5min long.
  const niceStep = (max) => {
    const target = max / 7;
    const exp = Math.floor(Math.log10(target));
    const f = target / Math.pow(10, exp);
    const round = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
    return round * Math.pow(10, exp);
  };
  const tickStep = niceStep(totalMs);
  const ticks = [];
  for (let t = 0; t <= totalMs; t += tickStep) ticks.push(t);
  if (ticks[ticks.length-1] < totalMs - tickStep / 2) ticks.push(totalMs);

  // Format ticks per scale: ms below 2s, integer seconds below 10s,
  // round seconds at scale, minutes-and-seconds for very long runs.
  const fmtTick = (ms) => {
    if (totalMs < 2000)  return ms + 'ms';
    if (totalMs < 10000) return (ms / 1000).toFixed(1) + 's';
    if (totalMs < 120000) return Math.round(ms / 1000) + 's';
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return s ? `${m}m ${s}s` : `${m}m`;
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:16, alignItems:'start' }}>
      <div>
        {/* axis caption above the chart — separated from the tick row so they
            never collide. The "s" suffix on each tick already says "seconds". */}
        <div style={{
          fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg3)',
          letterSpacing:1.5, textTransform:'uppercase',
          paddingLeft: padL, marginBottom: 4,
        }}>
          Wall-clock time (s) →
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }} onMouseLeave={() => setHover(null)}>
        {/* row backgrounds */}
        {suiteRows.map(([suite,_], i) => (
          <rect key={i} x={padL} y={padT + i*rowH} width={innerW} height={rowH} fill={i%2 ? 'transparent' : 'var(--bg-2)'} fillOpacity="0.5"/>
        ))}

        {/* time gridlines */}
        {ticks.map((t,i) => (
          <line key={i} x1={x(t)} x2={x(t)} y1={padT} y2={padT + suiteRows.length*rowH} stroke="var(--line)" strokeWidth="1" opacity={t === 0 ? 0.8 : 0.5}/>
        ))}

        {/* time labels (top) */}
        {ticks.map((t,i) => (
          <text key={i} x={x(t)} y={padT - 6} textAnchor={i === 0 ? 'start' : i === ticks.length-1 ? 'end' : 'middle'} fontFamily="var(--font-mono)" fontSize="11" fill="var(--fg3)" fontVariantNumeric="tabular-nums">{fmtTick(t)}</text>
        ))}

        {/* suite labels */}
        {suiteRows.map(([suite, suiteTests], i) => (
          <g key={i}>
            <text x={padL - 12} y={padT + i*rowH + rowH/2 + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="12" fill="var(--fg1)" fontWeight="600">{suite}</text>
            <text x={padL - 12} y={padT + i*rowH + rowH/2 + 18} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg3)">{suiteTests.length} test{suiteTests.length !== 1 ? 's' : ''}</text>
          </g>
        ))}

        {/* bars */}
        {suiteRows.map(([suite, suiteTests], rowIdx) =>
          suiteTests.map((t,i) => {
            if (t.durMs === 0) return null;
            // Min bar width 10px so every bar is clickable; 3px slivers from
            // sub-100ms tests in a 60s run window are unusable on hover.
            const bx = x(t.start), bw = Math.max(10, x(t.start + t.durMs) - bx);
            const by = padT + rowIdx*rowH + 6;
            const bh = rowH - 12;
            const c = `var(--status-${t.status})`;
            const isHover = hover && hover.id === t.id;
            return (
              <g key={i} onMouseEnter={() => setHover(t)} onClick={() => onOpen?.(t)} style={{ cursor:'pointer' }}>
                <title>{`${t.name} · ${t.dur} · ${t.status}`}</title>
                <rect x={bx} y={by} width={bw} height={bh} rx="3" fill={c} fillOpacity={isHover ? 1 : 0.85} stroke={isHover ? c : 'transparent'} strokeWidth="2"/>
                {/* Centered duration label — clipped to the bar so neighboring
                    bars never get text bleed-over. Only render when the bar is
                    wide enough to host the label without truncation. */}
                {bw >= 44 && (
                  <text x={bx + bw/2} y={by + bh/2 + 4}
                    textAnchor="middle"
                    fontFamily="var(--font-mono)" fontSize="10.5" fill="#fff" fontWeight="700"
                    style={{ pointerEvents:'none' }}
                    clipPath={`inset(0 0 0 0)`}
                  >{t.dur}</text>
                )}
              </g>
            );
          })
        )}

        {/* run end marker */}
        <line x1={x(totalMs)} x2={x(totalMs)} y1={padT} y2={padT + suiteRows.length*rowH} stroke="var(--accent)" strokeWidth="2" strokeDasharray="2 2"/>
        <text x={x(totalMs)} y={padT + suiteRows.length*rowH + 18} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--accent)" fontWeight="700">RUN END</text>
      </svg>
      </div>

      {/* details sidebar */}
      <TimelineDetails test={hover} totalMs={totalMs}/>
    </div>
  );
}

function TimelineDetails({ test, totalMs }) {
  if (!test) {
    return (
      <div style={{ border:'1px solid var(--line)', borderRadius:6, padding:14, background:'var(--bg-2)' }}>
        <div className="k-overline" style={{ marginBottom:6 }}>How to read this</div>
        <div style={{ fontSize:12, color:'var(--fg2)', lineHeight:1.5 }}>
          Each row is a <b>suite</b>. Bars are the <b>tests</b> in that suite, positioned by when they started. Hover a bar for details, click to open.
        </div>
        <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:6 }}>
          <LegendDot color="var(--status-passed)" label="Passed"/>
          <LegendDot color="var(--status-failed)" label="Failed"/>
          <LegendDot color="var(--status-broken)" label="Broken"/>
          <LegendDot color="var(--status-skipped)" label="Skipped"/>
        </div>
      </div>
    );
  }
  const c = `var(--status-${test.status})`;
  const startPct = (test.start / totalMs) * 100;
  return (
    <div style={{ border:'1px solid var(--line)', borderRadius:6, padding:14, background:'var(--bg-elev)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={{ width:10, height:10, borderRadius:2, background:c }}/>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg3)', textTransform:'uppercase', letterSpacing:1 }}>{test.status}</span>
      </div>
      <div style={{ fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13, color:'var(--fg1)', marginBottom:4, wordBreak:'break-word' }}>{test.name}</div>
      <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg3)', marginBottom:10 }}>{test.suite}</div>

      <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 10px', fontFamily:'var(--font-mono)', fontSize:11.5 }}>
        <span style={{ color:'var(--fg3)' }}>started</span><span style={{ color:'var(--fg1)' }}>{(test.start/1000).toFixed(2)}s ({startPct.toFixed(0)}% in)</span>
        <span style={{ color:'var(--fg3)' }}>duration</span><span style={{ color:'var(--fg1)', fontWeight:600 }}>{test.dur}</span>
        <span style={{ color:'var(--fg3)' }}>platform</span><span style={{ color:'var(--fg1)' }}>{test.platform}</span>
        <span style={{ color:'var(--fg3)' }}>retries</span><span style={{ color:'var(--fg1)' }}>{test.retries}</span>
        <span style={{ color:'var(--fg3)' }}>severity</span><span style={{ color:'var(--fg1)' }}>{test.severity}</span>
        <span style={{ color:'var(--fg3)' }}>file</span><span style={{ color:'var(--fg1)', fontSize:10.5 }}>{test.file}</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ width:14, height:8, borderRadius:2, background:color }}/>
      <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--fg2)' }}>{label}</span>
    </div>
  );
}

// ============== RETRY WATERFALL ==============
function RetryWaterfall({ attempts }) {
  // attempts: [{ status, dur, label }]
  const max = Math.max(...attempts.map(a => a.dur));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {attempts.map((a, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 70px', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg3)' }}>attempt {i+1}</div>
          <div style={{ height: 18, background: 'var(--bg-sunken)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(a.dur/max)*100}%`, height: '100%', background: `var(--status-${a.status})`, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#fff', fontSize: 11, fontWeight: 600 }}>{a.label}</div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg2)', textAlign: 'right' }}>{(a.dur/1000).toFixed(2)}s</div>
        </div>
      ))}
    </div>
  );
}

// ============== SUITE HEATMAP ==============
function SuiteHeatmap({ suites, runs }) {
  // suites: [{name, statuses: [last N statuses]}]
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '240px repeat(' + runs + ', 1fr)', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg3)', marginBottom: 6 }}>
        <div></div>
        {[...Array(runs)].map((_,i) => <div key={i} style={{ textAlign: 'center' }}>{i === 0 ? 'oldest' : i === runs-1 ? 'latest' : ''}</div>)}
      </div>
      {suites.map((s,i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '240px repeat(' + runs + ', 1fr)', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
          {s.statuses.map((st, j) => (
            <div key={j} title={st} style={{ height: 20, borderRadius: 3, background: `var(--status-${st})`, opacity: st === 'passed' ? 0.85 : 1 }}></div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============== FLAKE-RATE SCATTER (quadrant) ==============
function FlakeScatter({ tests }) {
  const [hoverIdx, setHover] = React.useState(null);
  const [hoverPos, setHoverPos] = React.useState({ x:0, y:0 }); // chart-pixel coords inside .scatter-wrap
  const wrapRef = React.useRef(null);
  const W = 560, H = 360, padL = 56, padR = 24, padT = 24, padB = 50;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxDur = Math.max(...tests.map(t => t.avgDur));
  const x = d => padL + (d / maxDur) * innerW;
  const y = f => padT + innerH - (f * innerH);

  const flakeMid = 0.15, flakeHigh = 0.35;
  const sorted = [...tests].sort((a,b) => b.flakeRate - a.flakeRate);

  // Convert SVG coords (which scale with viewBox) to live wrapper pixels for HTML tooltip
  const svgToPx = (sx, sy) => {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    return { x: (sx / W) * r.width, y: (sy / H) * r.height };
  };

  const onPointEnter = (i) => () => {
    const t = tests[i];
    const cx = x(t.avgDur), cy = y(t.flakeRate);
    setHoverPos(svgToPx(cx, cy));
    setHover(i);
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 240px', gap:20, alignItems:'start' }}>
      <div ref={wrapRef} className="scatter-wrap" style={{ position:'relative' }} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }} preserveAspectRatio="xMidYMid meet">
          {/* quadrant fills */}
          <rect x={padL} y={padT} width={innerW} height={y(flakeHigh) - padT} fill="var(--status-failed-bg)" fillOpacity="0.6"/>
          <rect x={padL} y={y(flakeHigh)} width={innerW} height={y(flakeMid) - y(flakeHigh)} fill="var(--status-broken-bg)" fillOpacity="0.55"/>
          <rect x={padL} y={y(flakeMid)} width={innerW} height={padT + innerH - y(flakeMid)} fill="var(--status-passed-bg)" fillOpacity="0.45"/>

          {/* zone labels */}
          <text x={padL + 10} y={padT + 16} fontFamily="var(--font-mono)" fontSize="10" fill="var(--status-failed)" letterSpacing="1.5">CRITICAL ≥35%</text>
          <text x={padL + 10} y={y(flakeHigh) + 14} fontFamily="var(--font-mono)" fontSize="10" fill="var(--status-broken-fg)" letterSpacing="1.5">UNSTABLE 15–35%</text>
          <text x={padL + 10} y={y(flakeMid) + 14} fontFamily="var(--font-mono)" fontSize="10" fill="var(--status-passed)" letterSpacing="1.5">HEALTHY &lt;15%</text>

          {/* gridlines + y ticks */}
          {[0, 0.15, 0.35, 0.5, 0.75, 1].map(f => (
            <g key={f}>
              <line x1={padL} x2={padL + innerW} y1={y(f)} y2={y(f)} stroke="var(--line)" strokeWidth="1"/>
              <text x={padL - 10} y={y(f) + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="11" fill="var(--fg3)" fontVariantNumeric="tabular-nums">{Math.round(f*100)}%</text>
            </g>
          ))}
          {/* x ticks */}
          {[0, maxDur*0.25, maxDur*0.5, maxDur*0.75, maxDur].map((d,i) => (
            <g key={i}>
              <line x1={x(d)} x2={x(d)} y1={padT} y2={padT + innerH} stroke="var(--line)" strokeWidth="1" opacity={i === 0 ? 0 : 0.5}/>
              <text x={x(d)} y={padT + innerH + 16} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="var(--fg3)" fontVariantNumeric="tabular-nums">{(d/1000).toFixed(1)}s</text>
            </g>
          ))}

          {/* axis labels */}
          <text x={padL - 44} y={padT - 8} fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg3)" letterSpacing="1.5">FLAKE RATE</text>
          <text x={padL + innerW} y={padT + innerH + 36} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg3)" letterSpacing="1.5">AVG DURATION →</text>

          <line x1={padL} x2={padL + innerW} y1={padT + innerH} y2={padT + innerH} stroke="var(--line-strong)"/>
          <line x1={padL} x2={padL} y1={padT} y2={padT + innerH} stroke="var(--line-strong)"/>

          {/* points — fixed radius, no per-hover state in props (CSS handles emphasis via class) */}
          {tests.map((t,i) => {
            const cx = x(t.avgDur), cy = y(t.flakeRate);
            const c = t.flakeRate >= flakeHigh ? 'var(--status-failed)' : t.flakeRate >= flakeMid ? 'var(--status-broken)' : 'var(--status-passed)';
            const isHover = hoverIdx === i;
            return (
              <circle
                key={i}
                cx={cx} cy={cy}
                r={isHover ? 8 : 6}
                fill={c}
                fillOpacity={isHover ? 1 : 0.78}
                stroke={c}
                strokeWidth={isHover ? 2 : 1}
                style={{ cursor:'pointer', transition:'r 120ms, fill-opacity 120ms' }}
                onMouseEnter={onPointEnter(i)}
              />
            );
          })}
        </svg>

        {/* HTML tooltip — fixed pixel size, never scales with the SVG viewBox */}
        {hoverIdx !== null && (() => {
          const t = tests[hoverIdx];
          const wrap = wrapRef.current;
          const w = wrap ? wrap.getBoundingClientRect().width : W;
          const h = wrap ? wrap.getBoundingClientRect().height : H;
          // edge-aware: flip horizontally / vertically if too close to edges
          const TT_W = 196, TT_H = 50;
          let left = hoverPos.x + 14;
          let top  = hoverPos.y - TT_H - 10;
          if (left + TT_W > w - 6) left = hoverPos.x - 14 - TT_W;
          if (top < 6) top = hoverPos.y + 14;
          return (
            <div
              style={{
                position:'absolute',
                left, top,
                width: TT_W,
                pointerEvents:'none',
                background:'#0B1220',
                color:'#fff',
                border:'1px solid rgba(255,255,255,0.08)',
                borderRadius:6,
                padding:'8px 10px',
                boxShadow:'0 6px 18px rgba(0,0,0,0.35)',
                fontFamily:'var(--font-mono)',
                zIndex:10,
              }}
            >
              <div style={{ fontSize:12.5, fontWeight:700, lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.name}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.65)', marginTop:3 }}>
                {Math.round(t.flakeRate*100)}% flaky · {(t.avgDur/1000).toFixed(1)}s avg
              </div>
            </div>
          );
        })()}
      </div>

      <div>
        <div className="k-overline" style={{ marginBottom:8 }}>Worst offenders</div>
        <div style={{ border:'1px solid var(--line)', borderRadius:6, overflow:'hidden', background:'var(--bg-elev)' }}>
          {sorted.slice(0,8).map((t,i) => {
            const tIdx = tests.indexOf(t);
            const c = t.flakeRate >= flakeHigh ? 'var(--status-failed)' : t.flakeRate >= flakeMid ? 'var(--status-broken)' : 'var(--status-passed)';
            const active = hoverIdx === tIdx;
            return (
              <div
                key={i}
                onMouseEnter={() => {
                  // also reposition the tooltip near this point in the chart
                  const cx = x(t.avgDur), cy = y(t.flakeRate);
                  setHoverPos(svgToPx(cx, cy));
                  setHover(tIdx);
                }}
                onMouseLeave={() => setHover(null)}
                style={{
                  display:'grid', gridTemplateColumns:'8px 1fr auto', gap:8, padding:'8px 10px',
                  borderBottom: i < 7 ? '1px solid var(--line)' : 'none', alignItems:'center', cursor:'pointer',
                  background: active ? 'var(--bg-hover)' : 'transparent',
                  transition:'background var(--dur-fast)'
                }}
              >
                <span style={{ width:8, height:8, borderRadius:2, background:c }}/>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--fg1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:c, fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{Math.round(t.flakeRate*100)}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============== HORIZONTAL BAR CHART ==============
function HBars({ data, max }) {
  const m = max || Math.max(...data.map(d => d.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d,i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 50px', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
          <div style={{ height: 14, background: 'var(--bg-sunken)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(d.value/m)*100}%`, height: '100%', background: d.color || 'var(--brand-blue-500)', borderRadius: 3 }}></div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg2)', textAlign: 'right' }}>{d.display ?? d.value}</div>
        </div>
      ))}
    </div>
  );
}

// ============== DURATION HISTOGRAM ==============
function DurationHistogram({ buckets }) {
  const W = 720, H = 180, padL = 28, padR = 12, padT = 12, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(...buckets.map(b => b.n));
  const bw = innerW / buckets.length - 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {[0, max/2, max].map((m,i) => (
        <g key={i}>
          <line x1={padL} x2={W-padR} y1={padT + innerH - (m/max)*innerH} y2={padT + innerH - (m/max)*innerH} stroke="var(--line)" strokeDasharray="2 4"/>
          <text x={padL-6} y={padT + innerH - (m/max)*innerH + 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg3)">{Math.round(m)}</text>
        </g>
      ))}
      {buckets.map((b,i) => {
        const h = (b.n/max)*innerH;
        const x = padL + i*(innerW/buckets.length) + 2;
        return (
          <g key={i}>
            <rect x={x} y={padT + innerH - h} width={bw} height={h} fill="var(--brand-blue-500)" fillOpacity="0.85" rx="2"/>
            <text x={x+bw/2} y={H-10} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg3)">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

Object.assign(window, { TrendChartV2, TimelineGantt, RetryWaterfall, SuiteHeatmap, FlakeScatter, HBars, DurationHistogram });
