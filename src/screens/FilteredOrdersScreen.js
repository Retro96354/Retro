import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Platform,
  TouchableOpacity, TextInput, ScrollView, Modal, Dimensions,  Animated 
} from 'react-native';
import {
  collection, getDocs, query, where,
  orderBy, limit, startAfter, getCountFromServer,
  updateDoc, doc
} from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { db } from '../firebaseConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_OPTIONS    = ['Active', 'Confirmed', 'Cancelled'];
const PAGE_SIZE_OPTIONS = [20, 50, 100];

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers (used only for the "All Orders" grouped view)
// ─────────────────────────────────────────────────────────────────────────────
const toMillis = (val) => {
  if (!val) return 0;
  if (val?.toDate) return val.toDate().getTime();
  const d = new Date(val).getTime();
  return isNaN(d) ? 0 : d;
};

const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();

// Used to restrict train-number search results to today's deliveries only —
// see the search effect below for why this is a client-side filter rather
// than a Firestore query constraint.
const isToday = (dateVal) => {
  const ms = toMillis(dateVal);
  if (!ms) return false;
  return startOfDay(new Date(ms)) === startOfDay(new Date());
};

const getDateKey = (dateVal) => {
  const ms = toMillis(dateVal);
  if (!ms) return 'no-date';
  return String(startOfDay(new Date(ms)));
};

