import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Platform,
  ActivityIndicator, Animated, TouchableWithoutFeedback, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { signOut } from 'firebase/auth';
import { auth } from './src/firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';

import AdminLoginScreen        from './admin/AdminLoginScreen';
import AdminDashboardScreen    from './admin/AdminDashboardScreen';
import AddClientScreen         from './admin/AddClientScreen';
import ClientDetailScreen      from './admin/ClientDetailScreen';
import DataManagementScreen    from './admin/DataManagementScreen';
import ClientManagementScreen  from './admin/ClientManagementScreen'; // ← NEW

// ─── Sidebar layout constants ─────────────────────────────────────────────────
const SIDEBAR_EXPANDED  = 240;
const SIDEBAR_COLLAPSED = 56;
const MOBILE_BP         = 768;
// ─────────────────────────────────────────────────────────────────────────────

// ─── URL <-> Screen mapping (web only) ────────────────────────────────────────
// Same approach used in the client-facing App.js: each admin screen gets its
// own URL, and the browser Back/Forward buttons move between them correctly.
const SCREEN_PATHS = {
  Dashboard:         '/dashboard',
  AddClient:         '/add-client',
  ClientDetail:      '/client-detail',
  DataManagement:    '/data-management',
  ClientManagement:  '/client-management',
};
const PATH_SCREENS = Object.fromEntries(
  Object.entries(SCREEN_PATHS).map(([screen, path]) => [path, screen])
);
const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Fix: extend content behind status bar (Median WebView) ──
  // Median's "Overlay" status-bar option renders content behind the status
  // bar, but that only works if the viewport meta tag has viewport-fit=cover.
  // Expo's default web template doesn't include it, so we patch it in here
  // at runtime instead of needing a custom web/index.html file.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      let viewport = document.querySelector('meta[name="viewport"]');
      const content = 'width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover';
      if (viewport) {
        viewport.setAttribute('content', content);
      } else {
        viewport = document.createElement('meta');
        viewport.name = 'viewport';
        viewport.content = content;
        document.head.appendChild(viewport);
      }
    }
  }, []);

  const [user, setUser]                           = useState(null);
  const [loading, setLoading]                     = useState(true);
  const [adminScreen, setAdminScreen]             = useState(() => {
    // On web, prefer whatever the URL says (handles refresh / direct links)
    // before falling back to localStorage. ClientDetail is the one exception:
    // it needs an in-memory `client` object we don't have on a hard load, so
    // we can't safely resume there — default to Dashboard instead.
    if (isWeb) {
      const screenFromPath = PATH_SCREENS[window.location.pathname];
      if (screenFromPath && screenFromPath !== 'ClientDetail') return screenFromPath;
    }
    return localStorage.getItem('admin_screen') || 'Dashboard';
  });
  const [adminParams, setAdminParams]             = useState(null);

  const [collapsed, setCollapsed]                 = useState(() => localStorage.getItem('sidebar_collapsed') === 'true');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < MOBILE_BP;

  const sidebarAnim = useRef(new Animated.Value(SIDEBAR_EXPANDED)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  // ── Animate sidebar width on collapse/expand (desktop) ──
  useEffect(() => {
    if (isMobile) return;
    Animated.timing(sidebarAnim, {
      toValue: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [collapsed, isMobile]);

  // ── Animate mobile sidebar + overlay ──
  useEffect(() => {
    if (!isMobile) {
      setMobileSidebarOpen(false);
      overlayAnim.setValue(0);
      sidebarAnim.setValue(collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED);
      return;
    }
    Animated.parallel([
      Animated.timing(sidebarAnim, {
        toValue: mobileSidebarOpen ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED,
        duration: 220,
        useNativeDriver: false,
      }),
      Animated.timing(overlayAnim, {
        toValue: mobileSidebarOpen ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [mobileSidebarOpen, isMobile]);

  const labelOpacity = sidebarAnim.interpolate({
    inputRange: [SIDEBAR_COLLAPSED, SIDEBAR_EXPANDED],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const handleToggle = () => {
    if (isMobile) {
      setMobileSidebarOpen(v => !v);
    } else {
      setCollapsed(v => { const n = !v; localStorage.setItem('sidebar_collapsed', n); return n; });
    }
  };

  const closeMobile = () => setMobileSidebarOpen(false);

  // ─── Central navigation helper ────────────────────────────────────────────
  // IMPORTANT: this is declared above the `loading` / `!user` early returns
  // (unlike the old inline `navigate` further down) so that hooks above —
  // like the popstate listener — can always safely reference it, even on
  // renders where the user isn't logged in yet.
  const navigate = (screen, params, { replace = false } = {}) => {
    setAdminScreen(screen);
    localStorage.setItem('admin_screen', screen);
    setAdminParams(params || null);

    if (isWeb) {
      let path = SCREEN_PATHS[screen] || '/dashboard';
      if (screen === 'ClientDetail' && params?.client?.id) {
        path += `?id=${encodeURIComponent(params.client.id)}`;
      }
      const target = path;
      const current = window.location.pathname + window.location.search;
      if (current !== target) {
        if (replace) window.history.replaceState({ screen }, '', target);
        else window.history.pushState({ screen }, '', target);
      }
    }
  };

  // ─── Handle browser Back / Forward buttons ────────────────────────────────
  useEffect(() => {
    if (!isWeb) return;
    const handlePopState = () => {
      const path = window.location.pathname;
      const screen = PATH_SCREENS[path] || 'Dashboard';

      // ClientDetail can't be reconstructed from the URL alone — we don't
      // fetch a client by id anywhere in this file. If we don't already
      // have the client object in memory, fall back to Dashboard instead
      // of rendering a broken screen.
      if (screen === 'ClientDetail' && !adminParams?.client) {
        navigate('Dashboard', null, { replace: true });
        return;
      }

      setAdminScreen(screen);
      localStorage.setItem('admin_screen', screen);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [adminParams]);

  // ─── Session restore ──────────────────────────────────────────────────────
  useEffect(() => {
    const loadSession = async () => {
      try {
        const userData = await AsyncStorage.getItem('migme_user');
        if (userData) {
          setUser(JSON.parse(userData));
          // Once we know the admin is logged in, make sure the URL matches
          // whatever screen we resolved above (covers a fresh "/" load).
          if (isWeb) {
            const path = SCREEN_PATHS[adminScreen] || '/dashboard';
            if (window.location.pathname !== path) {
              window.history.replaceState({ screen: adminScreen }, '', path);
            }
          }
        }
      } catch (e) { console.error('App.js loadSession error:', e); }
      setLoading(false);
    };
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (userData) => {
    setUser(userData);
    await AsyncStorage.setItem('migme_user', JSON.stringify(userData));
    await AsyncStorage.setItem('migme_role', 'admin');
    // Land on the dashboard with a proper URL right after login.
    navigate('Dashboard', null, { replace: true });
  };

  const handleLogout = async () => {
    setUser(null);
    setAdminScreen('Dashboard');
    localStorage.removeItem('admin_screen');
    setMobileSidebarOpen(false);
    if (isWeb) {
      window.history.replaceState({}, '', '/');
    }
    try { await signOut(auth); } catch (_) {}
    await AsyncStorage.removeItem('migme_user');
    await AsyncStorage.removeItem('migme_role');
  };

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  // ─── No user: admin login ─────────────────────────────────────────────────
  if (!user) {
    return (
      <View style={{ flex: 1 }}>
        <AdminLoginScreen onLogin={handleLogin} />
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Sidebar shell ────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  const SidebarShell = ({ bgColor, borderColor, children }) => (
    <>
      {isMobile && mobileSidebarOpen && (
        <Animated.View
          pointerEvents="auto"
          style={[styles.mobileOverlay, { opacity: overlayAnim }]}
        >
          <TouchableWithoutFeedback onPress={closeMobile}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
        </Animated.View>
      )}

      <Animated.View
        style={[
          styles.sidebar,
          {
            width: sidebarAnim,
            backgroundColor: bgColor,
            borderRightColor: borderColor,
            ...(isMobile && mobileSidebarOpen ? {
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              zIndex: 100,
              elevation: 20,
              shadowColor: '#000',
              shadowOffset: { width: 4, height: 0 },
              shadowOpacity: 0.18,
              shadowRadius: 12,
            } : {}),
          },
        ]}
      >
        {children}
      </Animated.View>
    </>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── ADMIN VIEW ───────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  const renderAdminContent = () => {
    switch (adminScreen) {
      case 'Dashboard':
        return (
          <AdminDashboardScreen
            onNavigate={(s, p) => navigate(s, p)}
            onLogout={handleLogout}
          />
        );
      case 'AddClient':
        return (
          <AddClientScreen
            onBack={() => navigate('Dashboard')}
          />
        );
      case 'ClientDetail':
        return (
          <ClientDetailScreen
            client={adminParams?.client}
            onBack={() => navigate('Dashboard')}
          />
        );
      case 'DataManagement':
        return (
          <DataManagementScreen
            onBack={() => navigate('Dashboard')}
          />
        );
      // ── NEW: Client Management screen ──
      case 'ClientManagement':
        return (
          <ClientManagementScreen
            onBack={() => navigate('Dashboard')}
          />
        );
      default:
        return (
          <AdminDashboardScreen
            onNavigate={(s, p) => navigate(s, p)}
            onLogout={handleLogout}
          />
        );
    }
  };

  const AdminNavItem = ({ icon, label, screen }) => {
    const isActive = adminScreen === screen;
    return (
      <TouchableOpacity
        style={[styles.navItem, isActive && styles.navItemActiveWhite]}
        onPress={() => { navigate(screen); closeMobile(); }}
        activeOpacity={0.75}
      >
        {isActive && <View style={[styles.activePill, { backgroundColor: '#4ade80' }]} />}
        <Ionicons name={icon} size={20} color={isActive ? '#ffffff' : 'rgba(255,255,255,0.7)'} />
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.navLabel,
            { color: '#ffffff', fontWeight: isActive ? '700' : '600', opacity: labelOpacity },
          ]}
        >
          {label}
        </Animated.Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.layout}>
        <SidebarShell bgColor="#0f766e" borderColor="#e2e8f0">

          {/* Header */}
          <View style={styles.sidebarHeader}>
            <TouchableOpacity style={styles.logoIconBox} onPress={handleToggle} activeOpacity={0.8}>
              <Ionicons name="shield-checkmark" size={18} color="white" />
            </TouchableOpacity>
            <Animated.View style={{ opacity: labelOpacity, flex: 1, overflow: 'hidden' }}>
              <Text numberOfLines={1} style={styles.logoText}>MIGME</Text>
              <Text numberOfLines={1} style={styles.clientSubName}>Admin Panel</Text>
            </Animated.View>
          </View>

          {/* Nav */}
          <View style={{ flex: 1, paddingTop: 8 }}>

            {/* ── Management section ── */}
            <Animated.Text style={[styles.sectionHeading, { opacity: labelOpacity }]}>
              MANAGEMENT
            </Animated.Text>

            <AdminNavItem
              icon="people-outline"
              label="Clients"
              screen="Dashboard"
            />
            <AdminNavItem
              icon="add-circle-outline"
              label="Add Client"
              screen="AddClient"
            />

            {/* ── NEW: Client Management ── */}
            <AdminNavItem
              icon="briefcase-outline"
              label="Client Management"
              screen="ClientManagement"
            />

            {/* ── System section ── */}
            <Animated.Text style={[styles.sectionHeading, { opacity: labelOpacity, marginTop: 16 }]}>
              SYSTEM
            </Animated.Text>

            <AdminNavItem
              icon="server-outline"
              label="Data Mgmt"
              screen="DataManagement"
            />

          </View>

          {/* Footer */}
          <View style={styles.sidebarFooter}>
            {!isMobile && (
              <TouchableOpacity
                style={styles.collapseBtn}
                onPress={() => setCollapsed(v => !v)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={collapsed ? 'chevron-forward-outline' : 'chevron-back-outline'}
                  size={16}
                  color="#94a3b8"
                />
                <Animated.Text
                  numberOfLines={1}
                  style={[styles.collapseBtnText, { opacity: labelOpacity }]}
                >
                  Collapse
                </Animated.Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.navItem}
              onPress={() => { handleLogout(); closeMobile(); }}
              activeOpacity={0.75}
            >
              <Ionicons name="log-out-outline" size={26} color="#ef4444" />
              <Animated.Text
                numberOfLines={1}
                style={[styles.navLabel, { color: '#ef4444', opacity: labelOpacity }]}
              >
                Log Out
              </Animated.Text>
            </TouchableOpacity>
          </View>

        </SidebarShell>

        {/* Main content */}
        <View style={styles.mainContent}>
          {renderAdminContent()}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    ...(Platform.OS === 'web' ? { height: '100vh' } : {}),
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
    overflow: 'hidden',
  },

  // ── Sidebar ───────────────────────────────────────────────────────────────
  sidebar: {
    flexDirection: 'column',
    borderRightWidth: 1,
    overflow: 'hidden',
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  logoIconBox: {
    backgroundColor: '#0f172a',
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  logoText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  clientSubName: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '600',
    marginTop: -1,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },

  // ── Nav items ─────────────────────────────────────────────────────────────
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    marginHorizontal: 6,
    marginVertical: 1,
    paddingHorizontal: 10,
    borderRadius: 8,
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  navItemActiveWhite: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  activePill: {
    position: 'absolute',
    left: -6,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 3,
  },
  navLabel: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },

  // ── Sidebar footer ────────────────────────────────────────────────────────
  sidebarFooter: {
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    paddingTop: 8,
  },
  collapseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  collapseBtnText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },

  // ── Main content ──────────────────────────────────────────────────────────
  mainContent: {
    flex: 1,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
    flexDirection: 'column',
  },
  topBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  hamburger: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Mobile overlay ────────────────────────────────────────────────────────
  mobileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 99,
  },

  // ── Auth screens ──────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleSelection:    { flex: 1 },
  adminSwitchBtn: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  adminSwitchText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
});
