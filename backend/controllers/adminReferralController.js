const ExcelJS = require('exceljs');
const User = require('../models/User');
const { normalizeDistrictName } = require('../utils/districtNormalizer');

const EMPTY_CODES = [null, '', 'null', 'undefined'];
const codeKey = (v) => String(v || '').trim().toUpperCase();
const isValid = (v) => v && v !== 'undefined' && v !== 'null' && v !== 'all' && String(v).trim() !== '';

// Every referrer with their direct referral count and 2-level network count.
// A member's `referredBy` may hold the referrer's referralCode, EPIC or mobile
// (same matching as the dashboard's Top Referrers card). Each code is credited
// to exactly one referrer — referralCode match first, then EPIC, then mobile —
// so a shared EPIC can't double-count. Referrals are placed in the REFERRER's
// own district.
const buildReferrerRows = async () => {
  const direct = await User.aggregate([
    { $match: { referredBy: { $nin: EMPTY_CODES } } },
    { $group: { _id: '$referredBy', referralCount: { $sum: 1 } } }
  ]);

  const countByCode = {};
  direct.forEach((r) => {
    if (r._id != null) countByCode[codeKey(r._id)] = (countByCode[codeKey(r._id)] || 0) + r.referralCount;
  });
  const totalReferred = Object.values(countByCode).reduce((a, b) => a + b, 0);

  const codeList = direct.map((r) => r._id).filter(Boolean);
  if (!codeList.length) return { rows: [], totalReferred, unattributed: totalReferred };

  const candidates = await User.find({
    $or: [
      { referralCode: { $in: codeList } },
      { epicNo: { $in: codeList } },
      { mobile: { $in: codeList } }
    ]
  }).select('referralCode epicNo mobile voterName district assemblyName boothNo').lean();

  const codeOwner = new Map(); // code -> user
  ['referralCode', 'epicNo', 'mobile'].forEach((field) => {
    candidates.forEach((u) => {
      const k = codeKey(u[field]);
      if (k && countByCode[k] && !codeOwner.has(k)) codeOwner.set(k, u);
    });
  });

  const byUser = new Map(); // userId -> row
  codeOwner.forEach((u, code) => {
    const id = String(u._id);
    if (!byUser.has(id)) {
      byUser.set(id, {
        userId: id,
        voterName: u.voterName || '',
        mobile: u.mobile || '',
        referralCode: u.referralCode || '',
        district: u.district || '',
        normalizedDistrict: normalizeDistrictName(u.district || ''),
        assemblyName: u.assemblyName || '',
        boothNo: u.boothNo || '',
        referralCount: 0,
        networkCount: 0,
        codes: []
      });
    }
    const row = byUser.get(id);
    row.referralCount += countByCode[code];
    row.codes.push(code);
  });

  // Level 2: members referred by the people each referrer brought in.
  const ownedCodes = [...codeOwner.keys()];
  const rawOwnedCodes = codeList.filter((c) => codeOwner.has(codeKey(c)));
  const l1Users = await User.find({ referredBy: { $in: rawOwnedCodes } }).select('referralCode referredBy').lean();
  const l1Codes = l1Users.map((u) => u.referralCode).filter(Boolean);
  const l2ByCode = {};
  if (l1Codes.length) {
    const l2 = await User.aggregate([
      { $match: { referredBy: { $in: l1Codes } } },
      { $group: { _id: '$referredBy', count: { $sum: 1 } } }
    ]);
    l2.forEach((r) => { if (r._id) l2ByCode[codeKey(r._id)] = r.count; });
  }
  const l2ByOwner = {};
  l1Users.forEach((l1) => {
    const owner = codeOwner.get(codeKey(l1.referredBy));
    if (owner && l1.referralCode) {
      const id = String(owner._id);
      l2ByOwner[id] = (l2ByOwner[id] || 0) + (l2ByCode[codeKey(l1.referralCode)] || 0);
    }
  });

  const rows = [...byUser.values()].map((r) => {
    const { codes, ...rest } = r;
    return { ...rest, networkCount: r.referralCount + (l2ByOwner[r.userId] || 0) };
  });
  rows.sort((a, b) => b.referralCount - a.referralCount || b.networkCount - a.networkCount || a.voterName.localeCompare(b.voterName));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const attributed = rows.reduce((a, r) => a + r.referralCount, 0);
  return { rows, totalReferred, unattributed: totalReferred - attributed, ownedCodes: ownedCodes.length };
};

// Same masking as the State Admin's Top Referrers card (TopReferrersCard maskPII):
// only SUPER_ADMIN gets full mobile numbers and referral codes.
const maskMobile = (m) => { const s = String(m || ''); return s.length >= 6 ? s.slice(0, 3) + 'XXXX' + s.slice(-3) : s; };
const maskCode = (c) => { const s = String(c || ''); return s.length > 6 ? s.slice(0, 6) + 'XXXX' : s; };
const applyPiiMask = (rows, admin) => (admin && admin.role === 'SUPER_ADMIN')
  ? rows
  : rows.map((r) => ({ ...r, mobile: maskMobile(r.mobile), referralCode: maskCode(r.referralCode) }));

const filterByDistrict = (rows, district) => {
  if (!isValid(district)) return rows;
  const target = normalizeDistrictName(district);
  return rows.filter((r) => r.normalizedDistrict === target);
};

