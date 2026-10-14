import React, { useState, useEffect, useRef } from 'react';
import API from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import MemberProfileTimelineView, { formatSchemeName, formatAppliedDateTime, getSchemeBgImage } from '../../components/MemberProfileTimelineView';
import ReportsView from '../../components/ReportsView';
import { useBjpSchemes, buildSchemeCards } from '../../utils/schemesData';
import {
  Shield, Users, PhoneCall, RefreshCw, Search, LogIn, Award, FileText, Menu
} from 'lucide-react';
import TopReferrersCard from '../../components/TopReferrersCard';
import SchemePieChart from '../../components/SchemePieChart';
import TrendsChart from '../../components/TrendsChart';
import CoverageTable from '../../components/CoverageTable';
import AdminSidebar from '../../components/AdminSidebar';
import ErrorBoundary from '../../components/ErrorBoundary';
import BoothPresidentRequestsView from '../../components/BoothPresidentRequestsView';
import ReferralsView from '../../components/ReferralsView';
import SchemesManagementView from '../../components/SchemesManagementView';
import FlowImagesView from '../../components/FlowImagesView';
import IncompleteRegistrationsView from '../../components/IncompleteRegistrationsView';
import TnDistrictMap from '../../components/TnDistrictMap';



const maskEpic = (e) => { const s = String(e || ''); return s.length > 6 ? s.slice(0, 6) + 'XXXX' : s; };
const maskMobile = (m) => { const s = String(m || ''); return s.length > 4 ? 'XXXXXX' + s.slice(-4) : s; };

const LIMIT = 20;

