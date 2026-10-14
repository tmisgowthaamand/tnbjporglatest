import React, { useState, useEffect } from 'react';
import API from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import MemberProfileTimelineView, { formatSchemeName, formatAppliedDateTime, getSchemeBgImage } from '../../components/MemberProfileTimelineView';
import ReportsView from '../../components/ReportsView';
import { useBjpSchemes, buildSchemeCards } from '../../utils/schemesData';
import {
  Shield, Users, Building, PhoneCall, RefreshCw, Search, Eye, Award, FileText, Share2, Menu
} from 'lucide-react';
import TopReferrersCard from '../../components/TopReferrersCard';
import SchemePieChart from '../../components/SchemePieChart';
import TrendsChart from '../../components/TrendsChart';
import CoverageTable from '../../components/CoverageTable';
import AdminSidebar from '../../components/AdminSidebar';
import ErrorBoundary from '../../components/ErrorBoundary';
import BoothPresidentRequestsView from '../../components/BoothPresidentRequestsView';
import SingleAssemblyMap from '../../components/SingleAssemblyMap';

const LIMIT = 20;

const maskMobile = (m) => { const s = String(m || ''); return s.length >= 6 ? s.slice(0, 3) + 'XXXX' + s.slice(-3) : s; };
const maskEpic = (e) => { const s = String(e || ''); return s.length > 6 ? s.slice(0, 6) + 'XXXX' : s; };

