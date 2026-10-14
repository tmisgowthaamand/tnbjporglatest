// Offline replay of BJP WACTO chats (v5: backend sends the EPIC prompt, "What next?" and the
// scheme lists) through the REAL routes/bjpWactoRoutes.js `/events` handler, with fake DB,
// fake voter roll and a recording WACTO sender that also checks WhatsApp limits.
// Usage: node harness.js "<BJP_Schemes/backend>" [scenarioNameFilter]
const path = require('path');
const Module = require('module');
const fakes = require('./fakes');

const BACKEND = path.resolve(process.argv[2]);
const FILTER = process.argv[3] || '';
process.env.BJP_WACTO_WEBHOOK_KEY = 'test-key';

const fakeByFile = {
  [path.join(BACKEND, 'services', 'voterSearchService.js')]: fakes.voterSearchService,
  [path.join(BACKEND, 'services', 'wactoSender.js')]: fakes.sender,
};
for (const [name, m] of Object.entries(fakes.models)) fakeByFile[path.join(BACKEND, 'models', `${name}.js`)] = m;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  try {
    const file = Module._resolveFilename(request, parent, isMain);
    if (fakeByFile[file]) return fakeByFile[file];
  } catch { /* not resolvable → let the real loader report it */ }
  return origLoad.apply(this, arguments);
};

const router = require(path.join(BACKEND, 'routes', 'bjpWactoRoutes.js'));
const layer = router.stack.find((l) => l.route && l.route.path === '/events' && l.route.methods.post);
const handler = layer.route.stack[layer.route.stack.length - 1].handle;
const SCHEMES = require(path.join(BACKEND, 'constants', 'schemes.js'));
const schemeList = Array.isArray(SCHEMES) ? SCHEMES : (SCHEMES.SCHEMES || SCHEMES.schemes || Object.values(SCHEMES).find(Array.isArray));

function seedSchemes() {
  for (const s of schemeList) fakes.models.Scheme.rows.push({ _id: `s${s.id}`, active: true, ...s });
}

const PHONE_A = '919000000001';
const PHONE_B = '919000000002';

// A tap on a backend-sent button/row carries that message's id; WACTO taps carry none of ours.
function idFor(phone, title) {
  for (let i = fakes.sent.length - 1; i >= 0; i--) {
    const m = fakes.sent[i];
    if (m.type === 'interactive' && m.phone === phone) {
      const o = m.options.find((x) => x.title === title);
      if (o) return o.id;
    }
  }
  return 'wacto-node-option';
}

function body(phone, step) {
  const msg = step.text !== undefined
    ? { from: phone, type: 'text', text: { body: step.text } }
    : step.list !== undefined
      ? { from: phone, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: idFor(phone, step.list), title: step.list } } }
      : { from: phone, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: idFor(phone, step.button), title: step.button } } };
  return { entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Test User' } }], messages: [msg] } }] }] };
}

async function send(phone, step, key = 'test-key') {
  const before = fakes.sent.length;
  const res = { statusCode: 200, sendStatus(c) { this.statusCode = c; return this; }, status(c) { this.statusCode = c; return this; }, json() { return this; } };
  await handler({ body: body(phone, step), query: key ? { key } : {}, headers: {} }, res, () => {});
  return fakes.sent.slice(before).filter((m) => m.phone.endsWith(phone.slice(-10)));
}

const NO_PII = [/Test Voter/, /Palani/, /Dindigul/];
const WHAT_NEXT = { n: 1, kind: 'button', re: [/What would you like to do\?/], opts: ['Pick Schemes', 'Volunteer only', 'Schemes + Volunteer'] };
// Default picker 'wacto': WACTO's own page 1 opens on the button title, so the backend stays silent.
const LIST1 = { n: 0 };
const BLIST1 = { n: 1, kind: 'list', re: [/Select Schemes\* \(Page 1 of 3\)/], opts: ['PMSBY', '✅ Done Selecting', 'More Schemes →'] };
const S = (label, steps, check) => ({ label, steps, check });
const epicStart = [
  { list: 'Register', n: 0 },
  { button: 'I have EPIC', n: 1, re: [/Type your EPIC number/], notButtons: true },
];

