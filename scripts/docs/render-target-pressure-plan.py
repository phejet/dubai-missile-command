"""Render the review plan as a dependency-free HTML companion with explanatory diagrams."""
from pathlib import Path
import html
import re

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/target-pressure-review-plan.md'
OUTPUT = SOURCE.with_suffix('.html')

def inline(s):
    s = html.escape(s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)

def figure(title, content, caption):
    return f'<figure><div class="figure-title">{title}</div>{content}<figcaption>{caption}</figcaption></figure>'

def steps(items, cls=''):
    return '<ol class="flow '+cls+'">'+''.join(f'<li><b>{a}</b><span>{b}</span></li>' for a,b in items)+'</ol>'

def routes():
    def panel(clear):
        path = 'M 370 25 L 370 209' if clear else 'M 42 25 L 370 209'
        col = '#167560' if clear else '#ba4934'
        label = 'Clear building approach' if clear else 'Building aim, tower crossing'
        return f'''<div class="route-panel"><h4>{label}</h4><svg viewBox="0 0 440 270" role="img" aria-label="{label}">
        <path d="M20 235 H420" stroke="#b9c2cc"/><path d="M196 235 L202 146 L211 146 L218 57 L225 146 L234 146 L241 235Z" fill="#253b55"/>
        <rect x="345" y="210" width="50" height="25" fill="#167560"/><rect x="45" y="220" width="45" height="15" fill="#607ca5"/>
        <path d="{path}" stroke="{col}" stroke-width="3" stroke-dasharray="7 5" fill="none"/>
        <circle cx="{370 if clear else 42}" cy="25" r="6" fill="{col}"/>
        {'' if clear else '<circle cx="218" cy="124" r="13" fill="none" stroke="#ba4934" stroke-width="3"/>'}
        <text x="218" y="257" text-anchor="middle">Burj</text><text x="370" y="257" text-anchor="middle">Building</text><text x="66" y="257" text-anchor="middle">Defense</text>
        </svg><p>{'Counts as building pressure.' if clear else 'Counts against the tower allowance.'}</p></div>'''
    return figure('01 / Destination is not the same as exposure', '<div class="route-grid">'+panel(False)+panel(True)+'</div>', 'Schematic only; not game coordinates or a proposed spawn location. Final feasibility uses the actual collision silhouette, movement and reaction time.')

def drone_trajectories():
    skyline = """<path d="M15 302H365" stroke="#b9c2cc"/>
      <path d="M175 302L178 220L185 220L191 119L196 220L204 220L209 302Z" fill="#253b55"/>
      <rect x="94" y="270" width="46" height="32" fill="#167560"/><rect x="297" y="270" width="46" height="32" fill="#167560"/>
      <path d="M52 302V286H77V302M58 286V279H72V286" fill="#607ca5"/>
      <text x="117" y="327" text-anchor="middle">Near building</text><text x="192" y="348" text-anchor="middle">Burj</text><text x="321" y="327" text-anchor="middle">Far building</text>"""
    def drone(x,y,rotation=0):
        return f'<g transform="translate({x} {y}) rotate({rotation})"><path d="M14 0L-7 -5L-11 -15L-15 -15L-12 -3L-18 -3L-18 3L-12 3L-15 15L-11 15L-7 5Z" fill="#23577b" stroke="white" stroke-width="1.5"/></g>'
    scenes = [
      ('A · Early dive to a nearby building',
       '<path d="M20 65H90Q117 65 119 101" stroke="#23577b"/><path d="M119 101C125 150 117 206 117 267" stroke="#167560"/>',
       drone(45,65)+drone(121,157,90),
       '<circle cx="119" cy="101" r="7" fill="#bd641d"/><text x="17" y="35">Cruise →</text><text x="18" y="132">Commit + bank</text><text x="28" y="211">Dive ↓</text>',
       'The drone peels off before the tower. Its bank reveals the nearby building as the target.'),
      ('B · Cross the skyline, then dive',
       '<path d="M20 65H277Q320 65 320 105" stroke="#23577b"/><path d="M320 105C324 160 320 210 320 267" stroke="#167560"/>',
       drone(64,65)+drone(243,65)+drone(322,166,90),
       '<circle cx="320" cy="105" r="7" fill="#bd641d"/><text x="16" y="35">Cruise above the tower →</text><text x="226" y="140">Commit + bank</text><text x="269" y="221">Dive ↓</text>',
       'The drone clears the tower before turning down. The far-side destination changes where its dive starts.'),
      ('C · A deliberate tower attack',
       '<path d="M20 65H112Q139 65 151 90" stroke="#23577b"/><path d="M151 90C170 118 177 162 185 213" stroke="#ad402d"/>',
       drone(51,65)+drone(172,150,72),
       '<circle cx="151" cy="90" r="7" fill="#bd641d"/><text x="17" y="35">Cruise →</text><text x="206" y="98">Commit to Burj</text><text x="219" y="183">Tower budget</text>',
       'A planned tower dive consumes tower allowance. It is not disguised as an attack on another asset.'),
      ('D · The route we must reject',
       '<path d="M20 65H81Q107 65 122 96" stroke="#23577b"/><path d="M122 96Q190 207 320 267" stroke="#ad402d"/>',
       drone(49,65),
       '<circle cx="122" cy="96" r="7" fill="#bd641d"/><circle cx="188" cy="186" r="15" fill="none" stroke="#ad402d" stroke-width="3"/><text x="17" y="35">Turns down too early</text><text x="210" y="174">Tower crossing</text>',
       'A far-building aim is insufficient. If the curve crosses the tower, construct a different continuation before commitment.')
    ]
    panels=[]
    for title,paths,icons,labels,caption in scenes:
        panels.append(f'<div class="route-panel"><h4>{title}</h4><svg viewBox="0 0 380 365" role="img" aria-label="{title}">{skyline}<g fill="none" stroke-width="3" stroke-dasharray="4 7" stroke-linecap="round">{paths}</g>{icons}{labels}</svg><p>{caption}</p></div>')
    return figure('07b / Drone flight paths — four worked sketches', '<div class="route-grid">'+''.join(panels)+'</div>', 'Illustrative side views, not validated game paths. Blue dotted lines = cruise; green = clear non-tower dive; red = tower exposure; amber dot = visible commitment. Repeated drone silhouettes show successive positions of ONE drone, not a formation. Right-entry approaches mirror these ideas. Exact clearance, turning limits and warning time remain to be specified.')

