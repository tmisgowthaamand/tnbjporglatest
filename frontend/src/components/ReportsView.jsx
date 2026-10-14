import React, { useState, useEffect } from 'react';
import ExcelJS from 'exceljs';
import API from '../utils/api';
import { useAuth } from '../context/AuthContext';
import StatusBadge from './StatusBadge';
import { useBjpSchemes } from '../utils/schemesData';
import TrendsChart from './TrendsChart';
import SchemePieChart from './SchemePieChart';
import {
  FileSpreadsheet, Filter, Search, RefreshCw, Download, Users, FileText, CheckCircle2, Clock, XCircle, Shield,
  BarChart2, UserX, TrendingUp, MapPin
} from 'lucide-react';

const SCHEME_OPTIONS = [
  'PMSBY (Pradhan Mantri Suraksha Bima Yojana)',
  'PMJJBY (Pradhan Mantri Jeevan Jyoti Bima Yojana)',
  'APY (Atal Pension Yojana)',
  'PM SVANidhi (Street Vendor Loan)',
  'PM Mudra Shishu (Up to ₹50,000)',
  'PM Mudra Kishor (₹50,000 to ₹5 Lakhs)',
  'Udyam MSME Registration',
  'Stand Up India Scheme',
  'Startup India Seed Fund Scheme',
  'PM Kisan Samman Nidhi (₹6,000/yr)',
  'PM Fasal Bima Yojana (Crop Insurance)',
  'PM Kisan Maan Dhan Yojana (Pension)',
  'PM Ujjwala Yojana (Free LPG)',
  'PM Matru Vandana Yojana (Maternity Benefit)',
  'Sukanya Samriddhi Yojana (Girl Child Savings)',
  'PMKVY (Pradhan Mantri Kaushal Vikas Yojana)',
  'NSP National Scholarship Portal',
  'PM Vishwakarma Scheme',
  'PM Jan Dhan Yojana (Zero-Balance Account)',
  'e-Shram Unorganised Workers Portal'
];

const STATUS_OPTIONS = [
  'Submitted',
  'Pending',
  'Processing',
  'In Progress',
  'Called',
  'Verified',
  'Approved',
  'Rejected'
];

