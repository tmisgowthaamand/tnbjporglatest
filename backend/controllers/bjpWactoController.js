/**
 * BJP WACTO Controller
 *
 * WACTO forwards every incoming WhatsApp message (Meta webhook format) to
 *   POST /api/whatsapp/bjp-wacto/events?key=<BJP_WACTO_WEBHOOK_KEY>
 * WACTO's flow nodes send the menu, the EPIC choice, the district/assembly pickers
 * and the scheme list pages (page 1 opens on the "Pick Schemes" button title via a
 * node keyword — WACTO rejects list messages sent through its API). Sent from here:
 * the EPIC prompt, "What next?" buttons (only after a verified EPIC or a tapped
 * assembly), scheme-pick confirmations, Done, volunteer, the returning-user options,
 * and a typed-number scheme list when BJP_WACTO_SCHEME_PICKER=typed.
 *
 * WACTO taps arrive as LABEL text (WACTO never sends node ids); taps on the
 * buttons/rows sent from here also carry our own `bjp:` ids.
 * Uses the WhatsApp phone number as the user identity — no OTP, no JWT.
 * In-progress registration lives in the WactoSession collection (PM2 cluster).
 */

const User                  = require('../models/User');
const SchemeApplication     = require('../models/SchemeApplication');
const BoothPresidentRequest = require('../models/BoothPresidentRequest');
const Scheme                = require('../models/Scheme');
const WactoSession          = require('../models/WactoSession');
const { findVoterByEpic }   = require('../services/voterSearchService');
const { sendWactoText, sendWactoInteractive } = require('../services/wactoSender');
const { DISTRICT_ASSEMBLIES, SCHEME_TITLES } = require('../constants/wactoFlowLabels');

const SESSION_TTL_MS = (WactoSession.SESSION_TTL_SECONDS || 7200) * 1000;
const SITE = 'https://tnbjp.org';

// Ids on the buttons/list rows this backend sends itself (WACTO nodes never use them).
const ID = { next: 'bjp:next:', scheme: 'bjp:scheme:', page: 'bjp:schemes:page:', done: 'bjp:done' };
const SCHEMES_PER_PAGE = 8; // + "✅ Done Selecting" + "More Schemes →" = 10 rows (WhatsApp max)

// ── Labels shown by the WACTO flow (English) ──────────────────────────────────
const L = {
  register:      new Set(['Register', 'Register for Schemes', 'Register as Volunteer']),
  haveEpic:      'I have EPIC',
  noEpic:        "I don't have EPIC",
  cont:          'Continue ✅',
  pickSchemes:   'Pick Schemes',
  volunteerOnly: 'Volunteer only',
  both:          'Schemes + Volunteer',
  done:          '✅ Done Selecting',
  addMore:       'Add more schemes', // WACTO "Scheme Added" button (v8) → copy of scheme page 1
  myRegistration:'My Registration',
  myReferral:    'My Referral Link',
  myMembers:     'My Members',
  beVolunteer:   'Be a Volunteer',
};
// Answered by WACTO nodes (or plain chit-chat) — the backend stays quiet.
const QUIET = /^(hi+|hello+|hey+|start|menu|ok|okay|thanks?|thank you|support|main menu)$/i;
const NAV   = /^More (Districts|Assemblies|Schemes|in )/;
// v8c flow shows district rows as "<Name> District" (WACTO keeps one destination per title,
// and 23 districts share a name with an assembly); older flows sent the plain name.
const districtFromLabel = (label) => {
  const name = String(label).replace(/\s+District$/, '');
  return DISTRICT_ASSEMBLIES[name] ? name : null;
};
const SCHEME_TITLE_SET = new Set(SCHEME_TITLES);

// Normalize WhatsApp phone → 10-digit mobile (same as waHelpers.js last10)
const last10 = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