const scenarios = [
  S('I have EPIC → prompt (no button) → EPIC → What next → 2 schemes on 2 pages → Done', [
    ...epicStart,
    { text: 'tna 1234567', ...WHAT_NEXT, re: [/✅ \*Voter ID found\*/, /What would you like to do\?/], no: NO_PII },
    { button: 'Pick Schemes', ...LIST1 },
    { list: 'PMSBY', n: 0 },
    { list: 'More Schemes →', n: 0 },
    { list: 'PMJJBY', n: 0 },
    { list: '✅ Done Selecting', n: 1, re: [/Registration Complete/i, /• PMSBY/, /• PMJJBY/, /tnbjp\.org\/\?ref=NT-/], no: NO_PII },
  ], ({ User, SchemeApplication }) => {
    const u = User.rows.find((r) => r.mobile === '9000000001');
    return [
      [u && u.epicNo === 'TNA1234567' && u.district === 'Dindigul' && u.assemblyName === 'Palani' && u.boothNo === '12', 'User from voter roll'],
      [SchemeApplication.rows.length === 2, `2 SchemeApplications (got ${SchemeApplication.rows.length})`],
    ];
  }),
  S('EPIC not found / bad format → message only, NO What next', [
    ...epicStart,
    { text: 'TNX0000000', n: 1, kind: 'text', re: [/not found/i] },
    { text: 'ab', n: 1, kind: 'text', re: [/doesn't look like an EPIC/] },
    { text: 'TNA1234567', ...WHAT_NEXT },
  ]),
  S('No EPIC → name → district → assembly → What next (backend) → scheme → Done', [
    { list: 'Register', n: 0 }, { button: "I don't have EPIC", n: 0 },
    { text: 'Kavitha R', n: 1, re: [/Kavitha R/] }, { button: 'Continue ✅', n: 0 },
    { list: 'More Districts →', n: 0 }, { list: 'Madurai', n: 0 }, { list: 'Dindigul', n: 0 },
    { list: 'Palani', n: 0 },   // v8b: WACTO's assembly-row edge sends "What next?"
    { button: 'Pick Schemes', ...LIST1 },
    { list: 'PMSBY', n: 0 }, { list: '✅ Done Selecting', n: 1, re: [/Registration Complete/i] },
  ], ({ User, SchemeApplication }) => {
    const u = User.rows[0];
    return [[u && u.voterName === 'Kavitha R' && u.district === 'Dindigul' && u.assemblyName === 'Palani', 'typed name + last tapped district/assembly'],
      [SchemeApplication.rows.length === 1, '1 SchemeApplication']];
  }),
  S('Picker=list (future): backend list pages, page 3 is last, all within WhatsApp limits', [
    { do: () => { process.env.BJP_WACTO_SCHEME_PICKER = 'list'; } },
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Pick Schemes', ...BLIST1 },
    { list: 'More Schemes →', n: 1, kind: 'list', re: [/Page 2 of 3/] },
    { list: 'More Schemes →', n: 1, kind: 'list', re: [/Page 3 of 3/], notOpts: ['More Schemes →'] },
  ]),
  S('Picker=list but WACTO rejects lists (real behaviour) → typed list, numbers → Done', [
    { do: () => { process.env.BJP_WACTO_SCHEME_PICKER = 'list'; fakes.control.failLists = true; } },
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT },
    { button: 'Pick Schemes', n: 1, kind: 'text', re: [/Reply with the numbers you want/, /1\. \*PMSBY\*/] },
    { text: '1', n: 1, re: [/Added: \*PMSBY\*/] }, { text: 'done', n: 1, re: [/Registration Complete/i, /• PMSBY/] },
  ], ({ SchemeApplication }) => [[SchemeApplication.rows.length === 1, '1 application']]),
  S('Picker=typed: numbered list → "1, 2" → duplicate/invalid handled → DONE', [
    { do: () => { process.env.BJP_WACTO_SCHEME_PICKER = 'typed'; } },
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT },
    { button: 'Schemes + Volunteer', n: 1, kind: 'text', re: [/1\. \*PMSBY\*/, /23\. /, /Reply \*DONE\*/] },
    { text: '1, 2', n: 1, re: [/Added: \*PMSBY\*, \*PMJJBY\* — 2 picked/] },
    { text: '1', n: 1, re: [/already in your list/] },
    { text: '99', n: 1, re: [/between \*1\* and \*23\*/] },
    { text: 'DONE', n: 1, re: [/Registration Complete/i, /• PMSBY/, /• PMJJBY/, /Volunteer application submitted/] },
  ], ({ SchemeApplication, BoothPresidentRequest }) => [[SchemeApplication.rows.length === 2 && BoothPresidentRequest.rows.length === 1, '2 applications + volunteer request']]),
  S('Done with no scheme / duplicate pick is silent and saved once', [
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Pick Schemes', ...LIST1 },
    { list: '✅ Done Selecting', n: 1, re: [/at least one/i] },
    { list: 'PMSBY', n: 0 }, { list: 'PMSBY', n: 0 }, { button: '✅ Done Selecting', n: 1, re: [/• PMSBY/] },
  ], ({ User, SchemeApplication }) => [[User.rows.length === 1 && SchemeApplication.rows.length === 1, 'duplicate pick saved once']]),
  S('Volunteer only (EPIC path)', [
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT },
    { button: 'Volunteer only', n: 1, re: [/Volunteer application submitted/], no: NO_PII },
  ], ({ User, SchemeApplication, BoothPresidentRequest }) => [
    [User.rows.length === 1 && SchemeApplication.rows.length === 0, '1 User, no applications'],
    [BoothPresidentRequest.rows[0] && BoothPresidentRequest.rows[0].status === 'Pending', '1 Pending volunteer request'],
  ]),
  S('Schemes + Volunteer (no-EPIC, Dindigul is district AND assembly)', [
    { list: 'Register', n: 0 }, { button: "I don't have EPIC", n: 0 }, { text: 'Arun', n: 1 }, { button: 'Continue ✅', n: 0 },
    { list: 'Dindigul', n: 0 }, { list: 'Dindigul', n: 0 },
    { button: 'Schemes + Volunteer', ...LIST1 }, { list: 'PMSBY', n: 0 },
    { list: '✅ Done Selecting', n: 1, re: [/Registration Complete/i, /Volunteer application submitted/] },
  ], ({ User, SchemeApplication, BoothPresidentRequest }) => [
    [User.rows[0] && User.rows[0].assemblyName === 'Dindigul', 'assembly Dindigul'],
    [SchemeApplication.rows.length === 1 && BoothPresidentRequest.rows.length === 1, '1 application + 1 volunteer request'],
  ]),
  S('Buttons rejected by WACTO → typed 1/2/3 fallback works', [
    ...epicStart,
    { do: () => { fakes.control.failInteractive = true; } },
    { text: 'TNA1234567', n: 1, kind: 'text', re: [/Reply with a number/, /\*2\* — Volunteer only/] },
    { text: '2', n: 1, re: [/Volunteer application submitted/] },
  ], ({ BoothPresidentRequest }) => [[BoothPresidentRequest.rows.length === 1, 'volunteer request saved']]),
  S('Typed digits only count while choosing', [
    ...epicStart, { text: '2', n: 1, re: [/doesn't look like an EPIC/] },
  ], ({ BoothPresidentRequest }) => [[BoothPresidentRequest.rows.length === 0, 'no request']]),
  S('Unregistered: returning-user options + Volunteer only without location', [
    { list: 'My Registration', n: 1, re: [/not registered/i] },
    { list: 'My Referral Link', n: 1, re: [/not registered/i] },
    { list: 'My Members', n: 1, re: [/not registered/i] },
    { list: 'Be a Volunteer', n: 1, re: [/register first/i] },
    { button: 'Volunteer only', n: 1, re: [/Tap \*Register\*/] },
    { list: 'Register', n: 0 }, { button: 'I have EPIC', n: 1 },
    { button: 'Volunteer only', n: 1, re: [/First type your \*EPIC number\*/] },
  ], ({ User, BoothPresidentRequest }) => [[User.rows.length === 0 && BoothPresidentRequest.rows.length === 0, 'no writes']]),
  S('Returning user: profile, referral, members, volunteer status, re-apply', [
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Pick Schemes', ...LIST1 },
    { list: 'PMSBY', n: 0 }, { list: '✅ Done Selecting', n: 1 },
    { list: 'My Registration', n: 1, re: [/PMSBY/, /Palani/] },
    { list: 'My Referral Link', n: 1, re: [/tnbjp\.org\/\?ref=NT-/] },
    { list: 'My Members', n: 1, re: [/No members/] },
    { list: 'Be a Volunteer', n: 1, re: [/submitted/i] }, { list: 'Be a Volunteer', n: 1, re: [/pending/i] },
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Pick Schemes', ...LIST1 },
    { list: 'PMSBY', n: 0 }, { list: '✅ Done Selecting', n: 1, re: [/already/i] },
  ], ({ User, SchemeApplication, BoothPresidentRequest }) => [
    [User.rows.length === 1 && SchemeApplication.rows.length === 1 && BoothPresidentRequest.rows.length === 1, 'no duplicates'],
  ]),
  S('Approved volunteer is not reset to Pending', [
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Volunteer only', n: 1 },
    { do: (m) => { m.BoothPresidentRequest.rows[0].status = 'Approved'; } },
    { list: 'Be a Volunteer', n: 1, re: [/approved volunteer/i] },
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Volunteer only', n: 1, re: [/approved volunteer/i] },
  ], ({ BoothPresidentRequest }) => [[BoothPresidentRequest.rows[0].status === 'Approved', 'stays Approved']]),
  S('Old v4 messages still safe: WACTO scheme row by title, Continue before EPIC', [
    { list: 'Register', n: 0 }, { button: 'Continue ✅', n: 1, re: [/haven't received a valid EPIC/] },
    { list: 'PMSBY', n: 0 },
  ]),
  S('Chit-chat and WACTO-answered taps stay quiet', [
    { text: 'hi', n: 0 }, { text: 'thanks', n: 0 }, { list: 'Support', n: 0 }, { button: 'Main Menu', n: 0 },
    { list: 'Register', n: 0 }, { button: "I don't have EPIC", n: 0 }, { list: 'More Districts →', n: 0 }, { list: 'Salem', n: 0 },
  ]),
  S('Two users at once do not mix sessions', [
    { list: 'Register', n: 0 }, { phone: PHONE_B, list: 'Register', n: 0 },
    { button: 'I have EPIC', n: 1 }, { phone: PHONE_B, button: "I don't have EPIC", n: 0 },
    { text: 'TNA1234567', ...WHAT_NEXT }, { phone: PHONE_B, text: 'Second Person', n: 1, re: [/Second Person/] },
    { button: 'Pick Schemes', ...LIST1 }, { list: 'PMSBY', n: 0 }, { list: '✅ Done Selecting', n: 1 },
  ], ({ User }) => [[User.rows.length === 1 && User.rows[0].voterName === 'Test Voter', 'only user A registered']]),
  S('Request without the webhook key is ignored', [
    { text: 'TNA1234567', n: 0, key: null }, { list: 'My Registration', n: 0, key: 'wrong' },
  ], ({ User }) => [[User.rows.length === 0, 'no writes']]),
  S('Allowlist: only listed numbers get answers', [
    { do: () => { process.env.BJP_WACTO_ALLOWLIST = '+91 90000 00002'; } },
    { list: 'My Registration', n: 0 },
    { phone: PHONE_B, list: 'My Registration', n: 1, re: [/not registered/i] },
    { do: () => { delete process.env.BJP_WACTO_ALLOWLIST; } },
    { list: 'My Registration', n: 1 },
  ]),
  S('Picker=list: after a pick, [✅ Done Selecting] button finishes', [
    { do: () => { process.env.BJP_WACTO_SCHEME_PICKER = 'list'; } },
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Pick Schemes', ...BLIST1 },
    { list: 'PMSBY', n: 1, kind: 'button', opts: ['Add more schemes', '✅ Done Selecting'] },
    { button: 'Add more schemes', n: 1, kind: 'list', re: [/Page 1 of 3/] },
    { list: 'PMJJBY', n: 1, kind: 'button', opts: ['Add more schemes', '✅ Done Selecting'], re: [/Picked so far \(2\)/] },
    { list: 'PMJJBY', n: 1, kind: 'button', opts: ['Add more schemes', '✅ Done Selecting'], re: [/already in your list/, /Picked so far \(2\)/] },
    { button: '✅ Done Selecting', n: 1, re: [/Registration Complete/i, /• PMSBY/, /• PMJJBY/] },
  ], ({ SchemeApplication }) => [[SchemeApplication.rows.length === 2, '2 applications']]),
  S('Picker=list, pick buttons rejected → text prompt still tells how to finish', [
    { do: () => { process.env.BJP_WACTO_SCHEME_PICKER = 'list'; } },
    ...epicStart, { text: 'TNA1234567', ...WHAT_NEXT }, { button: 'Pick Schemes', ...BLIST1 },
    { do: () => { fakes.control.failInteractive = true; } },
    { list: 'PMSBY', n: 1, kind: 'text', re: [/Picked so far \(1\)/, /tap \*✅ Done Selecting\*/] },
  ]),
  S('Older flows (no assembly edge): BJP_WACTO_ASSEMBLY_WHATNEXT=backend → backend sends What next', [
    { do: () => { process.env.BJP_WACTO_ASSEMBLY_WHATNEXT = 'backend'; } },
    { list: 'Register', n: 0 }, { button: "I don't have EPIC", n: 0 }, { text: 'Arun', n: 1 }, { button: 'Continue ✅', n: 0 },
    { list: 'Dindigul', n: 0 }, { list: 'Palani', ...WHAT_NEXT },
    { do: () => { delete process.env.BJP_WACTO_ASSEMBLY_WHATNEXT; } },
  ]),
  S('v8c labels: "Dindigul District" then assembly "Dindigul"; "Salem District" → Omalur; paging titles stay quiet', [
    { list: 'Register', n: 0 }, { button: "I don't have EPIC", n: 0 }, { text: 'Arun', n: 1 }, { button: 'Continue ✅', n: 0 },
    { list: 'More Districts (2/5)', n: 0 }, { list: 'Dindigul District', n: 0 }, { list: 'Dindigul', n: 0 },
    { list: 'More in Dindigul →', n: 0 }, { button: 'Volunteer only', n: 1, re: [/Volunteer application submitted/] },
    { list: 'Register', n: 0 }, { button: "I don't have EPIC", n: 0 }, { text: 'Meena', n: 1 }, { button: 'Continue ✅', n: 0 },
    { list: 'Salem District', n: 0 }, { list: 'Omalur', n: 0 }, { button: 'Pick Schemes', n: 0 },
    { list: 'More Schemes (2/4)', n: 0 }, { list: 'PMSBY', n: 0 }, { button: '✅ Done Selecting', n: 1, re: [/Registration Complete/i] },
  ], ({ BoothPresidentRequest, SchemeApplication, User }) => [
    [BoothPresidentRequest.rows[0] && BoothPresidentRequest.rows[0].district === 'Dindigul' && BoothPresidentRequest.rows[0].assemblyName === 'Dindigul', 'volunteer saved as Dindigul / Dindigul (no " District")'],
    [User.rows.length === 1 && SchemeApplication.rows.length === 1, 'same user, 1 application'],
  ]),
];

(async () => {
  let pass = 0, fail = 0;
  for (const sc of scenarios.filter((s) => s.label.includes(FILTER))) {
    fakes.resetAll(); seedSchemes(); delete process.env.BJP_WACTO_SCHEME_PICKER;
    const limitsBefore = fakes.limitErrors.length;
    const errs = [];
    for (const [i, st] of sc.steps.entries()) {
      if (st.do) { st.do(fakes.models); continue; }
      const phone = st.phone || PHONE_A;
      const replies = await send(phone, st, 'key' in st ? st.key : 'test-key');
      const what = st.text !== undefined ? `type "${st.text}"` : `tap "${st.list ?? st.button}"`;
      if (process.env.VERBOSE) {
        console.log(`  » ${what}`);
        replies.forEach((r) => console.log(`    ↳ [${r.kind || r.type}] ${r.text.split('\n').join('\n      ')}${r.options ? `\n      [${r.options.map((o) => o.title).join(' | ')}]` : ''}`));
      }
      if (replies.length !== st.n) errs.push(`step ${i + 1} ${what}: expected ${st.n} backend repl${st.n === 1 ? 'y' : 'ies'}, got ${replies.length}`);
      const joined = replies.map((r) => r.text).join('\n');
      for (const re of st.re || []) if (replies.length && !re.test(joined)) errs.push(`step ${i + 1} ${what}: reply missing ${re}`);
      for (const re of st.no || []) if (re.test(joined)) errs.push(`step ${i + 1} ${what}: reply LEAKS ${re}`);
      if (st.kind && replies[0] && (replies[0].kind || replies[0].type) !== st.kind) errs.push(`step ${i + 1} ${what}: expected a ${st.kind} message, got ${replies[0].kind || replies[0].type}`);
      if (st.notButtons && replies.some((r) => r.type === 'interactive')) errs.push(`step ${i + 1} ${what}: must not carry buttons`);
      const titles = replies.flatMap((r) => (r.options || []).map((o) => o.title));
      for (const o of st.opts || []) if (!titles.includes(o)) errs.push(`step ${i + 1} ${what}: option "${o}" missing`);
      for (const o of st.notOpts || []) if (titles.includes(o)) errs.push(`step ${i + 1} ${what}: option "${o}" must not appear`);
    }
    for (const [ok, msg] of sc.check ? sc.check(fakes.models) : []) if (!ok) errs.push(`DB: ${msg}`);
    errs.push(...fakes.limitErrors.slice(limitsBefore).map((e) => `WhatsApp limit: ${e}`));
    if (errs.length) { fail++; console.log(`FAIL  ${sc.label}`); errs.slice(0, 5).forEach((e) => console.log(`        ${e}`)); }
    else { pass++; console.log(`PASS  ${sc.label}`); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