// @desc    Referral counts per referrer district (Tamil Nadu map)
// @route   GET /api/admin/referral-map
// @access  SUPER_ADMIN, STATE_ADMIN
const getReferralMap = async (req, res) => {
  try {
    const { rows, totalReferred, unattributed } = await buildReferrerRows();
    const byDistrict = {};
    rows.forEach((r) => {
      const d = r.district || 'Unknown';
      if (!byDistrict[d]) byDistrict[d] = { _id: d, total: 0, referrers: 0 };
      byDistrict[d].total += r.referralCount;
      byDistrict[d].referrers += 1;
    });
    return res.status(200).json({
      success: true,
      districtStats: Object.values(byDistrict).sort((a, b) => b.total - a.total),
      totals: {
        referrals: totalReferred - unattributed,
        referrers: rows.length,
        unattributed
      }
    });
  } catch (error) {
    console.error('[getReferralMap Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch referral map' });
  }
};

// @desc    Ranked referrers, optionally for one district
// @route   GET /api/admin/referrers?district=
// @access  SUPER_ADMIN, STATE_ADMIN
const getReferrers = async (req, res) => {
  try {
    const { rows } = await buildReferrerRows();
    const filtered = applyPiiMask(filterByDistrict(rows, req.query.district), req.admin);
    return res.status(200).json({
      success: true,
      district: isValid(req.query.district) ? normalizeDistrictName(req.query.district) : null,
      referrers: filtered,
      totals: {
        referrers: filtered.length,
        referrals: filtered.reduce((a, r) => a + r.referralCount, 0)
      }
    });
  } catch (error) {
    console.error('[getReferrers Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch referrers' });
  }
};

// @desc    Excel export of ranked referrers, optionally for one district
// @route   GET /api/admin/export-referrers?district=
// @access  SUPER_ADMIN, STATE_ADMIN
const exportReferrersExcel = async (req, res) => {
  try {
    const user = req.admin;
    const { district } = req.query;
    const { rows } = await buildReferrerRows();
    const filtered = applyPiiMask(filterByDistrict(rows, district), user);
    const distName = isValid(district) ? normalizeDistrictName(district) : '';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BJP Nalam Thittam';
    const sheet = workbook.addWorksheet('Referrers', { views: [{ state: 'frozen', ySplit: 5 }] });

    const COLUMNS = [
      { header: 'Rank',              key: 'rank',     width: 7  },
      { header: 'Name',              key: 'name',     width: 26 },
      { header: 'Mobile',            key: 'mobile',   width: 14 },
      { header: 'Referral Code',     key: 'code',     width: 16 },
      { header: 'District',          key: 'district', width: 18 },
      { header: 'Assembly',          key: 'assembly', width: 22 },
      { header: 'Booth No',          key: 'booth',    width: 9  },
      { header: 'Direct Referrals',  key: 'direct',   width: 15 },
      { header: 'Network (2 levels)', key: 'network', width: 17 },
    ];
    sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
    const LAST_COL = 'I';

    const titleRow = (r, value, font, height) => {
      sheet.mergeCells(`A${r}:${LAST_COL}${r}`);
      const cell = sheet.getCell(`A${r}`);
      cell.value = value;
      cell.font = font;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      sheet.getRow(r).height = height;
    };
    const totalDirect = filtered.reduce((a, r) => a + r.referralCount, 0);
    titleRow(1, 'BJP Nalam Thittam — Referrers Report', { bold: true, size: 16, color: { argb: 'FFFF6B00' }, name: 'Calibri' }, 26);
    titleRow(2, distName ? `District-wise Report — ${distName}` : 'Statewide Report — All Tamil Nadu', { bold: true, size: 12, color: { argb: 'FF1F2937' } }, 20);
    titleRow(3, `Referrers: ${filtered.length}    |    Direct referrals: ${totalDirect}    |    Credited to the referrer's own district`, { size: 11, italic: true, color: { argb: 'FF475569' } }, 18);
    titleRow(4, `Generated by ${user.username || user.role}  •  ${new Date().toLocaleString('en-IN')}`, { size: 10, color: { argb: 'FF94A3B8' } }, 16);

    const headerRow = sheet.getRow(5);
    COLUMNS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.eachCell((cell) => {
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border    = { bottom: { style: 'medium', color: { argb: 'FFCC5500' } } };
    });
    headerRow.height = 22;

    filtered.forEach((r, i) => {
      const row = sheet.addRow({
        rank:     r.rank,
        name:     r.voterName    || '—',
        mobile:   r.mobile       || '—',
        code:     r.referralCode || '—',
        district: r.district     || '—',
        assembly: r.assemblyName || '—',
        booth:    r.boothNo      || '—',
        direct:   r.referralCount,
        network:  r.networkCount,
      });
      const rowBg = (i + 1) % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF';
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: 'middle', wrapText: false };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      });
      row.getCell('mobile').numFmt = '@';
    });

    const distLabel = distName ? `_${distName.replace(/\s+/g, '_')}` : '';
    const filename = `Referrers${distLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('[exportReferrersExcel Error]:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Failed to export referrers' });
  }
};

module.exports = {
  buildReferrerRows,
  getReferralMap,
  getReferrers,
  exportReferrersExcel
};
