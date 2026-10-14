import React, { useState } from 'react';
import { chat } from '../api';
import tnLocations from '../data/tn-locations.json';

const SAFFRON = '#FF6B00';
const SAFFRON_LIGHT = '#FFF4EC';
const SAFFRON_BORDER = '#FFD4B0';
const DARK = '#1a1a2e';
const GREEN = '#16a34a';
const GREEN_LIGHT = '#f0fdf4';
const GREEN_BORDER = '#bbf7d0';

const steps = ['Mobile', 'OTP', 'EPIC', 'Submit'];

const StepDot = ({ n, current, done }) => {
  const active = n === current;
  const completed = n < current || done;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: completed ? GREEN : active ? SAFFRON : '#e5e7eb',
        color: completed || active ? '#fff' : '#9ca3af',
        fontWeight: '700', fontSize: '13px',
        transition: 'all 0.2s'
      }}>
        {completed ? '✓' : n}
      </div>
      <span style={{ fontSize: '11px', color: active ? SAFFRON : completed ? GREEN : '#9ca3af', fontWeight: active ? '600' : '400' }}>
        {steps[n - 1]}
      </span>
    </div>
  );
};

const StepLine = ({ done }) => (
  <div style={{ flex: 1, height: 2, background: done ? GREEN : '#e5e7eb', marginBottom: '20px', transition: 'background 0.3s' }} />
);

const InputField = ({ label, value, onChange, type = 'text', placeholder, maxLength, disabled, autoFocus }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
    <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{label}</label>
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      autoFocus={autoFocus}
      style={{
        padding: '12px 14px',
        border: '1.5px solid #d1d5db',
        borderRadius: '10px',
        fontSize: '15px',
        outline: 'none',
        transition: 'border-color 0.2s',
        background: disabled ? '#f9fafb' : '#fff',
        color: disabled ? '#6b7280' : '#111827',
        width: '100%',
        boxSizing: 'border-box'
      }}
      onFocus={(e) => { if (!disabled) e.target.style.borderColor = SAFFRON; }}
      onBlur={(e) => { e.target.style.borderColor = '#d1d5db'; }}
    />
  </div>
);

const Btn = ({ children, onClick, disabled, loading, secondary }) => (
  <button
    onClick={onClick}
    disabled={disabled || loading}
    style={{
      padding: '12px 28px',
      background: secondary ? '#fff' : (disabled || loading) ? '#fbd5b0' : SAFFRON,
      color: secondary ? SAFFRON : '#fff',
      border: secondary ? `1.5px solid ${SAFFRON}` : 'none',
      borderRadius: '10px',
      fontSize: '15px',
      fontWeight: '600',
      cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      width: '100%',
      boxSizing: 'border-box'
    }}
  >
    {loading ? (
      <span style={{
        width: '16px', height: '16px', border: `2px solid ${secondary ? SAFFRON : 'rgba(255,255,255,0.5)'}`,
        borderTopColor: secondary ? SAFFRON : '#fff', borderRadius: '50%',
        display: 'inline-block', animation: 'spin 0.7s linear infinite'
      }} />
    ) : null}
    {children}
  </button>
);

const VoterCard = ({ voter }) => (
  <div style={{
    background: SAFFRON_LIGHT, border: `1.5px solid ${SAFFRON_BORDER}`, borderRadius: '12px',
    padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', background: SAFFRON,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', flexShrink: 0
      }}>
        {(voter.name || voter.voterName || '?')[0].toUpperCase()}
      </div>
      <div>
        <div style={{ fontWeight: '700', fontSize: '15px', color: DARK }}>{voter.name || voter.voterName}</div>
        <div style={{ fontSize: '12px', color: '#6b7280' }}>{voter.epic_no || voter.epicNo}</div>
      </div>
    </div>
    {[
      ['District', voter.district],
      ['Assembly', voter.assembly || voter.assemblyName],
      ['Booth No', voter.part_no || voter.boothNo],
      ['Gender', voter.gender]
    ].filter(([, v]) => v).map(([k, v]) => (
      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
        <span style={{ color: '#6b7280' }}>{k}</span>
        <span style={{ fontWeight: '500', color: '#374151' }}>{v}</span>
      </div>
    ))}
  </div>
);