const getDateHeaderLabel = (dateVal) => {
  const ms = toMillis(dateVal);
  if (!ms) return 'No Date';
  const d = new Date(ms);
  const today = new Date();
  const diffDays = Math.round((startOfDay(today) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === -1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// trainInfo is stored as "12431 - RAJDHANI EXPRESS", "12995 / BDTS AII SF EXP ...",
// sometimes just "19218", etc. — the train number always leads. For display,
// we only want that leading number (coach/seat are shown separately already),
// so this strips everything after it. Falls back to the raw value if no
// leading number is found, so nothing silently disappears.
const getTrainNumber = (trainInfo) => {
  if (!trainInfo) return 'N/A';
  const match = String(trainInfo).match(/^\s*(\d+)/);
  return match ? match[1] : trainInfo;
};

// ─────────────────────────────────────────────────────────────────────────────
// Expandable Order Row
// ─────────────────────────────────────────────────────────────────────────────
const ExpandableOrderRow = ({ item, onUpdateStatus, onAssign }) => {
  const [expanded, setExpanded]               = useState(false);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownPos, setDropdownPos]         = useState({ x: 0, y: 0 });
  const editBtnRef   = React.useRef(null);
  const assignBtnRef = React.useRef(null);

  const isCancelled = item.status === 'Cancelled';
  const isCompleted = item.status === 'Completed';

  const badgeBg     = isCancelled ? '#fef2f2' : isCompleted ? '#f0fdf4' : '#fffbeb';
  const badgeTxt    = isCancelled ? '#dc2626' : isCompleted ? '#16a34a' : '#b45309';
  const badgeBorder = isCancelled ? '#fecaca' : isCompleted ? '#bbf7d0' : '#fde68a';

  const codTypes     = ['COD', 'CASH', 'CASH_ON_DELIVERY'];
  const isCOD        = codTypes.includes((item.paymentType || '').toUpperCase().replace(/\s+/g, '_'));
  const paymentColor = isCOD ? '#b45309' : '#0f766e';
  const paymentLabel = isCOD ? 'COD' : 'ONLINE';
  const amountToCollect = isCOD ? (item.totalAmount || 0) : 0;

  const isAssigned    = !!item.assignedExecutiveName;
  const hasBillPrinted = !!item.billPrintedAt;

  const handleStatusSelect = (newStatus) => {
    setDropdownVisible(false);
    onUpdateStatus(item, newStatus);
  };

  const openDropdown = (e) => {
    e.stopPropagation();
    editBtnRef.current?.measure((fx, fy, width, height, px, py) => {
      const DROPDOWN_HEIGHT = 160;
      const screenHeight    = Dimensions.get('window').height;
      const fitsBelow       = screenHeight - (py + height) >= DROPDOWN_HEIGHT;
      setDropdownPos({
        x: px - 148 + width,
        y: fitsBelow ? py + height + 4 : py - DROPDOWN_HEIGHT - 4,
      });
      setDropdownVisible(true);
    });
  };

  const handleAssignPress = (e) => {
    e.stopPropagation();
    assignBtnRef.current?.measure((fx, fy, width, height, px, py) => {
      onAssign(item, { x: px, y: py, width, height });
    });
  };

  return (
    <View style={styles.cardContainer}>
      {/* ── Summary row ── */}
      <TouchableOpacity
        style={[styles.tableRow, expanded && styles.tableRowExpanded]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.85}
      >
        {/* Expand chevron */}
        <View style={{
          width: 28, height: 28, borderRadius: 14,
          backgroundColor: '#94a3b8',
          alignItems: 'center', justifyContent: 'center', marginRight: 8,
        }}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#ffffff" />
        </View>

        {/* Status + bill-printed badge */}
        <View style={{ flex: 0.8 }}>
          <View style={[styles.badge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: badgeTxt, letterSpacing: 0.5 }}>
              {item.status || 'ACTIVE'}
            </Text>
          </View>
          {hasBillPrinted && (
            <View style={styles.billPrintedBadge}>
              <Ionicons name="print-outline" size={8} color="#ffffff" />
              <Text style={styles.billPrintedText}>PRINTED</Text>
            </View>
          )}
        </View>

        <Text style={[styles.cell, { flex: 1.1, fontWeight: '700', color: '#0f172a' }]}>{item.orderNo}</Text>
        <Text style={[styles.cell, { flex: 1.0, fontSize: 12 }]}>
          {item.deliveryDate ? new Date(item.deliveryDate).toLocaleDateString('en-GB') : '—'}
        </Text>
        <Text style={[styles.cell, { flex: 0.8, fontSize: 12, fontWeight: '500' }]}>{item.deliveryTime || '—'}</Text>
        <Text style={[styles.cell, { flex: 1.2 }]} numberOfLines={1}>{item.vendorName}</Text>
        <Text style={[styles.cell, { flex: 1.2 }]} numberOfLines={2}>
          {getTrainNumber(item.trainInfo)}{' '}
          <Text style={{ color: '#dc2626', fontWeight: '700' }}>
            ({item.coach || 'No Coach'}{item.seat ? ` / ${item.seat}` : ''})
          </Text>
        </Text>

        <View style={{ flex: 0.9 }}>
          <Text style={[styles.paymentTag, { color: paymentColor, borderColor: paymentColor }]}>
            {paymentLabel}
          </Text>
        </View>

        {/* Delivery exec column */}
        <View style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text
            style={[styles.cell, {
              fontSize: 11, fontWeight: '700', flex: 1,
              color: isAssigned ? '#16a34a' : '#94a3b8',
            }]}
            numberOfLines={1}
          >
            {item.assignedExecutiveName || 'Not Assigned'}
          </Text>

          <View style={{ position: 'relative' }}>
            <TouchableOpacity ref={assignBtnRef} style={styles.assignBtn} onPress={handleAssignPress}>
              <Ionicons name="bicycle-outline" size={15} color="#ffffff" />
            </TouchableOpacity>
            {isAssigned && (
              <View style={styles.tickBadge}>
                <Ionicons name="checkmark" size={8} color="#fff" />
              </View>
            )}
          </View>

          <TouchableOpacity ref={editBtnRef} style={styles.editBtn} onPress={openDropdown}>
            <Ionicons name="create-outline" size={15} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* ── Status dropdown modal ── */}
      <Modal
        visible={dropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownVisible(false)}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setDropdownVisible(false)}>
          <View
            style={[styles.dropdownMenu, { position: 'absolute', top: dropdownPos.y, left: dropdownPos.x }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={styles.dropdownTitle}>Change Status</Text>
            {STATUS_OPTIONS.map((status) => (
              <TouchableOpacity
                key={status}
                style={[styles.dropdownItem, item.status === status && styles.dropdownItemActive]}
                onPress={() => handleStatusSelect(status)}
              >
                <View style={[styles.dropdownDot, {
                  backgroundColor:
                    status === 'Active'    ? '#f59e0b' :
                    status === 'Confirmed' ? '#3b82f6' : '#dc2626',
                }]} />
                <Text style={[styles.dropdownItemText, item.status === status && styles.dropdownItemTextActive]}>
                  {status}
                </Text>
                {item.status === status && (
                  <Ionicons name="checkmark" size={14} color="#0f172a" style={{ marginLeft: 'auto' }} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.expandedLayout}>

            {/* LEFT — Items */}
            <View style={styles.expandSectionLeft}>
              <View style={styles.miniTableHeader}>
                <Text style={[styles.miniHeadText, { flex: 1 }]}>ITEM NAME</Text>
                <Text style={[styles.miniHeadText, { width: 56, textAlign: 'center' }]}>QTY</Text>
              </View>
              {item.items?.map((prod, idx) => (
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
              <Text style={[styles.remarkText, { color: '#64748b' }]}>Mo: {item.contactNo}</Text>

              {hasBillPrinted && (
                <View style={styles.billPrintInfoBox}>
                  <Ionicons name="print-outline" size={13} color="#3b82f6" />
                  <View>
                    <Text style={styles.billPrintInfoLabel}>BILL PRINTED</Text>
                    <Text style={styles.billPrintInfoTime}>
                      {new Date(
                        item.billPrintedAt?.toDate
                          ? item.billPrintedAt.toDate()
                          : item.billPrintedAt
                      ).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </Text>
                  </View>
                </View>
              )}

              {item.remark && item.remark.trim() !== '' && (
                <View style={styles.remarkBox}>
                  <Text style={styles.remarkAlertText}>⚠ SPECIAL INSTRUCTIONS</Text>
                  <Text style={styles.remarkContentText}>{item.remark}</Text>
                </View>
              )}

              {item.assignedExecutiveName && (
                <View style={styles.assignedBadgeBox}>
                  <Text style={styles.assignedBadgeLabel}>Delivered By:</Text>
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
        </View>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Date section header (used only in the "All Orders" grouped view)
// ─────────────────────────────────────────────────────────────────────────────
const DateSectionHeader = ({ label }) => (
  <View style={styles.dateHeaderRow}>
    <View style={styles.dateHeaderLine} />
    <Text style={styles.dateHeaderText}>{label}</Text>
    <View style={styles.dateHeaderLine} />
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Pagination Bar
// NOTE: True server-side cursor pagination only supports First page (cursor=null)
// + Previous (cached cursor) + Next (startAfter). "Jump to last page" is removed
// on purpose — it would require reading the whole collection, defeating the
// point of this change.
// ─────────────────────────────────────────────────────────────────────────────
const PaginationBar = ({ currentPage, totalItems, itemsPerPage, onPageChange, onItemsPerPageChange }) => {
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
    <View style={styles.paginationBar}>
      <View style={styles.pageSizeWrapper}>
        <Text style={styles.pageSizeLabel}>Items per page:</Text>
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

      <Text style={styles.pageRangeText}>{startItem}–{endItem} of {totalItems}</Text>

      <View style={styles.pageNavRow}>
        <NavBtn iconName="play-skip-back"  onPress={() => onPageChange(1)}               disabled={currentPage === 1} />
        <NavBtn iconName="chevron-back"    onPress={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} />
        <NavBtn iconName="chevron-forward" onPress={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} />
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton Loader
// ─────────────────────────────────────────────────────────────────────────────
const SkeletonRow = () => {
  const shimmer = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmer]); // shimmer is a stable useRef value; included only to satisfy exhaustive-deps

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const Box = ({ w, flex }) => (
    <Animated.View style={{
      height: 12, borderRadius: 4, backgroundColor: '#e2e8f0',
      opacity, ...(flex ? { flex } : { width: w }),
    }} />
  );

  return (
    <View style={[styles.tableRow, { gap: 12 }]}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#e2e8f0', opacity: 0.5 }} />
      <Box flex={0.8} />
      <Box flex={1.1} />
      <Box flex={1.0} />
      <Box flex={0.8} />
      <Box flex={1.2} />
      <Box flex={1.2} />
      <Box flex={0.9} />
      <Box flex={1.2} />
    </View>
  );
};

const SkeletonLoader = () => (
  <View style={{ flex: 1 }}>
    {Array.from({ length: 10 }).map((_, i) => (
      <View key={i} style={{ borderBottomWidth: 1, borderColor: '#f1f5f9' }}>
        <SkeletonRow />
      </View>
    ))}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────
// `statusFilter` can be:
//   - a single string, e.g. "Completed"  → behaves exactly as before
//   - an array of strings, e.g. ["Completed", "Cancelled"] → "All Orders" mode:
//     fetches every status in the array and groups rows by delivery date,
//     with the current date at the top and older dates continuing below.
//
// PAGINATION MODEL (changed):
//   Instead of loading ALL matching orders and slicing them client-side,
//   we now use Firestore cursor pagination (orderBy + limit + startAfter).
//   Only `itemsPerPage` documents are read per page view. A single
//   `getCountFromServer` aggregation read gives the total count for the
//   "X–Y of Z" label and page-count math, without reading every document.
//
//   This uses your existing composite index:
//     orders → clientId (Asc), status (Asc), createdAt (Desc)
//   (covers both `status ==` for single-status tabs and `status in [...]`
//   for the "All" tab, since Firestore serves `in` queries off the same
//   index as equality on that field.)
export default function FilteredOrdersScreen({ statusFilter, title, clientId }) {
  const [orders, setOrders]                 = useState([]); // holds ONLY the current page's docs
  const [executives, setExecutives]         = useState([]);
  const [loading, setLoading]               = useState(true);

  // ── Search state ──
  // searchInput: raw text as the user types (updates every keystroke)
  // debouncedSearch: same value, but only updates 400ms after typing stops —
  //   prevents firing a Firestore query on every keystroke
  // searchResults: null = not searching (show normal paginated `orders`);
  //   [] or [...] = search is active, these are the server-matched results
  const [searchInput, setSearchInput]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchResults, setSearchResults]   = useState(null);
  const [searchLoading, setSearchLoading]   = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage]   = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [totalCount, setTotalCount]     = useState(0);
  const [refreshToken, setRefreshToken] = useState(0); // bump to force a full pagination reset + refetch (e.g. after a status change)

  // cursorsRef.current[i] = the last doc snapshot of page (i+1), used as `startAfter`
  // to fetch page (i+2). cursorsRef.current[0] is always null (page 1 has no cursor).
  // Kept in a ref (not state) on purpose: navigation is strictly sequential
  // (First / Previous / Next only), so every cursor we'll ever need was already
  // written by the time the user can click to it — no stale-closure risk, and
  // no extra re-renders just to store a cache.
  const cursorsRef = useRef([null]);

  // Assign modal
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder]           = useState(null);
  const [assignDropdownPos, setAssignDropdownPos]   = useState({ x: 0, y: 0, width: 0, height: 0 });

  const isAllOrders = Array.isArray(statusFilter);
  const filterKey = isAllOrders ? JSON.stringify(statusFilter) : statusFilter;
  const isSearchActive = debouncedSearch.trim().length > 0;

  // Identifies "this exact query" — tab, page size, client, and any forced refresh.
  // When this changes, pagination must reset to page 1 with a clean cursor cache.
  const queryVersion = `${filterKey}::${itemsPerPage}::${clientId}::${refreshToken}`;
  const prevQueryVersionRef = useRef(queryVersion);

  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));

  // While searching, show server-matched results (global, across all matching
  // orders — not just the loaded page). Otherwise show the normal paginated list.
  const activeList = isSearchActive ? (searchResults || []) : orders;

  // When in "All Orders" mode, attach date-section-header info to each row
  // so the list reads: Today's orders → Yesterday's → the day before, etc.
  // NOTE: ordering is by createdAt desc (paginated) or orderNo asc
  // (search results) — not deliveryDate — so date grouping happens purely
  // within whatever set is currently displayed.
  const displayData = isAllOrders
    ? activeList.map((ord, idx) => {
        const currKey = getDateKey(ord.deliveryDate);
        const prevKey = idx === 0 ? null : getDateKey(activeList[idx - 1].deliveryDate);
        return {
          ...ord,
          _showDateHeader: currKey !== prevKey,
          _dateHeaderLabel: getDateHeaderLabel(ord.deliveryDate),
        };
      })
    : activeList;

  // ── Fetch executives ──
  // Changed from a real-time onSnapshot listener to a one-time getDocs fetch.
  // Executives don't change often enough to need a live connection, and the
  // onSnapshot channel was the source of the "Listen/channel 400" errors you
  // saw in DevTools (unrelated to the orders pagination work — this was a
  // separate long-lived connection). Removing it also means one less open
  // connection per screen, which is one less thing that can flake on a bad
  // network/proxy/ad-blocker.
  //
  // To keep the list reasonably fresh without a live listener, this refetches
  // whenever the client changes AND whenever the assign modal is opened
  // (see openAssignModal below) — exactly when a stale list would matter most.
  const fetchExecutives = React.useCallback(async () => {
    try {
      const snapshot = await getDocs(
        query(collection(db, 'executives'), where('clientId', '==', clientId))
      );
      setExecutives(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error('Execs fetch error:', error.message);
    }
  }, [clientId]);

  useEffect(() => {
    fetchExecutives();
  }, [fetchExecutives]);

  // ── Fetch total count once per filter change (1 aggregation read, NOT N reads) ──
  useEffect(() => {
    let mounted = true;

    const fetchCount = async () => {
      try {
        const statusArray = isAllOrders ? statusFilter : [statusFilter];
        const countSnap = await getCountFromServer(
          query(
            collection(db, 'orders'),
            where('clientId', '==', clientId),
            where('status', 'in', statusArray)
          )
        );
        if (!mounted) return;
        const count = countSnap.data().count;
        setTotalCount(count);
        console.log(`[Orders] Total matching orders (count query, not full read): ${count}`);
      } catch (error) {
        console.error('Orders count fetch error:', error.message);
      }
    };

    fetchCount();
    return () => { mounted = false; };
    // isAllOrders/statusFilter are included for lint correctness — in practice
    // they can't change without filterKey also changing (it's derived from
    // statusFilter), so this doesn't introduce extra reruns beyond what
    // filterKey already causes.
  }, [filterKey, clientId, refreshToken, isAllOrders, statusFilter]);

  // ── Fetch ONLY the current page's orders ──
  // This single effect owns both "did the query change under us?" (tab, page
  // size, client, or a forced refresh) and "which page are we fetching?".
  // Handling both in one effect — instead of a separate reset effect — avoids
  // a race where a reset effect and a fetch effect fire in the same commit
  // using each other's stale, not-yet-applied state (which previously could
  // cause a wasted fetch of the wrong page right before the correct one).
  useEffect(() => {
    let cancelled = false;

    const isNewQuery = prevQueryVersionRef.current !== queryVersion;
    prevQueryVersionRef.current = queryVersion;

    if (isNewQuery) {
      console.log(`[Orders] Query changed → resetting to page 1 (filter=${filterKey}, pageSize=${itemsPerPage})`);
      cursorsRef.current = [null];
      if (currentPage !== 1) {
        // Bail out now; setting currentPage triggers this same effect again,
        // and by then prevQueryVersionRef already matches so it fetches page 1
        // directly below — exactly one real fetch happens, not two.
        setCurrentPage(1);
        return () => { cancelled = true; };
      }
    }

    const pageToFetch = currentPage;

    const loadPage = async () => {
      setLoading(true);
      try {
        const statusArray = isAllOrders ? statusFilter : [statusFilter];
        const cursor = cursorsRef.current[pageToFetch - 1] ?? null;

        const constraints = [
          collection(db, 'orders'),
          where('clientId', '==', clientId),
          where('status', 'in', statusArray),
          orderBy('createdAt', 'desc'),
        ];
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(limit(itemsPerPage));

        const snapshot = await getDocs(query(...constraints));
        if (cancelled) return;

        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // ── Console logs so you can verify read volume in DevTools ──
        console.log(`[Orders] Page ${pageToFetch} loaded → ${list.length} docs read (requested limit=${itemsPerPage})`);
        const statusCounts = {};
        list.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
        console.log('[Orders] Status breakdown on this page:', statusCounts);

        setOrders(list);

        // Cache the cursor needed to fetch the NEXT page (only if not already cached)
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (lastDoc && cursorsRef.current[pageToFetch] === undefined) {
          const next = [...cursorsRef.current];
          next[pageToFetch] = lastDoc;
          cursorsRef.current = next;
        }
      } catch (error) {
        console.error('Orders fetch error:', error.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPage();
    return () => { cancelled = true; };
    // clientId/filterKey/itemsPerPage/isAllOrders/statusFilter are included
    // for lint correctness — they're all already baked into queryVersion, so
    // none of them can change without queryVersion also changing. Listing
    // them here doesn't add extra reruns; it just makes that explicit.
  }, [currentPage, queryVersion, clientId, filterKey, itemsPerPage, isAllOrders, statusFilter]);

  // ── Debounce the search input (waits 400ms after typing stops) ──
  // Prevents firing a Firestore query on every single keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // ── Global search across ALL matching orders (not just the loaded page) ──
  // No extra field, no backfill. Searches the EXISTING `orderNo` AND
  // `trainInfo` fields as-is, and merges results from both.
  //
  // orderNo matching (two queries, same as before):
  //   Your orderNo values are mixed-type in Firestore — plain numbers for
  //   email-parsed orders, and strings like "HOM1024" / "PS2048" for the
  //   other two sources. Firestore can't range-match across two different
  //   field types in one query, so:
  //     1) If the typed term is all digits, run an EXACT match against the
  //        numeric-typed orderNo docs (where orderNo == Number(term)).
  //     2) Always also run a PREFIX match against the string-typed orderNo
  //        docs (where orderNo >= term && orderNo <= term + '\uf8ff').
  //        This only matches string order numbers that literally start with
  //        the typed digits — so "1024" won't currently match "HOM1024" or
  //        "PS2048" (Firestore can't search inside a string). Once the HOM/PS
  //        prefixes are removed from those orders, their orderNo becomes a
  //        plain digit string and this same prefix query starts matching
  //        them automatically — no code change needed at that point.
  //
  // trainInfo matching (one query, then a client-side date filter):
  //   trainInfo is always stored as a string starting with the train number
  //   (e.g. "12431 - RAJDHANI...", "12995 / BDTS..."), so a PREFIX match
  //   works directly — no type-mismatch issue like orderNo has. This matches
  //   any order whose train number starts with the typed digits.
  //   Train numbers repeat daily, so results are further restricted to only
  //   TODAY's deliveryDate (client-side, after fetch — see the query below
  //   for why this can't be a Firestore constraint in the same query).
  //   orderNo matches are NOT date-restricted — an order number search should
  //   still find that order regardless of when it was placed.
  //   CAVEAT: since the date filter happens after fetching, if a very common
  //   train-number prefix has 50+ matches from OTHER dates, today's match
  //   could theoretically get pushed out of the capped 50 before the date
  //   filter runs. In practice this only matters for very short/generic
  //   search terms — typing more digits narrows it down.
  //
  // Results from all queries are merged and de-duplicated by doc id, then
  // capped at 50 combined.
  //
  // Requires TWO composite indexes:
  //   orders → clientId (Asc), status (Asc), orderNo (Asc)
  //   orders → clientId (Asc), status (Asc), trainInfo (Asc)
  useEffect(() => {
    let cancelled = false;
    const term = debouncedSearch.trim();

    if (!term) {
      setSearchResults(null);
      return;
    }

    const runSearch = async () => {
      setSearchLoading(true);
      try {
        const statusArray = isAllOrders ? statusFilter : [statusFilter];
        const isNumeric = /^\d+$/.test(term);

        const [orderNoExactSnap, orderNoPrefixSnap, trainInfoSnap] = await Promise.all([
          // Exact match — catches plain-number orderNo docs (email-parsed orders)
          isNumeric
            ? getDocs(query(
                collection(db, 'orders'),
                where('clientId', '==', clientId),
                where('status', 'in', statusArray),
                where('orderNo', '==', Number(term))
              ))
            : Promise.resolve(null),

          // Prefix match on orderNo — catches string orderNo docs that literally start with these digits
          getDocs(query(
            collection(db, 'orders'),
            where('clientId', '==', clientId),
            where('status', 'in', statusArray),
            where('orderNo', '>=', term),
            where('orderNo', '<=', term + '\uf8ff'),
            orderBy('orderNo'),
            limit(50)
          )),

          // Prefix match on trainInfo — catches orders whose train number starts with these digits.
          // FIX: earlier this only had orderBy('trainInfo'), so among same-trainInfo docs
          // Firestore tie-broke by document ID (random w.r.t. date) — old orders could
         // fill up the limit(50) before today's orders even got fetched. Adding a
         // secondary orderBy('deliveryDate','desc') makes today's orders surface first
        // within each trainInfo group, so the isToday() filter below actually finds them
       // instead of them being cut off by the cap.
      // Requires composite index: orders → clientId (Asc), status (Asc), trainInfo (Asc), deliveryDate (Desc)
         getDocs(query(
           collection(db, 'orders'),
           where('clientId', '==', clientId),
           where('status', 'in', statusArray),
           where('trainInfo', '>=', term),
           where('trainInfo', '<=', term + '\uf8ff'),
           orderBy('trainInfo'),
           orderBy('deliveryDate', 'desc'),
           limit(50)
         )),
        ]);
        if (cancelled) return;

        const merged = new Map();

        // orderNo matches are NOT date-restricted — searching by order number
        // should still find that exact order regardless of which day it was placed.
        if (orderNoExactSnap) {
          orderNoExactSnap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
        }
        orderNoPrefixSnap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));

        // trainInfo matches ARE date-restricted to today — a train number search
        // should only surface today's delivery running that train, not every past
        // day this train number was ever used.
        let trainMatchesTotal = 0;
        let trainMatchesToday = 0;
        trainInfoSnap.docs.forEach(d => {
          trainMatchesTotal++;
          const data = d.data();
          if (isToday(data.deliveryDate)) {
            trainMatchesToday++;
            merged.set(d.id, { id: d.id, ...data });
          }
        });

        const list = Array.from(merged.values());

        console.log(`[Orders] Global search "${term}" → ${list.length} match(es). orderNo: ${(orderNoExactSnap?.docs.length || 0) + orderNoPrefixSnap.docs.length} (not date-restricted). trainInfo: ${trainMatchesToday}/${trainMatchesTotal} matched today's date (capped at 50 fetched per query).`);
        setSearchResults(list);
      } catch (error) {
        console.error('Global search error:', error.message);
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    };

    runSearch();
    return () => { cancelled = true; };
  }, [debouncedSearch, filterKey, clientId, isAllOrders, statusFilter, refreshToken]);

  const handleUpdateStatus = async (order, newStatus) => {
    try {
      await updateDoc(doc(db, 'orders', order.id), { status: newStatus });
      console.log(`[Orders] Status updated for ${order.orderNo} → ${newStatus}. Forcing a clean pagination refresh.`);
      // The order may no longer belong in this filtered set (e.g. Active -> Confirmed
      // while viewing the Active tab), so cached cursors are no longer trustworthy.
      // Bumping refreshToken changes queryVersion, which the fetch effect detects
      // as "new query" and resets to page 1 with a fresh cursor cache — this works
      // correctly even if we were already sitting on page 1 (setCurrentPage(1)
      // alone wouldn't re-trigger a fetch in that case since the value wouldn't change).
      setRefreshToken(t => t + 1);
    } catch (err) {
      console.error('Status update failed', err);
    }
  };

  const openAssignModal = (order, pos) => {
    setSelectedOrder(order);
    setAssignDropdownPos(pos);
    setAssignModalVisible(true);
    fetchExecutives(); // refresh right when it matters, since we no longer hold a live listener
  };

  const handleAssignExec = async (exec) => {
    if (!selectedOrder) return;
    try {
      await updateDoc(doc(db, 'orders', selectedOrder.id), {
        assignedExecutiveId: exec.id,
        assignedExecutiveName: exec.name,
      });
      // Assignment doesn't change status, so it's safe to just patch local state
      // instead of refetching. Patch whichever list is currently on screen —
      // `orders` (normal browsing) or `searchResults` (search is active) —
      // since displayData reads from `activeList`, not always `orders`.
      const patch = o => o.id === selectedOrder.id
        ? { ...o, assignedExecutiveId: exec.id, assignedExecutiveName: exec.name }
        : o;
      setOrders(prev => prev.map(patch));
      setSearchResults(prev => prev ? prev.map(patch) : prev);
    } catch (err) {
      console.error('Assign executive failed', err);
    }
    setAssignModalVisible(false);
  };

  const handleRemoveExec = async () => {
    if (!selectedOrder) return;
    try {
      await updateDoc(doc(db, 'orders', selectedOrder.id), {
        assignedExecutiveId: null,
        assignedExecutiveName: null,
      });
      const patch = o => o.id === selectedOrder.id
        ? { ...o, assignedExecutiveId: null, assignedExecutiveName: null }
        : o;
      setOrders(prev => prev.map(patch));
      setSearchResults(prev => prev ? prev.map(patch) : prev);
    } catch (err) {
      console.error('Remove executive failed', err);
    }
    setAssignModalVisible(false);
  };

  const handleItemsPerPageChange = (size) => {
    console.log(`[Orders] Page size changed → ${size}`);
    setItemsPerPage(size);
  };

  const handlePageChange = (page) => {
    const target = Math.min(Math.max(1, page), totalPages);
    // Safe without extra reachability checks: the UI only exposes First (1),
    // Previous (currentPage - 1), and Next (currentPage + 1). Since navigation
    // is always sequential, cursorsRef.current already holds every cursor
    // needed for any of these three targets by the time they're clickable.
    console.log(`[Orders] Navigating to page ${target}`);
    setCurrentPage(target);
  };

  const statusLabelLower = isAllOrders ? '' : String(statusFilter).toLowerCase();

  return (
    <View style={styles.container}>

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>{title}</Text>
          <View style={styles.countRow}>
            <View style={[styles.countDot, {
              backgroundColor: isAllOrders
                ? '#6366f1'
                : statusFilter === 'Completed' ? '#16a34a' :
                  statusFilter === 'Cancelled' ? '#dc2626' : '#f59e0b',
            }]} />
            <Text style={styles.subHeading}>
              {loading && !isSearchActive
                ? '…'
                : isSearchActive
                  ? (searchLoading ? 'Searching…' : `${(searchResults || []).length} match(es) for "${debouncedSearch}"`)
                  : `${totalCount} ${totalCount === 1 ? 'order' : 'orders'} found`}
            </Text>
          </View>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by order no. or train no. (e.g. 10234)"
            placeholderTextColor="#94a3b8"
            value={searchInput}
            onChangeText={setSearchInput}
          />
          {searchInput ? (
            <TouchableOpacity onPress={() => { setSearchInput(''); setDebouncedSearch(''); }}>
              <Ionicons name="close-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ── Table container ── */}
      <View style={styles.tableContainer}>
        {/* Header */}
        <View style={styles.tableHeader}>
          <View style={{ width: 36 }} />
          <Text style={[styles.col, { flex: 0.8 }]}>STATUS</Text>
          <Text style={[styles.col, { flex: 1.1 }]}>ORDER NO.</Text>
          <Text style={[styles.col, { flex: 1.0 }]}>DATE</Text>
          <Text style={[styles.col, { flex: 0.8 }]}>TIME</Text>
          <Text style={[styles.col, { flex: 1.2 }]}>VENDOR</Text>
          <Text style={[styles.col, { flex: 1.2 }]}>TRAIN</Text>
          <Text style={[styles.col, { flex: 0.9 }]}>PAYMENT</Text>
          <Text style={[styles.col, { flex: 1.2 }]}>DELIVERY EXEC</Text>
        </View>

         {(isSearchActive ? searchLoading : loading) ? (
           <SkeletonLoader />
          ) : displayData.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={36} color="#cbd5e1" />
            <Text style={styles.emptyStateText}>
              {isSearchActive ? `No orders match "${debouncedSearch}"` : `No ${statusLabelLower} orders`}
            </Text>
          </View>
        ) : (
          <>
            {/* ── Rows ── */}
            <FlatList
              data={displayData}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <>
                  {isAllOrders && item._showDateHeader && (
                    <DateSectionHeader label={item._dateHeaderLabel} />
                  )}
                  <ExpandableOrderRow
                    item={item}
                    onUpdateStatus={handleUpdateStatus}
                    onAssign={openAssignModal}
                  />
                </>
              )}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 0, flexGrow: 1 }}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            />

            {/* ── Pagination bar (hidden during search — results are a capped
                 top-50 match list across ALL matching orders, not a cursor-paginated page) ── */}
            {isSearchActive ? (
              (searchResults || []).length === 50 && (
                <View style={styles.searchCapNotice}>
                  <Text style={styles.searchCapNoticeText}>
                    Showing top 50 matches — type more of the order number to narrow it down.
                  </Text>
                </View>
              )
            ) : (
              <PaginationBar
                currentPage={currentPage}
                totalItems={totalCount}
                itemsPerPage={itemsPerPage}
                onPageChange={handlePageChange}
                onItemsPerPageChange={handleItemsPerPageChange}
              />
            )}
          </>
        )}
      </View>

      {/* ── Assign Executive Modal ── */}
      <Modal
        visible={assignModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAssignModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.dropdownBackdrop}
          activeOpacity={1}
          onPress={() => setAssignModalVisible(false)}
        >
          <View
            style={[
              styles.assignDropdownContainer,
              (() => {
                const DROPDOWN_HEIGHT = 320;
                const screenHeight    = Dimensions.get('window').height;
                const fitsBelow       = screenHeight - (assignDropdownPos.y + assignDropdownPos.height) >= DROPDOWN_HEIGHT;
                return {
                  top:  fitsBelow ? assignDropdownPos.y + assignDropdownPos.height + 6 : assignDropdownPos.y - DROPDOWN_HEIGHT - 6,
                  left: assignDropdownPos.x - 170,
                };
              })(),
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.assignDropdownHeader}>
              <Ionicons name="bicycle-outline" size={14} color="#3b82f6" />
              <Text style={styles.assignDropdownTitle}>
                {selectedOrder?.assignedExecutiveName ? 'REASSIGN EXECUTIVE' : 'ASSIGN EXECUTIVE'}
              </Text>
            </View>

            {selectedOrder?.assignedExecutiveName && (
              <View style={styles.currentlyAssignedRow}>
                <View style={styles.currentlyAssignedDot} />
                <Text style={styles.currentlyAssignedText}>
                  Currently: {selectedOrder.assignedExecutiveName}
                </Text>
              </View>
            )}

            <ScrollView
              style={{ maxHeight: 240 }}
              showsVerticalScrollIndicator={false}
            >
              {executives.map(exec => (
                <TouchableOpacity
                  key={exec.id}
                  style={[
                    styles.execDropdownRow,
                    selectedOrder?.assignedExecutiveId === exec.id && styles.execDropdownRowActive,
                  ]}
                  onPress={() => handleAssignExec(exec)}
                >
                  <Ionicons name="person-circle-outline" size={20} color="#475569" />
                  <Text style={[
                    styles.execName,
                    selectedOrder?.assignedExecutiveId === exec.id && styles.execNameActive,
                  ]}>
                    {exec.name}
                  </Text>
                  {selectedOrder?.assignedExecutiveId === exec.id && (
                    <Ionicons name="checkmark-circle" size={16} color="#16a34a" style={{ marginLeft: 'auto' }} />
                  )}
                </TouchableOpacity>
              ))}
              {executives.length === 0 && (
                <Text style={styles.noExecsText}>No executives found.</Text>
              )}
            </ScrollView>

            {selectedOrder?.assignedExecutiveName && (
              <TouchableOpacity style={styles.removeExecRow} onPress={handleRemoveExec}>
                <Ionicons name="close-circle-outline" size={16} color="#dc2626" />
                <Text style={styles.removeExecText}>Remove Assignment</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 24,
    height: Platform.OS === 'web' ? '100vh' : '100%',
  },

  topBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
    flexWrap: 'wrap', gap: 12,
  },
  heading:    { fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.5 },
  countRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  countDot:   { width: 7, height: 7, borderRadius: 4 },
  subHeading: { fontSize: 13, color: '#64748b', fontWeight: '500' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white', paddingHorizontal: 14,
    paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
    minWidth: 280, gap: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', outlineStyle: 'none' },

  tableContainer: {
    flex: 1, backgroundColor: 'white',
    borderRadius: 8, borderWidth: 1,
    borderColor: '#e2e8f0', overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row', backgroundColor: '#0f172a',
    paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center',
  },
  col: { fontSize: 10, fontWeight: '700', color: '#ffffff', letterSpacing: 0.8 },

  // ── Date section header (All Orders view) ──
  dateHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
    backgroundColor: '#f8fafc',
  },
  dateHeaderLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dateHeaderText: {
    fontSize: 11, fontWeight: '800', color: '#475569',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },

  cardContainer: { borderBottomWidth: 1, borderColor: '#f1f5f9' },
  tableRow: {
    flexDirection: 'row', paddingVertical: 12,
    paddingHorizontal: 12, alignItems: 'center', backgroundColor: 'white',
  },
  tableRowExpanded: { backgroundColor: '#f8fafc' },
  cell: { fontSize: 13, color: '#334155', fontWeight: '700' },

  badge: {
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 4, borderWidth: 1, alignSelf: 'flex-start',
  },

  billPrintedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    marginTop: 3, backgroundColor: '#3b82f6',
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 3, alignSelf: 'flex-start',
  },
  billPrintedText: { fontSize: 8, fontWeight: '700', color: '#ffffff', letterSpacing: 0.4 },

  billPrintInfoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8, marginBottom: 4, padding: 8,
    backgroundColor: '#eff6ff', borderRadius: 6,
    borderWidth: 1, borderColor: '#bfdbfe',
  },
  billPrintInfoLabel: { fontSize: 9, fontWeight: '700', color: '#3b82f6', letterSpacing: 0.5 },
  billPrintInfoTime:  { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },

  paymentTag: {
    fontSize: 10, fontWeight: '700', borderWidth: 1,
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    alignSelf: 'flex-start', letterSpacing: 0.5,
  },

  assignBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: '#16a34a', justifyContent: 'center', alignItems: 'center',
  },
  tickBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#0f172a', justifyContent: 'center',
    alignItems: 'center', borderWidth: 1.5, borderColor: '#fff',
  },
  editBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: '#3b82f6', justifyContent: 'center', alignItems: 'center',
  },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyStateText: { fontSize: 14, color: '#94a3b8' },

  dropdownMenu: {
    width: 180, backgroundColor: 'white',
    borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0',
    zIndex: 999, shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12,
    shadowRadius: 12, elevation: 8, overflow: 'hidden',
  },
  dropdownTitle: {
    fontSize: 10, fontWeight: '700', color: '#94a3b8',
    letterSpacing: 0.8, paddingHorizontal: 14,
    paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderColor: '#f1f5f9',
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11,
    gap: 10, borderBottomWidth: 1, borderColor: '#f8fafc',
  },
  dropdownItemActive:     { backgroundColor: '#f8fafc' },
  dropdownDot:            { width: 8, height: 8, borderRadius: 4 },
  dropdownItemText:       { fontSize: 13, color: '#334155', fontWeight: '500' },
  dropdownItemTextActive: { color: '#0f172a', fontWeight: '700' },

  dropdownBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
  assignDropdownContainer: {
    position: 'absolute', backgroundColor: 'white',
    borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0',
    width: 220, shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12,
    shadowRadius: 16, elevation: 12, overflow: 'hidden',
  },
  assignDropdownHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderColor: '#f1f5f9', backgroundColor: '#f8fafc',
  },
  assignDropdownTitle: { fontSize: 10, fontWeight: '700', color: '#3b82f6', letterSpacing: 0.8 },
  currentlyAssignedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#f0fdf4', borderBottomWidth: 1, borderColor: '#bbf7d0',
  },
  currentlyAssignedDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16a34a' },
  currentlyAssignedText: { fontSize: 11, fontWeight: '600', color: '#16a34a' },
  execDropdownRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderColor: '#f1f5f9', gap: 10,
  },
  execDropdownRowActive: { backgroundColor: '#f0fdf4' },
  execName:              { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  execNameActive:        { color: '#16a34a', fontWeight: '700' },
  noExecsText:           { textAlign: 'center', color: '#94a3b8', padding: 16, fontSize: 13 },
  removeExecRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 11,
    borderTopWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2',
  },
  removeExecText: { fontSize: 12, fontWeight: '700', color: '#dc2626' },

  expandedContent: {
    backgroundColor: '#f8fafc', padding: 16,
    borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  expandedLayout: { flexDirection: 'row', gap: 16 },

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
  miniCellText: { fontSize: 13, color: '#334155' },

  expandSectionMid: {
    flex: 1, padding: 12, backgroundColor: 'white',
    borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0',
  },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8, marginBottom: 8 },
  remarkText:   { fontSize: 13, color: '#0f172a', fontWeight: '500', marginBottom: 3 },
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
  financeRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  financeLabel:  { fontSize: 12, color: '#64748b' },
  financeValue:  { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  financeDivider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 8 },
  amountToCollectBar: {
    backgroundColor: '#0f172a', padding: 10, borderRadius: 6,
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 10,
  },
  atcLabel: { color: '#94a3b8', fontWeight: '700', fontSize: 10, letterSpacing: 0.8 },
  atcValue: { color: 'white', fontWeight: '800', fontSize: 15 },

  // ── Pagination ──
  paginationBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'flex-end', gap: 20,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderColor: '#e2e8f0', backgroundColor: 'white',
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
  pageSizeOptionActive:    { backgroundColor: '#f8fafc' },
  pageSizeOptionText:      { fontSize: 13, color: '#334155', fontWeight: '500' },
  pageSizeOptionTextActive: { color: '#0f172a', fontWeight: '700' },
  pageRangeText: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  pageNavRow:    { flexDirection: 'row', gap: 4 },
  pageNavBtn: {
    width: 32, height: 32, borderRadius: 6,
    borderWidth: 1, borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center',
  },
  pageNavBtnDisabled: { borderColor: '#f1f5f9', backgroundColor: '#fafafa' },

  // ── Search cap notice ──
  searchCapNotice: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fffbeb',
  },
  searchCapNoticeText: { fontSize: 12, color: '#b45309', fontWeight: '500', textAlign: 'center' },
});