visuals = {
'1. Player outcome and scope': routes(),
'2. Evidence and current behavior': figure('02 / What the replay routes actually threaten', '''<div class="bar" aria-label="57.5 percent aimed at tower, 17.0 percent crossing tower, 25.4 percent clear"><span class="tower" style="flex:1196">57.5%</span><span class="cross" style="flex:354">17.0%</span><span class="clear" style="flex:529">25.4%</span></div><div class="legend"><span><i class="tower"></i>1,196 tower aims</span><span><i class="cross"></i>354 incidental crossings</span><span><i class="clear"></i>529 clear routes</span></div><p class="big-insight">74.6% <span>of ordinary missile routes threatened the tower geometrically.</span></p>''', 'Historical cohort: 2,079 ordinary missiles across 26 human runs. 1,550 / 2,079 = 74.6%; independently rounded segments total 99.9%. Exposure is not actual damage. Stage A must preserve and reproduce the discussion calculations.'),
'Meaning of the tuning values': figure('03 / Proposed effective allocation', '''<div class="bar"><span class="tower" style="flex:30">30%</span><span class="clear" style="flex:50">50%</span><span class="infra" style="flex:20">20%</span></div><div class="allocation"><div><b>Tower</b><p>Protect the run.</p></div><div><b>City buildings</b><p>Preserve future bonuses.</p></div><div><b>Combat infrastructure</b><p>Preserve defensive capability.</p></div></div><div class="wave-strip"><span>Wave 1<br><b>30 / 50 / 20</b></span><span>Wave 5<br><b>30 / 50 / 20</b></span><span>Wave 10<br><b>30 / 50 / 20</b></span></div>''', 'Starting targets for review, not calibrated balance. The policy stays fixed across waves; accounting resets each wave. Small samples vary. Destination and tower exposure remain separate audit fields.'),
'Planning and correction': figure('04 / Budget the final route before it becomes visible', steps([
('Allocate','Read commander side, threat family and shared reserved pressure.'),('Construct','Missile: reachable flank pool. Drone: cruise and feasible dive continuation.'),('Classify','Check the final path against tower collision geometry.'),('Resolve','Over allowance? Construct a clear non-tower alternative.'),('Commit','Record the allocation and reveal a dependable route.')])+ '<div class="callout">Correction happens before commitment. A visible missile does not change its mind to repair the percentage.</div>', 'Bounded construction, not repeated random rerolls. Infeasible routes use an explicit fallback; they do not silently become tower attacks.'),
'Accounting: decisions to settle before implementation': figure('05 / One allocation, one lifecycle', steps([
('Reserve','Plan terminal bodies, including split descendants.'),('Commit / release','Distinguish bodies that actually launch from unused reservations.'),('Resolve','Record interception, impact, exit or wave end.')])+'''<div class="split-grid"><div><b>Carrier → children</b><p>Transfer the planned allocation. Do not count the carrier and its replacement children twice.</p></div><div><b>Player interception</b><p>Keep committed history. Do not spawn compensation attacks or refund tower pressure.</p></div></div><p class="pending">OPEN CONTRACT: child cancellation, carrier exposure, skipped bombs and denominator rules must be settled in Stage B.</p>''', 'Conceptual lifecycle, not an approved accounting algorithm. Reserved attacks are not evidence that those attacks actually appeared.'),
'Geometry and exhausted categories': figure('06 / Explicit fallback when targets disappear', steps([
('Preferred category','Choose a living asset with a valid approach.'),('Other non-tower assets','If that category is empty, redistribute here first.'),('Only the Burj remains','Declare the tower-only exception; report it separately.')])+ '<p class="pending">Already committed? Keep the route even if its destination is destroyed.</p>', 'Proposed fallback order. A conflict between commander tactics and safe geometry must also be surfaced and resolved explicitly.'),
'Shahed behavior': figure('07 / Uncertainty, then a readable commitment', steps([
('Cruise','Reserve a category. Final destination is not yet revealed.'),('Commit + tell','Choose a living asset and clear dive path. Show a visible bank.'),('Dive','Accelerate along the committed route. No further retargeting.')])+ '<div class="choice"><b>Player choice</b><span>Shoot early to remove uncertainty</span><em>or</em><span>Wait for the tell and defend the higher-value asset</span></div>', 'Separate drone implementation slice, followed by combined verification and feel-check. Propeller and jet variants need individual timing checks; this diagram sets no timing constants.'),
'4. Execution stages and handoffs': figure('08 / Work passes through evidence and human gates', steps([
('A · Analysis AI','Reproduce baseline evidence.'),('B · Design + review AI','Freeze the accounting and route contract.'),('C · Implementation AI','Build shared accounting and missile flank pools.'),('D · Implementation AI','Add drone cruise/commit/dive routing.'),('E · Independent AI','Verify the combined implementation.'),('F · You','Feel-check both threat families together.'),('G · Coordinating AI','Document results and remaining limitations.')], 'execution')+'<div class="callout">Routing direction agreed → settle remaining contract decisions → write the detailed AI execution handoff. No implementation has started.</div>', 'Stages are sequential gates. E returns defects to C/D; F checks the combined experience. Different sessions may own different stages.'),
'5. Verification and acceptance': figure('09 / Three different kinds of proof', '<div class="split-grid three"><div><b>Geometry</b><p>Does the actual simulated path match its exposure classification?</p></div><div><b>Determinism</b><p>Do replay, save/load and seeking preserve allocation state?</p></div><div><b>Player decisions</b><p>Can you read the danger, choose an asset and accept a deliberate sacrifice?</p></div></div>', 'Automated checks establish correctness. Human play establishes whether the choices feel fair and worthwhile.')
}