const SuperAdminDashboard = () => {
  const { admin, logoutAdmin, loginAdmin } = useAuth();
  const BJP_SCHEMES = useBjpSchemes();
  const [subPage, setSubPage] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);


  // ── Stats ──
  const [statsData, setStatsData] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // ── Scheme Suggestions ──
  const [suggestionsData, setSuggestionsData] = useState(null);

  // ── Credentials State ──
  const [adminList, setAdminList] = useState([]);
  const [credSubTab, setCredSubTab] = useState('districts');
  const [districtCredentials, setDistrictCredentials] = useState([]);
  const [assemblyCredentials, setAssemblyCredentials] = useState([]);

  // ── Booth Credentials ──
  const [assembliesList, setAssembliesList] = useState([]);
  const [selectedAssemblyNo, setSelectedAssemblyNo] = useState('1');
  const [boothCredentialsData, setBoothCredentialsData] = useState(null);
  const [boothSearchQuery, setBoothSearchQuery] = useState('');
  const [loadingBooths, setLoadingBooths] = useState(false);
  const [distCredSearch, setDistCredSearch] = useState('');
  const [assCredSearch, setAssCredSearch] = useState('');

  // ── Sub-page Pagination States ──
  const [distCredPage, setDistCredPage] = useState(1);
  const [assCredPage, setAssCredPage] = useState(1);
  const [boothCredPage, setBoothCredPage] = useState(1);
  const [distStatsPage, setDistStatsPage] = useState(1);
  const [assStatsPage, setAssStatsPage] = useState(1);
  const [boothStatsPage, setBoothStatsPage] = useState(1);

  // ── Paginated Voters (Applications) ──
  const [voters, setVoters] = useState([]);
  const [loadingVoters, setLoadingVoters] = useState(false);
  const [totalVoters, setTotalVoters] = useState(0);
  const [totalApplications, setTotalApplications] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // ── Filters ──
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [schemeFilter, setSchemeFilter] = useState('');
  const [districtFilter, setDistrictFilter] = useState('');
  const [assemblyFilter, setAssemblyFilter] = useState('');
  const [boothFilter, setBoothFilter] = useState('');

  // ── Metadata Dropdown Lists ──
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [booths, setBooths] = useState([]);
  const [loadingFilterAssemblies, setLoadingFilterAssemblies] = useState(false);
  const [loadingFilterBooths, setLoadingFilterBooths] = useState(false);

  const [selectedVoterTimeline, setSelectedVoterTimeline] = useState(null);
  const skipFilterResetRef = useRef(false);

  // ── Bulk Status Update ──
  const [selectedAppIds, setSelectedAppIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('Called');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // ── New Admin Form ──
  const [newAdminForm, setNewAdminForm] = useState({
    username: '', password: '', role: 'DISTRICT_ADMIN',
    district: '', assemblyName: '', boothNo: ''
  });
  const [credSuccessMsg, setCredSuccessMsg] = useState('');
  const [credErrorMsg, setCredErrorMsg] = useState('');

  const navigateSubPage = (pageKey) => {
    setSubPage(pageKey);
    setSelectedVoterTimeline(null);
    setDistStatsPage(1);
    setAssStatsPage(1);
    setBoothStatsPage(1);
    try { window.history.pushState({}, '', `/admin/superadmin/${pageKey}`); } catch (e) {}
  };

  // ── Fetch Initial Filter Metadata ──
  const fetchInitialMeta = async () => {
    try {
      const res = await API.get('/admin/filter-meta');
      if (res.data.success) {
        setDistricts(res.data.districts || []);
        setAssemblies(res.data.assemblies || []);
        setBooths(res.data.booths || []);
      }
    } catch (err) {
      console.error('Error fetching filter meta:', err);
    }
  };

  // ── Fetch Assemblies for District ──
  const fetchAssembliesForDistrict = async (dist) => {
    if (!dist) { fetchInitialMeta(); return; }
    try {
      setLoadingFilterAssemblies(true);
      const res = await API.get(`/admin/filter-meta?district=${encodeURIComponent(dist)}`);
      if (res.data.success) {
        setAssemblies(res.data.assemblies || []);
        setBooths(res.data.booths || []);
      }
    } catch (err) {
      console.error('Error loading assemblies for district:', err);
    } finally {
      setLoadingFilterAssemblies(false);
    }
  };

  // ── Fetch Booths for Assembly ──
  const fetchBoothsForAssembly = async (ass, dist) => {
    if (!ass) { setBooths([]); return; }
    try {
      setLoadingFilterBooths(true);
      const params = new URLSearchParams({ assemblyName: ass, ...(dist && { district: dist }) });
      const res = await API.get(`/admin/filter-meta?${params}`);
      if (res.data.success) setBooths(res.data.booths || []);
    } catch (err) {
      console.error('Error loading booths for assembly:', err);
    } finally {
      setLoadingFilterBooths(false);
    }
  };

  // ── Fetch Overall Stats (Unfiltered for Overview Dashboard) ──
  const fetchStats = async (live = false) => {
    try {
      setLoadingStats(true);
      const res = await API.get(`/admin/dashboard-stats${live ? '?live=1' : ''}`);
      if (res.data.success) setStatsData(res.data);
    } catch (err) {
      console.error('Error loading stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchSuggestions = async () => {
    try {
      const res = await API.get('/admin/scheme-suggestions');
      if (res.data.success) setSuggestionsData(res.data);
    } catch (err) {
      console.error('Error loading scheme suggestions:', err);
    }
  };

  // ── Fetch Paginated Voters ──
  const fetchVoters = async (page = 1) => {
    try {
      setLoadingVoters(true);
      const params = new URLSearchParams({
        page, limit: LIMIT,
        ...(searchQuery    && { search: searchQuery }),
        ...(statusFilter   && { status: statusFilter }),
        ...(schemeFilter   && { schemeName: schemeFilter }),
        ...(districtFilter && { district: districtFilter }),
        ...(assemblyFilter && { assemblyName: assemblyFilter }),
        ...(boothFilter    && { boothNo: boothFilter })
      });
      const res = await API.get(`/admin/applications?${params}`);
      if (res.data.success) {
        setVoters(res.data.voters || []);
        setTotalVoters(res.data.totalVoters || 0);
        setTotalApplications(res.data.totalApplications || res.data.totalVoters || 0);
        setTotalPages(res.data.totalPages || 1);
        setCurrentPage(res.data.currentPage || 1);
      }
    } catch (err) {
      console.error('Error loading voters:', err);
    } finally {
      setLoadingVoters(false);
    }
  };

  // ── Fetch Logins & Meta ──
  const fetchLoginsAndCreds = async () => {
    try {
      const [credRes, assRes, distCredRes, assCredRes] = await Promise.all([
        API.get('/admin/credentials'),
        API.get('/admin/jurisdiction-assemblies'),
        API.get('/admin/jurisdiction-district-credentials'),
        API.get('/admin/jurisdiction-assembly-credentials')
      ]);
      if (credRes.data.success) setAdminList(credRes.data.admins);
      if (assRes.data.success) setAssembliesList(assRes.data.assemblies);
      if (distCredRes.data.success) setDistrictCredentials(distCredRes.data.districts);
      if (assCredRes.data.success) setAssemblyCredentials(assCredRes.data.assemblies);
    } catch (err) {
      console.error('Error loading logins & credentials:', err);
    }
  };

  const fetchBoothCredentials = async (assemblyNo) => {
    setLoadingBooths(true);
    try {
      const res = await API.get(`/admin/assembly-booth-credentials?assemblyNo=${assemblyNo}`);
      if (res.data.success) setBoothCredentialsData(res.data.data);
    } catch (err) {
      console.error('Error loading booth credentials:', err);
    } finally {
      setLoadingBooths(false);
    }
  };

  const fetchDashboardData = () => {
    fetchStats(true);
    fetchVoters(1);
    fetchLoginsAndCreds();
  };

  useEffect(() => {
    fetchInitialMeta();
    fetchStats();
    fetchLoginsAndCreds();
    fetchSuggestions();
  }, []);

  useEffect(() => {
    fetchVoters(1);
    setCurrentPage(1);
  }, [districtFilter, assemblyFilter, boothFilter, statusFilter, schemeFilter, searchQuery]);

  useEffect(() => {
    fetchAssembliesForDistrict(districtFilter);
  }, [districtFilter]);

  useEffect(() => {
    fetchBoothsForAssembly(assemblyFilter, districtFilter);
  }, [assemblyFilter, districtFilter]);

  useEffect(() => {
    if (subPage === 'logins' && credSubTab === 'booths' && selectedAssemblyNo && assembliesList.length > 0) {
      fetchBoothCredentials(selectedAssemblyNo);
    }
  }, [subPage, credSubTab, selectedAssemblyNo]);

  const handleCreateCredential = async (e) => {
    e.preventDefault();
    setCredSuccessMsg(''); setCredErrorMsg('');
    try {
      const res = await API.post('/admin/create-credential', newAdminForm);
      if (res.data.success) {
        setCredSuccessMsg(`Credential '${res.data.admin.username}' created successfully!`);
        setNewAdminForm({ username: '', password: '', role: 'DISTRICT_ADMIN', district: '', assemblyName: '', boothNo: '' });
        fetchDashboardData();
      }
    } catch (err) {
      setCredErrorMsg(err.response?.data?.message || 'Failed to create admin credential');
    }
  };

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

  const handleDeleteMember = async (voterData) => {
    try {
      const userId = voterData.userId || voterData._id;
      const res = await API.delete(`/admin/members/${userId}`);
      if (res.data.success) {
        setSelectedVoterTimeline(null);
        fetchVoters(currentPage);
        fetchStats();
      }
    } catch (err) { console.error('Error deleting member:', err); }
  };

  const handleQuickSwitch = async (usr, pwd) => {
    try {
      const res = await API.post('/admin/login', { username: usr, password: pwd });
      if (res.data.success) loginAdmin(res.data.admin, res.data.token);
    } catch (err) { console.error('Switch error:', err); }
  };

  const filteredBooths = boothCredentialsData?.boothLogins?.filter(b => {
    if (!boothSearchQuery) return true;
    return b.boothNo.includes(boothSearchQuery) || b.username.includes(boothSearchQuery.toLowerCase()) || b.passcode.includes(boothSearchQuery);
  }) || [];

  // ── District / Assembly credential search filters ──
  const _distQ = distCredSearch.trim().toLowerCase();
  const filteredDistrictCreds = _distQ
    ? districtCredentials.filter(d =>
        (d.district || '').toLowerCase().includes(_distQ) ||
        (d.username || '').toLowerCase().includes(_distQ) ||
        String(d.passcode || '').toLowerCase().includes(_distQ))
    : districtCredentials;

  const _assQ = assCredSearch.trim().toLowerCase();
  const filteredAssemblyCreds = _assQ
    ? assemblyCredentials.filter(a =>
        (a.assemblyName || '').toLowerCase().includes(_assQ) ||
        String(a.assemblyNo || '').toLowerCase().includes(_assQ) ||
        (a.district || '').toLowerCase().includes(_assQ) ||
        (a.username || '').toLowerCase().includes(_assQ) ||
        String(a.passcode || '').toLowerCase().includes(_assQ))
    : assemblyCredentials;

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
        <div>
          Showing <strong>{startItem}</strong> – <strong>{endItem}</strong> of <strong>{totalItems}</strong> entries
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="btn btn-ghost"
            style={{ padding: '4px 10px', fontSize: '12px', opacity: page === 1 ? 0.4 : 1 }}
          >
            ← Prev
          </button>

          {range.map((p, idx) => (
            <button
              key={idx}
              disabled={p === '...'}
              onClick={() => typeof p === 'number' && onPageChange(p)}
              className={`btn ${p === page ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: p === page ? '700' : '500',
                minWidth: '32px'
              }}
            >
              {p}
            </button>
          ))}

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalP}
            className="btn btn-ghost"
            style={{ padding: '4px 10px', fontSize: '12px', opacity: page === totalP ? 0.4 : 1 }}
          >
            Next →
          </button>
        </div>
      </div>
    );
  };

  const activeScopeText = 'Full Statewide Governance';

  return (
    <div className="admin-layout">
      <div
        className={`admin-sidebar-backdrop ${isMobileSidebarOpen ? 'visible' : ''}`}
        onClick={() => setIsMobileSidebarOpen(false)}
      />
      <AdminSidebar
        activeTab={subPage}
        onSelectTab={(tab) => { navigateSubPage(tab); setIsMobileSidebarOpen(false); }}
        admin={admin || { role: 'SUPER_ADMIN', username: 'Super Admin' }}
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
            Statewide Super Admin Control Portal
          </div>

          <div className="admin-topbar-right">
            <span className="tag-pill tag-active" style={{ fontSize: '13px', background: 'var(--color-canvas)', color: 'var(--color-primary-ink)' }}>
              <Shield size={12} style={{ marginRight: '4px' }} /> {activeScopeText}
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
        loadingStats ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '16px' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid var(--color-linen)', borderTopColor: 'var(--color-saffron)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: '14px', color: 'var(--color-slate)', fontWeight: '500' }}>Loading Super Admin Portal stats...</div>
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
                  <div className="stat-label">Total Voters in Roll</div>
                  <div className="stat-sub">Electoral Roll (Read DB)</div>
                </div>
              </div>

              {/* Card 2: Voters Enrolled in Schemes (Write DB) */}
              <div
                className="stat-card"
                onClick={() => { setStatusFilter(''); setSchemeFilter(''); navigateSubPage('applications'); }}
                style={{ cursor: 'pointer' }}
                title="Click to view all enrolled members"
              >
                <div className="stat-icon" style={{ background: '#fff7ed', color: 'var(--color-saffron)' }}>
                  <Users size={20} />
                </div>
                <div style={{ width: '100%' }}>
                  <div className="stat-number">
                    {statsData.overview?.totalVotersRequested != null
                      ? statsData.overview.totalVotersRequested.toLocaleString()
                      : 0}
                  </div>
                  <div className="stat-label">Voters Enrolled in Schemes</div>
                  <div className="stat-sub">
                    {statsData.overview?.totalRegisteredUsers != null
                      ? `${statsData.overview.totalRegisteredUsers.toLocaleString()} Portal User Logins`
                      : 'Enrolled Members'}
                  </div>
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
                  <div className="stat-label">Applications Submitted</div>
                  <div className="stat-sub" style={{ color: 'var(--color-electric-blue)', fontWeight: '500' }}>Click to View Applications →</div>
                </div>
              </div>

              {/* Card 4: Approved Directives */}
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
                  <div className="stat-label">Approved Benefit Directives</div>
                  <div className="stat-sub" style={{ color: 'var(--color-forest-pulse)', fontWeight: '500' }}>Click to View Approved →</div>
                </div>
              </div>


            </div>
            </ErrorBoundary>

            {/* ── Action Required ── */}
            {admin?.role !== 'BOOTH_ADMIN' && (
            <ErrorBoundary inline>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', margin: '24px 0' }}>

                {/* Volunteer Requests card */}
                <div
                  className="stat-card"
                  onClick={() => navigateSubPage('booth_presidents')}
                  style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '20px' }}
                  title="Click to manage volunteer requests"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                    <div className="stat-icon" style={{ background: '#fff7ed', color: '#ea580c' }}>
                      <Shield size={20} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="stat-label" style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Volunteer Requests</div>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '4px', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '28px', fontWeight: '800', color: '#0f172a' }}>
                          {statsData.overview?.totalVolunteers ?? 0}
                        </span>
                        {(statsData.overview?.pendingVolunteers ?? 0) > 0 && (
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#ea580c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '12px', padding: '2px 10px' }}>
                            {statsData.overview.pendingVolunteers} Pending
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="stat-sub" style={{ color: 'var(--color-electric-blue)', fontWeight: '500' }}>Click to Review Requests →</div>
                </div>

                {/* Incomplete Enquiries card — SUPER/STATE only */}
                {(admin?.role === 'SUPER_ADMIN' || admin?.role === 'STATE_ADMIN') && (
                  <div
                    className="stat-card"
                    onClick={() => navigateSubPage('incomplete_registrations')}
                    style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '20px' }}
                    title="Click to view incomplete enquiries"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                      <div className="stat-icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
                        <FileText size={20} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="stat-label" style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Incomplete Enquiries</div>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
                          {statsData.overview?.totalIncomplete ?? 0}
                        </div>
                      </div>
                    </div>
                    <div className="stat-sub" style={{ color: 'var(--color-electric-blue)', fontWeight: '500' }}>People who dropped off mid-registration →</div>
                  </div>
                )}

              </div>
            </ErrorBoundary>
            )}

            <TnDistrictMap
              onSelectDistrict={(district) => {
                if (district) {
                  setDistrictFilter(district);
                  setAssemblyFilter('');
                  setBoothFilter('');
                  setStatusFilter('');
                  setSchemeFilter('');
                  navigateSubPage('applications');
                }
              }}
            />

            {/* ── Top Applied BJP Schemes ── */}
            <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--color-midnight-ink)', margin: 0 }}>
                  Top Applied BJP Schemes Across Tamil Nadu
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
                      {/* Top Row: Scheme Name */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', zIndex: 2 }}>
                        <div style={{ fontSize: '15px', fontWeight: '700', color: '#1d1d1f', lineHeight: '1.2' }}>
                          {formatSchemeName(item._id)}
                        </div>
                      </div>

                      {/* Bottom Row: Applications Count */}
                      <div style={{ zIndex: 2 }}>
                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#1d1d1f', lineHeight: '1' }}>
                          {item.count.toLocaleString()} <span style={{ fontSize: '12px', fontWeight: '500', color: '#474747' }}>applications</span>
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
              schemePopularity={statsData.schemePopularity || []}
              scopeLabel="Tamil Nadu State"
            />

            {/* ── Top Referral Champions ── */}
            <ErrorBoundary inline>
              <TopReferrersCard
                topReferrers={statsData.topReferrers || []}
                scopeLabel="Tamil Nadu State"
                onViewProfile={(ref) => {
                  if (ref && ref.epicNo) { setSubPage('applications'); setSelectedVoterTimeline(ref); }
                }}
              />
            </ErrorBoundary>

            {/* ── Scheme Requests ── */}
            {suggestionsData && (
              <div className="campsite-card" style={{ width: '100%', padding: '28px', marginTop: '28px', boxSizing: 'border-box', borderRadius: '28px', backgroundColor: '#ffffff', border: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h3 style={{ fontFamily: 'var(--font-sf-pro-display)', fontSize: '24px', fontWeight: '600', color: 'var(--color-primary-ink)', margin: 0, display: 'flex', alignItems: 'center', gap: '10px', letterSpacing: '0.007em' }}>
                      <FileText size={22} color="var(--color-electric-blue)" />
                      Scheme Requests
                    </h3>
                    <div style={{ fontSize: '14px', color: 'var(--color-mid-gray)', marginTop: '4px' }}>
                      Schemes users are asking for that are not yet in the catalog
                    </div>
                  </div>
                  <span className="tag-pill tag-active" style={{ fontSize: '13px', background: 'var(--color-canvas)', color: 'var(--color-primary-ink)' }}>
                    {suggestionsData.total} total request{suggestionsData.total !== 1 ? 's' : ''}
                  </span>
                </div>

                {suggestionsData.total === 0 ? (
                  <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-mid-gray)', background: 'var(--color-canvas)', borderRadius: '28px', fontSize: '15px' }}>
                    No scheme requests yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Top requested */}
                    {suggestionsData.topRequests?.length > 0 && (
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-mid-gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Most Requested</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {suggestionsData.topRequests.map((r, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--color-canvas)', borderRadius: '12px' }}>
                              <span style={{ fontSize: '14px', color: 'var(--color-primary-ink)', fontWeight: '500' }}>{r.suggestion}</span>
                              <span className="badge-status badge-confirmed" style={{ fontSize: '12px', padding: '4px 12px', flexShrink: 0 }}>{r.count}×</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* By district */}
                    {suggestionsData.byDistrict?.length > 0 && (
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-mid-gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Requests by District</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {suggestionsData.byDistrict.map((d, i) => (
                            <span key={i} style={{ padding: '6px 14px', background: 'var(--color-canvas)', borderRadius: '980px', fontSize: '13px', color: 'var(--color-primary-ink)', fontWeight: '500' }}>
                              {d.district} <span style={{ color: 'var(--color-mid-gray)', fontWeight: '400' }}>({d.count})</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recent raw list */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-mid-gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Recent Submissions</div>
                      <div style={{ width: '100%', overflowX: 'auto' }}>
                        <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ padding: '12px 16px' }}>Request</th>
                              <th style={{ padding: '12px 16px' }}>Member</th>
                              <th style={{ padding: '12px 16px' }}>District / Assembly</th>
                              <th style={{ padding: '12px 16px' }}>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {suggestionsData.recent.map((s, i) => (
                              <tr key={i}>
                                <td style={{ padding: '14px 16px', fontWeight: '500', color: 'var(--color-primary-ink)', fontSize: '14px' }}>{s.suggestion}</td>
                                <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--color-mid-gray)' }}>{s.voterName || '—'}</td>
                                <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--color-mid-gray)' }}>
                                  {s.district ? <><div style={{ fontWeight: '500', color: 'var(--color-primary-ink)' }}>{s.district}</div><div style={{ fontSize: '12px' }}>{s.assemblyName || ''}</div></> : '—'}
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--color-mid-gray)', fontVariantNumeric: 'tabular-nums' }}>
                                  {new Date(s.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}

          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-slate)' }}>No dashboard data available.</div>
        )
      )}

      {/* ══════════════════════════════════════════ */}
      {/* PAGE 2: SCHEME APPLICATIONS                */}
      {/* ══════════════════════════════════════════ */}
      {subPage === 'applications' && (
        selectedVoterTimeline ? (
          <MemberProfileTimelineView
            voterData={selectedVoterTimeline}
            onBack={() => setSelectedVoterTimeline(null)}
            onUpdateAppStatus={handleUpdateAppStatus}
            onSelectVoter={(voter) => setSelectedVoterTimeline(voter)}
            targetSchemeName={schemeFilter}
            onDeleteMember={handleDeleteMember}
          />
        ) : (
          <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>

            {/* ── Filters Row 1: Search + Header Stats ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
              <div style={{ flex: '1 1 300px', minWidth: '240px', position: 'relative' }}>
                <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-slate)' }} size={16} />
                <input
                  type="text"
                  placeholder="Search by Member Name, EPIC, Mobile, or Scheme..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="form-control"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>
                {loadingVoters
                  ? <span style={{ opacity: 0.6 }}>Loading…</span>
                  : <>
                      <strong style={{ color: 'var(--color-midnight-ink)' }}>
                        {totalApplications > 0 && totalApplications !== totalVoters
                          ? `${totalApplications.toLocaleString()} Applications (${totalVoters.toLocaleString()} Members)`
                          : `${totalVoters.toLocaleString()} voters`}
                      </strong> · Page {currentPage} of {totalPages}
                    </>
                }
              </div>
            </div>

            {/* ── Filters Row 2: District + Assembly + Booth + Status + Clear All ── */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', width: '100%', alignItems: 'center', background: 'var(--color-fog-gray)', padding: '12px', borderRadius: '10px', border: '1px solid var(--color-linen)' }}>

              {/* District Filter */}
              <select
                value={districtFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setDistrictFilter(val);
                  setAssemblyFilter('');
                  setBoothFilter('');
                }}
                className="admin-filter-select"
                style={{ flex: '1 1 200px', minWidth: '200px' }}
              >
                <option value="">All Districts (State-wide)</option>
                {districts.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              {/* Assembly Filter */}
              <select
                value={assemblyFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setAssemblyFilter(val);
                  setBoothFilter('');
                }}
                className="admin-filter-select"
                disabled={loadingFilterAssemblies}
                style={{ flex: '1 1 160px', minWidth: '160px' }}
              >
                <option value="">{loadingFilterAssemblies ? 'Loading assemblies…' : 'All Assemblies'}</option>
                {assemblies.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>

              {/* Booth Filter (Always Available) */}
              <select
                value={boothFilter}
                onChange={(e) => setBoothFilter(e.target.value)}
                className="admin-filter-select"
                disabled={loadingFilterBooths}
                style={{ flex: '1 1 140px', minWidth: '140px' }}
              >
                <option value="">{loadingFilterBooths ? 'Loading booths…' : 'All Booths'}</option>
                {booths.map(b => (
                  <option key={b} value={b}>Booth {b}</option>
                ))}
                {boothFilter && !booths.includes(boothFilter) && (
                  <option key={boothFilter} value={boothFilter}>Booth {boothFilter}</option>
                )}
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="admin-filter-select"
                style={{ flex: '1 1 150px', minWidth: '150px' }}
              >
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


              {/* Clear All button */}
              {(districtFilter || assemblyFilter || boothFilter || statusFilter || schemeFilter || searchQuery) && (
                <button
                  onClick={() => {
                    setDistrictFilter(''); setAssemblyFilter(''); setBoothFilter('');
                    setStatusFilter(''); setSchemeFilter(''); setSearchQuery('');
                  }}
                  style={{
                    background: '#fff', border: '1px solid var(--color-linen)',
                    borderRadius: '8px', padding: '6px 14px', fontSize: '12px',
                    color: 'var(--color-slate)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: '600'
                  }}
                >
                  Clear All
                </button>
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
                    <th style={{ padding: '12px 10px' }}>District / Assembly / Booth</th>
                    <th style={{ padding: '12px 10px' }}>Latest Status</th>
                    <th style={{ padding: '12px 10px', textAlign: 'right' }}>Actions</th>
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
                        No member applications found matching criteria.
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
                            {voter.district} · {voter.assemblyName} · <strong>Booth {voter.boothNo}</strong>
                          </td>
                          <td style={{ padding: '12px 10px' }}>
                            <StatusBadge status={latestApp?.status || 'Pending'} />
                          </td>
                          <td style={{ padding: '12px 10px', textAlign: 'right' }}>
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
      {/* PAGE 3: LOGINS MANAGER                     */}
      {/* ══════════════════════════════════════════ */}
      {subPage === 'logins' && (
        <div style={{ width: '100%', boxSizing: 'border-box' }}>
          <div className="tabs-header" style={{ width: '100%', marginBottom: '20px', background: 'var(--color-fog-gray)', padding: '6px', borderRadius: '10px' }}>
            <button onClick={() => setCredSubTab('districts')} className={`tab-btn ${credSubTab === 'districts' ? 'active' : ''}`} style={{ padding: '8px 16px', fontSize: '13px' }}>
              District Admin Passcodes ({districtCredentials.length})
            </button>
            <button onClick={() => setCredSubTab('assemblies')} className={`tab-btn ${credSubTab === 'assemblies' ? 'active' : ''}`} style={{ padding: '8px 16px', fontSize: '13px' }}>
              Assembly Admin Passcodes ({assemblyCredentials.length})
            </button>
            <button onClick={() => setCredSubTab('booths')} className={`tab-btn ${credSubTab === 'booths' ? 'active' : ''}`} style={{ padding: '8px 16px', fontSize: '13px' }}>
              Polling Booth Passcodes (By Assembly)
            </button>
          </div>

          {/* Sub-Tab 1: District Credentials */}
          {credSubTab === 'districts' && (
            <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--color-midnight-ink)', marginBottom: '16px' }}>
                Statewide District Admin Passcodes &amp; Quick Access
              </h3>
              <div style={{ marginBottom: '16px' }}>
                <input
                  type="text"
                  placeholder="Search by district, username or passcode..."
                  value={distCredSearch}
                  onChange={(e) => { setDistCredSearch(e.target.value); setDistCredPage(1); }}
                  className="form-control"
                  style={{ maxWidth: '360px' }}
                />
                {distCredSearch && (
                  <span style={{ marginLeft: '12px', fontSize: '13px', color: 'var(--color-slate)' }}>
                    {filteredDistrictCreds.length} result(s)
                  </span>
                )}
              </div>
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                      <th style={{ padding: '10px 12px' }}>DISTRICT NAME</th>
                      <th style={{ padding: '10px 12px' }}>TOTAL ASSEMBLIES</th>
                      <th style={{ padding: '10px 12px' }}>USERNAME</th>
                      <th style={{ padding: '10px 12px' }}>PASSCODE</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>QUICK LOGIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDistrictCreds.slice((distCredPage - 1) * 10, distCredPage * 10).map((dist) => (
                      <tr key={dist.username} style={{ borderBottom: '1px solid var(--color-linen)' }}>
                        <td style={{ padding: '12px', fontWeight: '700', color: 'var(--color-midnight-ink)' }}>{dist.district}</td>
                        <td style={{ padding: '12px', fontWeight: '600' }}>{dist.assembliesCount} Assemblies</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '600', color: 'var(--color-slate)' }}>{dist.username}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '700', color: 'var(--color-saffron)' }}>{dist.passcode}</td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button onClick={() => handleQuickSwitch(dist.username, dist.passcode)} className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: '12px', fontWeight: '700' }}>
                            <LogIn size={13} /> Switch Login
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderPagination(distCredPage, filteredDistrictCreds.length, 10, setDistCredPage)}
            </div>
          )}

          {/* Sub-Tab 2: Assembly Credentials */}
          {credSubTab === 'assemblies' && (
            <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--color-midnight-ink)', marginBottom: '16px' }}>
                All 234 Assembly Constituency Passcodes
              </h3>
              <div style={{ marginBottom: '16px' }}>
                <input
                  type="text"
                  placeholder="Search by assembly name, no, district, username or passcode..."
                  value={assCredSearch}
                  onChange={(e) => { setAssCredSearch(e.target.value); setAssCredPage(1); }}
                  className="form-control"
                  style={{ maxWidth: '420px' }}
                />
                {assCredSearch && (
                  <span style={{ marginLeft: '12px', fontSize: '13px', color: 'var(--color-slate)' }}>
                    {filteredAssemblyCreds.length} result(s)
                  </span>
                )}
              </div>
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                      <th style={{ padding: '10px 12px' }}># NO</th>
                      <th style={{ padding: '10px 12px' }}>ASSEMBLY NAME</th>
                      <th style={{ padding: '10px 12px' }}>DISTRICT</th>
                      <th style={{ padding: '10px 12px' }}>USERNAME</th>
                      <th style={{ padding: '10px 12px' }}>PASSCODE</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>QUICK LOGIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssemblyCreds.slice((assCredPage - 1) * 15, assCredPage * 15).map((ass) => (
                      <tr key={ass.username} style={{ borderBottom: '1px solid var(--color-linen)' }}>
                        <td style={{ padding: '12px', fontWeight: '700', color: 'var(--color-slate)' }}>#{ass.assemblyNo}</td>
                        <td style={{ padding: '12px', fontWeight: '700', color: 'var(--color-midnight-ink)' }}>{ass.assemblyName}</td>
                        <td style={{ padding: '12px', color: 'var(--color-slate)' }}>{ass.district}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '600', color: 'var(--color-slate)' }}>{ass.username}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '700', color: 'var(--color-saffron)' }}>{ass.passcode}</td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button onClick={() => handleQuickSwitch(ass.username, ass.passcode)} className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: '12px', fontWeight: '700' }}>
                            <LogIn size={13} /> Switch Login
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderPagination(assCredPage, filteredAssemblyCreds.length, 15, setAssCredPage)}
            </div>
          )}

          {/* Sub-Tab 3: Booth Credentials */}
          {credSubTab === 'booths' && (
            <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '20px' }}>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-slate)', display: 'block', marginBottom: '6px' }}>Select Assembly Constituency:</label>
                  <select
                    value={selectedAssemblyNo}
                    onChange={(e) => { setSelectedAssemblyNo(e.target.value); setBoothCredPage(1); }}
                    className="form-control"
                  >
                    {assembliesList.map(a => (
                      <option key={a.assemblyNo} value={a.assemblyNo}>
                        #{a.assemblyNo} — {a.assemblyName} ({a.district})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: 1, minWidth: '220px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-slate)', display: 'block', marginBottom: '6px' }}>Search Booth No or Passcode:</label>
                  <input
                    type="text"
                    placeholder="Search booth number..."
                    value={boothSearchQuery}
                    onChange={(e) => { setBoothSearchQuery(e.target.value); setBoothCredPage(1); }}
                    className="form-control"
                  />
                </div>
              </div>

              {loadingBooths ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-slate)' }}>Loading booth logins...</div>
              ) : boothCredentialsData && (
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                        <th style={{ padding: '10px 12px' }}>BOOTH NO</th>
                        <th style={{ padding: '10px 12px' }}>ASSEMBLY</th>
                        <th style={{ padding: '10px 12px' }}>DISTRICT</th>
                        <th style={{ padding: '10px 12px' }}>USERNAME</th>
                        <th style={{ padding: '10px 12px' }}>PASSCODE</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>QUICK LOGIN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBooths.slice((boothCredPage - 1) * 15, boothCredPage * 15).map((b) => (
                        <tr key={b.username} style={{ borderBottom: '1px solid var(--color-linen)' }}>
                          <td style={{ padding: '10px 12px', fontWeight: '700', color: 'var(--color-midnight-ink)' }}>Booth {b.boothNo}</td>
                          <td style={{ padding: '10px 12px' }}>{boothCredentialsData.assemblyName}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--color-slate)' }}>{boothCredentialsData.district}</td>
                          <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: '600' }}>{b.username}</td>
                          <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: '700', color: 'var(--color-saffron)' }}>{b.passcode}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            <button onClick={() => handleQuickSwitch(b.username, b.passcode)} className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: '12px', fontWeight: '700' }}>
                              <LogIn size={13} /> Switch Login
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {renderPagination(boothCredPage, filteredBooths.length, 15, setBoothCredPage)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* PAGE 4: DISTRICT STATS                    */}
      {/* ══════════════════════════════════════════ */}
      {(subPage === 'districts' || subPage === 'districtStats') && (
        <TnDistrictMap
          onSelectDistrict={(district) => {
            if (district) {
              setDistrictFilter(district);
              setAssemblyFilter('');
              setBoothFilter('');
              setStatusFilter('');
              setSchemeFilter('');
              navigateSubPage('applications');
            }
          }}
        />
      )}
      {(subPage === 'districts' || subPage === 'districtStats') && (
        loadingStats ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '16px' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid var(--color-linen)', borderTopColor: 'var(--color-saffron)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: '14px', color: 'var(--color-slate)', fontWeight: '500' }}>Loading District Stats...</div>
          </div>
        ) : (
          <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--color-midnight-ink)', marginBottom: '16px' }}>
              District-wise Application Analytics
            </h3>
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                    <th style={{ padding: '10px' }}>District Name</th>
                    <th style={{ padding: '10px' }}>Total Voters</th>
                    <th style={{ padding: '10px' }}>Applied Voters</th>
                    <th style={{ padding: '10px' }}>Total Applications</th>
                    <th style={{ padding: '10px' }}>Approved</th>
                    <th style={{ padding: '10px' }}>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {(statsData?.districtStats || []).slice((distStatsPage - 1) * 10, distStatsPage * 10).map((row) => (
                    <tr key={row._id} style={{ borderBottom: '1px solid var(--color-linen)', cursor: 'pointer' }}
                      onClick={() => { setDistrictFilter(row._id); setAssemblyFilter(''); setBoothFilter(''); setStatusFilter(''); setSchemeFilter(''); navigateSubPage('applications'); }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-fog-gray)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px', fontWeight: '600', color: 'var(--color-midnight-ink)' }}>{row._id}</td>
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
            {renderPagination(distStatsPage, statsData?.districtStats?.length || 0, 10, setDistStatsPage)}
          </div>
        )
      )}

      {/* ══════════════════════════════════════════ */}
      {/* PAGE 5: ASSEMBLY STATS                    */}
      {/* ══════════════════════════════════════════ */}
      {(subPage === 'assemblies' || subPage === 'assemblyStats') && (
        loadingStats ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '16px' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid var(--color-linen)', borderTopColor: 'var(--color-saffron)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: '14px', color: 'var(--color-slate)', fontWeight: '500' }}>Loading Assembly Stats...</div>
          </div>
        ) : (
          <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--color-midnight-ink)', marginBottom: '16px' }}>
              Assembly Constituency-wise Stats
            </h3>
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                    <th style={{ padding: '10px' }}>Assembly Constituency</th>
                    <th style={{ padding: '10px' }}>District</th>
                    <th style={{ padding: '10px' }}>Total Voters</th>
                    <th style={{ padding: '10px' }}>Applied Voters</th>
                    <th style={{ padding: '10px' }}>Total Applications</th>
                    <th style={{ padding: '10px' }}>Approved</th>
                    <th style={{ padding: '10px' }}>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {(statsData?.assemblyStats || []).slice((assStatsPage - 1) * 15, assStatsPage * 15).map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--color-linen)', cursor: 'pointer' }}
                      onClick={() => { setDistrictFilter(row._id.district); setAssemblyFilter(row._id.assemblyName); setBoothFilter(''); setStatusFilter(''); setSchemeFilter(''); navigateSubPage('applications'); }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-fog-gray)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px', fontWeight: '600', color: 'var(--color-midnight-ink)' }}>{row._id.assemblyName}</td>
                      <td style={{ padding: '10px', color: 'var(--color-slate)' }}>{row._id.district}</td>
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
            {renderPagination(assStatsPage, statsData?.assemblyStats?.length || 0, 15, setAssStatsPage)}
          </div>
        )
      )}

      {/* ══════════════════════════════════════════ */}
      {/* PAGE 6: BOOTH STATS                       */}
      {/* ══════════════════════════════════════════ */}
      {(subPage === 'booths' || subPage === 'boothStats') && (
        loadingStats ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: '16px' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid var(--color-linen)', borderTopColor: 'var(--color-saffron)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: '14px', color: 'var(--color-slate)', fontWeight: '500' }}>Loading Booth Stats...</div>
          </div>
        ) : (

        <div className="campsite-card" style={{ width: '100%', padding: '24px', boxSizing: 'border-box' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--color-midnight-ink)', marginBottom: '16px' }}>
            Polling Booth-wise Breakdown Stats
          </h3>
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-slate)', textAlign: 'left', background: 'var(--color-fog-gray)' }}>
                  <th style={{ padding: '10px' }}>Booth / Part No</th>
                  <th style={{ padding: '10px' }}>Assembly</th>
                  <th style={{ padding: '10px' }}>District</th>
                  <th style={{ padding: '10px' }}>Total Voters</th>
                  <th style={{ padding: '10px' }}>Applied Voters</th>
                  <th style={{ padding: '10px' }}>Total Applications</th>
                  <th style={{ padding: '10px' }}>Approved</th>
                  <th style={{ padding: '10px' }}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {(statsData.boothStats || []).slice((boothStatsPage - 1) * 15, boothStatsPage * 15).map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-linen)', cursor: 'pointer' }}
                    onClick={() => { setDistrictFilter(row._id.district); setAssemblyFilter(row._id.assemblyName); setBoothFilter(String(row._id.boothNo)); setStatusFilter(''); setSchemeFilter(''); navigateSubPage('applications'); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-fog-gray)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px', fontWeight: '600', color: 'var(--color-midnight-ink)' }}>Booth {row._id.boothNo}</td>
                    <td style={{ padding: '10px' }}>{row._id.assemblyName}</td>
                    <td style={{ padding: '10px', color: 'var(--color-slate)' }}>{row._id.district}</td>
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
          {renderPagination(boothStatsPage, statsData?.boothStats?.length || 0, 15, setBoothStatsPage)}
        </div>
        )
      )}

      {/* PAGE: BOOTH PRESIDENT REQUESTS */}
      {subPage === 'booth_presidents' && (
        <BoothPresidentRequestsView admin={admin} />
      )}

      {/* PAGE: REFERRALS */}
      {subPage === 'referrals' && (
        <ReferralsView admin={admin} />
      )}

      {/* ══════════════════════════════════════════ */}
      {/* PAGE 7: REPORTS & EXCEL EXPORT             */}
      {/* ══════════════════════════════════════════ */}
      {subPage === 'reports' && (
        <ReportsView
          initialDistrict={districtFilter}
          initialAssembly={assemblyFilter}
          initialBooth={boothFilter}
          initialStatus={statusFilter}
          initialScheme={schemeFilter}
        />
      )}

      {subPage === 'incomplete_registrations' && (
        <IncompleteRegistrationsView />
      )}

      {subPage === 'schemes' && (
        <SchemesManagementView />
      )}

      {subPage === 'flow_images' && (
        <FlowImagesView />
      )}
        </main>
      </div>
    </div>

  );
};

export default SuperAdminDashboard;
