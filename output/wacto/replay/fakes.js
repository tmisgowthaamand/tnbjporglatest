// In-memory fakes for the BJP WACTO replay harness: Mongoose-ish models,
// voter lookup and the WACTO sender (records every outbound message).
let seq = 0;
const nextId = () => `id_${++seq}`;

function matches(q, doc) {
  return Object.entries(q || {}).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => matches(sub, doc));
    const dv = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('$regex' in v) return new RegExp(v.$regex, v.$options || '').test(String(dv ?? ''));
      if ('$elemMatch' in v) return Array.isArray(dv) && dv.some((x) => matches({ _: v.$elemMatch }, { _: x }));
      if ('$in' in v) return v.$in.map(String).includes(String(dv));
      if ('$exists' in v) return (dv !== undefined) === v.$exists;
    }
    return String(dv) === String(v);
  });
}

class Chain {
  constructor(run, single) { this.run = run; this.single = single; this.s = null; this.l = null; }
  select() { return this; }
  lean() { return this; }
  sort(s) { this.s = s; return this; }
  limit(n) { this.l = n; return this; }
  exec() {
    let rows = this.run();
    if (this.s) {
      const [k, dir] = Object.entries(this.s)[0];
      rows = [...rows].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
    }
    if (this.l) rows = rows.slice(0, this.l);
    return Promise.resolve(this.single ? (rows[0] || null) : rows);
  }
  then(res, rej) { return this.exec().then(res, rej); }
}

function makeModel(name, defaults = {}) {
  const rows = [];
  const attach = (doc) => {
    Object.defineProperty(doc, 'save', { enumerable: false, value: async () => doc });
    return doc;
  };
  const M = {
    modelName: name,
    rows,
    reset() { rows.length = 0; },
    find: (q) => new Chain(() => rows.filter((d) => matches(q, d)), false),
    findOne: (q) => new Chain(() => rows.filter((d) => matches(q, d)), true),
    async create(doc) {
      const d = attach({ _id: nextId(), ...defaults, ...doc });
      rows.push(d);
      return d;
    },
    async exists(q) { return rows.some((d) => matches(q, d)) ? { _id: 'x' } : null; },
    async countDocuments(q) { return rows.filter((d) => matches(q, d)).length; },
    async deleteOne(q) {
      const i = rows.findIndex((d) => matches(q, d));
      if (i >= 0) rows.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    async updateOne(q, upd, opts = {}) {
      let d = rows.find((r) => matches(q, r));
      if (!d) {
        if (!opts.upsert) return { matchedCount: 0 };
        const base = {};
        for (const [k, v] of Object.entries(q)) if (typeof v !== 'object') base[k] = v;
        d = attach({ _id: nextId(), ...defaults, ...base, ...(upd.$setOnInsert || {}) });
        rows.push(d);
      }
      Object.assign(d, upd.$set || {});
      for (const k of Object.keys(upd.$unset || {})) delete d[k];
      for (const [k, v] of Object.entries(upd.$addToSet || {})) {
        d[k] = d[k] || [];
        if (!d[k].includes(v)) d[k].push(v);
      }
      return { matchedCount: 1 };
    },
    async findOneAndUpdate(q, upd, opts = {}) {
      await M.updateOne(q, upd, opts);
      return rows.find((r) => matches(q, r)) || null;
    },
  };
  return M;
}

const models = {
  User: makeModel('User', { gender: 'Unspecified', referredBy: null, assemblyNo: '' }),
  SchemeApplication: makeModel('SchemeApplication'),
  BoothPresidentRequest: makeModel('BoothPresidentRequest', { status: 'Pending' }),
  Scheme: makeModel('Scheme'),
  WhatsAppContact: makeModel('WhatsAppContact'),
  WactoSession: makeModel('WactoSession'),
};

// Fake voter roll: one known EPIC (synthetic test data, not a real voter).
const voterSearchService = {
  async findVoterByEpic(epic) {
    if (String(epic).toUpperCase() !== 'TNA1234567') return null;
    return {
      colName: 'ass_207',
      doc: { EPIC_NO: 'TNA1234567', VOTER_NAME: 'Test Voter', DISTRICT: 'Dindigul', ASSEMBLY_NO: '207',
             ASSEMBLY_NAME: 'Palani', PART_NO: '12', GENDER: 'M' },
    };
  },
};

const sent = [];
const limitErrors = [];   // WhatsApp/Meta limits broken by any interactive message
const control = { failInteractive: false, failLists: false }; // failLists = real WACTO: "Invalid Interactive type"

// Meta rejects the whole message when any of these is exceeded.
function checkLimits(iv) {
  const errs = [];
  const len = (s) => [...String(s || '')].length;
  if (len(iv.body && iv.body.text) > 1024) errs.push('body > 1024');
  if (iv.type === 'button') {
    const b = (iv.action && iv.action.buttons) || [];
    if (!b.length || b.length > 3) errs.push(`buttons count ${b.length}`);
    b.forEach((x) => { if (len(x.reply.title) > 20) errs.push(`button title > 20: ${x.reply.title}`); });
  } else if (iv.type === 'list') {
    const a = iv.action || {};
    if (!a.button || len(a.button) > 20) errs.push('list button text missing or > 20');
    const rows = (a.sections || []).flatMap((s) => {
      if (len(s.title) > 24) errs.push(`section title > 24: ${s.title}`);
      return s.rows || [];
    });
    if (!rows.length || rows.length > 10) errs.push(`rows count ${rows.length}`);
    const ids = new Set();
    rows.forEach((r) => {
      if (len(r.title) > 24) errs.push(`row title > 24: ${r.title}`);
      if (len(r.description) > 72) errs.push(`row description > 72: ${r.title}`);
      if (ids.has(r.id)) errs.push(`duplicate row id ${r.id}`);
      ids.add(r.id);
    });
  } else errs.push(`unknown interactive type ${iv.type}`);
  return errs;
}

const sender = {
  wactoConfigured: () => true,
  async sendWactoText(phone, text) { sent.push({ phone, type: 'text', text }); return { ok: true }; },
  async sendWactoImageWithCaption(phone, link, caption) { sent.push({ phone, type: 'image', text: caption }); return { ok: true }; },
  async sendWactoInteractive(phone, iv) {
    if (control.failInteractive) throw new Error('WACTO API error: simulated rejection');
    if (control.failLists && iv.type === 'list') throw new Error('WACTO API error: Invalid Interactive type');
    limitErrors.push(...checkLimits(iv));
    const options = iv.type === 'button'
      ? iv.action.buttons.map((b) => ({ id: b.reply.id, title: b.reply.title }))
      : iv.action.sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title })));
    sent.push({ phone, type: 'interactive', kind: iv.type, text: iv.body.text, options });
    return { ok: true };
  },
};

function resetAll() {
  Object.values(models).forEach((m) => m.reset());
  sent.length = 0;
  control.failInteractive = false;
  control.failLists = false;
}

module.exports = { models, voterSearchService, sender, sent, limitErrors, control, resetAll };