const VolunteerRegistrationPage = () => {
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);

  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [epic, setEpic] = useState('');
  const [voter, setVoter] = useState(null);
  const [result, setResult] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // No-EPIC path
  const [noEpicMode, setNoEpicMode] = useState(false);
  const [locName, setLocName] = useState('');
  const [locDistrict, setLocDistrict] = useState('');
  const [locAssembly, setLocAssembly] = useState('');

  const startResendTimer = () => {
    setResendTimer(30);
    const iv = setInterval(() => {
      setResendTimer((t) => {
        if (t <= 1) { clearInterval(iv); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  const handleSendOtp = async () => {
    setError('');
    if (!/^[6-9]\d{9}$/.test(mobile.trim())) {
      setError('Enter a valid 10-digit mobile number');
      return;
    }
    setLoading(true);
    try {
      await chat.sendOtp(mobile.trim());
      setOtpSent(true);
      setStep(2);
      startResendTimer();
    } catch (e) {
      setError(e?.message || 'Failed to send OTP. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError('');
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit OTP');
      return;
    }
    setLoading(true);
    try {
      await chat.verifyOtp(mobile.trim(), otp.trim());
      setStep(3);
    } catch (e) {
      setError(e?.message || 'Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLookupEpic = async () => {
    setError('');
    if (!epic.trim()) {
      setError('Enter your Voter ID (EPIC number)');
      return;
    }
    setLoading(true);
    try {
      const res = await chat.validateEpic(epic.trim().toUpperCase(), mobile.trim());
      const v = res?.voter || res?.data || res;
      setVoter(v);
    } catch (e) {
      setError(e?.message || 'Voter ID not found. Check and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setError('');
    setStep(4);
    setLoading(true);
    try {
      const payload = noEpicMode
        ? {
            mobile: mobile.trim(),
            epicNo: '',
            voterName: locName.trim(),
            district: locDistrict,
            assemblyName: locAssembly,
            boothNo: '0',
            gender: 'Unspecified',
            assemblyNo: ''
          }
        : {
            mobile: mobile.trim(),
            epicNo: voter?.epic_no || voter?.epicNo || epic.trim().toUpperCase(),
            voterName: voter?.name || voter?.voterName,
            district: voter?.district,
            assemblyName: voter?.assembly || voter?.assemblyName,
            boothNo: String(voter?.part_no || voter?.boothNo || ''),
            gender: voter?.gender,
            assemblyNo: String(voter?.assembly_no || voter?.assemblyNo || '')
          };
      const res = await chat.volunteerRegister(payload);
      setResult(res);
      setDone(true);
    } catch (e) {
      setError(e?.message || 'Submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setError('');
    setLoading(true);
    try {
      await chat.sendOtp(mobile.trim());
      startResendTimer();
      setOtp('');
    } catch (e) {
      setError(e?.message || 'Failed to resend OTP.');
    } finally {
      setLoading(false);
    }
  };

  if (done && result) {
    return (
      <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pop { 0%{transform:scale(0.7);opacity:0} 80%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }`}</style>
        <div style={{ background: '#fff', borderRadius: '20px', padding: '40px 32px', maxWidth: '440px', width: '100%', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', background: GREEN_LIGHT, border: `2px solid ${GREEN_BORDER}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
            fontSize: '32px', animation: 'pop 0.5s ease'
          }}>🎉</div>
          <h2 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: '700', color: DARK }}>Application Submitted!</h2>
          <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: '14px' }}>
            Your volunteer registration is under review. We'll get in touch soon.
          </p>
          <div style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}`, borderRadius: '12px', padding: '16px', marginBottom: '24px', textAlign: 'left' }}>
            {[
              ['Name', result?.user?.voterName],
              ['Voter ID', result?.user?.epicNo],
              ['Member Code', result?.user?.referralCode],
              ['Status', 'Pending Review']
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0' }}>
                <span style={{ color: '#6b7280' }}>{k}</span>
                <span style={{ fontWeight: '600', color: k === 'Status' ? GREEN : '#374151' }}>{v}</span>
              </div>
            ))}
          </div>
          <a href="/" style={{
            display: 'block', textAlign: 'center', color: SAFFRON, fontSize: '14px', textDecoration: 'none', fontWeight: '500'
          }}>← Back to Home</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ background: '#fff', borderRadius: '20px', padding: '32px 28px', maxWidth: '440px', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <img src="/bjp_logo.svg" alt="BJP Logo" style={{ width: '52px', height: '52px', objectFit: 'contain', marginBottom: '10px' }} />
          <h1 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: '700', color: DARK }}>
            BJP Volunteer Registration
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
            Join as a volunteer for TNBJP Central Government Schemes
          </p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0', marginBottom: '28px' }}>
          <StepDot n={1} current={step} done={done} />
          <StepLine done={step > 1} />
          <StepDot n={2} current={step} done={done} />
          <StepLine done={step > 2} />
          <StepDot n={3} current={step} done={done} />
          <StepLine done={step > 3} />
          <StepDot n={4} current={step} done={done} />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px',
            padding: '10px 14px', marginBottom: '16px', color: '#dc2626', fontSize: '13px'
          }}>
            {error}
          </div>
        )}

        {/* Step 1: Mobile */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <InputField
              label="Mobile Number"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="Enter 10-digit mobile number"
              maxLength={10}
              autoFocus
            />
            <Btn onClick={handleSendOtp} loading={loading} disabled={mobile.length !== 10}>
              Send OTP →
            </Btn>
          </div>
        )}

        {/* Step 2: OTP */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', textAlign: 'center' }}>
              OTP sent to <strong style={{ color: DARK }}>+91 {mobile}</strong>
            </div>
            <InputField
              label="Enter OTP"
              type="tel"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit OTP"
              maxLength={6}
              autoFocus
            />
            <Btn onClick={handleVerifyOtp} loading={loading} disabled={otp.length !== 6}>
              Verify OTP →
            </Btn>
            <button
              onClick={handleResend}
              disabled={resendTimer > 0 || loading}
              style={{
                background: 'none', border: 'none', color: resendTimer > 0 ? '#9ca3af' : SAFFRON,
                cursor: resendTimer > 0 ? 'default' : 'pointer', fontSize: '13px', padding: '4px'
              }}
            >
              {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
            </button>
          </div>
        )}

        {/* Step 3: EPIC lookup or District/Assembly fallback */}
        {step === 3 && !noEpicMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <InputField
              label="Voter ID (EPIC Number)"
              value={epic}
              onChange={(e) => setEpic(e.target.value.toUpperCase())}
              placeholder="e.g. ABC1234567"
              autoFocus
            />
            {!voter && (
              <Btn onClick={handleLookupEpic} loading={loading} disabled={!epic.trim()}>
                Find Voter Details →
              </Btn>
            )}
            {voter && (
              <>
                <VoterCard voter={voter} />
                <Btn onClick={handleSubmit} loading={loading}>
                  Register as Volunteer ✓
                </Btn>
                <Btn secondary onClick={() => { setVoter(null); setEpic(''); setError(''); }}>
                  Change Voter ID
                </Btn>
              </>
            )}
            <button
              type="button"
              onClick={() => { setNoEpicMode(true); setError(''); }}
              style={{ background: 'none', border: 'none', color: SAFFRON, fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', padding: '4px 0' }}
            >
              Don't have Voter ID card? Register with District &amp; Assembly →
            </button>
          </div>
        )}

        {/* Step 3 — no-EPIC: name + district + assembly */}
        {step === 3 && noEpicMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <InputField
              label="Your Full Name"
              value={locName}
              onChange={(e) => setLocName(e.target.value)}
              placeholder="Enter your name"
              autoFocus
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>District</label>
              <select
                value={locDistrict}
                onChange={e => { setLocDistrict(e.target.value); setLocAssembly(''); }}
                style={{ padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontSize: '15px', background: '#fff', color: '#111827', outline: 'none', width: '100%' }}
              >
                <option value="">Select District</option>
                {Object.keys(tnLocations).sort().map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Assembly Constituency</label>
              <select
                value={locAssembly}
                onChange={e => setLocAssembly(e.target.value)}
                disabled={!locDistrict}
                style={{ padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: '10px', fontSize: '15px', background: locDistrict ? '#fff' : '#f9fafb', color: '#111827', outline: 'none', width: '100%' }}
              >
                <option value="">{locDistrict ? 'Select Assembly' : 'Select district first'}</option>
                {(tnLocations[locDistrict] || []).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <Btn
              onClick={handleSubmit}
              loading={loading}
              disabled={!locName.trim() || !locDistrict || !locAssembly}
            >
              Register as Volunteer ✓
            </Btn>
            <button
              type="button"
              onClick={() => { setNoEpicMode(false); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', padding: '4px 0' }}
            >
              ← I have my Voter ID card
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default VolunteerRegistrationPage;