// Generate a unique NT- referral code
async function genReferralCode() {
  for (let i = 0; i < 10; i++) {
    const code = 'NT-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  throw new Error('Failed to generate unique referral code');
}

// Find or create a User from WACTO data (no OTP gate)
async function findOrCreateUser({ mobile, epicNo, voterName, district, assemblyName, boothNo = '0', gender = 'Unspecified', assemblyNo = '' }) {
  let user = await User.findOne({ mobile });
  if (user) return { user, isNew: false };

  const referralCode = await genReferralCode();
  user = await User.create({
    mobile,
    epicNo:       epicNo || ('PND-' + mobile),
    voterName:    voterName || 'Member',
    district:     district || 'Tamil Nadu',
    assemblyName: assemblyName || 'Assembly',
    boothNo,
    gender,
    assemblyNo,
    referralCode,
    referredBy: null,
  });
  return { user, isNew: true };
}

// Tapped scheme title → active Scheme (exact, case-insensitive, name or alias; no regex)
async function findSchemeByTitle(title) {
  const t = String(title || '').trim().toLowerCase();
  const schemes = await Scheme.find({ active: true }).lean();
  return schemes.find((s) => String(s.name).toLowerCase() === t
    || (s.keys || []).some((k) => String(k).toLowerCase() === t)) || null;
}

// Create a SchemeApplication if one doesn't already exist for this user+scheme
async function applyForScheme(user, scheme) {
  const existing = await SchemeApplication.findOne({
    $or: [
      { userId: user._id, schemeId: scheme.id },
      { mobile: user.mobile, schemeId: scheme.id },
      ...(user.epicNo ? [{ epicNo: user.epicNo, schemeId: scheme.id }] : []),
      { userId: user._id, schemeName: scheme.name },
      { mobile: user.mobile, schemeName: scheme.name }
    ]
  });
  if (existing) return { app: existing, alreadyHad: true };
  const app = await SchemeApplication.create({
    userId:       user._id,
    epicNo:       user.epicNo,
    voterName:    user.voterName,
    mobile:       user.mobile,
    district:     user.district,
    assemblyName: user.assemblyName,
    assemblyNo:   user.assemblyNo || '',
    boothNo:      user.boothNo,
    schemeId:     scheme.id,
    schemeName:   scheme.name,
    clusterName:  scheme.cluster || 'BJP Nalam Thittam Welfare',
    benefit:      scheme.benefit || '',
    status:       'Submitted',
    appliedAt:    new Date(),
  });
  return { app, alreadyHad: false };
}

// Create or re-apply a volunteer request. Returns the request (status 'Approved' untouched).
async function submitVolunteer(user) {
  let request = await BoothPresidentRequest.findOne({ userId: user._id });
  if (request && request.status === 'Approved') return request;

  const fields = {
    type:         'volunteer',
    voterName:    user.voterName,
    epicNo:       user.epicNo,
    mobile:       user.mobile,
    gender:       user.gender || 'Unspecified',
    district:     user.district,
    assemblyName: user.assemblyName,
    assemblyNo:   user.assemblyNo || '',
    boothNo:      '',
    status:       'Pending',
    rejectionReason: '',
    appliedAt:    new Date(),
    actionDate:   null,
    actionBy:     '',
  };
  if (request) {
    Object.assign(request, fields);
    await request.save();
    return request;
  }
  return BoothPresidentRequest.create({ userId: user._id, isCustomBooth: false, ...fields });
}

// ── Session helpers ───────────────────────────────────────────────────────────

async function loadSession(mobile) {
  const s = await WactoSession.findOne({ phone: mobile }).lean();
  if (!s) return null;
  if (s.updatedAt && Date.now() - new Date(s.updatedAt).getTime() > SESSION_TTL_MS) return null;
  return s;
}

async function saveSession(mobile, fields) {
  await WactoSession.updateOne(
    { phone: mobile },
    { $set: { ...fields, updatedAt: new Date() } },
    { upsert: true },
  );
}

const clearSession = (mobile) => WactoSession.deleteOne({ phone: mobile });

// Where the user said they live: voter roll (EPIC) wins, else tapped district + assembly.
function locationOf(s) {
  if (!s) return null;
  if (s.voter) return s.voter;
  if (s.district && s.assembly) {
    return { district: s.district, assemblyName: s.assembly, assemblyNo: '', boothNo: '0', gender: 'Unspecified', epicNo: '' };
  }
  return null;
}

async function userFromSession(mobile, s, profileName) {
  const loc = locationOf(s);
  return findOrCreateUser({
    mobile,
    epicNo:       loc.epicNo,
    voterName:    (s.voter && s.voter.voterName) || s.name || profileName || 'Member',
    district:     loc.district,
    assemblyName: loc.assemblyName,
    boothNo:      loc.boothNo || '0',
    gender:       loc.gender || 'Unspecified',
    assemblyNo:   loc.assemblyNo || '',
  });
}

const START_AGAIN = '⚠️ Your registration details have expired.\n\nTap *Register* in the menu to start again.';
const NEED_EPIC = '⚠️ First type your *EPIC number* in the chat and send it — e.g. *TNA1234567*.';
const EPIC_PROMPT = '🪪 *Type your EPIC number*\n\nType the number printed on your voter ID card and send it — e.g. *TNA1234567*.';
const CHOICE_DIGITS = { 1: L.pickSchemes, 2: L.volunteerOnly, 3: L.both };

const clip = (s, n) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// "What next?" — sent by the backend only once a location is known (verified EPIC or
// tapped assembly). Falls back to a typed 1/2/3 choice if WACTO rejects the buttons.
async function sendWhatNext(phone, mobile, lead) {
  await saveSession(mobile, { awaiting: 'choice' });
  const body = `${lead}\n\nWhat would you like to do?\n\n• *Pick Schemes* — apply for welfare schemes\n• *Volunteer only* — apply to volunteer for BJP TN\n• *Schemes + Volunteer* — both`;
  try {
    await sendWactoInteractive(phone, {
      type: 'button',
      body: { text: body },
      action: { buttons: [
        { type: 'reply', reply: { id: `${ID.next}pick`, title: L.pickSchemes } },
        { type: 'reply', reply: { id: `${ID.next}volunteer`, title: L.volunteerOnly } },
        { type: 'reply', reply: { id: `${ID.next}both`, title: L.both } },
      ] },
    });
  } catch (err) {
    console.error('[BJP WACTO] buttons rejected, sending typed choice:', err.message);
    await sendWactoText(phone, `${lead}\n\nReply with a number:\n*1* — Pick Schemes\n*2* — Volunteer only\n*3* — Schemes + Volunteer`);
  }
}

async function activeSchemes() {
  return (await Scheme.find({ active: true }).lean()).sort((a, b) => a.id - b.id);
}

// Scheme picker page, built from the live Scheme collection (rows use the real names).
async function sendSchemePage(phone, page, mobile) {
  const all = await activeSchemes();
  const pages = Math.max(1, Math.ceil(all.length / SCHEMES_PER_PAGE));
  const p = Math.min(Math.max(1, page || 1), pages);
  const rows = all.slice((p - 1) * SCHEMES_PER_PAGE, p * SCHEMES_PER_PAGE)
    .map((s) => ({ id: `${ID.scheme}${s.id}`, title: clip(s.name, 24), description: clip(s.benefit, 72) }));
  rows.push({ id: ID.done, title: L.done, description: 'Finish and register the schemes you picked' });
  if (p < pages) rows.push({ id: `${ID.page}${p + 1}`, title: 'More Schemes →', description: `Page ${p + 1} of ${pages}` });
  try {
    await sendWactoInteractive(phone, {
      type: 'list',
      body: { text: `🎯 *Select Schemes* (Page ${p} of ${pages})\n\nTap a scheme to add it — you'll get a ✅ for each one.\nTo add more, open this list again.\nTap *✅ Done Selecting* when you're finished.` },
      action: { button: 'Choose', sections: [{ title: clip(`Schemes — Page ${p}`, 24), rows }] },
    });
  } catch (err) {
    console.error('[BJP WACTO] scheme list rejected, sending typed list:', err.message);
    if (mobile) await saveSession(mobile, { awaiting: 'schemes' });
    await sendTypedSchemeList(phone);
  }
}

// How the scheme list is shown after "Pick Schemes":
//   wacto (default) — WACTO's own list pages (WACTO accepts no list messages from the API:
//                     "Invalid Interactive type", 2026-10-09)
//   typed           — numbered text list, user replies "4, 9, 12" (proven mechanics)
//   list            — backend list message (kept for when WACTO supports it)
function schemePicker() {
  const m = String(process.env.BJP_WACTO_SCHEME_PICKER || 'wacto').toLowerCase();
  return ['wacto', 'typed', 'list'].includes(m) ? m : 'wacto';
}

async function sendTypedSchemeList(phone) {
  const all = await activeSchemes();
  const lines = all.map((s, i) => `${i + 1}. *${s.name}* — ${clip(s.benefit, 60)}`).join('\n');
  return sendWactoText(phone, `📋 *Select Schemes*\n\nReply with the numbers you want — e.g. *4, 9, 12*\n\n${lines}\n\nReply *DONE* when you're finished.`);
}

async function addPickedScheme(phone, mobile, session, scheme) {
  const picked = (session && session.schemes) || [];
  // WACTO picker (v8 flow): WACTO's own "✅ Scheme added!" node confirms — record silently.
  const quiet = schemePicker() === 'wacto';
  if (picked.includes(scheme.name)) return quiet ? undefined : sendPickedPrompt(phone, picked, `*${scheme.name}* is already in your list.`);
  const next = [...picked, scheme.name];
  await saveSession(mobile, { schemes: next });
  if (quiet) return undefined;
  return sendPickedPrompt(phone, next, `✅ *${scheme.name}* added.`);
}

// picker=list only (backend-sent lists): after each pick, [Add more schemes] resends page 1,
// [✅ Done Selecting] finishes — no need to reopen the list to find Done.
async function sendPickedPrompt(phone, picked, head) {
  const body = clip(`${head}\n\nPicked so far (${picked.length}): ${picked.join(', ')}`, 1024);
  try {
    await sendWactoInteractive(phone, {
      type: 'button',
      body: { text: body },
      action: { buttons: [
        { type: 'reply', reply: { id: `${ID.next}more`, title: L.addMore } },
        { type: 'reply', reply: { id: ID.done, title: L.done } },
      ] },
    });
  } catch (err) {
    console.error('[BJP WACTO] pick buttons rejected, sending text:', err.message);
    await sendWactoText(phone, `${body}\n\nOpen the list again to add more, or tap *✅ Done Selecting*.`);
  }
}
const NEED_NAME = '⚠️ First type your *full name* in the chat and send it.\n\nThen tap *Continue ✅* again.';

// Why no location yet: tell the user the exact missing step instead of "expired".
function noLocationMessage(s) {
  if (s && s.awaiting === 'epic' && !s.voter) return NEED_EPIC;
  if (s && s.awaiting === 'name' && !s.name) return NEED_NAME;
  return START_AGAIN;
}
const NOT_REGISTERED = "You're not registered yet.\n\nTap *Register* in the menu — it takes about a minute.";

function volunteerStatusLine(request) {
  if (!request) return '';
  if (request.status === 'Approved') return '🏆 *You are an approved volunteer!*';
  if (request.status === 'Rejected') {
    return `❌ *Volunteer application declined*${request.rejectionReason ? `\nReason: ${request.rejectionReason}` : ''}\n\nTap *Support* in the menu if you would like to re-apply.`;
  }
  return '⏳ *Volunteer application pending* — under review by the Super Admin.';
}

// ── Typed text ────────────────────────────────────────────────────────────────

async function handleText(phone, mobile, text, session, profileName) {
  if (QUIET.test(text)) return;
  if (!session || !session.awaiting) return;

  // Fallback path when "What next?" went out as text: typed 1 / 2 / 3.
  if (session.awaiting === 'choice' && CHOICE_DIGITS[text]) {
    return handleTap(phone, mobile, CHOICE_DIGITS[text], '', session, profileName);
  }

  // Typed scheme picker: "4, 9, 12" adds schemes; "done" finishes.
  if (session.awaiting === 'schemes') {
    if (/^done$/i.test(text)) return handleTap(phone, mobile, L.done, '', session, profileName);
    const all = await activeSchemes();
    const nums = text.split(/[^0-9]+/).filter(Boolean).map(Number);
    const bad = !nums.length || nums.some((n) => n < 1 || n > all.length);
    if (bad) return sendWactoText(phone, `❌ Please reply with scheme numbers between *1* and *${all.length}* — e.g. *4, 9, 12* — or *DONE* to finish.`);
    const picked = [...(session.schemes || [])];
    const added = [];
    for (const n of nums) {
      const name = all[n - 1].name;
      if (!picked.includes(name)) { picked.push(name); added.push(name); }
    }
    await saveSession(mobile, { schemes: picked });
    const head = added.length ? `✅ Added: *${added.join('*, *')}*` : 'Those schemes are already in your list.';
    return sendWactoText(phone, `${head} — ${picked.length} picked so far.\n\nSend more numbers, or reply *DONE* to finish.`);
  }

  if (session.awaiting === 'epic') {
    const epic = text.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9/]{6,20}$/.test(epic)) {
      await sendWactoText(phone, '❌ That doesn\'t look like an EPIC number.\n\nType it as printed on your voter card — e.g. *TNA1234567* — or tap *I don\'t have EPIC*.');
      return;
    }
    const result = await findVoterByEpic(epic);
    if (!result || !result.doc) {
      await sendWactoText(phone, `❌ EPIC *${epic}* was not found in the Tamil Nadu voter roll.\n\nCheck it and type it again, or tap *I don't have EPIC*.`);
      return;
    }
    const d = result.doc;
    const voter = {
      epicNo:       d.EPIC_NO || epic,
      voterName:    d.VOTER_NAME || '',
      district:     d.DISTRICT || '',
      assemblyNo:   String(d.ASSEMBLY_NO || (result.colName || '').replace('ass_', '')),
      assemblyName: d.ASSEMBLY_NAME || `Assembly ${d.ASSEMBLY_NO}`,
      boothNo:      String(d.PART_NO || '0'),
      gender:       d.GENDER || 'Unspecified',
    };
    await saveSession(mobile, { voter });
    // Privacy: anyone can type any EPIC, so never echo voter-roll details back.
    await sendWhatNext(phone, mobile, '✅ *Voter ID found*');
    return;
  }

  if (session.awaiting === 'name') {
    const name = text.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60 || !/\p{L}/u.test(name)) {
      await sendWactoText(phone, '❌ Please type your full name — e.g. *Vijay Kumar*.');
      return;
    }
    await saveSession(mobile, { name });
    await sendWactoText(phone, `👍 Thanks, *${name}*.\n\nTap *Continue ✅* to choose your district.`);
  }
}

