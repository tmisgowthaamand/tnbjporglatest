/**
 * BJP Nalam Thittam — WACTO Chatbot JSON Generator
 *
 * Produces a complete chatbot JSON ready to import into the WACTO builder.
 *
 * Flow:
 *   Root (main menu)
 *   ├── Register for Schemes → EPIC Ask (Schemes)
 *   │   └── I don't have EPIC → District Pages → Assemblies → Scheme Pages
 *   ├── Register as Volunteer → EPIC Ask (Volunteer)
 *   │   └── I don't have EPIC → District Pages (shared) → Assemblies
 *   ├── My Registration → backend handled
 *   ├── My Referral Link → backend handled
 *   ├── My Members → backend handled
 *   ├── Be a Volunteer → backend handled
 *   └── Support → static node
 *
 * Run:  node scripts/generate_bjp_wacto_flow.js
 * Output: output/bjp_nalam_thittam_wacto.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uid = () => crypto.randomUUID();

// ── Districts & Assemblies (from EDMS chatbot, same for all TN flows) ──────────
const DISTRICTS_PAGE1 = ['Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dharmapuri', 'Dindigul', 'Erode', 'Kallakurichi'];
const DISTRICTS_PAGE2 = ['Kanchipuram', 'Kanyakumari', 'Karur', 'Krishnagiri', 'Madurai', 'Mayiladuthurai', 'Nagapattinam', 'Namakkal', 'Nilgiris'];
const DISTRICTS_PAGE3 = ['Perambalur', 'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga', 'Tenkasi', 'Thanjavur', 'Theni'];
const DISTRICTS_PAGE4 = ['Thoothukudi', 'Tiruchirappalli', 'Tirunelveli', 'Tirupathur', 'Tiruppur', 'Tiruvallur', 'Tiruvannamalai', 'Tiruvarur'];
const DISTRICTS_PAGE5 = ['Vellore', 'Viluppuram', 'Virudhunagar'];

const ASSEMBLIES = {
  'Ariyalur':        ['Ariyalur', 'Jayankondam'],
  'Chengalpattu':    ['Shozhinganallur', 'Pallavaram', 'Tambaram', 'Chengalpattu', 'Thiruporur', 'Cheyyur', 'Madurantakam'],
  'Chennai':         ['Dr.Radhakrishnan Nagar', 'Perambur', 'Kolathur', 'Villivakkam', 'Thiru-Vi-Ka-Nagar', 'Egmore', 'Royapuram', 'Harbour', 'Chepauk-Thiruvallikeni', 'Thousand Lights', 'Anna Nagar', 'Virugampakkam', 'Saidapet', 'Thiyagarayanagar', 'Mylapore', 'Velachery'],
  'Coimbatore':      ['Mettuppalayam', 'Sulur', 'Kavundampalayam', 'Coimbatore North', 'Thondamuthur', 'Coimbatore South', 'Singanallur', 'Kinathukadavu', 'Pollachi', 'Valparai'],
  'Cuddalore':       ['Tittakudi', 'Vriddhachalam', 'Neyveli', 'Panruti', 'Cuddalore', 'Kurinjipadi', 'Bhuvanagiri', 'Chidambaram', 'Kattumannarkoil'],
  'Dharmapuri':      ['Palacodu', 'Pennagaram', 'Dharmapuri', 'Pappireddipatti', 'Harur'],
  'Dindigul':        ['Palani', 'Oddanchatram', 'Athoor', 'Nilakkottai', 'Natham', 'Dindigul', 'Vedasandur'],
  'Erode':           ['Erode East', 'Erode West', 'Modakkurichi', 'Perundurai', 'Bhavani', 'Anthiyur', 'Gobichettipalayam', 'Bhavanisagar'],
  'Kallakurichi':    ['Ulundurpettai', 'Rishivandiyam', 'Sankarapuram', 'Kallakurichi'],
  'Kanchipuram':     ['Alandur', 'Sriperumbudur', 'Uthiramerur', 'Kancheepuram'],
  'Kanyakumari':     ['Kanniyakumari', 'Nagercoil', 'Colachal', 'Padmanabhapuram', 'Vilavancode', 'Killiyoor'],
  'Karur':           ['Aravakurichi', 'Karur', 'Krishnarayapuram', 'Kulithalai'],
  'Krishnagiri':     ['Uthangarai', 'Bargur', 'Krishnagiri', 'Veppanahalli', 'Hosur', 'Thalli'],
  'Madurai':         ['Melur', 'Madurai East', 'Sholavandan', 'Madurai North', 'Madurai South', 'Madurai Central', 'Madurai West', 'Thiruparankundram', 'Thirumangalam', 'Usilampatti'],
  'Mayiladuthurai':  ['Sirkazhi', 'Mayiladuthurai', 'Poompuhar'],
  'Nagapattinam':    ['Nagapattinam', 'Kilvelur', 'Vedaranyam'],
  'Namakkal':        ['Rasipuram', 'Senthamangalam', 'Namakkal', 'Paramathi-Velur', 'Tiruchengodu', 'Kumarapalayam'],
  'Nilgiris':        ['Udhagamandalam', 'Gudalur', 'Coonoor'],
  'Perambalur':      ['Perambalur', 'Kunnam'],
  'Pudukkottai':     ['Gandarvakkottai', 'Viralimalai', 'Pudukkottai', 'Thirumayam', 'Alangudi', 'Aranthangi'],
  'Ramanathapuram':  ['Paramakudi', 'Tiruvadanai', 'Ramanathapuram', 'Mudhukulathur'],
  'Ranipet':         ['Arakkonam', 'Sholinghur', 'Ranipet', 'Arcot'],
  'Salem':           ['Gangavalli', 'Attur', 'Yercaud', 'Omalur', 'Mettur', 'Edappadi', 'Sankari', 'Salem West', 'Salem North', 'Salem South', 'Veerapandi'],
  'Sivaganga':       ['Karaikudi', 'Tiruppattur', 'Sivaganga', 'Manamadurai'],
  'Tenkasi':         ['Sankarankovil', 'Vasudevanallur', 'Kadayanallur', 'Tenkasi', 'Alangulam'],
  'Thanjavur':       ['Thiruvidaimarudur', 'Kumbakonam', 'Papanasam', 'Thiruvaiyaru', 'Thanjavur', 'Orathanadu', 'Pattukkottai', 'Peravurani'],
  'Theni':           ['Andipatti', 'Periyakulam', 'Bodinayakanur', 'Cumbum'],
  'Thoothukudi':     ['Vilathikulam', 'Thoothukkudi', 'Tiruchendur', 'Srivaikuntam', 'Ottapidaram', 'Kovilpatti'],
  'Tiruchirappalli': ['Manapparai', 'Srirangam', 'Tiruchirappalli West', 'Tiruchirappalli East', 'Thiruverumbur', 'Lalgudi', 'Manachanallur', 'Musiri', 'Thuraiyur'],
  'Tirunelveli':     ['Tirunelveli', 'Ambasamudram', 'Palayamkottai', 'Nanguneri', 'Radhapuram'],
  'Tirupathur':      ['Vaniyambadi', 'Ambur', 'Jolarpet', 'Tirupattur'],
  'Tiruppur':        ['Dharapuram', 'Kangayam', 'Avanashi', 'Tiruppur North', 'Tiruppur South', 'Palladam', 'Udumalaipettai', 'Madathukulam'],
  'Tiruvallur':      ['Gummidipoondi', 'Ponneri', 'Tiruttani', 'Thiruvallur', 'Poonamallee', 'Avadi', 'Maduravoyal', 'Ambattur', 'Madavaram', 'Thiruvottiyur'],
  'Tiruvannamalai':  ['Chengam', 'Tiruvannamalai', 'Kilpennathur', 'Kalasapakkam', 'Polur', 'Arani', 'Cheyyar', 'Vandavasi'],
  'Tiruvarur':       ['Thiruthuraipoondi', 'Mannargudi', 'Thiruvarur', 'Nannilam'],
  'Vellore':         ['Katpadi', 'Vellore', 'Anaikattu', 'Kilvaithinankuppam', 'Gudiyattam'],
  'Viluppuram':      ['Gingee', 'Mailam', 'Tindivanam', 'Vanur', 'Viluppuram', 'Vikravandi', 'Tirukkoyilur'],
  'Virudhunagar':    ['Rajapalayam', 'Srivilliputhur', 'Sattur', 'Sivakasi', 'Virudhunagar', 'Aruppukkottai', 'Tiruchuli'],
};

// ── 32 Schemes (from live DB, id order) ──────────────────────────────────────
const SCHEMES = [
  { id: 1,  name: 'e-Shram',              benefit: 'Worker ID card + ₹2L free accident insurance' },
  { id: 2,  name: 'ABHA',                 benefit: 'Free 14-digit digital health ID' },
  { id: 3,  name: 'Udyam',                benefit: 'Free MSME registration certificate' },
  { id: 4,  name: 'PMSBY',                benefit: '₹2L accident cover — ₹20/year' },
  { id: 5,  name: 'PMJJBY',               benefit: '₹2L life insurance — ₹436/year' },
  { id: 6,  name: 'Jan Dhan',             benefit: 'Zero-balance bank account + RuPay card' },
  { id: 7,  name: 'PM-POSHAN Tracker',    benefit: 'Free school meals, uniforms & textbooks' },
  { id: 8,  name: 'Ayushman Bharat',      benefit: '₹5L/year cashless hospitalisation' },
  { id: 9,  name: 'Ayushman 70+',         benefit: '₹5L/year health cover — seniors 70+' },
  { id: 10, name: 'PM Kisan',             benefit: '₹6,000/year direct cash to farmers' },
  { id: 11, name: 'PM Matru Vandana',     benefit: '₹5,000 cash — pregnant/lactating mothers' },
  { id: 12, name: 'APY',                  benefit: 'Pension ₹1K–5K/month after age 60' },
  { id: 13, name: 'NAPS',                 benefit: 'Govt stipend up to ₹1,500/month — trainees' },
  { id: 14, name: 'PMKVY',                benefit: 'Free skill training — 300+ trades' },
  { id: 15, name: 'PM Kisan Maan Dhan',   benefit: 'Farmer pension ₹3,000/month after 60' },
  { id: 16, name: 'NSP Scholarship',      benefit: 'Scholarships Class 1 to PhD — DBT' },
  { id: 17, name: 'PM-YASASVI',           benefit: 'Scholarship ₹75K–₹1.25L/year — school' },
  { id: 18, name: 'NMMS',                 benefit: '₹12,000/year — Class 9 to 12' },
  { id: 19, name: 'KCC',                  benefit: 'Revolving credit up to ₹3L at 4%' },
  { id: 20, name: 'DAY-NRLM',             benefit: 'Fund ₹15K–₹1.5L for Self-Help Groups' },
  { id: 21, name: 'Sukanya Samriddhi',    benefit: '8.2% tax-free savings — girl child' },
  { id: 22, name: 'PM Ujjwala',           benefit: 'Free LPG connection + cylinder subsidies' },
  { id: 23, name: 'PM SVANidhi',          benefit: 'Loan ₹10K–₹50K — street vendors' },
  { id: 24, name: 'PM Surya Ghar',        benefit: 'Solar subsidy ₹78K + 300 units free/month' },
  { id: 25, name: 'PM-KUSUM',             benefit: '60% subsidy — solar agricultural pumps' },
  { id: 26, name: 'PMMSY',                benefit: 'Subsidy 40%–60% — boats, aquaculture' },
  { id: 27, name: 'PM-FME',               benefit: '35% subsidy up to ₹10L — food enterprises' },
  { id: 28, name: 'PM Mudra',             benefit: 'Collateral-free loan up to ₹5L' },
  { id: 29, name: 'PM Awas Yojana',       benefit: 'Housing grant ₹1.2L–₹2.67L' },
  { id: 30, name: 'Stand Up India',       benefit: 'Loan ₹10L–₹1Cr — SC/ST & women' },
  { id: 31, name: 'PM Fasal Bima',        benefit: 'Crop insurance — natural calamities' },
  { id: 32, name: 'PMEGP',                benefit: 'Credit subsidy up to 35% — new enterprise' },
];

// ── Helper: make a standard node skeleton ─────────────────────────────────────
function makeNode(nodeId, name, interactiveId, parentNodeId, body, interactiveType, buttons, sections, buttonLabel, keywords, x, y) {
  return {
    nodeId,
    type: 'interactive',
    name,
    interactiveId: interactiveId || null,
    data: {
      body,
      header: { type: 'none', text: '' },
      footer: '',
      action: {
        buttons: buttons || [{ type: 'reply', reply: { id: uid(), title: 'Button 1' } }],
        sections: sections || [],
        dynamicRows: { enabled: false },
        button: buttonLabel || 'Choose',
      },
      interactiveType: interactiveType || 'list',
    },
    keywords: keywords || [],
    parentNodeId: parentNodeId || null,
    assignedAgent: null,
    assignedAgents: [],
    enabledNotify: false,
    notifyConfig: {},
    funnelStageConfig: { enabled: false },
    variableConfig: {},
    canvasPosition: { x: x || 0, y: y || 0 },
  };
}

function makeListNode(nodeId, name, interactiveId, parentNodeId, body, sections, keywords, x, y) {
  return makeNode(nodeId, name, interactiveId, parentNodeId, body, 'list',
    [{ type: 'reply', reply: { id: uid(), title: 'Button 1' } }],
    sections, 'Choose', keywords, x, y);
}

function makeButtonNode(nodeId, name, interactiveId, parentNodeId, body, buttons, keywords, x, y) {
  return makeNode(nodeId, name, interactiveId, parentNodeId, body, 'button',
    buttons, [], '', keywords, x, y);
}

// ── Build the nodes array ──────────────────────────────────────────────────────
const nodes = [];

// ── IDs we need to reference ──────────────────────────────────────────────────
const ROOT_ID = 'root';

// Root menu row IDs
const ROW_REGISTER_SCHEMES   = uid();
const ROW_REGISTER_VOLUNTEER = uid();
const ROW_MY_REGISTRATION    = uid();
const ROW_MY_REFERRAL        = uid();
const ROW_MY_MEMBERS         = uid();
const ROW_BE_VOLUNTEER       = uid();
const ROW_SUPPORT             = uid();

// EPIC ask node IDs
const NODE_EPIC_SCHEMES   = uid();
const NODE_EPIC_VOLUNTEER = uid();

// "I don't have EPIC" button IDs
const BTN_NO_EPIC_SCHEMES   = uid();
const BTN_NO_EPIC_VOLUNTEER = uid();

// District page node IDs
const NODE_DIST_P1 = uid();
const NODE_DIST_P2 = uid();
const NODE_DIST_P3 = uid();
const NODE_DIST_P4 = uid();
const NODE_DIST_P5 = uid();

// "More Districts" nav row IDs
const ROW_MORE_DIST_P1 = uid();
const ROW_MORE_DIST_P2 = uid();
const ROW_MORE_DIST_P3 = uid();
const ROW_MORE_DIST_P4 = uid();

// District row IDs (needed to link assembly nodes)
const districtRowIds = {};
[...DISTRICTS_PAGE1, ...DISTRICTS_PAGE2, ...DISTRICTS_PAGE3, ...DISTRICTS_PAGE4, ...DISTRICTS_PAGE5]
  .forEach(d => { districtRowIds[d] = uid(); });

// Assembly node IDs per district
const assemblyNodeIds = {};
Object.keys(ASSEMBLIES).forEach(d => { assemblyNodeIds[d] = uid(); });

// Ask Name node (no-EPIC path — inserted between "I don't have EPIC" and District pages)
const NODE_ASK_NAME    = uid();
const BTN_NAME_CONTINUE = uid();

// Scheme select page node IDs (keyword-triggered)
const NODE_SCHEME_P1 = uid();
const NODE_SCHEME_P2 = uid();
const NODE_SCHEME_P3 = uid();
const NODE_SCHEME_P4 = uid();

const ROW_SCHEME_NEXT_P1 = uid();
const ROW_SCHEME_NEXT_P2 = uid();
const ROW_SCHEME_NEXT_P3 = uid();
const ROW_SCHEME_DONE_ALL = uid();

// Scheme row IDs
const schemeRowIds = {};
SCHEMES.forEach(s => { schemeRowIds[s.id] = uid(); });

// Support node
const NODE_SUPPORT = uid();

// ── 1. ROOT NODE ──────────────────────────────────────────────────────────────
nodes.push(makeListNode(
  ROOT_ID, 'Root Node', null, null,
  '🪷 *வணக்கம்! Welcome to BJP Nalam Thittam*\n\nConnect with Central Government welfare schemes.\n\nHow can we help you today?',
  [{
    title: '🪷 BJP Nalam Thittam',
    rows: [
      { id: ROW_REGISTER_SCHEMES,   title: 'Register for Schemes',   description: 'Apply for Central Govt welfare schemes' },
      { id: ROW_REGISTER_VOLUNTEER, title: 'Register as Volunteer',  description: 'Apply to volunteer for BJP TN' },
      { id: ROW_MY_REGISTRATION,    title: 'My Registration',        description: 'View your registration & schemes' },
      { id: ROW_MY_REFERRAL,        title: 'My Referral Link',       description: 'Share and invite members' },
      { id: ROW_MY_MEMBERS,         title: 'My Members',             description: 'Members you referred' },
      { id: ROW_BE_VOLUNTEER,       title: 'Be a Volunteer',         description: 'Volunteer application status' },
      { id: ROW_SUPPORT,            title: 'Support',                description: 'Get help from our team' },
    ],
  }],
  ['Hi', 'Hello', 'Hey', 'Start', 'Menu', 'hi', 'hello', 'hey', 'start', 'menu'],
  -240, -200,
));

// ── 2. EPIC ASK — SCHEMES ──────────────────────────────────────────────────────
nodes.push(makeButtonNode(
  NODE_EPIC_SCHEMES, 'Register: EPIC Ask (Schemes)', ROW_REGISTER_SCHEMES, ROOT_ID,
  '📋 *Register for Schemes*\n\nEnter your *EPIC (Voter ID)* number to get started.\n\nYour EPIC is on your voter card — e.g. *TNA1234567*\n\n👇 If you don\'t have your voter ID, tap below.',
  [{ type: 'reply', reply: { id: BTN_NO_EPIC_SCHEMES, title: "I don't have EPIC" } }],
  [],
  520, -200,
));

// ── 3. EPIC ASK — VOLUNTEER ────────────────────────────────────────────────────
nodes.push(makeButtonNode(
  NODE_EPIC_VOLUNTEER, 'Register: EPIC Ask (Volunteer)', ROW_REGISTER_VOLUNTEER, ROOT_ID,
  '🤝 *Register as Volunteer*\n\nEnter your *EPIC (Voter ID)* number to continue.\n\nYour EPIC is on your voter card — e.g. *TNA1234567*\n\n👇 If you don\'t have your voter ID, tap below.',
  [{ type: 'reply', reply: { id: BTN_NO_EPIC_VOLUNTEER, title: "I don't have EPIC" } }],
  [],
  520, 200,
));

// ── 4. SUPPORT NODE ──────────────────────────────────────────────────────────
nodes.push(makeButtonNode(
  NODE_SUPPORT, 'Support', ROW_SUPPORT, ROOT_ID,
  '✅ *Support Request Received!*\n\nOur team will respond within *2 hours*.\n\nFor urgent help:\n📞 *+91 94444 XXXXX*\n⏰ 8am – 10pm daily\n\nThank you! 🙏',
  [{ type: 'reply', reply: { id: uid(), title: 'Main Menu' } }],
  [],
  520, 600,
));

// ── 4b. ASK NAME NODE (no-EPIC path) ──────────────────────────────────────────
// Triggered when user taps "I don't have EPIC" — collects name before district selection.
// User types their name as free text, then taps "Continue" to proceed to districts.
nodes.push(makeButtonNode(
  NODE_ASK_NAME, 'Ask: Full Name (No EPIC)', BTN_NO_EPIC_SCHEMES, NODE_EPIC_SCHEMES,
  '📝 *Please Enter Your Full Name*\n\nType your full name in the message box below and send it.\n\n_Example: Vijay Kumar_\n\nOnce sent, tap *Continue* to select your district.',
  [{ type: 'reply', reply: { id: BTN_NAME_CONTINUE, title: 'Continue ✅' } }],
  [],
  1040, 200,
));

// ── 5. DISTRICT PAGES ─────────────────────────────────────────────────────────
function makeDistrictPageRows(districts, moreRowId) {
  const rows = districts.map(d => ({ id: districtRowIds[d], title: d, description: '' }));
  if (moreRowId) rows.push({ id: moreRowId, title: 'More Districts →', description: '' });
  return rows;
}

// District Page 1 — now triggered by "Continue" button from Ask Name node
nodes.push(makeListNode(
  NODE_DIST_P1, 'Select District — Page 1/5', BTN_NAME_CONTINUE, NODE_ASK_NAME,
  '📍 *Select Your District* (Page 1 of 5)\n\nChoose your district from the list below:',
  [{ title: 'Districts A–K', rows: makeDistrictPageRows(DISTRICTS_PAGE1, ROW_MORE_DIST_P1) }],
  [],
  1040, -200,
));

// District Page 2
nodes.push(makeListNode(
  NODE_DIST_P2, 'Select District — Page 2/5', ROW_MORE_DIST_P1, NODE_DIST_P1,
  '📍 *Select Your District* (Page 2 of 5)',
  [{ title: 'Districts K–N', rows: makeDistrictPageRows(DISTRICTS_PAGE2, ROW_MORE_DIST_P2) }],
  [],
  1560, -200,
));

// District Page 3
nodes.push(makeListNode(
  NODE_DIST_P3, 'Select District — Page 3/5', ROW_MORE_DIST_P2, NODE_DIST_P2,
  '📍 *Select Your District* (Page 3 of 5)',
  [{ title: 'Districts P–T', rows: makeDistrictPageRows(DISTRICTS_PAGE3, ROW_MORE_DIST_P3) }],
  [],
  2080, -200,
));

// District Page 4
nodes.push(makeListNode(
  NODE_DIST_P4, 'Select District — Page 4/5', ROW_MORE_DIST_P3, NODE_DIST_P3,
  '📍 *Select Your District* (Page 4 of 5)',
  [{ title: 'Districts T–T', rows: makeDistrictPageRows(DISTRICTS_PAGE4, ROW_MORE_DIST_P4) }],
  [],
  2600, -200,
));

// District Page 5
nodes.push(makeListNode(
  NODE_DIST_P5, 'Select District — Page 5/5', ROW_MORE_DIST_P4, NODE_DIST_P4,
  '📍 *Select Your District* (Page 5 of 5)',
  [{ title: 'Districts V–V', rows: makeDistrictPageRows(DISTRICTS_PAGE5, null) }],
  [],
  3120, -200,
));

// ── 6. ASSEMBLY NODES PER DISTRICT ────────────────────────────────────────────
// Determine parent page for each district
const districtParentPage = {};
DISTRICTS_PAGE1.forEach(d => districtParentPage[d] = NODE_DIST_P1);
DISTRICTS_PAGE2.forEach(d => districtParentPage[d] = NODE_DIST_P2);
DISTRICTS_PAGE3.forEach(d => districtParentPage[d] = NODE_DIST_P3);
DISTRICTS_PAGE4.forEach(d => districtParentPage[d] = NODE_DIST_P4);
DISTRICTS_PAGE5.forEach(d => districtParentPage[d] = NODE_DIST_P5);

Object.entries(ASSEMBLIES).forEach(([district, assemblies], idx) => {
  const MAX_PER_PAGE = 9; // leave 1 slot for "More Assemblies" if needed
  const pages = [];
  for (let i = 0; i < assemblies.length; i += MAX_PER_PAGE) {
    pages.push(assemblies.slice(i, i + MAX_PER_PAGE));
  }

  pages.forEach((pageAssemblies, pageIdx) => {
    const isFirst = pageIdx === 0;
    const isLast  = pageIdx === pages.length - 1;
    const nodeId  = isFirst ? assemblyNodeIds[district] : uid();
    const parentId = isFirst
      ? districtParentPage[district]
      : (pageIdx === 1 ? assemblyNodeIds[district] : null); // further pages: chained

    const moreRowId = !isLast ? uid() : null;
    const rows = pageAssemblies.map(a => ({ id: uid(), title: a, description: '' }));
    if (moreRowId) rows.push({ id: moreRowId, title: 'More Assemblies →', description: '' });

    const pageLabel = pages.length > 1 ? ` (Page ${pageIdx + 1}/${pages.length})` : '';
    nodes.push(makeListNode(
      nodeId,
      `Assembly: ${district}${pageIdx > 0 ? ` p${pageIdx + 1}` : ' p1'}`,
      isFirst ? districtRowIds[district] : null,
      parentId || districtParentPage[district],
      `🗳️ *Select Your Assembly${pageLabel}*\nDistrict: *${district}*`,
      [{ title: `${district} Assemblies`, rows }],
      [],
      3120 + (idx % 10) * 520, 820 + Math.floor(idx / 10) * 300,
    ));
  });
});

// ── 7. SCHEME SELECTION PAGES (keyword-triggered) ─────────────────────────────
// Chunks of 8 schemes per page, "Done Selecting" on every page, "Next Page →" except last
const SCHEME_CHUNKS = [];
for (let i = 0; i < SCHEMES.length; i += 8) SCHEME_CHUNKS.push(SCHEMES.slice(i, i + 8));

const schemePageNodeIds = [NODE_SCHEME_P1, NODE_SCHEME_P2, NODE_SCHEME_P3, NODE_SCHEME_P4];
const schemeMoreRowIds  = [ROW_SCHEME_NEXT_P1, ROW_SCHEME_NEXT_P2, ROW_SCHEME_NEXT_P3];

SCHEME_CHUNKS.forEach((chunk, pageIdx) => {
  const nodeId = schemePageNodeIds[pageIdx];
  const isLast = pageIdx === SCHEME_CHUNKS.length - 1;
  const rows   = chunk.map(s => ({ id: schemeRowIds[s.id], title: s.name, description: s.benefit }));
  rows.push({ id: uid(), title: '✅ Done Selecting', description: 'Complete registration with selected schemes' });
  if (!isLast) rows.push({ id: schemeMoreRowIds[pageIdx], title: `More Schemes → (Page ${pageIdx + 2}/${SCHEME_CHUNKS.length})`, description: '' });

  const parentOfNext = pageIdx > 0 ? schemePageNodeIds[pageIdx - 1] : null;

  nodes.push(makeListNode(
    nodeId,
    `Select Schemes — Page ${pageIdx + 1}/${SCHEME_CHUNKS.length}`,
    pageIdx === 0 ? null : schemeMoreRowIds[pageIdx - 1],
    pageIdx === 0 ? null : schemePageNodeIds[pageIdx - 1],
    `🎯 *Select Schemes* (Page ${pageIdx + 1} of ${SCHEME_CHUNKS.length})\n\nTap a scheme to add it. You can pick from multiple pages.\nTap *Done Selecting* when finished.`,
    [{ title: `Schemes — Page ${pageIdx + 1}`, rows }],
    pageIdx === 0
      ? ['Schemes', 'Select Schemes', 'More Schemes', 'Pick Schemes', 'schemes']
      : [],
    -240 + pageIdx * 520, 400,
  ));
});

// ── OUTPUT ────────────────────────────────────────────────────────────────────
const outputDir  = path.join(__dirname, '..', 'output');
const outputFile = path.join(outputDir, 'bjp_nalam_thittam_wacto.json');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const chatbot = { chatbot: { name: 'BJP Nalam Thittam' }, nodes };
fs.writeFileSync(outputFile, JSON.stringify(chatbot, null, 2), 'utf8');

console.log(`✅ Generated ${nodes.length} nodes → ${outputFile}`);
console.log(`   Root menu          : 1 node`);
console.log(`   EPIC ask nodes     : 2 nodes`);
console.log(`   Support            : 1 node`);
console.log(`   District pages     : 5 nodes`);
console.log(`   Assembly nodes     : ${nodes.filter(n => n.name.startsWith('Assembly:')).length} nodes (38 districts)`);
console.log(`   Scheme pages       : ${SCHEME_CHUNKS.length} nodes (${SCHEMES.length} schemes)`);
