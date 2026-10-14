import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);
const THIRTY_MINUTES_MS = 30 * 60 * 1000; // 30 minutes inactivity limit

// Safe localStorage wrapper — prevents SecurityError in WebViews (WhatsApp, Instagram, etc.)
// that restrict storage access. Falls back gracefully so the app still loads.
const safeLS = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, val); } catch {} },
  remove: (key) => { try { localStorage.removeItem(key); } catch {} },
};

export const AuthProvider = ({ children }) => {
  const isExpired = () => {
    try {
      const cardCache = safeLS.get('bjp_card_cache');
      if (cardCache) {
        try {
          const parsed = JSON.parse(cardCache);
          if (parsed?.timestamp && (Date.now() - parsed.timestamp < THIRTY_MINUTES_MS)) {
            return false;
          }
        } catch (_) {}
      }
      const lastActive = safeLS.get('bjp_last_activity');
      if (!lastActive) return false;
      return Date.now() - parseInt(lastActive, 10) > THIRTY_MINUTES_MS;
    } catch { return false; }
  };

  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(() => isExpired());

  const [user, setUser] = useState(() => {
    if (isExpired()) {
      safeLS.remove('bjp_user_data');
      safeLS.remove('bjp_user_token');
      return null;
    }
    const saved = safeLS.get('bjp_user_data');
    return saved ? JSON.parse(saved) : null;
  });
  const [userToken, setUserToken] = useState(() => {
    if (isExpired()) return null;
    return safeLS.get('bjp_user_token') || null;
  });

  const [admin, setAdmin] = useState(() => {
    if (isExpired()) {
      safeLS.remove('bjp_admin_data');
      safeLS.remove('bjp_admin_token');
      return null;
    }
    const saved = safeLS.get('bjp_admin_data');
    return saved ? JSON.parse(saved) : null;
  });
  const [adminToken, setAdminToken] = useState(() => {
    if (isExpired()) return null;
    return safeLS.get('bjp_admin_token') || null;
  });

  const [referredByCode, setReferredByCode] = useState(() => safeLS.get('bjp_referred_by') || '');

  // Capture URL referral link (?ref=BJP-XXXX-YYYY)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      safeLS.set('bjp_referred_by', ref);
      setReferredByCode(ref);
    }
  }, []);

  const loginUser = (userData, token) => {
    setUser(userData);
    setUserToken(token);
    setSessionExpiredNotice(false);
    safeLS.set('bjp_user_data', JSON.stringify(userData));
    safeLS.set('bjp_user_token', token);
    safeLS.set('bjp_last_activity', Date.now().toString());
  };

  const logoutUser = () => {
    setUser(null);
    setUserToken(null);
    safeLS.remove('bjp_user_data');
    safeLS.remove('bjp_user_token');
  };

  const loginAdmin = (adminData, token) => {
    setAdmin(adminData);
    setAdminToken(token);
    setSessionExpiredNotice(false);
    safeLS.set('bjp_admin_data', JSON.stringify(adminData));
    safeLS.set('bjp_admin_token', token);
    safeLS.set('bjp_last_activity', Date.now().toString());
  };

  const logoutAdmin = (expired = false) => {
    setAdmin(null);
    setAdminToken(null);
    if (expired) setSessionExpiredNotice(true);
    safeLS.remove('bjp_admin_data');
    safeLS.remove('bjp_admin_token');
    safeLS.remove('bjp_last_activity');
  };

  // ── 30-Minute Inactivity Auto-Logout Tracker ──
  useEffect(() => {
    if (!admin && !user) return;

    // Record activity timestamp
    const recordActivity = () => {
      safeLS.set('bjp_last_activity', Date.now().toString());
    };

    // Initialize activity timestamp on login if not set
    if (!safeLS.get('bjp_last_activity')) {
      recordActivity();
    }

    // Throttle activity updates to at most once every 3 seconds to preserve performance
    let lastRecordTime = 0;
    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastRecordTime > 3000) {
        lastRecordTime = now;
        recordActivity();
      }
    };

    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    activityEvents.forEach(evt => window.addEventListener(evt, handleUserActivity, { passive: true }));

    // Check inactivity every 10 seconds
    const interval = setInterval(() => {
      const lastActiveStr = safeLS.get('bjp_last_activity');
      if (lastActiveStr) {
        const elapsed = Date.now() - parseInt(lastActiveStr, 10);
        if (elapsed >= THIRTY_MINUTES_MS) {
          if (admin) logoutAdmin(true);
          if (user) logoutUser();
        }
      }
    }, 10000);

    return () => {
      activityEvents.forEach(evt => window.removeEventListener(evt, handleUserActivity));
      clearInterval(interval);
    };
  }, [admin, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        userToken,
        admin,
        adminToken,
        referredByCode,
        sessionExpiredNotice,
        loginUser,
        logoutUser,
        loginAdmin,
        logoutAdmin
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

