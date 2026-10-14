// Flow + backend simulation (v5). WACTO side from the flow JSON's edges, backend side from the
// REAL routes/bjpWactoRoutes.js handler (fake DB / voter roll / sender, LIVE scheme list).
// "On screen" = every WACTO node and every backend button/list message delivered so far.
// Rules on every step:
//   • a tap must be an option of a message already on screen (newest one wins, like a user)
//   • each step yields exactly ONE message in total (WACTO node + backend replies)
// Usage: node flow_sim.js <backendDir> <flow.json> <live_schemes.json>
const path = require('path');
const Module = require('module');
const fakes = require('./fakes');

const [BACKEND, FLOW, LIVE] = process.argv.slice(2).map((x) => path.resolve(x));
process.env.BJP_WACTO_WEBHOOK_KEY = 'test-key';
const fakeByFile = {
  [path.join(BACKEND, 'services', 'voterSearchService.js')]: fakes.voterSearchService,
  [path.join(BACKEND, 'services', 'wactoSender.js')]: fakes.sender,
};
for (const [n, m] of Object.entries(fakes.models)) fakeByFile[path.join(BACKEND, 'models', `${n}.js`)] = m;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  try { const f = Module._resolveFilename(request, parent, isMain); if (fakeByFile[f]) return fakeByFile[f]; } catch { /* real loader */ }
  return origLoad.apply(this, arguments);
};
const router = require(path.join(BACKEND, 'routes', 'bjpWactoRoutes.js'));
const layer = router.stack.find((l) => l.route && l.route.path === '/events');
const handler = layer.route.stack[layer.route.stack.length - 1].handle;
const { DISTRICT_ASSEMBLIES, SCHEME_TITLES } = require(path.join(BACKEND, 'constants', 'wactoFlowLabels.js'));

const flow = require(FLOW);
const N = Object.fromEntries(flow.nodes.map((n) => [n.nodeId, n]));
const nodeOpts = (n) => [...(n.data.action.sections || []).flatMap((s) => s.rows.map((r) => ({ id: 'wacto-node-option', title: r.title }))),
  ...(n.data.interactiveType === 'button' ? (n.data.action.buttons || []).map((b) => ({ id: 'wacto-node-option', title: b.reply.title })) : [])];
const live = require(LIVE).map(([id, name, k]) => ({ _id: `s${id}`, id, name, active: true, cluster: '', benefit: `Benefit line for ${name}`, keys: k.split('|') }));