const AssemblyAdminDashboard = () => {
  const { admin, logoutAdmin } = useAuth();
  const BJP_SCHEMES = useBjpSchemes();
  const [subPage, setSubPage] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);


  // ── Dashboard stats ──
  const [statsData, setStatsData] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState(false);

  // ── Paginated voters (applications) ──
  const [voters, setVoters] = useState([]);
  const [loadingVoters, setLoadingVoters] = useState(false);
  const [totalVoters, setTotalVoters] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // ── Filters ──
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [schemeFilter, setSchemeFilter] = useState('');
  const [boothFilter, setBoothFilter] = useState('');
  const [booths, setBooths] = useState([]);
  const [loadingBooths, setLoadingBooths] = useState(false);

  const [selectedVoterTimeline, setSelectedVoterTimeline] = useState(null);
  const [boothStatsPage, setBoothStatsPage] = useState(1);

  // ── Bulk Status Update ──
  const [selectedAppIds, setSelectedAppIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('Called');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const navigateSubPage = (pageKey) => {
    setSubPage(pageKey);
    setSelectedVoterTimeline(null);
    setBoothStatsPage(1);
    try { window.history.pushState({}, '', `/admin/assembly/${pageKey}`); } catch (e) {}
  };

  // ── Fetch stats (unfiltered for Assembly Overview) ──
  const fetchStats = async () => {
    try {
      setLoadingStats(true);
      setStatsError(false);
      const res = await API.get('/admin/dashboard-stats');
      if (res.data.success) {
        setStatsData(res.data);
      } else {
        console.error('[fetchStats] API returned success:false', res.data);
        setStatsError(true);
      }
    } catch (err) {
      console.error('[fetchStats] Network/auth error:', err?.response?.status, err?.message);
      setStatsError(true);
    } finally {
      setLoadingStats(false);
    }
  };

  // ── Fetch booths for this assembly ──
  const fetchBooths = async () => {
    try {
      setLoadingBooths(true);
      const res = await API.get(`/admin/filter-meta?assemblyName=${encodeURIComponent(admin.assemblyName || '')}`);
      if (res.data.success) setBooths(res.data.booths || []);
    } catch (err) {
      console.error('Error loading booths:', err);
    } finally {
      setLoadingBooths(false);
    }
  };

  // ── Fetch paginated voters ──
  const fetchVoters = async (page = 1) => {
    try {
      setLoadingVoters(true);
      const params = new URLSearchParams({
        page, limit: LIMIT,
        ...(searchQuery  && { search: searchQuery }),
        ...(statusFilter && { status: statusFilter }),
        ...(schemeFilter && { schemeName: schemeFilter }),
        ...(boothFilter  && { boothNo: boothFilter })
      });
      const res = await API.get(`/admin/applications?${params}`);
      if (res.data.success) {
        setVoters(res.data.voters || []);
        setTotalVoters(res.data.totalVoters || 0);
        setTotalPages(res.data.totalPages || 1);
        setCurrentPage(res.data.currentPage || 1);
      }
    } catch (err) {
      console.error('Error loading voters:', err);
    } finally {
      setLoadingVoters(false);
    }
  };

  const fetchDashboardData = () => { fetchStats(); fetchVoters(1); };

  useEffect(() => { fetchStats(); fetchBooths(); }, []);
  useEffect(() => { fetchVoters(1); setCurrentPage(1); }, [searchQuery, statusFilter, schemeFilter, boothFilter]);

  const handleUpdateAppStatus = async (appId, updatePayload) => {
    try {
      const res = await API.put(`/admin/applications/${appId}/status`, updatePayload);
      if (res.data.success) { fetchStats(); fetchVoters(currentPage); }
    } catch (err) { console.error('Error updating status:', err); }
  };

  const handleDirectCallVoter = async (voter) => {
    const latestApp = voter.applications[voter.applications.length - 1];
    window.location.href = `tel:${voter.mobile}`;
    if (latestApp) {
      await handleUpdateAppStatus(latestApp._id, {
        status: 'Called',
        notes: `Follow-up call to ${voter.voterName} (${voter.mobile})`,
        isCallAction: true
      });
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedAppIds.size === 0 || bulkUpdating) return;
    setBulkUpdating(true);
    try {
      const res = await API.put('/admin/applications/bulk-status', {
        ids: [...selectedAppIds],
        status: bulkStatus,
        remarks: ''
      });
      if (res.data.success) {
        setSelectedAppIds(new Set());
        fetchVoters(currentPage);
      }
    } catch (err) { console.error('Bulk update failed:', err); }
    finally { setBulkUpdating(false); }
  };

  const renderPagination = (page, totalItems, itemsPerPage, onPageChange) => {
    const totalP = Math.ceil(totalItems / itemsPerPage);
    if (totalP <= 1) return null;
    const startItem = (page - 1) * itemsPerPage + 1;
    const endItem = Math.min(page * itemsPerPage, totalItems);
    const range = [];
    const delta = 2;
    const left = Math.max(1, page - delta);
    const right = Math.min(totalP, page + delta);
    if (left > 1) { range.push(1); if (left > 2) range.push('...'); }
    for (let i = left; i <= right; i++) range.push(i);
    if (right < totalP) { if (right < totalP - 1) range.push('...'); range.push(totalP); }
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--color-linen)', fontSize: '13px', color: 'var(--color-slate)' }}>
        <div>Showing <strong>{startItem}</strong> – <strong>{endItem}</strong> of <strong>{totalItems}</strong> entries</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '12px', opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
          {range.map((p, idx) => (
            <button key={idx} disabled={p === '...'} onClick={() => typeof p === 'number' && onPageChange(p)} className={`btn ${p === page ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '4px 10px', fontSize: '12px', fontWeight: p === page ? '700' : '500', minWidth: '32px' }}>{p}</button>
          ))}
          <button onClick={() => onPageChange(page + 1)} disabled={page === totalP} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '12px', opacity: page === totalP ? 0.4 : 1 }}>Next →</button>
        </div>
      </div>
    );
  };

  // Page range for pagination pills
  const getPageRange = () => {
    const range = [];
    const delta = 2;
    const left = Math.max(1, currentPage - delta);
    const right = Math.min(totalPages, currentPage + delta);
    if (left > 1) { range.push(1); if (left > 2) range.push('...'); }
    for (let i = left; i <= right; i++) range.push(i);
    if (right < totalPages) { if (right < totalPages - 1) range.push('...'); range.push(totalPages); }
    return range;
  };

  return (
    <div className="admin-layout">
      <div
        className={`admin-sidebar-backdrop ${isMobileSidebarOpen ? 'visible' : ''}`}
        onClick={() => setIsMobileSidebarOpen(false)}
      />
      <AdminSidebar
        activeTab={subPage}
        onSelectTab={(tab) => { navigateSubPage(tab); setIsMobileSidebarOpen(false); }}
        admin={admin || { role: 'ASSEMBLY_ADMIN', username: 'Assembly Admin' }}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onLogout={logoutAdmin}
        isMobileOpen={isMobileSidebarOpen}
      />

      <div className="admin-main">
        {/* Sticky Topbar */}
        <header className="admin-topbar">
          <button className="admin-mobile-hamburger" onClick={() => setIsMobileSidebarOpen(o => !o)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="admin-topbar-brand">
            {admin?.assemblyName || 'Assembly'} Constituency Dashboard
          </div>

          <div className="admin-topbar-right">
            <span className="tag-pill tag-active" style={{ fontSize: '13px', background: 'var(--color-canvas)', color: 'var(--color-primary-ink)' }}>
              <Shield size={12} style={{ marginRight: '4px' }} /> {admin?.assemblyName || 'Assembly Level'}
            </span>

            <button onClick={fetchDashboardData} className="btn-action btn-view" style={{ padding: '8px 16px', fontSize: '13px' }}>
              <RefreshCw size={14} /> Refresh Data
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="admin-content">


      {/* ══════════════════════════════════════════ */}
      {/* PAGE 1: OVERVIEW DASHBOARD                */}
      {/* ══════════════════════════════════════════ */}
      {subPage === 'dashboard' && (
        (loadingStats || (!statsData && !statsError)) ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '16px' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid var(--color-linen)', borderTopColor: 'var(--color-saffron)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: '14px', color: 'var(--color-slate)', fontWeight: '500' }}>Loading stats for {admin?.assemblyName}...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : statsData ? (
          <div style={{ width: '100%', boxSizing: 'border-box' }}>

            {/* ── 4 Stat Cards ── */}
            <ErrorBoundary inline>
            <div className="stat-cards-grid">


              {/* Card 1: Total Voters in Electoral Roll (Read DB) */}
              <div className="stat-card">
                <div className="stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
                  <Users size={20} />
                </div>
                <div style={{ width: '100%' }}>
                  <div className="stat-number" style={{ color: '#2563eb' }}>
                    {statsData.overview?.totalVotersInRoll != null
                      ? statsData.overview?.totalVotersInRoll.toLocaleString()
                      : '—'}
                  </div>
                  <div className="stat-label">Total Voters in {admin.assemblyName}</div>
                  <div className="stat-sub">Electoral Roll (Voter DB)</div>
                </div>
              </div>

              {/* Card 2: Voters Requested Schemes (Write DB) */}
              <div className="stat-card">
                <div className="stat-icon">
                  <Users size={20} />
                </div>
                <div style={{ width: '100%' }}>
                  <div className="stat-number">{statsData.overview?.totalVotersRequested ?? statsData.overview?.totalUsers ?? 0}</div>
                  <div className="stat-label">Voters Requested Schemes</div>
                  <div className="stat-sub">Enrolled in Program</div>
                </div>
              </div>

              {/* Card 3: Total Applications */}
              <div
                className="stat-card"
                onClick={() => { setStatusFilter(''); setSchemeFilter(''); navigateSubPage('applications'); }}
                style={{ cursor: 'pointer' }}
                title="Click to view all applications"
              >
                <div className="stat-icon" style={{ background: 'var(--color-fog-gray)', color: 'var(--color-midnight-ink)' }}>
                  <FileText size={20} />
                </div>
                <div style={{ width: '100%' }}>
                  <div className="stat-number">{statsData.overview?.totalApplications ?? 0}</div>
                  <div className="stat-label">Assembly Applications</div>
                  <div className="stat-sub" style={{ color: 'var(--color-electric-blue)', fontWeight: '500' }}>Click to View Applications →</div>
                </div>
              </div>

              {/* Card 4: Approved */}
              <div
                className="stat-card"
                onClick={() => { setStatusFilter('Approved'); setSchemeFilter(''); navigateSubPage('applications'); }}
                style={{ cursor: 'pointer' }}
                title="Click to view approved applications"
              >
                <div className="stat-icon" style={{ background: '#f0fdf4', color: 'var(--color-forest-pulse)' }}>
                  <Shield size={20} />
                </div>
                <div style={{ width: '100%' }}>
                  <div className="stat-number" style={{ color: 'var(--color-forest-pulse)' }}>
                    {statsData.overview?.statusBreakdown?.Approved || 0}
                  </div>
                  <div className="stat-label">Approved Directives</div>
                  <div className="stat-sub" style={{ color: 'var(--color-forest-pulse)', fontWeight: '500' }}>Click to View Approved →</div>
                </div>
              </div>
            </div>
            </ErrorBoundary>


            <SingleAssemblyMap
              assemblyName={admin.assemblyName}
              statsData={statsData}
            />

            {/* ── Scheme Popularity ── */}
            <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--color-midnight-ink)', margin: 0 }}>
                  Top Scheme Applications in {admin.assemblyName}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>Click any scheme to filter applications</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', width: '100%' }}>
                {buildSchemeCards(BJP_SCHEMES, statsData.schemePopularity).map((item) => {
                  const bgImg = getSchemeBgImage(item._id);
                  return (
                    <div
                      key={item._id}
                      onClick={() => {
                        setSchemeFilter(item._id);
                        setStatusFilter('');
                        navigateSubPage('applications');
                      }}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '16px',
                        border: '1px solid #e5e5ea',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        transition: 'all 0.22s ease',
                        overflow: 'hidden',
                        position: 'relative',
                        minHeight: '135px',
                        height: '135px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxSizing: 'border-box',
                        width: '100%',
                        background: bgImg
                          ? `url("${encodeURI(bgImg)}") center / cover no-repeat`
                          : '#ffffff'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--color-saffron)';
                        e.currentTarget.style.transform = 'translateY(-3px)';
                        e.currentTarget.style.boxShadow = '0 8px 20px rgba(255, 153, 51, 0.25)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = '#e5e5ea';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                      }}
                    >
                      <div style={{ zIndex: 2, position: 'relative', maxWidth: '65%' }}>
                        <div style={{ fontSize: '14px', fontWeight: '700', color: '#1d1d1f', lineHeight: '1.25' }}>
                          {formatSchemeName(item._id)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px', fontWeight: '500' }}>
                          {item.cluster || 'Central Welfare Scheme'}
                        </div>
                      </div>
                      <div style={{ zIndex: 2, position: 'relative' }}>
                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#1d1d1f' }}>
                          {item.count}{' '}
                          <span style={{ fontSize: '12px', color: '#555', fontWeight: '500' }}>
                            applications
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-saffron)', fontWeight: '700', marginTop: '2px' }}>
                          View Applications →
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Daily Registration Trend ── */}
            <TrendsChart days={14} />

            {/* ── Coverage vs Voter Roll ── */}
            <CoverageTable />

            {/* ── Visual Scheme Distribution Pie Chart ── */}
            <SchemePieChart
              schemePopularity={statsData?.schemePopularity || []}
              scopeLabel={admin?.assemblyName || ''}
            />

            {/* ── Top Referral Champions ── */}
            <ErrorBoundary inline>
              <TopReferrersCard
                topReferrers={statsData.topReferrers || []}
                scopeLabel={admin?.assemblyName || ''}
                maskPII={true}
                onViewProfile={(ref) => {
                  if (ref && ref.epicNo) { setSubPage('applications'); setSelectedVoterTimeline(ref); }
                }}
              />
            </ErrorBoundary>


          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '12px' }}>
            <div style={{ fontSize: '32px' }}>⚠️</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--color-midnight-ink)' }}>Could not load stats</div>
            <button onClick={fetchStats} className="btn btn-primary" style={{ marginTop: '8px' }}>Retry</button>
          </div>
        )
      )}

      {/* ══════════════════════════════════════════ */}
      {/* PAGE 2: APPLICATIONS LIST (Paginated)     */}
      {/* ══════════════════════════════════════════ */}
      {subPage === 'applications' && (
        selectedVoterTimeline ? (
          <MemberProfileTimelineView
            voterData={selectedVoterTimeline}
            onBack={() => setSelectedVoterTimeline(null)}
            onUpdateAppStatus={handleUpdateAppStatus}
            onSelectVoter={(voter) => setSelectedVoterTimeline(voter)}
            targetSchemeName={schemeFilter}
            maskPII={true}
          />
        ) : (
          <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>

            {/* ── Filter Row 1: Search + Summary ── */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px', width: '100%', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ash-gray)' }} />
                <input
                  type="text"
                  placeholder="Search name, EPIC, mobile, scheme..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="form-control"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>
                {loadingVoters
                  ? <span style={{ opacity: 0.6 }}>Loading…</span>
                  : <><strong style={{ color: 'var(--color-midnight-ink)' }}>{totalVoters.toLocaleString()}</strong> voters · Page {currentPage} of {totalPages}</>
                }
              </div>
            </div>

            {/* ── Filter Row 2: Status + Booth + Chips ── */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', width: '100%', alignItems: 'center' }}>
              {/* Status */}
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="admin-filter-select" style={{ flex: '1 1 150px', minWidth: '150px' }}>
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Submitted">Submitted</option>
                <option value="Processing">Processing</option>
                <option value="Called">Called</option>
                <option value="Verified">Verified</option>
                <option value="Approved">Approved</option>
                <option value="Completed">Completed</option>
                <option value="Rejected">Rejected</option>
              </select>

              {/* Scheme Filter */}
              <select
                value={BJP_SCHEMES.find(s => s.name.toLowerCase() === (schemeFilter || '').toLowerCase() || (s.fullTitle && s.fullTitle.toLowerCase() === (schemeFilter || '').toLowerCase()))?.name || schemeFilter || ''}
                onChange={(e) => setSchemeFilter(e.target.value)}
                className="admin-filter-select"
                style={{ flex: '1 1 220px', minWidth: '220px' }}
              >
                <option value="">All {BJP_SCHEMES.length} Central BJP Schemes</option>
                {BJP_SCHEMES.map(s => (
                  <option key={s.id} value={s.name}>
                    {s.name} ({s.fullTitle || s.fullName})
                  </option>
                ))}
              </select>

              {/* Booth Filter */}
              <select
                value={boothFilter}
                onChange={(e) => setBoothFilter(e.target.value)}
                className="admin-filter-select"
                disabled={loadingBooths}
                style={{ flex: '1 1 150px', minWidth: '150px' }}
              >
                <option value="">{loadingBooths ? 'Loading booths…' : 'All Booths'}</option>

                {booths.map(b => <option key={b} value={b}>Booth {b}</option>)}
                {boothFilter && !booths.includes(boothFilter) && (
                  <option key={boothFilter} value={boothFilter}>Booth {boothFilter}</option>
                )}
              </select>

              {/* Active filter chips */}
              {(boothFilter || statusFilter || schemeFilter || searchQuery) && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {boothFilter && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: '#e0f2fe', borderRadius: '20px', fontSize: '12px', fontWeight: '600', color: '#0369a1' }}>
                      Booth {boothFilter}
                      <button onClick={() => setBoothFilter('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', lineHeight: 1, fontSize: '14px', color: '#0369a1' }}>×</button>
                    </span>
                  )}
                  <button
                    onClick={() => { setSearchQuery(''); setStatusFilter(''); setSchemeFilter(''); setBoothFilter(''); }}
                    style={{ background: 'none', border: '1px solid var(--color-linen)', borderRadius: '20px', padding: '4px 12px', fontSize: '12px', color: 'var(--color-slate)', cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {/* ── Bulk Action Bar ── */}
            {selectedAppIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: '#FFF3E0', borderRadius: '8px', marginBottom: '10px', flexWrap: 'wrap', border: '1px solid #FFB74D' }}>
                <span style={{ fontWeight: '700', fontSize: '13px', color: '#E65100' }}>{selectedAppIds.size} application{selectedAppIds.size > 1 ? 's' : ''} selected</span>
                <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #FFB74D', fontSize: '13px', background: 'white' }}>
                  {['Pending','Submitted','Processing','In Progress','Called','Verified','Approved','Completed','Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={handleBulkUpdate} disabled={bulkUpdating} className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}>{bulkUpdating ? 'Updating…' : 'Update Status'}</button>
                <button onClick={() => setSelectedAppIds(new Set())} className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: '13px' }}>Clear</button>
              </div>
            )}

            {/* ── Table ── */}
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                    <th style={{ padding: '12px 10px', width: '36px', cursor: 'pointer' }} onClick={e => { if (e.target.tagName !== 'INPUT') e.currentTarget.querySelector('input')?.click(); }}>
                      <input type="checkbox" style={{ width: 18, height: 18, cursor: 'pointer' }} title="Select all on this page"
                        checked={voters.length > 0 && voters.every(v => v.applications.every(a => selectedAppIds.has(a._id)))}
                        onChange={e => {
                          const pageIds = voters.flatMap(v => v.applications.map(a => a._id));
                          setSelectedAppIds(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) pageIds.forEach(id => next.add(id));
                            else pageIds.forEach(id => next.delete(id));
                            return next;
                          });
                        }}
                      />
                    </th>
                    <th style={{ padding: '12px 10px' }}>#</th>
                    <th style={{ padding: '12px 10px' }}>Member &amp; EPIC</th>
                    <th style={{ padding: '12px 10px' }}>Mobile</th>
                    <th style={{ padding: '12px 10px' }}>Schemes Applied</th>
                    <th style={{ padding: '12px 10px' }}>Applied Date &amp; Time</th>
                    <th style={{ padding: '12px 10px' }}>Booth</th>
                    <th style={{ padding: '12px 10px' }}>Latest Status</th>
                    <th className="sticky-col" style={{ padding: '12px 10px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingVoters ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--color-linen)' }}>
                        {Array.from({ length: 9 }).map((_, j) => (
                          <td key={j} style={{ padding: '14px 10px' }}>
                            <div style={{ height: '14px', borderRadius: '6px', background: 'var(--color-linen)', animation: 'pulse 1.4s ease-in-out infinite', width: j === 0 ? '24px' : j === 1 ? '80%' : '60%' }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : voters.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-slate)' }}>
                        <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
                        No applications found for {admin.assemblyName}{boothFilter ? ` — Booth ${boothFilter}` : ''}.
                      </td>
                    </tr>
                  ) : (
                    voters.map((voter, idx) => {
                      const latestApp = voter.applications[voter.applications.length - 1];
                      const rowNum = (currentPage - 1) * LIMIT + idx + 1;
                      const voterAppIds = voter.applications.map(a => a._id);
                      const allSelected = voterAppIds.length > 0 && voterAppIds.every(id => selectedAppIds.has(id));
                      const uniqueSchemesCount = new Set((voter.applications || []).map(a => String(a.schemeId || a.schemeName || a._id).toLowerCase().trim())).size;
                      return (
                        <tr key={voter.epicNo || idx}
                          style={{ borderBottom: '1px solid var(--color-linen)', transition: 'background 0.15s', cursor: 'pointer' }}
                          onClick={() => setSelectedVoterTimeline(voter)}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-fog-gray)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          title="Click anywhere on row to view details"
                        >
                          <td style={{ padding: '12px 10px', width: '36px', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); if (e.target.tagName !== 'INPUT') e.currentTarget.querySelector('input')?.click(); }}>
                            <input type="checkbox" style={{ width: 18, height: 18, cursor: 'pointer' }} checked={allSelected} onChange={e => {
                              setSelectedAppIds(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) voterAppIds.forEach(id => next.add(id));
                                else voterAppIds.forEach(id => next.delete(id));
                                return next;
                              });
                            }} />
                          </td>
                          <td style={{ padding: '12px 10px', color: 'var(--color-ash-gray)', fontSize: '12px', fontWeight: '600' }}>{rowNum}</td>
                          <td style={{ padding: '12px 10px' }}>
                            <div style={{ fontWeight: '700', color: 'var(--color-midnight-ink)' }}>{voter.voterName}</div>
                            <div style={{ fontSize: '11px', color: 'var(--color-slate)', fontFamily: 'monospace' }}>{maskEpic(voter.epicNo)}</div>
                          </td>
                          <td style={{ padding: '12px 10px', fontWeight: '600' }}>{maskMobile(voter.mobile)}</td>
                          <td style={{ padding: '12px 10px' }}>
                            <span className="tag-pill tag-sunlit" style={{ fontWeight: '700', fontSize: '11px', padding: '4px 10px' }}>
                              <Award size={12} /> {uniqueSchemesCount} Scheme{uniqueSchemesCount === 1 ? '' : 's'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 10px', fontSize: '12px', color: 'var(--color-midnight-ink)', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: '600' }}>
                              {formatAppliedDateTime(latestApp?.appliedAt || latestApp?.createdAt || voter.createdAt)}
                            </div>
                          </td>
                          <td style={{ padding: '12px 10px', color: 'var(--color-midnight-ink)' }}>
                            <strong>Booth {voter.boothNo}</strong>
                          </td>
                          <td style={{ padding: '12px 10px' }}>
                            <StatusBadge status={latestApp?.status || 'Pending'} />
                          </td>
                          <td className="sticky-col" style={{ padding: '12px 10px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDirectCallVoter(voter); }}
                                className="btn btn-ghost"
                                style={{ padding: '5px 10px', fontSize: '12px' }}
                              >
                                <PhoneCall size={13} /> Call
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const digits = String(voter.mobile || '').replace(/\D/g, '');
                                  const phone = digits.length === 10 ? `91${digits}` : digits;
                                  const name = (voter.voterName || '').replace(/\s*-\s*$/, '').trim();
                                  const msg = encodeURIComponent(`Hi ${name}, regarding your Central Government welfare scheme registration — please call us or reply here for any help.`);
                                  window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
                                }}
                                className="btn btn-ghost"
                                style={{ padding: '5px 10px', fontSize: '12px', color: '#25D366' }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.132.561 4.13 1.535 5.862L0 24l6.29-1.516A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.808 9.808 0 01-5.002-1.368l-.359-.213-3.731.899.937-3.627-.234-.373A9.786 9.786 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182c5.43 0 9.818 4.388 9.818 9.818 0 5.43-4.388 9.818-9.818 9.818z"/></svg>
                                WA
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Pagination Controls ── */}
            {!loadingVoters && totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '24px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { const p = currentPage - 1; setCurrentPage(p); fetchVoters(p); }}
                  disabled={currentPage === 1}
                  className="btn btn-ghost"
                  style={{ padding: '6px 14px', fontSize: '13px', opacity: currentPage === 1 ? 0.4 : 1 }}
                >← Prev</button>

                {getPageRange().map((item, i) =>
                  item === '...' ? (
                    <span key={`e-${i}`} style={{ padding: '6px 4px', color: 'var(--color-ash-gray)', fontSize: '13px' }}>…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => { setCurrentPage(item); fetchVoters(item); }}
                      className="btn"
                      style={{
                        padding: '6px 12px', fontSize: '13px',
                        fontWeight: item === currentPage ? '700' : '500',
                        background: item === currentPage ? 'var(--color-saffron)' : 'transparent',
                        color: item === currentPage ? 'var(--color-midnight-ink)' : 'var(--color-slate)',
                        border: item === currentPage ? '1.5px solid var(--color-saffron)' : '1.5px solid var(--color-linen)',
                        borderRadius: '8px', minWidth: '36px'
                      }}
                    >{item}</button>
                  )
                )}

                <button
                  onClick={() => { const p = currentPage + 1; setCurrentPage(p); fetchVoters(p); }}
                  disabled={currentPage === totalPages}
                  className="btn btn-ghost"
                  style={{ padding: '6px 14px', fontSize: '13px', opacity: currentPage === totalPages ? 0.4 : 1 }}
                >Next →</button>

                <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
              </div>
            )}
          </div>
        )
      )}

      {/* ══════════════════════════════════════════ */}
      {/* PAGE 3: BOOTH STATS                       */}
      {/* ══════════════════════════════════════════ */}
      {subPage === 'booths' && statsData && (
        <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--color-midnight-ink)', marginBottom: '16px' }}>
            Polling Booths in {admin.assemblyName} Constituency
          </h3>
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                  <th style={{ padding: '10px' }}>Booth / Part No</th>
                  <th style={{ padding: '10px' }}>Total Voters</th>
                  <th style={{ padding: '10px' }}>Applied Voters</th>
                  <th style={{ padding: '10px' }}>Total Applications</th>
                  <th style={{ padding: '10px' }}>Approved</th>
                  <th style={{ padding: '10px' }}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {statsData.boothStats?.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-slate)' }}>No booth data available.</td></tr>
                )}
                {(statsData.boothStats || []).slice((boothStatsPage - 1) * 15, boothStatsPage * 15).map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-linen)', cursor: 'pointer' }}
                    onClick={() => { setBoothFilter(String(row._id.boothNo)); setStatusFilter(''); setSchemeFilter(''); navigateSubPage('applications'); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-fog-gray)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px', fontWeight: '700', color: 'var(--color-midnight-ink)' }}>Booth {row._id.boothNo}</td>
                    <td style={{ padding: '10px', color: 'var(--color-slate)' }}>{row.totalVoters ? row.totalVoters.toLocaleString('en-IN') : '—'}</td>
                    <td style={{ padding: '10px', color: '#0284c7', fontWeight: '700' }}>{row.appliedVoters ?? '—'}</td>
                    <td style={{ padding: '10px', fontWeight: '600' }}>{row.totalApps}</td>
                    <td style={{ padding: '10px', color: 'var(--color-forest-pulse)', fontWeight: '600' }}>{row.approved}</td>
                    <td style={{ padding: '10px', color: 'var(--color-slate)' }}>{row.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {renderPagination(boothStatsPage, statsData.boothStats?.length || 0, 15, setBoothStatsPage)}
        </div>
      )}

      {/* PAGE: BOOTH PRESIDENT REQUESTS */}
      {subPage === 'booth_presidents' && (
        <BoothPresidentRequestsView admin={admin} />
      )}

      {/* PAGE: REPORTS & EXCEL EXPORT */}
      {subPage === 'reports' && (
        <ReportsView
          initialDistrict={admin?.district}
          initialAssembly={admin?.assemblyName}
          initialBooth={boothFilter}
          initialStatus={statusFilter}
          initialScheme={schemeFilter}
        />
      )}
        </main>
      </div>
    </div>

  );
};

export default AssemblyAdminDashboard;
