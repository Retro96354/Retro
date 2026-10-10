import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, Modal, TouchableOpacity, TouchableWithoutFeedback, Animated } from 'react-native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { db } from '../firebaseConfig';

const isWeb = Platform.OS === 'web';

// Helper: format a Date object to YYYY-MM-DD using LOCAL time (fixes UTC timezone bug)
const toDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Helper: format for display (e.g. "Mon, 30 May 2026")
const toDisplayStr = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton Loader
// ─────────────────────────────────────────────────────────────────────────────
const SkeletonStatRow = () => {
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

  return (
    <View style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Animated.View style={{ height: 12, borderRadius: 4, backgroundColor: '#e2e8f0', opacity, width: '55%' }} />
      <Animated.View style={{ height: 12, borderRadius: 4, backgroundColor: '#e2e8f0', opacity, width: '25%' }} />
    </View>
  );
};

const SkeletonLoader = () => (
  <View>
    {Array.from({ length: 4 }).map((_, i) => (
      <SkeletonStatRow key={i} />
    ))}
  </View>
);

export default function DailyBusinessScreen({ visible, onClose, clientId }) {
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [todayStats, setTodayStats] = useState({ revenue: 0, orders: 0, cod: 0, codCount: 0, online: 0, onlineCount: 0 });

  const todayStr = toDateStr(new Date());
  const isToday = selectedDate === todayStr;

  // Navigate prev/next day
  const changeDay = (offset) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + offset);
    // Don't allow future dates
    if (toDateStr(d) > todayStr) return;
    setSelectedDate(toDateStr(d));
  };

  useEffect(() => {
    if (!visible) return;
    setLoading(true);

    // FIX: added where('deliveryDate', '==', selectedDate) to the query
    // so we only fetch orders for the selected date instead of all orders.
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'orders'),
        where('clientId', '==', clientId),
        where('deliveryDate', '==', selectedDate)
      ),
      (snapshot) => {
        let revenue = 0, count = 0, codTotal = 0, codCount = 0, onlineTotal = 0, onlineCount = 0;
        snapshot.docs.forEach((doc) => {
          const data = doc.data();

          // FIX: removed status === 'Delivered' filter — backend saves orders as 'Active'.
          // Exclude only Cancelled orders so all real orders are counted.
          if (data.status !== 'Completed') return;

          // FIX: use data.totalAmount directly (saved by backend, includes delivery charges).
          // Fall back to computing from items if totalAmount is missing.
          const total = data.totalAmount ||
            data.items?.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0) || 0;

          revenue += total;
          count++;
          if (data.paymentType === 'COD') { codTotal += total; codCount++; }
          else { onlineTotal += total; onlineCount++; }
        });
        setTodayStats({ revenue, orders: count, cod: codTotal, codCount, online: onlineTotal, onlineCount });
        setLoading(false);
      },
      (error) => { console.error('DailyBusinessScreen sync error:', error.message); setLoading(false); }
    );
    return () => unsubscribe();
  }, [visible, clientId, selectedDate]);

  const fmt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={styles.card}>

              {/* Header */}
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Daily Business</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <MaterialCommunityIcons name="close" size={16} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              <View style={styles.divider} />

              {/* Date Navigator */}
              <View style={styles.dateNavRow}>
                <TouchableOpacity onPress={() => changeDay(-1)} style={styles.navBtn}>
                  <MaterialCommunityIcons name="chevron-left" size={20} color="#475569" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dateBadge}
                  onPress={() => setShowDatePicker(true)}
                >
                  <MaterialCommunityIcons name="calendar" size={13} color="#64748b" />
                  <Text style={styles.dateText}>{toDisplayStr(selectedDate)}</Text>
                  {isToday && <View style={styles.todayDot} />}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => changeDay(1)}
                  style={[styles.navBtn, isToday && styles.navBtnDisabled]}
                  disabled={isToday}
                >
                  <MaterialCommunityIcons name="chevron-right" size={20} color={isToday ? '#cbd5e1' : '#475569'} />
                </TouchableOpacity>
              </View>

              {/* "Jump to Today" pill — only shown when not on today */}
              {!isToday && (
                <TouchableOpacity style={styles.todayPill} onPress={() => setSelectedDate(todayStr)}>
                  <MaterialCommunityIcons name="calendar-today" size={12} color="#3b82f6" />
                  <Text style={styles.todayPillText}>Back to Today</Text>
                </TouchableOpacity>
              )}

              <View style={styles.divider} />

              {/* Stats */}
              {loading ? (
                <SkeletonLoader />
              ) : (
                <>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Total number of orders</Text>
                    <Text style={styles.statValue}>: {todayStats.orders}</Text>
                  </View>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Total amount from orders</Text>
                    <Text style={styles.statValue}>: ₹ {fmt(todayStats.revenue)}</Text>
                  </View>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Online Orders ({todayStats.onlineCount})</Text>
                    <Text style={styles.statValue}>: ₹ {fmt(todayStats.online)}</Text>
                  </View>
                  <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.statLabel}>COD Orders ({todayStats.codCount})</Text>
                    <Text style={styles.statValue}>: ₹ {fmt(todayStats.cod)}</Text>
                  </View>
                </>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>

      {/* Native date picker modal (web uses <input type="date">, mobile uses @react-native-community/datetimepicker) */}
      {showDatePicker && (
        isWeb ? (
          <Modal transparent animationType="fade" visible={showDatePicker} onRequestClose={() => setShowDatePicker(false)}>
            <TouchableWithoutFeedback onPress={() => setShowDatePicker(false)}>
              <View style={styles.pickerBackdrop}>
                <TouchableWithoutFeedback onPress={() => {}}>
                  <View style={styles.pickerCard}>
                    <Text style={styles.pickerTitle}>Select Date</Text>
                    <input
                      type="date"
                      max={todayStr}
                      value={selectedDate}
                      onChange={(e) => {
                        if (e.target.value) setSelectedDate(e.target.value);
                        setShowDatePicker(false);
                      }}
                      style={{
                        marginTop: 12,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        fontSize: 14,
                        color: '#0f172a',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                    <TouchableOpacity style={styles.pickerClose} onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.pickerCloseText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>
        ) : (
          // For mobile: use @react-native-community/datetimepicker
          // Install: expo install @react-native-community/datetimepicker
          (() => {
            try {
              const DateTimePicker = require('@react-native-community/datetimepicker').default;
              return (
                <DateTimePicker
                  value={new Date(selectedDate + 'T00:00:00')}
                  mode="date"
                  display="default"
                  maximumDate={new Date()}
                  onChange={(event, date) => {
                    setShowDatePicker(false);
                    if (date) setSelectedDate(toDateStr(date));
                  }}
                />
              );
            } catch {
              // Fallback if package not installed
              setShowDatePicker(false);
              return null;
            }
          })()
        )
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 70,
    paddingLeft: isWeb ? 272 : 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    width: isWeb ? 400 : 320,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', letterSpacing: -0.3 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    justifyContent: 'center', alignItems: 'center',
  },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginBottom: 12 },

  // Date Navigator
  dateNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  navBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
    justifyContent: 'center', alignItems: 'center',
  },
  navBtnDisabled: { opacity: 0.4 },
  dateBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f1f5f9', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    gap: 6, borderWidth: 1, borderColor: '#e2e8f0',
  },
  dateText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  todayDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#22c55e', marginLeft: 2,
  },

  // Back to Today pill
  todayPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'center', marginBottom: 10,
    backgroundColor: '#eff6ff', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: '#bfdbfe',
  },
  todayPillText: { fontSize: 11, color: '#3b82f6', fontWeight: '600' },

  // Stats
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  statLabel: { fontSize: 13, color: '#334155', fontWeight: '400' },
  statValue: { fontSize: 13, color: '#0f172a', fontWeight: '600' },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },

  // Date picker modal (web)
  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  pickerCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 20,
    width: 280, borderWidth: 1, borderColor: '#e2e8f0',
  },
  pickerTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  pickerClose: {
    marginTop: 14, alignItems: 'center',
    paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  pickerCloseText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
});