const PHONE = '919000000001';
let screen = []; // { kind: 'wacto'|'backend', name, opts:[{id,title}], node? }
async function backend(msg) {
  const before = fakes.sent.length;
  const res = { sendStatus() { return this; }, status() { return this; }, json() { return this; } };
  await handler({ body: { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Sim' } }], messages: [{ from: PHONE, ...msg }] } }] }] }, query: { key: 'test-key' } }, res, () => {});
  const out = fakes.sent.slice(before);
  for (const m of out) if (m.type === 'interactive') screen.push({ kind: 'backend', name: `[backend ${m.kind}] ${m.text.split('\n')[0]}`, opts: m.options });
  return out;
}
const pushNode = (n) => screen.push({ kind: 'wacto', name: n.name, node: n, opts: nodeOpts(n) });
// WACTO model (from the v7/v8 exports): only the root keeps its own keywords; every other
// node is reached through EDGES. A tap/text with no edge on its own message is matched
// against edge keywords anywhere in the flow (that is how old-message taps work).
const byKeyword = (t) => {
  if ((N.root.keywords || []).includes(t)) return N.root;
  const targets = [...new Set(flow.edges.filter((e) => e.keywords.includes(t)).map((e) => e.toNodeId))];
  if (targets.length > 1) throw new Error(`"${t}" matches edges to ${targets.length} different nodes — WACTO's choice is ambiguous`);
  return targets.length ? N[targets[0]] : null;
};
async function step(s) {
  if (s.text !== undefined) {
    const kn = byKeyword(s.text);
    if (kn) pushNode(kn);
    return { wacto: kn ? kn.name : null, replies: await backend({ type: 'text', text: { body: s.text } }) };
  }
  const from = [...screen].reverse().find((x) => x.opts.some((o) => o.title === s.tap));
  if (!from) throw new Error(`"${s.tap}" is not on screen (last: ${screen.at(-1)?.name})`);
  const opt = from.opts.find((o) => o.title === s.tap);
  let wacto = null;
  // Live 2026-10-10 (v8b): "More Schemes →" tapped on page 2 opened page 2 — WACTO keeps ONE
  // destination per title, whichever message was tapped. A title with 2+ destinations is an error.
  const kn = byKeyword(s.tap);
  if (kn) { pushNode(kn); wacto = kn.name; }
  const kind = from.kind === 'wacto' && from.node.data.interactiveType === 'list' || (from.kind === 'backend' && from.name.includes('list')) ? 'list_reply' : 'button_reply';
  const replies = await backend({ type: 'interactive', interactive: { type: kind, [kind]: { id: opt.id, title: s.tap } } });
  return { wacto, replies };
}
function reset() { fakes.resetAll(); screen = []; fakes.models.Scheme.rows.push(...live.map((s) => ({ ...s }))); }

async function run(steps, { verbose = false } = {}) {
  reset();
  const errs = [];
  for (const s of steps) {
    let r;
    try { r = await step(s); } catch (e) { errs.push(e.message); break; }
    const total = (r.wacto ? 1 : 0) + r.replies.length;
    const what = s.text !== undefined ? `type "${s.text}"` : `tap "${s.tap}"`;
    if (verbose) console.log(`  ${what.padEnd(30)} → ${r.wacto ? `[WACTO] ${r.wacto}` : ''}${r.replies.map((m) => `[backend${m.kind ? ` ${m.kind}` : ''}] ${m.text.split('\n')[0]}${m.options ? `  {${m.options.map((o) => o.title).join(' | ')}}` : ''}`).join(' ')}`);
    if (total !== (s.n ?? 1)) errs.push(`${what}: ${total} messages (WACTO=${r.wacto || '-'}, backend=${r.replies.length})`);
    for (const re of s.re || []) if (!re.test(r.replies.map((m) => m.text).join('\n'))) errs.push(`${what}: backend reply missing ${re}`);
  }
  return errs;
}

// Titles as this flow version spells them ("More Districts →" in v8b, "More Districts (3/5)" in v8c).
const titlesOf = (name) => nodeOpts(flow.nodes.find((n) => n.name === name)).map((o) => o.title);
const moreOn = (name, prefix) => titlesOf(name).find((t) => t.startsWith(prefix));
const districtTitle = (d, k) => titlesOf(`Select District — Page ${k}/5`).find((t) => t === d || t === `${d} District`);
const districtPage = (d) => {
  for (let k = 1; k <= 5; k++) if (districtTitle(d, k)) return k;
  throw new Error(`district ${d} not on any page`);
};
const toAssembly = (d, a) => {
  const steps = [{ text: 'hi' }, { tap: 'Register' }, { tap: "I don't have EPIC" }, { text: 'Sim Person' }, { tap: 'Continue ✅' }];
  const page = districtPage(d);
  for (let k = 1; k < page; k++) steps.push({ tap: moreOn(`Select District — Page ${k}/5`, 'More Districts') });
  steps.push({ tap: districtTitle(d, page) });
  if (!titlesOf(`Assembly: ${d} p1`).includes(a)) steps.push({ tap: moreOn(`Assembly: ${d} p1`, 'More ') });
  steps.push({ tap: a });   // WACTO "What next?" via the assembly row's edge
  return steps;
};
const toWhatNextByEpic = [{ text: 'hi' }, { tap: 'Register' }, { tap: 'I have EPIC', re: [/Type your EPIC number/] }, { text: 'TNA1234567', re: [/✅ \*Voter ID found\*/, /What would you like to do\?/] }];
const schemePages = flow.nodes.filter((n) => n.name.startsWith('Select Schemes') && !n.name.includes('(')).sort((a, b) => a.name.localeCompare(b.name));
const pageRows = schemePages.map((n) => nodeOpts(n).map((o) => o.title).filter((t) => SCHEME_TITLES.includes(t)));
const moreSchemes = (i) => moreOn(schemePages[i].name, 'More Schemes');   // the "More" row ON page i (0-based)

(async () => {
  let fail = 0;
  const report = (label, errs) => { if (errs.length) { fail++; console.log(`FAIL  ${label}`); errs.slice(0, 5).forEach((e) => console.log(`        ${e}`)); } else console.log(`PASS  ${label}`); };
  const m = fakes.models;

  // 1. Every WACTO option without an edge must be one the backend answers; none may have both.
  const allAssemblies = new Set(Object.values(DISTRICT_ASSEMBLIES).flat());
  const backendLabels = new Set(['I have EPIC', 'My Registration', 'My Referral Link', 'My Members', 'Be a Volunteer', '✅ Done Selecting', 'Volunteer only']);
  // Assembly rows are backend-answered only on assembly screens (a district can share the name).
  const answeredByBackend = (n, title) => backendLabels.has(title);
  const dead = [], doubled = [];
  let noEdge = 0;
  for (const n of flow.nodes) for (const { title } of nodeOpts(n)) {
    const hasEdge = flow.edges.some((e) => e.fromNodeId === n.nodeId && e.keywords.includes(title));
    if (!hasEdge) {
      noEdge++;
      if (!answeredByBackend(n, title)) dead.push(`dead end ${n.name}: "${title}"`);
      // WACTO matches an edge-less tap against edges elsewhere: a same-titled edge would also answer it.
      else if (flow.edges.some((e) => e.keywords.includes(title))) doubled.push(`collision ${n.name}: "${title}" also matches an edge elsewhere`);
    }
    else if (answeredByBackend(n, title)) doubled.push(`double reply ${n.name}: "${title}"`);
  }
  report(`Dead-end audit: ${noEdge} WACTO options answered only by the backend, none dead, none doubled`, [...dead, ...doubled]);

  // 2. Ram's rule: after "I have EPIC", nothing can be tapped to move on until the EPIC is verified.
  report('No way past the EPIC screen without a valid EPIC (no Continue, no What-next buttons on screen)', await (async () => {
    const errs = await run([{ text: 'hi' }, { tap: 'Register' }, { tap: 'I have EPIC' }, { text: 'TNX0000000', re: [/not found/] }]);
    for (const t of ['Continue ✅', 'Pick Schemes', 'Volunteer only', 'Schemes + Volunteer']) {
      try { await step({ tap: t }); errs.push(`"${t}" was tappable before a valid EPIC`); } catch { /* correct: not on screen */ }
    }
    return errs;
  })());

  // 3. Journeys.
  const p2 = { name: pageRows[1][0] };
  report(`EPIC → What next → Pick Schemes (WACTO page 1 via edge match) → PMSBY + ${p2.name} (page 2) → Done`, await run([
    ...toWhatNextByEpic, { tap: 'Pick Schemes' }, { tap: 'PMSBY' },
    { tap: moreSchemes(0) }, { tap: p2.name },
    { tap: '✅ Done Selecting', re: [/Registration Complete/, /• PMSBY/] },
  ], { verbose: !!process.env.VERBOSE }));
  report('  └ DB: 1 User from the voter roll, 2 SchemeApplications', [
    ...(m.User.rows.length === 1 && m.User.rows[0].assemblyName === 'Palani' ? [] : ['User wrong']),
    ...(m.SchemeApplication.rows.length === 2 ? [] : [`apps=${m.SchemeApplication.rows.length}`])]);

  report('Pick → [Add more schemes] (WACTO copy of page 1) → pick → [✅ Done Selecting] button', await run([
    ...toWhatNextByEpic, { tap: 'Pick Schemes' }, { tap: 'PMSBY' },
    { tap: 'Add more schemes' }, { tap: moreSchemes(0) }, { tap: moreSchemes(1) }, { tap: 'PM Surya Ghar' },
    { tap: '✅ Done Selecting', re: [/Registration Complete/, /• PMSBY/, /• PM Surya Ghar/] },
  ], { verbose: !!process.env.VERBOSE }));
  report('  └ DB: 2 SchemeApplications', m.SchemeApplication.rows.length === 2 ? [] : [`apps=${m.SchemeApplication.rows.length}`]);
  report('No EPIC → Chennai p2 → Velachery → What next → Schemes + Volunteer → Done', await run([
    ...toAssembly('Chennai', 'Velachery'), { tap: 'Schemes + Volunteer' }, { tap: moreSchemes(0) }, { tap: 'APY' },
    { tap: '✅ Done Selecting', re: [/Registration Complete/, /Volunteer application submitted/] },
  ]));
  report('  └ DB: Velachery user, 1 application, 1 Pending volunteer request', [
    ...(m.User.rows[0]?.assemblyName === 'Velachery' && m.User.rows[0]?.voterName === 'Sim Person' ? [] : ['User wrong']),
    ...(m.SchemeApplication.rows.length === 1 ? [] : ['apps']), ...(m.BoothPresidentRequest.rows[0]?.status === 'Pending' ? [] : ['no request'])]);

  report('Returning user: My Registration / Referral / Members / Be a Volunteer / Support → Main Menu', await (async () => {
    const e1 = await run([...toWhatNextByEpic, { tap: 'Volunteer only', re: [/Volunteer application submitted/] }]);
    if (e1.length) return e1;
    screen.push({ kind: 'wacto', name: 'Root Node', node: N.root, opts: nodeOpts(N.root) });
    const errs = [];
    for (const s of [{ tap: 'My Registration', re: [/My Registration/] }, { tap: 'My Referral Link', re: [/\?ref=NT-/] },
      { tap: 'My Members', re: [/No members/] }, { tap: 'Be a Volunteer', re: [/pending/i] }, { tap: 'Support' }, { tap: 'Main Menu' }]) {
      const r = await step(s);
      const total = (r.wacto ? 1 : 0) + r.replies.length;
      if (total !== 1) errs.push(`tap "${s.tap}": ${total} messages`);
      for (const re of s.re || []) if (!re.test(r.replies.map((x) => x.text).join('\n'))) errs.push(`tap "${s.tap}": missing ${re}`);
    }
    return errs;
  })());

  // 4. Every assembly: picker → backend What next → Volunteer only saves exactly that district/assembly.
  const bad = [];
  let count = 0;
  for (const [d, list] of Object.entries(DISTRICT_ASSEMBLIES)) for (const a of list) {
    count++;
    const errs = await run([...toAssembly(d, a), { tap: 'Volunteer only', re: [/Volunteer application submitted/] }]);
    const r = m.BoothPresidentRequest.rows[0];
    if (errs.length || !r || r.district !== d || r.assemblyName !== a) bad.push(`${d} / ${a}: ${errs[0] || `saved ${r?.district}/${r?.assemblyName}`}`);
  }
  report(`All ${count} assemblies: on screen, 1 message per step, WACTO What next, saved district/assembly correct`, bad);

  // 5. Every live scheme, reached through the backend's own list pages, saves an application.
  const notOk = [];
  const savedIds = new Set();
  for (const [pi, titles] of pageRows.entries()) for (const t of titles) {
    const nav = Array.from({ length: pi }, (_, j) => ({ tap: moreSchemes(j) }));
    const errs = await run([...toWhatNextByEpic, { tap: 'Pick Schemes' }, ...nav, { tap: t }, { tap: '✅ Done Selecting', re: [/Registration Complete/] }]);
    const app = m.SchemeApplication.rows[0];
    if (errs.length || m.SchemeApplication.rows.length !== 1) notOk.push(`${t}: ${errs[0] || 'application not saved'}`);
    else savedIds.add(app.schemeId);
  }
  if (savedIds.size !== live.length) notOk.push(`distinct live schemes saved: ${savedIds.size} of ${live.length}`);
  report(`All ${pageRows.flat().length} WACTO scheme rows (live scheme list): tap → "added" → Done saves it; every live scheme covered once`, notOk);

  report('WhatsApp limits on every backend button/list message sent above', [...new Set(fakes.limitErrors)]);
  console.log(`\n${fail ? `${fail} FAILED` : 'ALL PASSED'}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SIM ERROR', e); process.exit(2); });
