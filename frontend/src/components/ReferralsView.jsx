import React, { useState, useEffect, useCallback } from 'react';
import { Share2, RefreshCw, Download, Users, MapPin, Trophy } from 'lucide-react';
import API from '../utils/api';
import TnDistrictMap from './TnDistrictMap';
import { normalizeDistrictName } from '../utils/districtNormalizer';

const REFERRAL_METRIC = {
  title: 'Referrals',
  plural: 'referrals',
  activeNote: 'With Referrers',
  directory: 'DISTRICT REFERRAL DIRECTORY',
};

const PAGE_SIZE = 20;

/**
 * Referrals page (Super Admin / State Admin): Tamil Nadu map of referrals
 * credited to each referrer's own district, the ranked referrer list
 * (filtered by the clicked district) and an Excel export.
 */
const ReferralsView = ({ admin = {} }) => {
  const [mapData, setMapData] = useState({ districtStats: [], totals: { referrals: 0, referrers: 0, unattributed: 0 } });
  const [mapLoading, setMapLoading] = useState(true);
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [referrers, setReferrers] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const fetchMap = useCallback(async () => {
    setMapLoading(true);
    try {
      const res = await API.get('/admin/referral-map');
      if (res.data.success) setMapData({ districtStats: res.data.districtStats || [], totals: res.data.totals || {} });
    } catch (err) {
      console.error('Error fetching referral map:', err);
      setError('Could not load referral data. Please try again.');
    } finally {
      setMapLoading(false);
    }
  }, []);

  const fetchReferrers = useCallback(async (district) => {
    setListLoading(true);
    try {
      const res = await API.get('/admin/referrers', { params: district ? { district } : {} });
      if (res.data.success) setReferrers(res.data.referrers || []);
    } catch (err) {
      console.error('Error fetching referrers:', err);
      setError('Could not load the referrer list. Please try again.');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { fetchMap(); }, [fetchMap]);
  useEffect(() => { setPage(1); fetchReferrers(selectedDistrict); }, [selectedDistrict, fetchReferrers]);

  const refresh = () => { setError(''); fetchMap(); fetchReferrers(selectedDistrict); };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await API.get('/admin/export-referrers', { responseType: 'blob', params: selectedDistrict ? { district: selectedDistrict } : {} });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers['content-disposition'] || '';
      const match = cd.match(/filename="?([^"]+)"?/);
      a.download = match ? match[1] : 'Referrers.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // Top district by referrals (merging spellings the same way the map does).
  const byDistrict = {};
  mapData.districtStats.forEach((d) => {
    const n = normalizeDistrictName(d._id);
    if (n) byDistrict[n] = (byDistrict[n] || 0) + (d.total || 0);
  });
  const topDistrict = Object.entries(byDistrict).sort((a, b) => b[1] - a[1])[0];
  const listTotal = referrers.reduce((a, r) => a + (r.referralCount || 0), 0);
  const totalPages = Math.max(1, Math.ceil(referrers.length / PAGE_SIZE));
  const pageRows = referrers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const statCards = [
    { label: 'Total Referrals', value: mapData.totals.referrals || 0, icon: Share2, color: '#ea580c', bg: '#fff7ed' },
    { label: 'Referrers', value: mapData.totals.referrers || 0, icon: Users, color: '#2563eb', bg: '#eff6ff' },
    { label: 'Districts with Referrals', value: `${Object.keys(byDistrict).length} / 38`, icon: MapPin, color: '#059669', bg: '#ecfdf5' },
    { label: 'Top District', value: topDistrict ? `${topDistrict[0]} (${topDistrict[1]})` : '—', icon: Trophy, color: '#b45309', bg: '#fffbeb' },
  ];

  return (
    <div style={{ width: '100%', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--color-midnight-ink, #0f172a)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Share2 size={24} style={{ color: 'var(--color-saffron, #ff9933)' }} />
            Referrals
          </h2>
          <div style={{ fontSize: '13px', color: 'var(--color-slate, #64748b)', marginTop: '4px' }}>
            Members who joined through a referral, counted in the referrer's own district
          </div>
        </div>
        <button onClick={refresh} className="btn-action btn-view" style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px', fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div className="stat-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="stat-card" style={{ padding: '16px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mapLoading ? '…' : value}</div>
            </div>
          </div>
        ))}
      </div>

      {mapData.totals.unattributed > 0 && (
        <div style={{ marginBottom: '16px', fontSize: '12px', color: '#64748b' }}>
          {mapData.totals.unattributed} referral{mapData.totals.unattributed === 1 ? '' : 's'} could not be placed on the map (the referral code does not match any member).
        </div>
      )}

      <TnDistrictMap
        districtStats={mapData.districtStats}
        metric={REFERRAL_METRIC}
        title="REFERRALS BY DISTRICT"
        selectedDistrict={selectedDistrict}
        onSelectDistrict={setSelectedDistrict}
      />

      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              {selectedDistrict ? `Referrers in ${selectedDistrict}` : 'All Referrers — Tamil Nadu'}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              {listLoading ? 'Loading…' : `${referrers.length} referrer${referrers.length === 1 ? '' : 's'} • ${listTotal} referral${listTotal === 1 ? '' : 's'}`}
              {selectedDistrict && (
                <button onClick={() => setSelectedDistrict('')} style={{ marginLeft: 10, background: 'none', border: 'none', color: '#2563eb', fontWeight: 700, cursor: 'pointer', fontSize: '12px', padding: 0 }}>
                  Show all districts
                </button>
              )}
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || listLoading || referrers.length === 0}
            style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', background: exporting ? '#e0f2fe' : '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '8px', cursor: exporting ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: exporting ? 0.7 : 1 }}
          >
            <Download size={14} /> {exporting ? 'Exporting…' : `Export XLSX${selectedDistrict ? ` (${selectedDistrict})` : ''}`}
          </button>
        </div>

        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                {['Rank', 'Name', 'Mobile', 'Referral Code', 'District', 'Assembly', 'Booth', 'Direct Referrals', 'Network (2 levels)'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr><td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading referrers…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No referrers {selectedDistrict ? `in ${selectedDistrict}` : 'yet'}.</td></tr>
              ) : pageRows.map((r) => (
                <tr key={r.userId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: r.rank <= 3 ? '#ea580c' : '#334155' }}>#{r.rank}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' }}>{r.voterName || '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-ui-monospace, monospace)', whiteSpace: 'nowrap' }}>{r.mobile || '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-ui-monospace, monospace)', whiteSpace: 'nowrap' }}>{r.referralCode || '—'}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.district || '—'}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.assemblyName || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{r.boothNo || '—'}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: '#ea580c' }}>{r.referralCount}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: '#2563eb' }}>{r.networkCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', fontSize: '13px', color: '#475569' }}>
            <span>Page {page} of {totalPages}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="btn-action btn-view" style={{ padding: '6px 12px', opacity: page === 1 ? 0.5 : 1 }}>Previous</button>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="btn-action btn-view" style={{ padding: '6px 12px', opacity: page === totalPages ? 0.5 : 1 }}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReferralsView;