visuals['Shahed behavior'] += drone_trajectories()

lines=SOURCE.read_text().splitlines(); body=[]; i=0; toc=[]
while i<len(lines):
    line=lines[i]
    if not line.strip(): i+=1; continue
    if line.startswith('# '): i+=1; continue
    if line.startswith('##'):
        level=len(line)-len(line.lstrip('#')); title=line[level:].strip(); anchor=re.sub(r'[^a-z0-9]+','-',title.lower()).strip('-')
        body.append(f'<h{level} id="{anchor}">{inline(title)}</h{level}>')
        if level==2: toc.append((anchor,title))
        body.append(visuals.get(title,'')); i+=1;continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].startswith('|'):
            cells=[c.strip() for c in lines[i].strip('|').split('|')]
            if not all(re.fullmatch(r'[-: ]+',c) for c in cells): rows.append(cells)
            i+=1
        body.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th scope="col">'+inline(c)+'</th>' for c in rows[0])+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in r)+'</tr>' for r in rows[1:])+'</tbody></table></div>');continue
    if re.match(r'^(?:- |\d+\. )',line):
        numbered=bool(re.match(r'^\d+\.',line));tag='ol' if numbered else 'ul';items=[]
        while i<len(lines) and re.match(r'^(?:- |\d+\. )',lines[i]):
            text=re.sub(r'^(?:- |\d+\. )','',lines[i]);i+=1
            while i<len(lines) and lines[i].startswith('  '): text+=' '+lines[i].strip();i+=1
            items.append('<li>'+inline(text)+'</li>')
        body.append('<'+tag+'>'+''.join(items)+'</'+tag+'>');continue
    paragraph=[]
    while i<len(lines) and lines[i].strip() and not re.match(r'^(?:#|\||- |\d+\. )',lines[i]): paragraph.append(lines[i].strip());i+=1
    body.append('<p>'+inline(' '.join(paragraph))+'</p>')

