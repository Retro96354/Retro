import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  SafeAreaView, Modal, Platform, Alert, Dimensions, ScrollView, Animated,
  useWindowDimensions,
} from 'react-native';
import { collection, onSnapshot, query, where, updateDoc, doc, getDoc } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { db } from '../firebaseConfig';

const SOUND_OPTIONS = [
  { name: 'Classic Bell', url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' },
  { name: 'Soft Chime', url: 'https://assets.mixkit.co/active_storage/sfx/2875/2875-preview.mp3' },
  { name: 'Digital Alert', url: 'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3' },
  { name: 'Notification Tone', url: 'https://assets.mixkit.co/active_storage/sfx/2872/2872-preview.mp3' },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const TODAY_FILTER_KEY = 'dashboard_today_only';

// ─────────────────────────────────────────────────────────────────────────────
// Responsive breakpoint — below this width we switch the table's column
// sizing from flex-ratios to FIXED pixel widths and wrap the whole table
// (header + rows) in a horizontal ScrollView. This keeps the exact same
// row/column design as desktop — nothing is redesigned — it just becomes
// side-scrollable instead of squeezing/overlapping on narrow screens.
// ─────────────────────────────────────────────────────────────────────────────
const MOBILE_BREAKPOINT = 700;

// Fixed pixel widths used ONLY when isMobile is true. Chosen to mirror the
// original flex ratios (0.8 / 1.1 / 1.0 / 0.8 / 1.2 / 1.2 / 0.9 / 1.2) at a
// comfortable reading size — same proportions, just non-compressible.
const COL_W = {
  expand:  36,
  status:  90,
  orderNo: 120,
  date:    100,
  time:    80,
  vendor:  130,
  train:   140,
  payment: 100,
  actions: 130,
};
const TABLE_WIDTH =
  COL_W.expand + COL_W.status + COL_W.orderNo + COL_W.date + COL_W.time +
  COL_W.vendor + COL_W.train + COL_W.payment + COL_W.actions + 24; // +row padding

// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIX: Statuses that should be visible on the dashboard.
// Previously only 'Active' was shown — COD orders saved with status 'Confirmed'
// (from vendor postProcess) were silently hidden. Now both are shown.
// 'Completed' and 'Cancelled' remain hidden as intended.
// ─────────────────────────────────────────────────────────────────────────────
const VISIBLE_STATUSES = ['Active', 'Confirmed', 'confirmed', 'Confirm', 'confirm'];

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard-table-only display helper. This never touches the actual value
// used for printing/searching/updating — it only shortens what's rendered
// in the ORDER NO. column so long order numbers don't blow out the row.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_ORDER_NO_DISPLAY_LEN = 10;
const formatOrderNoForDisplay = (orderNo) => {
  if (orderNo === null || orderNo === undefined) return orderNo;
  const str = String(orderNo);
  return str.length > MAX_ORDER_NO_DISPLAY_LEN
    ? `${str.slice(0, MAX_ORDER_NO_DISPLAY_LEN)}…`
    : str;
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIX: TRAIN column display helper. trainInfo may be stored as
// "Name/Number" or "Number/Name" (e.g. "Adi Shatabdi Exp/ 12009"). We only
// want the numeric train number shown in the table — not the train name.
// This never touches the underlying trainInfo value used elsewhere.
// ─────────────────────────────────────────────────────────────────────────────
const extractTrainNo = (trainInfo) => {
  if (!trainInfo) return 'N/A';
  const match = String(trainInfo).match(/\d{3,5}/);
  return match ? match[0] : String(trainInfo);
};

// ─────────────────────────────────────────────────────────────────────────────
// Pagination Bar
// ─────────────────────────────────────────────────────────────────────────────
const PaginationBar = ({ currentPage, totalItems, itemsPerPage, onPageChange, onItemsPerPageChange, isMobile }) => {
  const [pageSizeDropdownVisible, setPageSizeDropdownVisible] = useState(false);
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startItem  = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem    = Math.min(currentPage * itemsPerPage, totalItems);

  const NavBtn = ({ onPress, disabled, iconName }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.pageNavBtn, disabled && styles.pageNavBtnDisabled]}
    >
      <Ionicons name={iconName} size={14} color={disabled ? '#cbd5e1' : '#0f172a'} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.paginationBar, isMobile && styles.paginationBarMobile]}>
      <View style={styles.pageSizeWrapper}>
        <Text style={styles.pageSizeLabel}>{isMobile ? 'Per page:' : 'Items per page:'}</Text>
        <TouchableOpacity
          style={styles.pageSizeSelector}
          onPress={() => setPageSizeDropdownVisible(v => !v)}
        >
          <Text style={styles.pageSizeSelectorText}>{itemsPerPage}</Text>
          <Ionicons name="chevron-down" size={12} color="#64748b" />
        </TouchableOpacity>

        {pageSizeDropdownVisible && (
          <View style={styles.pageSizeDropdown}>
            {PAGE_SIZE_OPTIONS.map(size => (
              <TouchableOpacity
                key={size}
                style={[styles.pageSizeOption, size === itemsPerPage && styles.pageSizeOptionActive]}
                onPress={() => {
                  onItemsPerPageChange(size);
                  setPageSizeDropdownVisible(false);
                }}
              >
                <Text style={[styles.pageSizeOptionText, size === itemsPerPage && styles.pageSizeOptionTextActive]}>
                  {size}
                </Text>
                {size === itemsPerPage && <Ionicons name="checkmark" size={12} color="#0f172a" />}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <Text style={[styles.pageRangeText, isMobile && { fontSize: 11 }]}>{startItem}–{endItem} of {totalItems}</Text>

      <View style={styles.pageNavRow}>
        <NavBtn iconName="play-skip-back"    onPress={() => onPageChange(1)}               disabled={currentPage === 1} />
        <NavBtn iconName="chevron-back"      onPress={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} />
        <NavBtn iconName="chevron-forward"   onPress={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} />
        <NavBtn iconName="play-skip-forward" onPress={() => onPageChange(totalPages)}      disabled={currentPage === totalPages} />
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Expandable Order Row — SAME layout/design as before on desktop.
// On mobile, the expanded detail area now uses a tabbed accordion
// (Items / Customer / Billing) instead of stacking all three sections
// vertically — only the active tab's content renders, so the card no
// longer grows very tall when expanded. Desktop is untouched.
// ─────────────────────────────────────────────────────────────────────────────
const ExpandableOrderRow = ({ item, onPrint, onAssign, isPrinted, isMobile }) => {
  const [expanded, setExpanded] = useState(false);
  const [mobileTab, setMobileTab] = useState('items'); // 'items' | 'customer' | 'billing'
  const STORAGE_KEY = 'viewedOrders';
  const getViewedSet = () => {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
    catch { return new Set(); }
  };
  const [viewed, setViewed] = useState(() => getViewedSet().has(item.id));
  const assignBtnRef = useRef(null);

  const isAssigned = !!item.assignedExecutiveName;

  const isCancelled = item.status === 'Cancelled';
  const isCompleted = item.status === 'Completed';
  // ✅ FIX: Detect all Confirmed variants for badge colour
  const isConfirmed = ['Confirmed', 'confirmed', 'Confirm', 'confirm'].includes(item.status);

  // Status badge colours:
  // Cancelled  → red
  // Completed  → green
  // Confirmed  → blue   ← NEW: distinguishable from Active at a glance
  // Active/etc → amber  (default)
  const badgeBg     = isCancelled ? '#fef2f2'
                    : isCompleted ? '#f0fdf4'
                    : isConfirmed ? '#eff6ff'
                    : '#fffbeb';
  const badgeTxt    = isCancelled ? '#dc2626'
                    : isCompleted ? '#16a34a'
                    : isConfirmed ? '#1d4ed8'
                    : '#b45309';
  const badgeBorder = isCancelled ? '#fecaca'
                    : isCompleted ? '#bbf7d0'
                    : isConfirmed ? '#bfdbfe'
                    : '#fde68a';

  const codTypes    = ['COD', 'CASH', 'CASH_ON_DELIVERY'];
  const isCOD       = codTypes.includes((item.paymentType || '').toUpperCase().replace(/\s+/g, '_'));
  const paymentColor = isCOD ? '#b45309' : '#0f766e';
  const paymentLabel = isCOD ? 'COD' : 'ONLINE';
  const amountToCollect = isCOD ? (item.totalAmount || 0) : 0;

  const handleAssignPress = () => {
    assignBtnRef.current?.measure((fx, fy, width, height, px, py) => {
      onAssign(item, { x: px, y: py, width, height });
    });
  };

  const MOBILE_TABS = [
    { key: 'items', label: 'ITEMS', icon: 'list-outline' },
    { key: 'customer', label: 'CONTACT', icon: 'person-outline' },
    { key: 'billing', label: 'BILLS', icon: 'receipt-outline' },
  ];

  return (
    <View style={styles.cardContainer}>
      <TouchableOpacity
        style={[
          styles.tableRow,
          expanded && styles.tableRowExpanded,
          isMobile && { width: TABLE_WIDTH },
        ]}
        onPress={() => {
          if (!expanded && !viewed) {
            const set = getViewedSet();
            set.add(item.id);
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
            setViewed(true);
          }
          setExpanded(!expanded);
        }}
        activeOpacity={0.85}
      >
        <View style={{
          width: 28, height: 28, borderRadius: 14,
          backgroundColor: viewed ? '#94a3b8' : '#f59e0b',
          alignItems: 'center', justifyContent: 'center',
          marginRight: 8,
        }}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#ffffff" />
        </View>

        <View style={isMobile ? { width: COL_W.status } : { flex: 0.8 }}>
          <View style={[styles.badge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: badgeTxt, letterSpacing: 0.5 }}>
              {item.status || 'ACTIVE'}
            </Text>
          </View>
        </View>

        <Text style={[
          styles.cell,
          isMobile ? { width: COL_W.orderNo } : { flex: 1.1 },
          { fontWeight: '700', color: '#0f172a' },
        ]}>
          {formatOrderNoForDisplay(item.orderNo)}
        </Text>

        <Text style={[
          styles.cell,
          isMobile ? { width: COL_W.date } : { flex: 1.0 },
          { fontSize: 12 },
        ]}>
          {item.deliveryDate ? new Date(item.deliveryDate).toLocaleDateString('en-GB') : '—'}
        </Text>

        <Text style={[
          styles.cell,
          isMobile ? { width: COL_W.time } : { flex: 0.8 },
          { fontSize: 12, fontWeight: '500' },
        ]}>
          {item.deliveryTime || '—'}
        </Text>

        <Text
          style={[styles.cell, isMobile ? { width: COL_W.vendor } : { flex: 1.2 }]}
          numberOfLines={1}
        >
          {item.vendorName}
        </Text>

        <Text
          style={[styles.cell, isMobile ? { width: COL_W.train } : { flex: 1.2 }]}
          numberOfLines={2}
        >
          {extractTrainNo(item.trainInfo)}{' '}
          <Text style={{ color: '#dc2626', fontWeight: '700' }}>
            ({item.coach || 'No Coach'}{item.seat ? ` / ${item.seat}` : ''})
          </Text>
        </Text>

        <View style={isMobile ? { width: COL_W.payment } : { flex: 0.9 }}>
          <Text style={[styles.paymentTag, { color: paymentColor, borderColor: paymentColor }]}>
            {paymentLabel}
          </Text>
        </View>

        {/* ── ACTIONS ── */}
        <View style={[
          isMobile ? { width: COL_W.actions } : { flex: 1.2 },
          { flexDirection: 'row', justifyContent: 'center', gap: 6 },
        ]}>
          <View style={{ position: 'relative' }}>
            <TouchableOpacity ref={assignBtnRef} style={styles.assignBtn} onPress={handleAssignPress}>
              <Ionicons name="bicycle-outline" size={16} color="#ffffff" />
            </TouchableOpacity>
            {isAssigned && (
              <View style={styles.tickBadge}>
                <Ionicons name="checkmark" size={8} color="#fff" />
              </View>
            )}
          </View>

          <View style={{ position: 'relative' }}>
            <TouchableOpacity style={styles.printBtn} onPress={() => onPrint(item)}>
              <Ionicons name="print-outline" size={16} color="#ffffff" />
            </TouchableOpacity>
            {isPrinted && (
              <View style={styles.tickBadge}>
                <Ionicons name="checkmark" size={8} color="#fff" />
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.expandedContent, isMobile && { width: TABLE_WIDTH }]}>
          {isMobile ? (
            <>
              {/* ── Mobile tab switcher — keeps expanded card short ── */}
              <View style={styles.mobileTabBar}>
                {MOBILE_TABS.map(tab => (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.mobileTabBtn, mobileTab === tab.key && styles.mobileTabBtnActive]}
                    onPress={() => setMobileTab(tab.key)}
                  >
                    <Ionicons
                      name={tab.icon}
                      size={14}
                      color={mobileTab === tab.key ? '#ffffff' : '#64748b'}
                    />
                    <Text style={[styles.mobileTabText, mobileTab === tab.key && styles.mobileTabTextActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── Only the active tab's content renders ── */}
              {mobileTab === 'items' && (
                <View style={styles.expandSectionLeft}>
                  <View style={styles.miniTableHeader}>
                    <Text style={[styles.miniHeadText, { flex: 1 }]}>ITEM NAME</Text>
                    <Text style={[styles.miniHeadText, { width: 56, textAlign: 'center' }]}>QTY</Text>
                  </View>
                  <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                    {item.items && item.items.map((prod, idx) => (
                      <View key={idx} style={styles.miniTableRow}>
                        <Text style={[styles.miniCellText, { flex: 1 }]}>{prod.name}</Text>
                        <Text style={[styles.miniCellText, { width: 56, textAlign: 'center', fontWeight: '700', color: '#0f172a' }]}>
                          {prod.quantity}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {mobileTab === 'customer' && (
                <View style={styles.expandSectionMid}>
                  <Text style={styles.sectionLabel}>CUSTOMER DETAILS</Text>
                  <Text style={styles.remarkText}>{item.customerName}</Text>
                  <Text style={[styles.remarkText, { color: '#475569', fontWeight: '700' }]}>Mo: {item.contactNo}</Text>

                  {item.remark && item.remark.trim() !== '' && (
                    <View style={styles.remarkBox}>
                      <Text style={styles.remarkAlertText}>⚠ SPECIAL INSTRUCTIONS</Text>
                      <Text style={styles.remarkContentText}>{item.remark}</Text>
                    </View>
                  )}

                  {item.assignedExecutiveName && (
                    <View style={styles.assignedBadgeBox}>
                      <Text style={styles.assignedBadgeLabel}>ASSIGNED TO:</Text>
                      <Text style={styles.assignedBadgeName}>{item.assignedExecutiveName}</Text>
                    </View>
                  )}
                </View>
              )}

              {mobileTab === 'billing' && (
                <View style={styles.expandSectionRight}>
                  <Text style={styles.sectionLabel}>BILLING SUMMARY</Text>
                  <View style={styles.financeRow}>
                    <Text style={styles.financeLabel}>Sub Total</Text>
                    <Text style={styles.financeValue}>₹ {item.subTotal || 0}</Text>
                  </View>
                  <View style={styles.financeRow}>
                    <Text style={styles.financeLabel}>Tax / GST</Text>
                    <Text style={styles.financeValue}>₹ {item.tax || 0}</Text>
                  </View>
                  <View style={styles.financeRow}>
                    <Text style={styles.financeLabel}>Delivery</Text>
                    <Text style={styles.financeValue}>₹ {item.deliveryCharge || 0}</Text>
                  </View>
                  <View style={styles.financeDivider} />
                  <View style={styles.financeRow}>
                    <Text style={[styles.financeLabel, { fontWeight: '700', color: '#0f172a' }]}>TOTAL BILL</Text>
                    <Text style={[styles.financeValue, { fontSize: 15, fontWeight: '800', color: '#0f172a' }]}>
                      ₹ {item.totalAmount || 0}
                    </Text>
                  </View>
                  {isCOD && (
                    <View style={styles.amountToCollectBar}>
                      <Text style={styles.atcLabel}>COLLECT CASH</Text>
                      <Text style={styles.atcValue}>₹ {amountToCollect}</Text>
                    </View>
                  )}
                </View>
              )}
            </>
          ) : (
            // ── Desktop: unchanged, exactly as before ──
            <View style={styles.expandedLayout}>
              {/* LEFT — Items */}
              <View style={styles.expandSectionLeft}>
                <View style={styles.miniTableHeader}>
                  <Text style={[styles.miniHeadText, { flex: 1 }]}>ITEM NAME</Text>
                  <Text style={[styles.miniHeadText, { width: 56, textAlign: 'center' }]}>QTY</Text>
                </View>
                {item.items && item.items.map((prod, idx) => (
                  <View key={idx} style={styles.miniTableRow}>
                    <Text style={[styles.miniCellText, { flex: 1 }]}>{prod.name}</Text>
                    <Text style={[styles.miniCellText, { width: 56, textAlign: 'center', fontWeight: '700', color: '#0f172a' }]}>
                      {prod.quantity}
                    </Text>
                  </View>
                ))}
              </View>

              {/* MID — Customer */}
              <View style={styles.expandSectionMid}>
                <Text style={styles.sectionLabel}>CUSTOMER DETAILS</Text>
                <Text style={styles.remarkText}>{item.customerName}</Text>
                <Text style={[styles.remarkText, { color: '#475569', fontWeight: '700' }]}>Mo: {item.contactNo}</Text>

                {item.remark && item.remark.trim() !== '' && (
                  <View style={styles.remarkBox}>
                    <Text style={styles.remarkAlertText}>⚠ SPECIAL INSTRUCTIONS</Text>
                    <Text style={styles.remarkContentText}>{item.remark}</Text>
                  </View>
                )}

                {item.assignedExecutiveName && (
                  <View style={styles.assignedBadgeBox}>
                    <Text style={styles.assignedBadgeLabel}>ASSIGNED TO:</Text>
                    <Text style={styles.assignedBadgeName}>{item.assignedExecutiveName}</Text>
                  </View>
                )}
              </View>

              {/* RIGHT — Billing */}
              <View style={styles.expandSectionRight}>
                <Text style={styles.sectionLabel}>BILLING SUMMARY</Text>
                <View style={styles.financeRow}>
                  <Text style={styles.financeLabel}>Sub Total</Text>
                  <Text style={styles.financeValue}>₹ {item.subTotal || 0}</Text>
                </View>
                <View style={styles.financeRow}>
                  <Text style={styles.financeLabel}>Tax / GST</Text>
                  <Text style={styles.financeValue}>₹ {item.tax || 0}</Text>
                </View>
                <View style={styles.financeRow}>
                  <Text style={styles.financeLabel}>Delivery</Text>
                  <Text style={styles.financeValue}>₹ {item.deliveryCharge || 0}</Text>
                </View>
                <View style={styles.financeDivider} />
                <View style={styles.financeRow}>
                  <Text style={[styles.financeLabel, { fontWeight: '700', color: '#0f172a' }]}>TOTAL BILL</Text>
                  <Text style={[styles.financeValue, { fontSize: 15, fontWeight: '800', color: '#0f172a' }]}>
                    ₹ {item.totalAmount || 0}
                  </Text>
                </View>
                {isCOD && (
                  <View style={styles.amountToCollectBar}>
                    <Text style={styles.atcLabel}>COLLECT CASH</Text>
                    <Text style={styles.atcValue}>₹ {amountToCollect}</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton Loader
// ─────────────────────────────────────────────────────────────────────────────
const SkeletonRow = ({ isMobile }) => {
  const shimmer = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const Box = ({ flex, width }) => (
    <Animated.View style={{
      height: 12, borderRadius: 4, backgroundColor: '#e2e8f0',
      opacity, flex, width,
    }} />
  );

  return (
    <View style={[styles.tableRow, { gap: 12 }, isMobile && { width: TABLE_WIDTH }]}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#e2e8f0', opacity: 0.5 }} />
      <Box {...(isMobile ? { width: COL_W.status } : { flex: 0.8 })} />
      <Box {...(isMobile ? { width: COL_W.orderNo } : { flex: 1.1 })} />
      <Box {...(isMobile ? { width: COL_W.date } : { flex: 1.0 })} />
      <Box {...(isMobile ? { width: COL_W.time } : { flex: 0.8 })} />
      <Box {...(isMobile ? { width: COL_W.vendor } : { flex: 1.2 })} />
      <Box {...(isMobile ? { width: COL_W.train } : { flex: 1.2 })} />
      <Box {...(isMobile ? { width: COL_W.payment } : { flex: 0.9 })} />
      <Box {...(isMobile ? { width: COL_W.actions } : { flex: 1.2 })} />
    </View>
  );
};

const SkeletonLoader = ({ isMobile }) => (
  <View style={{ flex: 1 }}>
    {Array.from({ length: 10 }).map((_, i) => (
      <View key={i} style={{ borderBottomWidth: 1, borderColor: '#f1f5f9' }}>
        <SkeletonRow isMobile={isMobile} />
      </View>
    ))}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardScreen({ clientId }) {
  const [appReady, setAppReady]       = useState(true);
  const [orders, setOrders]           = useState([]);
  const [executives, setExecutives]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [printedOrders, setPrintedOrders] = useState(new Set());
  const [alertSound, setAlertSound]   = useState(SOUND_OPTIONS[0].url);

  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < MOBILE_BREAKPOINT;

  // ── Today-only filter — persisted in localStorage ──
  const [todayOnly, setTodayOnly] = useState(() => {
    try { return localStorage.getItem(TODAY_FILTER_KEY) === 'true'; }
    catch { return false; }
  });

  // ── Pagination ──
  const [currentPage, setCurrentPage]   = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // ── Assign modal ──
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder]           = useState(null);
  const [dropdownPos, setDropdownPos]               = useState({ x: 0, y: 0, width: 0, height: 0 });

  const soundRef    = useRef(null);
  const isFirstLoad = useRef(true);

  // ── Toggle today-only and persist ──
  const handleTodayToggle = () => {
    const next = !todayOnly;
    setTodayOnly(next);
    setCurrentPage(1);
    try { localStorage.setItem(TODAY_FILTER_KEY, String(next)); } catch {}
  };

  // ── Today's date string for comparison (YYYY-MM-DD) ──
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ── Subscribe to client alertSound ──
  useEffect(() => {
    if (!clientId) return;
    const unsub = onSnapshot(doc(db, 'clients', clientId), (snap) => {
      if (snap.exists()) setAlertSound(snap.data().alertSound || SOUND_OPTIONS[0].url);
    });
    return () => unsub();
  }, [clientId]);

  // ── Init sound ──
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'web') {
          const audio = new window.Audio(alertSound);
          await audio.play().then(() => audio.pause()).catch(() => {});
          soundRef.current = audio;
        } else {
          const { sound } = await Audio.Sound.createAsync({ uri: alertSound });
          soundRef.current = sound;
        }
      } catch (e) {}
      setAppReady(true);
    })();
  }, [alertSound]);

  async function playAlert() {
    if (Platform.OS === 'web' && soundRef.current) {
      soundRef.current.currentTime = 0;
      soundRef.current.play().catch(() => {});
    } else if (soundRef.current) {
      await soundRef.current.replayAsync();
    }
  }

  // ── Fetch orders + executives ──
  useEffect(() => {
    if (!appReady) return;
    const q = query(collection(db, "orders"),where("clientId", "==", clientId),
    where("status", "in", [
    "Active",
    "Confirm",
    "Confirmed",
    "confirmed",
     ])
   );
    const unsubscribeOrders = onSnapshot(q, (snapshot) => {
        console.log("Orders received:", snapshot.docs.length);
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const timeA = a.deliveryTime || '23:59';
        const timeB = b.deliveryTime || '23:59';
        return timeA.localeCompare(timeB);
      });
      setOrders(list);
      setLoading(false);

      if (isFirstLoad.current) { isFirstLoad.current = false; return; }
      snapshot.docChanges().forEach((change) => { if (change.type === 'added') playAlert(); });
    }, (error) => { Alert.alert('Sync Error', error.message); });

    const unsubscribeExecs = onSnapshot(
      query(collection(db, 'executives'), where('clientId', '==', clientId)),
      (snapshot) => setExecutives(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    return () => { unsubscribeOrders(); unsubscribeExecs(); };
  }, [appReady]);

  // ── Derive display list ──
  // ✅ FIX: Show all VISIBLE_STATUSES (Active + Confirmed variants).
  // Previously only 'Active' was shown — any order saved with status 'Confirmed'
  // (e.g. COD orders from Yatri Restro vendor postProcess) was silently hidden.
  const activeOrders = orders.filter(o => {
    if (!VISIBLE_STATUSES.includes(o.status)) return false;
    if (!todayOnly) return true;

    if (!o.deliveryDate) return false;
    try {
      const d = o.deliveryDate?.toDate
        ? o.deliveryDate.toDate()
        : new Date(o.deliveryDate);
      const orderDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return orderDateStr === getTodayStr();
    } catch { return false; }
  });

  // ── Pagination derived values ──
  const totalItems  = activeOrders.length;
  const totalPages  = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIdx    = (currentPage - 1) * itemsPerPage;
  const pagedOrders = activeOrders.slice(startIdx, startIdx + itemsPerPage);

  const handlePageChange = (page) => {
    setCurrentPage(Math.min(Math.max(1, page), totalPages));
  };

  const handleItemsPerPageChange = (size) => {
    setItemsPerPage(size);
    setCurrentPage(1);
  };

  // ── Print ──
  const handlePrint = async (order) => {
    try {
      let clientPaymentId = '';
      // ✅ Pulled from the client's profile instead of being hardcoded, so
      // every client's receipt shows their own business name and address.
      let clientBusinessName = 'E-Catering Orders';
      let clientAddress = '';
      try {
        const clientSnap = await getDoc(doc(db, 'clients', clientId));
        if (clientSnap.exists()) {
          const clientData = clientSnap.data();
          clientPaymentId    = clientData.paymentId || '';
          clientBusinessName = clientData.businessName || clientBusinessName;
          clientAddress      = clientData.address || '';
        }
      } catch (e) {}

      let itemsHtml = '';
      if (order.items && order.items.length > 0) {
        order.items.forEach(item => {
          itemsHtml += `
            <tr>
              <td style="padding: 4px 2px; border-bottom: 1px solid #eee; width: 75%; vertical-align: top;">${item.name}</td>
              <td style="padding: 4px 2px; border-bottom: 1px solid #eee; text-align: right; vertical-align: top;">${item.quantity}</td>
            </tr>`;
        });
      }

      const codTypes    = ['COD', 'CASH', 'CASH_ON_DELIVERY'];
      const rawPayType  = (order.paymentType || 'ONLINE').toUpperCase().replace(/\s+/g, '_');
      const isCOD       = codTypes.includes(rawPayType);
      const paymentType = isCOD ? 'COD' : 'ONLINE';
      const amountToCollect = isCOD ? (order.totalAmount || 0) : 0;

      const trainNo   = extractTrainNo(order.trainInfo);
      const coachSeat = `${order.coach || '-'}/${order.seat || '-'}`;
      const upiUrl    = `upi://pay?pa=${clientPaymentId}&pn=${order.vendorName || 'Vendor'}&am=${amountToCollect}&cu=INR`;

      const qrHtml = clientPaymentId && isCOD ? `
        <div class="center" style="margin-top:12px;">
          <img id="qrImg"
            src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUrl)}"
            style="width:150px;height:150px;object-fit:contain;border:1px solid #ccc;padding:4px;"
          />
          <div style="font-size:11px;margin-top:6px;font-weight:bold;word-break:break-all;">Scan & Pay</div>
          <div style="font-size:10px;margin-top:2px;word-break:break-all;">${clientPaymentId}</div>
        </div>` : '';

      const htmlContent = `
<html>
  <head>
    <title>Receipt</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
    <style>
      @page { margin: 0; size: 80mm auto; }
      * { box-sizing: border-box; font-weight: inherit; }
      html { background-color: #ffffff; }
      body {
        background-color: #ffffff;
        font-family: 'Courier New', Courier, monospace;
        width: 72mm; margin: 0 auto; padding: 10px 16px 16px 10px;
        font-size: 12px; color: #000; font-weight: 900;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .center { text-align: center; }
      .bold { font-weight: bold; }
      .divider { border: none; border-top: 1px #000; margin: 7px 0; }
      .detail-table { width: 100%; border-collapse: collapse; }
      .detail-table tr td { padding: 2px 0; vertical-align: top; }
      .detail-table tr td:first-child { white-space: nowrap; padding-right: 8px; }
      .detail-table tr td:last-child { text-align: right; word-break: break-word; }
      .items-table { width: 100%; border-collapse: collapse; margin-top: 2px; }
      .items-head th { font-weight: bold; padding: 4px 2px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; font-size: 14px; }
      .items-head th:first-child { text-align: left; }
      .items-head th:last-child { text-align: right; width: 40px; }
      .items-table tbody tr td { padding: 3px 2px; vertical-align: top; font-size: 15px; }
      .items-table tbody tr td:last-child { text-align: right; width: 40px; }
      .totals-table { width: 100%; border-collapse: collapse; }
      .totals-table td { padding: 2px 0; font-size: 14px; }
      .totals-table td:last-child { text-align: right; padding-right: 6px; }
      .totals-table tr.total-row td { font-weight: bold; font-size: 14px; padding-top: 3px; }
      .totals-table tr.collect-row td { font-weight: bold; font-size: 14px; }
      .payment-box { border: 2.5px solid #000; text-align: center; padding: 8px 4px; margin: 10px 0 0 0; font-size: 30px; font-weight: 900; letter-spacing: 4px; }
      .train-box { border: 2.5px solid #000; border-top: none; display: flex; margin: 0 0 10px 0; }
      .train-cell { flex: 1; text-align: center; padding: 8px 4px; font-size: 16px; font-weight: 900; }
      .train-cell.divider-right { border-right: 2.5px solid #000; }
    </style>
  </head>
  <body>

    <div class="center bold" style="font-size:16px;margin-bottom:2px;">${clientBusinessName}</div>
    <div class="center" style="font-size:11px;">${clientAddress}</div>
    <hr class="divider"/>
    <table class="detail-table">
      <tr><td>Order No.</td><td>${order.orderNo || order.pnr || 'N/A'}</td></tr>
      <tr><td>Vendor</td><td>${order.vendorName || 'N/A'}</td></tr>
      <tr><td>Date</td><td>${order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')}</td></tr>
      <tr><td>Time</td><td>${order.deliveryTime || new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</td></tr>
      <tr><td>Customer</td><td>${order.customerName || 'Customer'}</td></tr>
      <tr><td>Mobile</td><td>${order.contactNo || 'N/A'}</td></tr>
    </table>
    <hr class="divider"/>
    <table class="items-table">
      <thead class="items-head"><tr><th>Item</th><th>Qty</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <hr class="divider"/>
    <table class="totals-table">
      <tr><td>Remarks:</td><td>${order.remark && order.remark.trim() !== '' ? order.remark : ''}</td></tr>
      <tr><td>Advance:</td><td>₹ 0</td></tr>
      <tr><td>GST:</td><td>₹ ${order.tax || 0}</td></tr>
      <tr><td>Tax:</td><td>₹ 0</td></tr>
      <tr><td>Discount:</td><td>₹ 0</td></tr>
      <tr class="total-row"><td>Total:</td><td>₹ ${order.totalAmount || 0}</td></tr>
      <tr class="collect-row"><td>Amount to collect:</td><td>₹ ${amountToCollect}</td></tr>
    </table>
    <div class="payment-box">${paymentType}</div>
    <div class="train-box">
      <div class="train-cell divider-right">${trainNo}</div>
      <div class="train-cell">${coachSeat}</div>
    </div>
    ${qrHtml}
    <div class="center" style="font-size:14px;">www.imperiial.tech</div>
  </body>
</html>`;

      if (Platform.OS === 'web') {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        iframe.contentDocument.write(htmlContent);
        iframe.contentDocument.close();

        const doPrint = () => {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          setPrintedOrders(prev => new Set([...prev, order.id]));
          updateDoc(doc(db, 'orders', order.id), { status: 'Completed' }).catch(() => {});
          setTimeout(() => { document.body.removeChild(iframe); }, 1000);
        };

        setTimeout(() => {
          const img = iframe.contentDocument.getElementById('qrImg');
          if (img && !img.complete) {
            img.onload = doPrint;
            img.onerror = doPrint;
          } else {
            doPrint();
          }
        }, 200);
      } else {
        Alert.alert('Notice', 'Printing is currently configured for Web only.');
      }
    } catch (error) {
      console.error('Printing Error:', error);
      Alert.alert('Print Failed', 'Could not generate the receipt.');
    }
  };

  const openAssignModal = (order, pos) => {
    setSelectedOrder(order);
    setDropdownPos(pos);
    setAssignModalVisible(true);
  };

  const handleAssignExec = async (exec) => {
    if (!selectedOrder) return;
    await updateDoc(doc(db, 'orders', selectedOrder.id), {
      assignedExecutiveId: exec.id,
      assignedExecutiveName: exec.name,
    });
    setAssignModalVisible(false);
  };

  // ── Shared header row (used inside the scroll wrapper on mobile, and
  //    directly on desktop) ──
  const TableHeader = () => (
    <View style={[styles.tableHeader, isMobile && { width: TABLE_WIDTH }]}>
      <View style={{ width: 36 }} />
      <Text style={[styles.col, isMobile ? { width: COL_W.status } : { flex: 0.8 }]}>STATUS</Text>
      <Text style={[styles.col, isMobile ? { width: COL_W.orderNo } : { flex: 1.1 }]}>ORDER NO.</Text>
      <Text style={[styles.col, isMobile ? { width: COL_W.date } : { flex: 1.0 }]}>DEL. DATE</Text>
      <Text style={[styles.col, isMobile ? { width: COL_W.time } : { flex: 0.8 }]}>DEL. TIME</Text>
      <Text style={[styles.col, isMobile ? { width: COL_W.vendor } : { flex: 1.2 }]}>VENDOR</Text>
      <Text style={[styles.col, isMobile ? { width: COL_W.train } : { flex: 1.2 }]}>TRAIN</Text>
      <Text style={[styles.col, isMobile ? { width: COL_W.payment } : { flex: 0.9 }]}>PAYMENT</Text>
      <Text style={[styles.col, isMobile ? { width: COL_W.actions } : { flex: 1.2 }, { textAlign: 'center' }]}>ACTIONS</Text>
    </View>
  );

  // ── Body: skeleton / empty / list — same content either way ──
  const TableBody = () => (
    loading ? (
      <SkeletonLoader isMobile={isMobile} />
    ) : activeOrders.length === 0 ? (
      <View style={[styles.emptyState, isMobile && { width: TABLE_WIDTH }]}>
        <Ionicons name="receipt-outline" size={36} color="#cbd5e1" />
        <Text style={styles.emptyStateText}>
          {todayOnly ? "No active orders for today" : "No active orders right now"}
        </Text>
      </View>
    ) : (
      <FlatList
        data={pagedOrders}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ExpandableOrderRow
            item={item}
            onPrint={handlePrint}
            onAssign={openAssignModal}
            isPrinted={printedOrders.has(item.id)}
            isMobile={isMobile}
          />
        )}
        style={[{ flex: 1 }, isMobile && { width: TABLE_WIDTH }]}
        contentContainerStyle={{ paddingBottom: 0, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      />
    )
  );

  return (
    <SafeAreaView style={styles.container}>

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Active Orders</Text>
          <View style={styles.countRow}>
            <View style={[styles.countDot, { backgroundColor: '#f59e0b' }]} />
            <Text style={styles.subHeading}>
              {loading ? '…' : `${activeOrders.length} ${activeOrders.length === 1 ? 'order' : 'orders'} found`}
            </Text>
          </View>
        </View>

        {/* Today Only toggle button */}
        <TouchableOpacity
          style={[styles.todayBtn, todayOnly && styles.todayBtnActive]}
          onPress={handleTodayToggle}
          activeOpacity={0.8}
        >
          <Ionicons
            name={todayOnly ? 'today' : 'today-outline'}
            size={15}
            color={todayOnly ? '#ffffff' : '#0f172a'}
          />
          <Text style={[styles.todayBtnText, todayOnly && styles.todayBtnTextActive]}>
            Today Only
          </Text>
          {todayOnly && (
            <View style={styles.todayActiveDot} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Table container ── */}
      <View style={styles.tableContainer}>
        {isMobile ? (
          // Mobile: same table, wrapped in a horizontal ScrollView so wide
          // (fixed-width) columns can be reached by side-scrolling instead
          // of being compressed/overlapped.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            style={{ flex: 1 }}
            contentContainerStyle={{ minWidth: TABLE_WIDTH }}
          >
            <View style={{ width: TABLE_WIDTH, flex: 1 }}>
              <TableHeader />
              <TableBody />
            </View>
          </ScrollView>
        ) : (
          // Desktop: unchanged, exactly as before.
          <>
            <TableHeader />
            <TableBody />
          </>
        )}

        {!loading && activeOrders.length > 0 && (
          <PaginationBar
            currentPage={currentPage}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            onItemsPerPageChange={handleItemsPerPageChange}
            isMobile={isMobile}
          />
        )}
      </View>

      {/* ── Assign Executive Modal ── */}
      <Modal visible={assignModalVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.dropdownBackdrop}
          activeOpacity={1}
          onPress={() => setAssignModalVisible(false)}
        >
          <View
            style={[
              styles.dropdownContainer,
              { top: dropdownPos.y + dropdownPos.height + 6, left: dropdownPos.x - 180 },
            ]}
          >
            <Text style={styles.dropdownTitle}>ASSIGN EXECUTIVE</Text>
            <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
              {executives.map(exec => (
                <TouchableOpacity
                  key={exec.id}
                  style={styles.execDropdownRow}
                  onPress={() => handleAssignExec(exec)}
                >
                  <Ionicons name="person-circle-outline" size={20} color="#475569" />
                  <Text style={styles.execName}>{exec.name}</Text>
                </TouchableOpacity>
              ))}
              {executives.length === 0 && (
                <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 16, fontSize: 13 }}>
                  No executives found.
                </Text>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#f8fafc', padding: 24,
    height: Platform.OS === 'web' ? '100vh' : '100%',
  },

  topBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12,
  },
  heading:    { fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.5 },
  countRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  countDot:   { width: 7, height: 7, borderRadius: 4 },
  subHeading: { fontSize: 13, color: '#64748b', fontWeight: '500' },

  todayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  todayBtnActive:     { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  todayBtnText:       { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  todayBtnTextActive: { color: '#ffffff' },
  todayActiveDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#22c55e', marginLeft: 2,
  },

  tableContainer: {
    flex: 1, backgroundColor: 'white', borderRadius: 8,
    borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row', backgroundColor: '#0f172a',
    paddingVertical: 12, paddingHorizontal: 12,
    borderBottomWidth: 1, borderColor: '#e2e8f0', alignItems: 'center',
  },
  col: { fontSize: 10, fontWeight: '700', color: '#ffffff', letterSpacing: 0.8 },

  cardContainer: { borderBottomWidth: 1, borderColor: '#f1f5f9' },
  tableRow: {
    flexDirection: 'row', paddingVertical: 12,
    paddingHorizontal: 12, alignItems: 'center', backgroundColor: 'white',
  },
  tableRowExpanded: { backgroundColor: '#f8fafc' },
  cell:      { fontSize: 13, color: '#334155', fontWeight: '700' },
  badge:     { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1, alignSelf: 'flex-start' },
  paymentTag: {
    fontSize: 10, fontWeight: '700', borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', letterSpacing: 0.5,
  },
  assignBtn: {
    width: 32, height: 32, borderRadius: 6,
    backgroundColor: '#16a34a', justifyContent: 'center', alignItems: 'center',
  },
  printBtn: {
    width: 32, height: 32, borderRadius: 6,
    backgroundColor: '#3b82f6', justifyContent: 'center', alignItems: 'center',
  },
  tickBadge: {
    position: 'absolute', top: -5, right: -5,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#0f172a', justifyContent: 'center',
    alignItems: 'center', borderWidth: 1.5, borderColor: '#fff',
  },
  emptyState:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyStateText: { fontSize: 14, color: '#94a3b8' },

  expandedContent: {
    backgroundColor: '#f8fafc', padding: 16,
    borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  expandedLayout: { flexDirection: 'row', gap: 16 },

  // ── Mobile tab switcher (Items / Customer / Billing) ──
  mobileTabBar: {
    flexDirection: 'row', gap: 6, marginBottom: 12,
    backgroundColor: '#f1f5f9', borderRadius: 8, padding: 4,
  },
  mobileTabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 6,
  },
  mobileTabBtnActive: { backgroundColor: '#0f172a' },
  mobileTabText: { fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 0.4 },
  mobileTabTextActive: { color: '#ffffff' },

  expandSectionLeft: {
    flex: 1.5, backgroundColor: 'white', borderRadius: 6,
    overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0',
  },
  miniTableHeader: {
    flexDirection: 'row', backgroundColor: '#f8fafc',
    padding: 8, borderBottomWidth: 1, borderColor: '#e2e8f0',
  },
  miniHeadText: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.6 },
  miniTableRow: { flexDirection: 'row', padding: 9, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  miniCellText: { fontSize: 13, color: '#0f172a', fontWeight: '700' },

  expandSectionMid: {
    flex: 1, padding: 12, backgroundColor: 'white',
    borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0',
  },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8, marginBottom: 8 },
  remarkText:   { fontSize: 13, color: '#0f172a', fontWeight: '700', marginBottom: 3 },
  remarkBox: {
    marginTop: 10, padding: 10, backgroundColor: '#fffbeb',
    borderRadius: 6, borderWidth: 1, borderColor: '#fde68a',
  },
  remarkAlertText:   { fontSize: 10, fontWeight: '700', color: '#b45309', marginBottom: 3, letterSpacing: 0.5 },
  remarkContentText: { fontSize: 12, color: '#92400e', fontWeight: '600', lineHeight: 16 },
  assignedBadgeBox: {
    marginTop: 12, padding: 10, backgroundColor: '#f0fdf4',
    borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0',
  },
  assignedBadgeLabel: { fontSize: 10, fontWeight: '700', color: '#16a34a', marginBottom: 2, letterSpacing: 0.5 },
  assignedBadgeName:  { fontSize: 13, fontWeight: '700', color: '#14532d' },

  expandSectionRight: {
    flex: 1, backgroundColor: 'white', borderRadius: 6,
    borderWidth: 1, borderColor: '#e2e8f0', padding: 12,
  },
  financeRow:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  financeLabel:   { fontSize: 12, color: '#334155', fontWeight: '600' },
  financeValue:   { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  financeDivider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 8 },
  amountToCollectBar: {
    backgroundColor: '#0f172a', padding: 10, borderRadius: 6,
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 10,
  },
  atcLabel: { color: '#94a3b8', fontWeight: '700', fontSize: 10, letterSpacing: 0.8 },
  atcValue: { color: 'white', fontWeight: '800', fontSize: 15 },

  dropdownBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
  dropdownContainer: {
    position: 'absolute', backgroundColor: 'white', borderRadius: 8,
    borderWidth: 1, borderColor: '#e2e8f0', width: 210, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 12,
  },
  dropdownTitle: {
    fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: '#f1f5f9',
  },
  execDropdownRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderColor: '#f1f5f9', gap: 10,
  },
  execName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },

  paginationBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'flex-end', gap: 20,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderColor: '#e2e8f0', backgroundColor: 'white',
  },
  paginationBarMobile: {
    flexWrap: 'wrap', justifyContent: 'space-between',
    gap: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  pageSizeWrapper:  { flexDirection: 'row', alignItems: 'center', gap: 8, position: 'relative' },
  pageSizeLabel:    { fontSize: 12, color: '#64748b', fontWeight: '500' },
  pageSizeSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc', minWidth: 60,
  },
  pageSizeSelectorText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  pageSizeDropdown: {
    position: 'absolute', bottom: 36, left: 0,
    width: 80, backgroundColor: 'white', borderRadius: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 10,
    elevation: 6, overflow: 'hidden', zIndex: 999,
  },
  pageSizeOption: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderColor: '#f1f5f9',
  },
  pageSizeOptionActive:     { backgroundColor: '#f8fafc' },
  pageSizeOptionText:       { fontSize: 13, color: '#334155', fontWeight: '500' },
  pageSizeOptionTextActive: { color: '#0f172a', fontWeight: '700' },
  pageRangeText: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  pageNavRow:    { flexDirection: 'row', gap: 4 },
  pageNavBtn: {
    width: 32, height: 32, borderRadius: 6,
    borderWidth: 1, borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center',
  },
  pageNavBtnDisabled: { borderColor: '#f1f5f9', backgroundColor: '#fafafa' },
});