const ReportsView = ({
  initialDistrict = '',
  initialAssembly = '',
  initialBooth = '',
  initialStatus = '',
  initialScheme = ''
}) => {
  const { admin } = useAuth();
  const BJP_SCHEMES = useBjpSchemes();
  const role = admin?.role || 'SUPER_ADMIN';

  // Filters State
  const [districtFilter, setDistrictFilter] = useState(initialDistrict || admin?.district || '');
  const [assemblyFilter, setAssemblyFilter] = useState(initialAssembly || admin?.assemblyName || '');
  const [boothFilter, setBoothFilter] = useState(initialBooth || (admin?.boothNo ? String(admin.boothNo) : ''));
  const [statusFilter, setStatusFilter] = useState(initialStatus || '');
  const [schemeFilter, setSchemeFilter] = useState(initialScheme || '');
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdowns Meta
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [booths, setBooths] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Data & Loading State
  const [reportVoters, setReportVoters] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0); // distinct applied voters
  const [totalApps, setTotalApps] = useState(0);       // total scheme applications
  const [statusCounts, setStatusCounts] = useState({ Approved: 0, Pending: 0, Submitted: 0, Processing: 0, Called: 0, Verified: 0, Completed: 0, Rejected: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingData, setLoadingData] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ── Analytics Tab State ──
  const [activeTab, setActiveTab] = useState('report');
  const [trendDays, setTrendDays] = useState(14);
  const [statsData, setStatsData] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [incompleteStats, setIncompleteStats] = useState(null);
  const [loadingIncomplete, setLoadingIncomplete] = useState(false);
  const [exportingType, setExportingType] = useState(null);

  const isDistrictLocked = ['DISTRICT_ADMIN', 'ASSEMBLY_ADMIN', 'BOOTH_ADMIN'].includes(role);
  const isAssemblyLocked = ['ASSEMBLY_ADMIN', 'BOOTH_ADMIN'].includes(role);
  const isBoothLocked    = role === 'BOOTH_ADMIN';

  // ── Fetch Initial Filter Metadata ──
  const fetchInitialMeta = async () => {
    try {
      setLoadingMeta(true);
      const res = await API.get('/admin/filter-meta');
      if (res.data.success) {
        setDistricts(res.data.districts || []);
        if (!districtFilter) setAssemblies(res.data.assemblies || []);
      }
    } catch (err) {
      console.error('Error fetching metadata:', err);
    } finally {
      setLoadingMeta(false);
    }
  };

  // ── Fetch Assemblies for District ──
  const fetchAssembliesForDistrict = async (dist) => {
    if (!dist) { fetchInitialMeta(); return; }
    try {
      const res = await API.get(`/admin/filter-meta?district=${encodeURIComponent(dist)}`);
      if (res.data.success) setAssemblies(res.data.assemblies || []);
    } catch (err) {
      console.error('Error fetching assemblies:', err);
    }
  };

  // ── Fetch Booths for Assembly ──
  const fetchBoothsForAssembly = async (ass, dist) => {
    if (!ass) { setBooths([]); return; }
    try {
      const params = new URLSearchParams({ assemblyName: ass, ...(dist && { district: dist }) });
      const res = await API.get(`/admin/filter-meta?${params}`);
      if (res.data.success) setBooths(res.data.booths || []);
    } catch (err) {
      console.error('Error fetching booths:', err);
    }
  };

  // ── Fetch Report Applications ──
  const fetchReportData = async () => {
    try {
      setLoadingData(true);
      const params = new URLSearchParams({
        page: currentPage,
        limit: 50,
        ...(searchQuery    && { search: searchQuery }),
        ...(statusFilter   && { status: statusFilter }),
        ...(schemeFilter   && { schemeName: schemeFilter }),
        ...(districtFilter && { district: districtFilter }),
        ...(assemblyFilter && { assemblyName: assemblyFilter }),
        ...(boothFilter    && { boothNo: boothFilter })
      });
      const res = await API.get(`/admin/applications?${params}`);
      if (res.data.success) {
        setReportVoters(res.data.voters || []);
        setTotalRecords(res.data.totalVoters || 0);
        setTotalApps(res.data.totalApplications || res.data.totalVoters || 0);
        setTotalPages(res.data.totalPages || 1);
        if (res.data.statusCounts) {
          setStatusCounts(res.data.statusCounts);
        }
      }
    } catch (err) {
      console.error('Error fetching report data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const fetchAnalyticsStats = async () => {
    if (statsData) return;
    setLoadingStats(true);
    try {
      const res = await API.get('/admin/dashboard-stats');
      if (res.data?.success) {
        setStatsData(res.data);
      }
    } catch (err) {
      console.error('Error fetching analytics stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchIncompleteStats = async () => {
    if (incompleteStats) return;
    setLoadingIncomplete(true);
    try {
      const [allRes, otpRes, epicRes] = await Promise.all([
        API.get('/admin/incomplete-registrations', { params: { limit: 5 } }),
        API.get('/admin/incomplete-registrations', { params: { limit: 1, stage: 'OTP_VERIFIED' } }),
        API.get('/admin/incomplete-registrations', { params: { limit: 1, stage: 'EPIC_VERIFIED' } }),
      ]);
      setIncompleteStats({
        records: allRes.data?.records || [],
        total: allRes.data?.total || 0,
        otpCount: otpRes.data?.total || 0,
        epicCount: epicRes.data?.total || 0,
      });
    } catch (err) {
      console.error('Error fetching incomplete stats:', err);
    } finally {
      setLoadingIncomplete(false);
    }
  };

  const exportAnalytics = async (type) => {
    setExportingType(type);
    try {
      const params = { type };
      if (type === 'datewise') params.days = trendDays;
      const res = await API.get('/admin/export-analytics', { params, responseType: 'blob' });
      const blob = res.data;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers?.['content-disposition'] || '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : `BJP_${type}_export.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export analytics error:', err);
    } finally {
      setExportingType(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalyticsStats();
      fetchIncompleteStats();
    }
  }, [activeTab]);

  useEffect(() => {
    fetchInitialMeta();
  }, []);

  useEffect(() => {
    if (!isAssemblyLocked) {
      setAssemblyFilter(admin?.assemblyName || '');
      setBoothFilter(admin?.boothNo ? String(admin.boothNo) : '');
      setBooths([]);
      fetchAssembliesForDistrict(districtFilter);
    }
  }, [districtFilter]);

  useEffect(() => {
    if (!isBoothLocked) {
      setBoothFilter(admin?.boothNo ? String(admin.boothNo) : '');
      fetchBoothsForAssembly(assemblyFilter, districtFilter);
    }
  }, [assemblyFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [districtFilter, assemblyFilter, boothFilter, statusFilter, schemeFilter, searchQuery]);

  useEffect(() => {
    fetchReportData();
  }, [districtFilter, assemblyFilter, boothFilter, statusFilter, schemeFilter, searchQuery, currentPage]);

  // ── Resolve a scheme's display name (some records store the numeric scheme
  // id in schemeName/schemeId; map those back to the readable name). ──
  const schemeNameById = React.useMemo(() => {
    const m = {};
    (BJP_SCHEMES || []).forEach(s => { if (s.id != null && s.name) m[String(s.id)] = s.name; });
    return m;
  }, [BJP_SCHEMES]);
  const resolveSchemeName = (raw) => {
    if (raw == null || String(raw).trim() === '') return 'General Scheme';
    const str = String(raw).trim();
    if (/^\d+$/.test(str)) return schemeNameById[str] || `Scheme ${str}`;
    return str;
  };

  // ── Flatten All Scheme Application Items for Export & Stats ──
  const allReportApps = reportVoters.flatMap(v => {
    if (!v.applications || v.applications.length === 0) {
      return [{
        voterName: v.voterName || 'N/A',
        epicNo: v.epicNo || 'N/A',
        mobile: v.mobile || 'N/A',
        district: v.district || 'N/A',
        assemblyName: v.assemblyName || 'N/A',
        boothNo: v.boothNo || 'N/A',
        schemeName: 'No Scheme Applied',
        clusterName: '—',
        status: 'Unregistered',
        appliedAt: '—',
        referredBy: v.referredBy || '—'
      }];
    }
    return v.applications.map(app => ({
      voterName: v.voterName || app.voterName || 'N/A',
      epicNo: v.epicNo || app.epicNo || 'N/A',
      mobile: v.mobile || app.mobile || 'N/A',
      district: v.district || app.district || 'N/A',
      assemblyName: v.assemblyName || app.assemblyName || 'N/A',
      boothNo: v.boothNo || app.boothNo || 'N/A',
      schemeName: resolveSchemeName(app.schemeName || app.schemeId),
      clusterName: app.clusterName || 'BJP Welfare',
      status: app.status || 'Submitted',
      appliedAt: app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() : '—',
      referredBy: v.referredBy || '—'
    }));
  });

  const totalAppsCount = totalApps || allReportApps.length;
  const approvedCount = (statusCounts.Approved || 0) + (statusCounts.Completed || 0);
  const pendingCount = (statusCounts.Submitted || 0) + (statusCounts.Pending || 0) + (statusCounts.Processing || 0) + (statusCounts.Called || 0) + (statusCounts.Verified || 0);
  const rejectedCount = statusCounts.Rejected || 0;

  // ── Styled Excel Download via backend (server-side ExcelJS, fast) ──
  const handleDownloadCsv = () => {
    const token = localStorage.getItem('bjp_admin_token');
    const apiBase = import.meta.env.VITE_API_URL || '';
    const params = new URLSearchParams({
      ...(searchQuery    && { search: searchQuery }),
      ...(statusFilter   && { status: statusFilter }),
      ...(schemeFilter   && { schemeName: schemeFilter }),
      ...(districtFilter && { district: districtFilter }),
      ...(assemblyFilter && { assemblyName: assemblyFilter }),
      ...(boothFilter    && { boothNo: boothFilter })
    });

    setIsExporting(true);
    fetch(`${apiBase}/api/admin/export-excel?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Export failed');
        const cd = res.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : `BJP_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
        return res.blob().then(blob => ({ blob, filename }));
      })
      .then(({ blob, filename }) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      })
      .catch(err => console.error('Excel download error:', err))
      .finally(() => setIsExporting(false));
  };


  return (
    <div style={{ width: '100%', boxSizing: 'border-box' }}>
      
      {/* ── Page Header Banner ── */}
      <div className="campsite-card" style={{ width: '100%', padding: '24px', marginBottom: '24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span className="tag-pill tag-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <FileSpreadsheet size={12} /> REPORTS &amp; EXPORT CENTER
              </span>
              <span style={{ fontSize: '12px', background: 'rgba(255, 153, 51, 0.15)', color: '#FF9933', padding: '2px 10px', borderRadius: '12px', fontWeight: '700' }}>
                {role}
              </span>
            </div>
            <h1 className="text-heading" style={{ margin: 0 }}>
              Scheme Applications &amp; Member Reports
            </h1>
            <div style={{ fontSize: '13px', color: 'var(--color-slate)', marginTop: '4px' }}>
              Generate, filter, and export customized Excel reports for Central Government Welfare Schemes.
            </div>
          </div>

          <button
            onClick={handleDownloadCsv}
            disabled={isExporting || totalRecords === 0}
            className="btn btn-primary"
            style={{
              padding: '10px 22px',
              fontSize: '14px',
              fontWeight: '700',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(255, 153, 51, 0.3)',
              cursor: isExporting ? 'wait' : 'pointer'
            }}
          >
            {isExporting ? <RefreshCw size={16} className="spin-icon" /> : <Download size={16} />}
            {isExporting ? 'Downloading CSV...' : 'Download CSV Report'}
          </button>
        </div>
      </div>

      {/* ── Tab Switcher ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--color-fog-gray)', borderRadius: '12px', padding: '4px', width: 'fit-content' }}>
        {[
          { key: 'report', label: 'Report Data', icon: <FileSpreadsheet size={14} /> },
          { key: 'analytics', label: 'Analytics', icon: <BarChart2 size={14} /> }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '8px', border: 'none',
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? 'var(--color-midnight-ink)' : 'var(--color-slate)',
              fontWeight: activeTab === tab.key ? '700' : '500',
              fontSize: '13px', cursor: 'pointer',
              boxShadow: activeTab === tab.key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
              transition: 'all 0.15s'
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Analytics Section ── */}
      {activeTab === 'analytics' && (
        <div style={{ width: '100%' }}>

          {/* Date-wise Daily Registrations */}
          <div className="campsite-card" style={{ padding: '20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={18} color="var(--color-saffron)" />
                <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-midnight-ink)' }}>Daily Registration Trend</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {[14, 30, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setTrendDays(d)}
                    style={{
                      padding: '4px 12px', borderRadius: '20px', border: '1px solid',
                      borderColor: trendDays === d ? 'var(--color-saffron)' : 'var(--color-linen)',
                      background: trendDays === d ? 'rgba(255,153,51,0.1)' : 'transparent',
                      color: trendDays === d ? 'var(--color-saffron)' : 'var(--color-slate)',
                      fontWeight: trendDays === d ? '700' : '500',
                      fontSize: '12px', cursor: 'pointer'
                    }}
                  >
                    {d}D
                  </button>
                ))}
                <button onClick={() => exportAnalytics('datewise')} disabled={!!exportingType} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--color-linen)', background: 'transparent', color: 'var(--color-slate)', fontSize: '12px', fontWeight: '500', cursor: 'pointer', opacity: exportingType === 'datewise' ? 0.6 : 1 }}>
                  <Download size={11} />{exportingType === 'datewise' ? 'Exporting…' : 'Export'}
                </button>
              </div>
            </div>
            <TrendsChart key={trendDays} days={trendDays} />
          </div>

          {/* Scheme-wise Distribution */}
          {loadingStats ? (
            <div className="campsite-card" style={{ padding: '32px', textAlign: 'center', marginBottom: '20px', color: 'var(--color-slate)' }}>
              <RefreshCw size={20} className="spin-icon" style={{ marginBottom: '8px' }} />
              <div>Loading scheme analytics…</div>
            </div>
          ) : statsData && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                <button onClick={() => exportAnalytics('schemewise')} disabled={!!exportingType} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', borderRadius: '20px', border: '1px solid var(--color-linen)', background: 'transparent', color: 'var(--color-slate)', fontSize: '12px', fontWeight: '500', cursor: 'pointer', opacity: exportingType === 'schemewise' ? 0.6 : 1 }}>
                  <Download size={11} />{exportingType === 'schemewise' ? 'Exporting…' : 'Export Schemewise'}
                </button>
              </div>
              <SchemePieChart schemePopularity={statsData.schemePopularity || []} />

              {/* District-wise Breakdown */}
              {(statsData.districtStats || []).length > 0 && (
                <div className="campsite-card" style={{ padding: '20px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <MapPin size={18} color="var(--color-saffron)" />
                    <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-midnight-ink)' }}>District-wise Breakdown</span>
                    <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginLeft: '4px' }}>({statsData.districtStats.length} districts)</span>
                    <button onClick={() => exportAnalytics('districtwise')} disabled={!!exportingType} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--color-linen)', background: 'transparent', color: 'var(--color-slate)', fontSize: '12px', fontWeight: '500', cursor: 'pointer', opacity: exportingType === 'districtwise' ? 0.6 : 1 }}>
                      <Download size={11} />{exportingType === 'districtwise' ? 'Exporting…' : 'Export'}
                    </button>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-fog-gray)', borderBottom: '2px solid var(--color-linen)' }}>
                          {['District', 'Total', 'Approved', 'Pending', 'Share %'].map(h => (
                            <th key={h} style={{ padding: '10px 14px', textAlign: h === 'District' ? 'left' : 'center', fontWeight: '700', color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(statsData.districtStats || [])
                          .sort((a, b) => (b.totalApps || 0) - (a.totalApps || 0))
                          .map((d, i) => {
                            const grandTotal = statsData.districtStats.reduce((s, x) => s + (x.totalApps || 0), 0);
                            const pct = grandTotal > 0 ? ((d.totalApps / grandTotal) * 100).toFixed(1) : '0.0';
                            return (
                              <tr key={d._id || i} style={{ borderBottom: '1px solid var(--color-linen)', background: i % 2 === 0 ? '#fff' : 'var(--color-fog-gray)' }}>
                                <td style={{ padding: '10px 14px', fontWeight: '600', color: 'var(--color-midnight-ink)' }}>{d._id || d.district || '—'}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: 'var(--color-electric-blue)', fontVariantNumeric: 'tabular-nums' }}>{(d.totalApps || 0).toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: '#16a34a', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{(d.approved || 0).toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: '#ca8a04', fontVariantNumeric: 'tabular-nums' }}>{(d.pending || 0).toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  <span style={{ fontSize: '12px', background: 'rgba(255,153,51,0.1)', color: 'var(--color-saffron)', padding: '2px 8px', borderRadius: '12px', fontWeight: '600' }}>{pct}%</span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Assembly-wise Breakdown */}
              {(statsData.assemblyStats || []).length > 0 && (
                <div className="campsite-card" style={{ padding: '20px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <Shield size={18} color="#5856d6" />
                    <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-midnight-ink)' }}>Assembly-wise Breakdown</span>
                    <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginLeft: '4px' }}>({statsData.assemblyStats.length} assemblies)</span>
                    <button onClick={() => exportAnalytics('assemblywise')} disabled={!!exportingType} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--color-linen)', background: 'transparent', color: 'var(--color-slate)', fontSize: '12px', fontWeight: '500', cursor: 'pointer', opacity: exportingType === 'assemblywise' ? 0.6 : 1 }}>
                      <Download size={11} />{exportingType === 'assemblywise' ? 'Exporting…' : 'Export'}
                    </button>
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                        <tr style={{ background: 'var(--color-fog-gray)', borderBottom: '2px solid var(--color-linen)' }}>
                          {['Assembly', 'District', 'Total', 'Approved', 'Pending'].map(h => (
                            <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Assembly' || h === 'District' ? 'left' : 'center', fontWeight: '700', color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(statsData.assemblyStats || [])
                          .sort((a, b) => (b.totalApps || 0) - (a.totalApps || 0))
                          .map((a, i) => {
                            const assemblyName = (a._id && typeof a._id === 'object') ? a._id.assemblyName : (a.assemblyName || a._id || '—');
                            const district = (a._id && typeof a._id === 'object') ? a._id.district : (a.district || '—');
                            return (
                              <tr key={assemblyName + i} style={{ borderBottom: '1px solid var(--color-linen)', background: i % 2 === 0 ? '#fff' : 'var(--color-fog-gray)' }}>
                                <td style={{ padding: '10px 14px', fontWeight: '600', color: 'var(--color-midnight-ink)', whiteSpace: 'nowrap' }}>{assemblyName || '—'}</td>
                                <td style={{ padding: '10px 14px', color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>{district || '—'}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700', color: 'var(--color-electric-blue)', fontVariantNumeric: 'tabular-nums' }}>{(a.totalApps || 0).toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: '#16a34a', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{(a.approved || 0).toLocaleString()}</td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', color: '#ca8a04', fontVariantNumeric: 'tabular-nums' }}>{(a.pending || 0).toLocaleString()}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Incomplete Registrations Summary */}
          <div className="campsite-card" style={{ padding: '20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <UserX size={18} color="#dc2626" />
              <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-midnight-ink)' }}>Incomplete Registrations</span>
              <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginLeft: '4px' }}>People who verified OTP but never submitted a scheme</span>
              {['SUPER_ADMIN', 'STATE_ADMIN'].includes(role) && (
                <button onClick={() => exportAnalytics('incomplete')} disabled={!!exportingType} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', padding: '4px 10px', borderRadius: '20px', border: '1px solid #fca5a5', background: 'transparent', color: '#dc2626', fontSize: '12px', fontWeight: '500', cursor: 'pointer', opacity: exportingType === 'incomplete' ? 0.6 : 1 }}>
                  <Download size={11} />{exportingType === 'incomplete' ? 'Exporting…' : 'Export All'}
                </button>
              )}
            </div>

            {loadingIncomplete ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-slate)' }}>
                <RefreshCw size={16} className="spin-icon" style={{ marginBottom: '6px' }} />
                <div style={{ fontSize: '13px' }}>Loading…</div>
              </div>
            ) : incompleteStats ? (
              <>
                {/* Summary counts */}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[
                    { label: 'Total Leads', value: incompleteStats.total || 0, color: '#dc2626', bg: '#fef2f2' },
                    { label: 'OTP Done (no EPIC)', value: incompleteStats.otpCount || 0, color: '#c2410c', bg: '#fff7ed' },
                    { label: 'EPIC Found (no submit)', value: incompleteStats.epicCount || 0, color: '#1d4ed8', bg: '#eff6ff' },
                  ].map(s => (
                    <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.color}30`, borderRadius: '10px', padding: '12px 18px', minWidth: '140px' }}>
                      <div style={{ fontSize: '22px', fontWeight: '800', color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value.toLocaleString()}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Recent leads table */}
                {(incompleteStats.records || []).length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-fog-gray)', borderBottom: '2px solid var(--color-linen)' }}>
                          {['Mobile', 'Stage', 'Name', 'District', 'Assembly', 'Captured'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '700', color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(incompleteStats.records || []).slice(0, 5).map((r, i) => (
                          <tr key={r._id || i} style={{ borderBottom: '1px solid var(--color-linen)' }}>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: '500' }}>{r.mobile || '—'}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{
                                fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '20px',
                                background: r.stage === 'EPIC_VERIFIED' ? '#eff6ff' : '#fff7ed',
                                color: r.stage === 'EPIC_VERIFIED' ? '#1d4ed8' : '#c2410c'
                              }}>
                                {r.stage === 'EPIC_VERIFIED' ? 'EPIC Found' : 'OTP Done'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', color: 'var(--color-midnight-ink)' }}>{r.voterName || '—'}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--color-slate)' }}>{r.district || '—'}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--color-slate)' }}>{r.assemblyName || '—'}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--color-slate)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                              {r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(incompleteStats.total || 0) > 5 && (
                      <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--color-slate)', borderTop: '1px solid var(--color-linen)' }}>
                        Showing 5 of {incompleteStats.total} leads. Go to <strong>Incomplete Registrations</strong> tab for full list.
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>

        </div>
      )}

      {/* ── Report Mode: Filters + Stats + Table ── */}
      {activeTab === 'report' && (
      <>
      {/* ── Filter Bar Card ── */}
      <div className="campsite-card" style={{ width: '100%', padding: '20px', marginBottom: '24px', boxSizing: 'border-box' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--color-midnight-ink)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Filter size={15} color="var(--color-saffron)" /> Report Scope &amp; Data Filters
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', width: '100%' }}>
          
          {/* Search Input */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-slate)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Search Member</label>
            <div style={{ position: 'relative', marginTop: '4px' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name, EPIC, Mobile..."
                className="form-control"
                style={{ paddingLeft: '32px' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--color-slate)' }} />
            </div>
          </div>

          {/* District Filter */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-slate)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>District</label>
            <select
              value={districtFilter}
              disabled={isDistrictLocked}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="form-control"
              style={{ marginTop: '4px', cursor: isDistrictLocked ? 'not-allowed' : 'pointer' }}
            >
              <option value="">All Districts (Statewide)</option>
              {districts.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Assembly Filter */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-slate)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assembly Constituency</label>
            <select
              value={assemblyFilter}
              disabled={isAssemblyLocked}
              onChange={(e) => setAssemblyFilter(e.target.value)}
              className="form-control"
              style={{ marginTop: '4px', cursor: isAssemblyLocked ? 'not-allowed' : 'pointer' }}
            >
              <option value="">All Assemblies</option>
              {assemblies.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Booth Filter */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-slate)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Booth / Part No</label>
            <select
              value={boothFilter}
              disabled={isBoothLocked}
              onChange={(e) => setBoothFilter(e.target.value)}
              className="form-control"
              style={{ marginTop: '4px', cursor: isBoothLocked ? 'not-allowed' : 'pointer' }}
            >
              <option value="">All Booths</option>
              {booths.map(b => (
                <option key={b} value={b}>Booth {b}</option>
              ))}
            </select>
          </div>

          {/* Scheme Status Filter */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-slate)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Application Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="form-control"
              style={{ marginTop: '4px' }}
            >
              <option value="">All Application Statuses</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Scheme Name Filter */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-slate)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>BJP Scheme Name</label>
            <select
              value={BJP_SCHEMES.find(s => s.name.toLowerCase() === (schemeFilter || '').toLowerCase() || (s.fullTitle && s.fullTitle.toLowerCase() === (schemeFilter || '').toLowerCase()))?.name || schemeFilter || ''}
              onChange={(e) => setSchemeFilter(e.target.value)}
              className="form-control"
              style={{ marginTop: '4px' }}
            >
              <option value="">All {BJP_SCHEMES.length} Central BJP Schemes</option>
              {BJP_SCHEMES.map(s => (
                <option key={s.id} value={s.name}>
                  {s.name} ({s.fullTitle || s.fullName})
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Reset Filters Row */}
        {(districtFilter || assemblyFilter || boothFilter || statusFilter || schemeFilter || searchQuery) && (
          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                if (!isDistrictLocked) setDistrictFilter('');
                if (!isAssemblyLocked) setAssemblyFilter('');
                if (!isBoothLocked) setBoothFilter('');
                setStatusFilter('');
                setSchemeFilter('');
                setSearchQuery('');
              }}
              style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
            >
              ✕ Clear All Filters
            </button>
          </div>
        )}
      </div>

      {/* ── Summary Stats Cards (5 Column Grid) ── */}
      <div className="reports-stat-grid">
        
        {/* Total Members */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <Users size={18} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="stat-number" style={{ color: '#2563eb' }}>{totalRecords}</div>
            <div className="stat-label">Unique Members</div>
          </div>
        </div>

        {/* Total Applications */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fff7ed', color: '#ea580c' }}>
            <FileText size={18} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="stat-number" style={{ color: '#ea580c' }}>{totalAppsCount}</div>
            <div className="stat-label">Scheme Applications</div>
          </div>
        </div>

        {/* Approved */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <CheckCircle2 size={18} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="stat-number" style={{ color: '#16a34a' }}>{approvedCount}</div>
            <div className="stat-label">Approved Directives</div>
          </div>
        </div>

        {/* Pending */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fefce8', color: '#ca8a04' }}>
            <Clock size={18} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="stat-number" style={{ color: '#ca8a04' }}>{pendingCount}</div>
            <div className="stat-label">Pending Verification</div>
          </div>
        </div>

        {/* Rejected */}
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
            <XCircle size={18} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="stat-number" style={{ color: '#dc2626' }}>{rejectedCount}</div>
            <div className="stat-label">Rejected / Action Needed</div>
          </div>
        </div>

      </div>


      {/* ── Report Data Table View ── */}
      <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--color-midnight-ink)', margin: 0 }}>
              Report Data Preview ({allReportApps.length} Application Records)
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
              Showing matching records in current view. Click "Download Excel Report" above to export the complete report dataset.
            </span>
          </div>

          <button
            onClick={handleDownloadCsv}
            disabled={isExporting || totalRecords === 0}
            className="btn btn-secondary"
            style={{ padding: '6px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>

        {loadingData ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-slate)' }}>
            <RefreshCw size={24} className="spin-icon" style={{ marginBottom: '10px' }} />
            <div>Loading report dataset...</div>
          </div>
        ) : allReportApps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-slate)', background: 'var(--color-fog-gray)', borderRadius: '8px' }}>
            <FileSpreadsheet size={32} style={{ marginBottom: '10px', color: 'var(--color-slate)' }} />
            <div style={{ fontWeight: '600' }}>No records found matching selected report filters.</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting your search query, status, or jurisdiction filters above.</div>
          </div>
        ) : (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>S.NO</th>
                  <th style={{ padding: '10px 12px' }}>MEMBER / VOTER NAME</th>
                  <th style={{ padding: '10px 12px' }}>EPIC NUMBER</th>
                  <th style={{ padding: '10px 12px' }}>MOBILE NUMBER</th>
                  <th style={{ padding: '10px 12px' }}>DISTRICT</th>
                  <th style={{ padding: '10px 12px' }}>ASSEMBLY</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>BOOTH</th>
                  <th style={{ padding: '10px 12px' }}>BJP SCHEME NAME</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>STATUS</th>
                  <th style={{ padding: '10px 12px' }}>APPLIED DATE</th>
                  <th style={{ padding: '10px 12px' }}>REFERRED BY</th>
                </tr>
              </thead>
              <tbody>
                {allReportApps.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-linen)' }}>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--color-slate)' }}>{(currentPage - 1) * 50 + idx + 1}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '700', color: 'var(--color-midnight-ink)' }}>{row.voterName}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: '600' }}>{row.epicNo}</td>
                    <td style={{ padding: '10px 12px' }}>{row.mobile}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '600' }}>{row.district}</td>
                    <td style={{ padding: '10px 12px' }}>{row.assemblyName}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>Booth {row.boothNo}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '600', color: 'var(--color-midnight-ink)' }}>{row.schemeName}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <StatusBadge status={row.status} />
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-slate)', fontSize: '12px' }}>{row.appliedAt}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--color-slate)' }}>{row.referredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── Pagination Bar (50 items per page) ── */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginTop: '20px', paddingTop: '14px', borderTop: '1px solid var(--color-linen)', fontSize: '13px', color: 'var(--color-slate)' }}>
                <div>
                  Showing <strong>{(currentPage - 1) * 50 + 1}</strong> – <strong>{Math.min(currentPage * 50, totalAppsCount)}</strong> of <strong>{totalAppsCount}</strong> application records
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1 || loadingData}
                    className="btn btn-ghost"
                    style={{ padding: '6px 12px', fontSize: '12px', opacity: currentPage === 1 ? 0.4 : 1 }}
                  >
                    ← Prev
                  </button>

                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let p = i + 1;
                    if (totalPages > 5) {
                      if (currentPage > 3) p = currentPage - 2 + i;
                      if (p > totalPages) p = totalPages - 4 + i;
                    }
                    return (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        disabled={loadingData}
                        className={`btn ${p === currentPage ? 'btn-primary' : 'btn-ghost'}`}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          fontWeight: p === currentPage ? '700' : '500',
                          minWidth: '34px'
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages || loadingData}
                    className="btn btn-ghost"
                    style={{ padding: '6px 12px', fontSize: '12px', opacity: currentPage === totalPages ? 0.4 : 1 }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </>
      )}

    </div>
  );
};

export default ReportsView;