css='''
:root{--ink:#203248;--muted:#526173;--line:#d9dfe5;--paper:#fff;--bg:#f3f1eb;--tower:#ad402d;--clear:#167560;--infra:#3f648f;--cross:#bd641d}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;color:var(--ink);background:var(--bg);font:17px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#23577b;text-underline-offset:3px}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #bf611d;outline-offset:4px}header{background:#203248;color:white;padding:64px max(24px,calc((100vw - 1120px)/2)) 48px}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:12px;color:#bfd0dd;font-weight:700}h1{font-size:clamp(36px,5vw,62px);line-height:1.08;max-width:850px;letter-spacing:-.045em;margin:18px 0}header p{max-width:780px;color:#d9e3ed;font-size:19px}.badge{display:inline-block;border:1px solid #a6b7c9;border-radius:4px;padding:5px 10px;font-size:12px;letter-spacing:.07em}header a{color:white}.layout{max-width:1190px;margin:auto;padding:35px;display:grid;grid-template-columns:200px minmax(0,1fr);gap:35px}nav{position:sticky;top:24px;align-self:start;font-size:13px}nav p{font-weight:700}nav a{display:block;padding:9px 0;border-bottom:1px solid var(--line);text-decoration:none}main{min-width:0}h2{margin:65px 0 22px;font-size:29px;line-height:1.25;letter-spacing:-.025em;border-top:2px solid var(--ink);padding-top:20px}h3{font-size:22px;line-height:1.3;margin-top:40px}h4{margin:0;font-size:15px}p{margin:15px 0}li{margin:10px 0}code{font: .86em ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere;background:#e9edf0;padding:2px 4px;border-radius:3px}figure{margin:25px 0;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:24px;box-shadow:0 3px 15px #20324805}.figure-title{text-transform:uppercase;font-size:11px;letter-spacing:.09em;font-weight:800;margin-bottom:22px}figcaption{font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;margin-top:22px}.route-grid,.split-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.route-panel svg{width:100%;display:block}svg text{font:14px system-ui;fill:#203248}.route-panel p{font-size:13px;margin:0}.bar{display:flex;min-height:54px;border-radius:6px;overflow:hidden;color:#fff;font-weight:750;font-size:17px}.bar span{display:flex;align-items:center;justify-content:center}.tower{background:var(--tower)}.clear{background:var(--clear)}.cross{background:var(--cross)}.infra{background:var(--infra)}.legend{display:flex;flex-wrap:wrap;gap:9px 20px;font-size:12px;margin-top:15px}.legend i{display:inline-block;width:9px;height:9px;margin-right:6px}.big-insight{font-size:42px;font-weight:750;line-height:1.2;margin:26px 0 8px}.big-insight span{font-size:17px;font-weight:450;display:block;margin-top:9px}.allocation{display:grid;grid-template-columns:30fr 50fr 20fr;gap:12px;margin-top:15px;font-size:13px}.allocation p{margin:4px 0}.wave-strip{display:flex;gap:12px;margin-top:24px}.wave-strip span{flex:1;border:1px solid var(--line);border-top:3px solid var(--infra);padding:12px;text-align:center;font-size:12px}.flow{list-style:none;padding:0;counter-reset:step;display:grid;gap:19px;margin:0}.flow li{position:relative;background:#f1f4f6;border:1px solid #dbe2e8;padding:13px 16px 13px 48px;border-radius:6px;margin:0;counter-increment:step;font-size:14px}.flow li:before{content:counter(step);position:absolute;left:16px;top:13px;color:#526173;font-size:13px;font-weight:700}.flow li:not(:last-child):after{content:"↓";position:absolute;bottom:-22px;left:23px;color:#63788d;font-size:19px}.flow b{display:block}.flow span{display:block;color:var(--muted)}.callout{border-left:3px solid var(--infra);padding:11px 14px;background:#edf2f7;margin-top:22px;font-size:14px}.split-grid{margin-top:22px}.split-grid>div{border-top:3px solid var(--infra);padding-top:12px;font-size:14px}.split-grid p{margin:8px 0}.pending{color:#885215;font-size:13px;border:1px solid #d9c3a5;padding:12px;border-radius:4px}.choice{margin-top:24px;display:flex;flex-wrap:wrap;gap:10px 16px;font-size:14px}.choice b{flex-basis:100%}.choice em{color:var(--muted)}.three{grid-template-columns:repeat(3,1fr)}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:6px;margin:25px 0}table{border-collapse:collapse;width:100%;font-size:14px;background:white}th,td{text-align:left;vertical-align:top;padding:13px;border-bottom:1px solid var(--line)}th{background:#e7edf2}td:first-child{font-weight:650;min-width:135px}footer{max-width:1120px;margin:30px auto;padding:25px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}.companion{background:#e5ecef;padding:14px 18px;font-size:14px;border-radius:5px}.top-tools{display:flex;gap:20px;align-items:center;flex-wrap:wrap;font-size:14px;margin-top:26px}button{font:inherit;color:white;background:transparent;border:1px solid #9eb0c4;border-radius:4px;padding:7px 12px;cursor:pointer}@media(max-width:850px){.layout{display:block;padding:24px}nav{position:static;display:flex;flex-wrap:wrap;gap:5px 15px;margin-bottom:28px}nav p{flex-basis:100%;margin:0}nav a{border:0;padding:4px 0}header{padding:40px 24px}h2{margin-top:45px}}@media(max-width:540px){body{font-size:16px}.layout{padding:18px}figure{padding:17px}.route-grid,.split-grid,.three{grid-template-columns:1fr}.route-panel+ .route-panel{border-top:1px solid var(--line);padding-top:18px}.allocation{grid-template-columns:1fr}.allocation>div{border-bottom:1px solid var(--line);padding-bottom:8px}.allocation p{display:inline}.allocation b{display:block}.bar{font-size:14px}.wave-strip{gap:5px}.wave-strip span{padding:9px 3px;font-size:11px}.table-wrap table{min-width:560px}h2{font-size:25px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{body{background:#fff;font-size:10pt}header{background:white;color:var(--ink);padding:12px 0}header p,.eyebrow{color:var(--muted)}header a{color:var(--ink)}h1{font-size:30pt}.layout{display:block;padding:0}nav,.top-tools{display:none}figure{break-inside:avoid;box-shadow:none}h2,h3{break-after:avoid}.bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}footer{margin:10px 0}.table-wrap{overflow:visible}table{font-size:9pt}}
'''
nav=''.join(f'<a href="#{a}">{html.escape(t)}</a>' for a,t in toc)
OUTPUT.write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Effective target pressure — review plan</title><style>'''+css+'''</style></head><body><header><div class="eyebrow">Dubai Missile Command · Design review · 20 September 2026</div><h1>Make every defense<br>decision matter.</h1><p>Budget the attacks that actually threaten the tower. Give buildings and combat infrastructure a meaningful share of the battle.</p><span class="badge">ROUTING AGREED · CONTRACT UNDER REVIEW</span><div class="top-tools"><a href="#6-review-decisions-requested">Jump to review decisions ↓</a><a href="target-pressure-review-plan.md">Markdown source</a><button type="button" onclick="window.print()">Print / save PDF</button></div></header><div class="layout"><nav aria-label="Plan sections"><p>In this plan</p>'''+nav+'''</nav><main><div class="companion">Illustrated companion to the review plan. Missile flank pools and drone cruise/commit/dive routing are agreed. Numerical defaults and unresolved contract decisions remain proposals. <a href="../ROADMAP.html#rm-09">ROADMAP.html</a> remains the source of product status.</div>'''+''.join(body)+'''</main></div><footer>Self-contained HTML · Ten diagrams · No external fonts, libraries or network requests.<br>Generated from <a href="target-pressure-review-plan.md">the Markdown review plan</a> with <code>scripts/docs/render-target-pressure-plan.py</code>. Regenerate after source edits.</footer></body></html>''')
print(OUTPUT)