// ── Taps (list rows / reply buttons) ──────────────────────────────────────────

async function handleTap(phone, mobile, label, id, session, profileName) {
  // Rows/buttons this backend sent carry our own ids — handle those first.
  if (id && id.startsWith(ID.page)) return sendSchemePage(phone, parseInt(id.slice(ID.page.length), 10), mobile);
  if (id && id.startsWith(ID.scheme)) {
    const scheme = await Scheme.findOne({ id: Number(id.slice(ID.scheme.length)), active: true }).lean();
    if (!scheme) return sendWactoText(phone, "⚠️ That scheme isn't available right now. Please pick another one.");
    return addPickedScheme(phone, mobile, session, scheme);
  }

  if (QUIET.test(label) || NAV.test(label)) return;

  if (label === L.myRegistration) {
    const user = await User.findOne({ mobile }).lean();
    if (!user) return sendWactoText(phone, NOT_REGISTERED);
    const apps = await SchemeApplication.find({ userId: user._id }).select('schemeName status appliedAt').sort({ appliedAt: -1 }).lean();
    const request = await BoothPresidentRequest.findOne({ userId: user._id }).lean();
    const lines = apps.map((a, i) => `${i + 1}. ${a.schemeName} — ${a.status}`).join('\n') || 'No schemes yet.';
    const epic = String(user.epicNo || '').startsWith('PND-') ? 'Not provided' : user.epicNo;
    return sendWactoText(phone, `👤 *My Registration*\n\nName: *${user.voterName}*\nAssembly: *${user.assemblyName}*\nDistrict: *${user.district}*\nEPIC: *${epic}*\n\n📋 *Schemes*\n${lines}${request ? `\n\n${volunteerStatusLine(request)}` : ''}\n\n📱 ${SITE}`);
  }

  if (label === L.myReferral) {
    const user = await User.findOne({ mobile }).lean();
    if (!user) return sendWactoText(phone, NOT_REGISTERED);
    const count = await User.countDocuments({ referredBy: user.referralCode });
    return sendWactoText(phone, `🔗 *My Referral Link*\n\nShare this link to invite members:\n${SITE}/?ref=${user.referralCode}\n\nYour code: *${user.referralCode}*\nMembers referred: *${count}*`);
  }

  if (label === L.myMembers) {
    const user = await User.findOne({ mobile }).lean();
    if (!user) return sendWactoText(phone, NOT_REGISTERED);
    const total = await User.countDocuments({ referredBy: user.referralCode });
    if (!total) return sendWactoText(phone, '👥 *My Members*\n\nNo members referred yet.\n\nTap *My Referral Link* to get your invite link.');
    const recent = await User.find({ referredBy: user.referralCode }).select('voterName district createdAt').sort({ createdAt: -1 }).limit(5).lean();
    const lines = recent.map((m, i) => `${i + 1}. ${m.voterName} — ${m.district}`).join('\n');
    return sendWactoText(phone, `👥 *My Members* — ${total} total\n\nLatest:\n${lines}`);
  }

  if (label === L.beVolunteer) {
    const user = await User.findOne({ mobile });
    if (!user) return sendWactoText(phone, "🤝 To volunteer, register first.\n\nTap *Register* in the menu, then choose *Volunteer only* (or *Schemes + Volunteer*).");
    const existing = await BoothPresidentRequest.findOne({ userId: user._id }).lean();
    if (existing) return sendWactoText(phone, volunteerStatusLine(existing));
    await submitVolunteer(user);
    return sendWactoText(phone, `✅ *Volunteer application submitted!*\n\nAssembly: *${user.assemblyName}*\n\nThe Super Admin will review it. Tap *Be a Volunteer* any time to see the status.`);
  }

  if (L.register.has(label)) {
    // Fresh start; WACTO sends the EPIC question.
    await clearSession(mobile);
    await saveSession(mobile, { awaiting: 'epic', voter: null, name: '', district: '', assembly: '', schemes: [], volunteer: false });
    return;
  }

  if (label === L.haveEpic) {
    await saveSession(mobile, { awaiting: 'epic', voter: null, name: '' });
    return sendWactoText(phone, EPIC_PROMPT); // no button: "What next?" only follows a verified EPIC
  }

  if (label === L.noEpic) {
    await saveSession(mobile, { awaiting: 'name', voter: null });
    return;
  }

  if (label === L.cont) {
    if (session && session.awaiting === 'epic' && !session.voter) {
      return sendWactoText(phone, "⚠️ We haven't received a valid EPIC yet.\n\nType your EPIC number, or tap *I don't have EPIC*.");
    }
    if (session && session.awaiting === 'name' && !session.name) {
      return sendWactoText(phone, '⚠️ Please type your full name first, then tap *Continue ✅*.');
    }
    if (session) await saveSession(mobile, { awaiting: null });
    return;
  }

  if (label === L.pickSchemes || label === L.both) {
    if (!locationOf(session)) return sendWactoText(phone, noLocationMessage(session));
    const picker = schemePicker();
    await saveSession(mobile, { volunteer: label === L.both, awaiting: picker === 'typed' ? 'schemes' : null });
    if (picker === 'wacto') return; // WACTO's scheme page 1 opens on this button title (node keyword)
    if (picker === 'list') return sendSchemePage(phone, 1, mobile);
    return sendTypedSchemeList(phone);
  }

  if (label === L.volunteerOnly) {
    if (!locationOf(session)) return sendWactoText(phone, noLocationMessage(session));
    const { user } = await userFromSession(mobile, session, profileName);
    const request = await submitVolunteer(user);
    await clearSession(mobile);
    if (request.status === 'Approved') return sendWactoText(phone, volunteerStatusLine(request));
    return sendWactoText(phone, `✅ *Volunteer application submitted!*\n\nThe Super Admin will review it. Tap *Be a Volunteer* in the menu any time to see the status.\n\n🔗 Invite others: ${SITE}/?ref=${user.referralCode}`);
  }

  if (label === L.addMore) {
    // v8 flow: WACTO's edge opens the copy of page 1; only the "list" picker needs us.
    if (schemePicker() === 'list') return sendSchemePage(phone, 1, mobile);
    return;
  }

  if (label === L.done) {
    if (!locationOf(session)) return sendWactoText(phone, noLocationMessage(session));
    const picked = session.schemes || [];
    if (!picked.length) return sendWactoText(phone, '⚠️ Please pick at least one scheme from the list, then tap *✅ Done Selecting*.');

    const { user } = await userFromSession(mobile, session, profileName);
    const added = [], already = [];
    for (const title of picked) {
      const scheme = await findSchemeByTitle(title);
      if (!scheme) continue;
      const { alreadyHad } = await applyForScheme(user, scheme);
      (alreadyHad ? already : added).push(scheme.name);
    }
    const request = session.volunteer ? await submitVolunteer(user) : null;
    await clearSession(mobile);

    const parts = ['✅ *Registration Complete!*\n\n🎉 Welcome to BJP Nalam Thittam!'];
    if (added.length) parts.push(`You're now registered for:\n${added.map((n) => `• ${n}`).join('\n')}`);
    if (already.length) parts.push(`You had already applied for:\n${already.map((n) => `• ${n}`).join('\n')}`);
    if (request) parts.push(request.status === 'Approved' ? volunteerStatusLine(request) : '🤝 *Volunteer application submitted* — under review by the Super Admin.');
    parts.push(`📱 Login: ${SITE}\n🔗 Invite others: ${SITE}/?ref=${user.referralCode}`);
    return sendWactoText(phone, parts.join('\n\n'));
  }

  // Scheme rows from the older WACTO scheme pages (v3/v4 flows): matched by title.
  if (SCHEME_TITLE_SET.has(label)) {
    const scheme = await findSchemeByTitle(label);
    if (!scheme) return sendWactoText(phone, `⚠️ *${label}* can't be applied for on WhatsApp yet. Please pick another scheme.`);
    return addPickedScheme(phone, mobile, session, scheme);
  }

  // Assembly of the chosen district (checked first: e.g. "Dindigul" is both), else a district.
  if (session && session.district && (DISTRICT_ASSEMBLIES[session.district] || []).includes(label)) {
    await saveSession(mobile, { assembly: label, voter: null });
    // v8b flow: the assembly row's WACTO edge sends "What next?" (no EPIC to gate here).
    // Older flows had no such edge, so the backend sent it.
    if (process.env.BJP_WACTO_ASSEMBLY_WHATNEXT === 'backend') return sendWhatNext(phone, mobile, '📍 *Almost done!*');
    return undefined;
  }
  const district = districtFromLabel(label);
  if (district) {
    await saveSession(mobile, { district, assembly: '', voter: null });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/bjp-wacto/events?key=...
// ─────────────────────────────────────────────────────────────────────────────
let warnedNoKey = false;
const handleEvents = async (req, res) => {
  const key = process.env.BJP_WACTO_WEBHOOK_KEY;
  if (!key) {
    if (!warnedNoKey) { console.error('[BJP WACTO] BJP_WACTO_WEBHOOK_KEY not set — ignoring all events'); warnedNoKey = true; }
    return res.sendStatus(503);
  }
  if (!req.query || req.query.key !== key) return res.sendStatus(403);
  res.sendStatus(200); // ack immediately so WACTO doesn't retry

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg || !msg.from) return;

    const phone = msg.from;
    const mobile = last10(phone);
    // Live-test switch: when set, answer only these 10-digit numbers (comma-separated).
    const allow = String(process.env.BJP_WACTO_ALLOWLIST || '').split(',').map((s) => last10(s)).filter(Boolean);
    if (allow.length && !allow.includes(mobile)) return;
    const profileName = value.contacts?.[0]?.profile?.name || '';
    const session = await loadSession(mobile);

    if (msg.type === 'text') {
      const text = String(msg.text?.body || '').trim();
      if (text) await handleText(phone, mobile, text, session, profileName);
      return;
    }
    if (msg.type === 'interactive') {
      const it = msg.interactive || {};
      const label = String(it.list_reply?.title || it.button_reply?.title || '').trim();
      const id = String(it.list_reply?.id || it.button_reply?.id || '');
      if (label || id) await handleTap(phone, mobile, label, id, session, profileName);
    }
  } catch (err) {
    console.error('[BJP WACTO] event error:', err.message);
  }
};

module.exports = { handleEvents };
