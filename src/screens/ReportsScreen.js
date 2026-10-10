import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Dimensions, TextInput, Animated,
} from 'react-native';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Line, Text as SvgText, G, Rect } from 'react-native-svg';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';

const PIE_COLORS = [
  '#2563eb','#22c55e','#f59e0b','#ef4444','#06b6d4',
  '#8b5cf6','#f97316','#64748b','#ec4899','#14b8a6',
  '#eab308','#a855f7','#0ea5e9','#84cc16','#fb923c',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) =>
  `₹ ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const clearTime = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const fmtDate = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

const fmtDateStr = (str) => {
  if (!str) return '';
  const d = parseDate(str);
  if (isNaN(d.getTime())) return str;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const fmtDateFile = (d) => {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
};

const COD_TYPES = ['COD', 'CASH', 'CASH_ON_DELIVERY'];
const normPayment = (p) =>
  COD_TYPES.includes((p || '').toUpperCase().replace(/\s+/g, '_')) ? 'COD' : 'ONLINE';

const parseDate = (str) => {
  if (!str) return new Date(0);
  const p = str.split('-');
  if (p.length === 3 && p[0].length === 4) return new Date(+p[0], +p[1] - 1, +p[2]);
  if (p.length === 3 && p[2].length === 4) return new Date(+p[2], +p[1] - 1, +p[0]);
  return new Date(str);
};

const toISOLocal = (d) => {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ─── Vendor Name Normalizer ───────────────────────────────────────────────────
const VENDOR_ALIASES = {
  'zoop':          'ZOOP',
  'zoop india':    'ZOOP',
  'railyatri':     'RailYatri',
  'rail yatri':    'RailYatri',
  'railrecipe':    'RailRecipe',
  'rail recipe':   'RailRecipe',
  'rajbhog khana': 'RajBhog Khana',
  'rajbhog':       'RajBhog Khana',
  'rel food':      'REL FOOD',
  'rail food':     'REL FOOD',
};

const normalizeVendor = (name) => {
  if (!name) return 'Unknown';
  const key = name.trim().toLowerCase();
  return VENDOR_ALIASES[key] || name.trim();
};

// ─── Extract Order ID ─────────────────────────────────────────────────────────
const extractOrderId = (row) => {
  const knownKeys = [
    'Order ID','ORDER ID','OrderId','order_id',
    'Order No','ORDER NO','OrderNo','order_no',
    'Order Number','ORDER NUMBER','order_number',
    'PNR','pnr','ID','id',
  ];
  for (const key of knownKeys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  const keys = Object.keys(row);
  for (const key of keys) {
    const lk = key.toLowerCase().replace(/[\s_\-\.]/g, '');
    if (
      lk.includes('orderid') || lk.includes('orderno') ||
      lk.includes('ordernumber') || lk === 'id' || lk === 'no'
    ) {
      const val = String(row[key]).trim();
      if (val && val !== 'undefined') return val;
    }
  }
  for (const key of keys) {
    const val = String(row[key]).trim();
    if (val && val !== 'undefined' && val !== '') return val;
  }
  return '';
};

// ─── Skeleton Loader ──────────────────────────────────────────────────────────
const SkeletonRow = ({ alt }) => {
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
  const Box = ({ flex }) => (
    <Animated.View style={{ height: 12, borderRadius: 4, backgroundColor: '#e2e8f0', opacity, flex }} />
  );
  return (
    <View style={[{ flexDirection: 'row', paddingVertical: 16, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: '#f1f5f9', alignItems: 'center', gap: 10 }, alt && { backgroundColor: '#f8fafc' }]}>
      <Box flex={0.4} /><Box flex={1.8} /><Box flex={0.8} /><Box flex={0.8} />
      <Box flex={1.4} /><Box flex={1.4} /><Box flex={1.4} /><Box flex={0.9} />
    </View>
  );
};

const SkeletonCard = () => {
  const shimmer = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });
  return <Animated.View style={{ flex: 1, height: 60, borderRadius: 8, backgroundColor: '#cbd5e1', opacity }} />;
};

const SkeletonLoader = () => (
  <>
    <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
      <SkeletonCard /><SkeletonCard /><SkeletonCard />
    </View>
    <View style={[styles.tableCard, { overflow: 'hidden' }]}>
      <View style={{ backgroundColor: '#0f172a', height: 44 }} />
      {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} alt={i % 2 !== 0} />)}
    </View>
  </>
);

// ─── Toast ────────────────────────────────────────────────────────────────────
const Toast = ({ message, type = 'info', onDismiss }) => {
  if (!message) return null;
  const C = {
    success: { bg: '#f0fdf4', border: '#bbf7d0', icon: 'checkmark-circle', iconColor: '#16a34a', textColor: '#14532d' },
    error:   { bg: '#fef2f2', border: '#fecaca', icon: 'close-circle',     iconColor: '#dc2626', textColor: '#7f1d1d' },
    info:    { bg: '#eff6ff', border: '#bfdbfe', icon: 'information-circle',iconColor: '#2563eb', textColor: '#1e3a8a' },
    warning: { bg: '#fffbeb', border: '#fde68a', icon: 'alert-circle',     iconColor: '#d97706', textColor: '#78350f' },
  }[type] || {};
  return (
    <View style={[tStyles.box, { backgroundColor: C.bg, borderColor: C.border }]}>
      <Ionicons name={C.icon} size={18} color={C.iconColor} />
      <Text style={[tStyles.txt, { color: C.textColor }]}>{message}</Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color={C.iconColor} />
      </TouchableOpacity>
    </View>
  );
};
const tStyles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12 },
  txt: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
});

// ─── Compare Result Panel ─────────────────────────────────────────────────────
const ComparePanel = ({ result, onClose }) => {
  if (!result) return null;
  const { missingInVendor, extraInVendor, uploadedCount, systemCount } = result;
  const allMatch = missingInVendor.length === 0 && extraInVendor.length === 0;
  return (
    <View style={cStyles.panel}>
      <View style={cStyles.header}>
        <Ionicons name="git-compare-outline" size={18} color="#0f172a" />
        <Text style={cStyles.title}>Comparison Result</Text>
        {allMatch && (
          <View style={cStyles.matchBadge}>
            <Ionicons name="checkmark-circle" size={13} color="#16a34a" />
            <Text style={cStyles.matchTxt}>All Matched</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <View style={cStyles.statRow}>
          <View style={cStyles.chip}><Text style={cStyles.chipLbl}>Our System</Text><Text style={cStyles.chipVal}>{systemCount} orders</Text></View>
          <Ionicons name="swap-horizontal-outline" size={14} color="#94a3b8" />
          <View style={cStyles.chip}><Text style={cStyles.chipLbl}>Vendor File</Text><Text style={cStyles.chipVal}>{uploadedCount} orders</Text></View>
        </View>
        <TouchableOpacity style={cStyles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={16} color="#64748b" />
        </TouchableOpacity>
      </View>

      <View style={cStyles.cols}>
        {[
          { title: 'Missing in Vendor File', data: missingInVendor, color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', dotColor: '#dc2626', footerTxt: 'Orders in our system but not in vendor file', textColor: '#7f1d1d' },
          { title: 'Extra in Vendor File',   data: extraInVendor,   color: '#2563eb', bg: '#eff6ff', border: '#93c5fd', dotColor: '#2563eb', footerTxt: 'Vendor orders not found in our system',       textColor: '#1e3a8a' },
        ].map(({ title, data, color, bg, border, dotColor, footerTxt, textColor }) => (
          <View key={title} style={[cStyles.col, { borderTopColor: data.length > 0 ? border : '#bbf7d0' }]}>
            <View style={[cStyles.colHead, { backgroundColor: data.length > 0 ? bg : '#f0fdf4' }]}>
              <Ionicons name={data.length > 0 ? (color === '#dc2626' ? 'alert-circle' : 'information-circle') : 'checkmark-circle'} size={15} color={data.length > 0 ? color : '#16a34a'} />
              <Text style={[cStyles.colTitle, { color: data.length > 0 ? textColor : '#14532d' }]} numberOfLines={1}>{title}</Text>
              <View style={[cStyles.badge, { backgroundColor: data.length > 0 ? color : '#16a34a' }]}>
                <Text style={cStyles.badgeTxt}>{data.length}</Text>
              </View>
            </View>
            <ScrollView style={cStyles.colScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {data.length === 0 ? (
                <View style={cStyles.empty}>
                  <Ionicons name="checkmark-done-circle-outline" size={24} color="#86efac" />
                  <Text style={cStyles.emptyTxt}>{color === '#dc2626' ? 'All orders present in vendor file' : 'No extra orders in vendor file'}</Text>
                </View>
              ) : data.map((id, idx) => (
                <View key={id+idx} style={[cStyles.idRow, idx % 2 === 0 && { backgroundColor: '#f8fafc' }]}>
                  <View style={[cStyles.dot, { backgroundColor: dotColor }]} />
                  <Text style={[cStyles.idTxt, { color: textColor }]} selectable>{id}</Text>
                </View>
              ))}
            </ScrollView>
            {data.length > 0 && (
              <View style={[cStyles.footer, color === '#2563eb' && { backgroundColor: '#eff6ff', borderTopColor: '#bfdbfe' }]}>
                <Text style={[cStyles.footerTxt, { color: textColor }]}>{footerTxt}</Text>
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
};

const cStyles = StyleSheet.create({
  panel: { backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16, overflow: 'hidden', elevation: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: '#f8fafc', borderBottomWidth: 1, borderColor: '#e2e8f0', flexWrap: 'wrap' },
  title: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  matchBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#dcfce7', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  matchTxt: { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { backgroundColor: 'white', borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 4, paddingHorizontal: 8, alignItems: 'center' },
  chipLbl: { fontSize: 9, color: '#94a3b8', fontWeight: '600' },
  chipVal: { fontSize: 12, color: '#0f172a', fontWeight: '800' },
  closeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  cols: { flexDirection: 'row', minHeight: 180, maxHeight: 300 },
  col: { flex: 1, borderTopWidth: 3 },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  colTitle: { flex: 1, fontSize: 11, fontWeight: '700' },
  badge: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, minWidth: 22, alignItems: 'center' },
  badgeTxt: { fontSize: 11, fontWeight: '800', color: 'white' },
  colScroll: { flex: 1 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  idTxt: { fontSize: 12, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  empty: { alignItems: 'center', padding: 24, gap: 6 },
  emptyTxt: { fontSize: 11, color: '#64748b', textAlign: 'center', lineHeight: 16 },
  footer: { paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fef2f2', borderTopWidth: 1, borderColor: '#fecaca' },
  footerTxt: { fontSize: 11, lineHeight: 15 },
});

// ─── Expandable Order Row ─────────────────────────────────────────────────────
const OrderRow = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const isCancelled = item.status === 'Cancelled';
  const isCompleted = item.status === 'Completed' || item.status === 'Delivered';
  const badgeBg     = isCancelled ? '#fef2f2' : isCompleted ? '#f0fdf4' : '#fffbeb';
  const badgeTxt    = isCancelled ? '#dc2626' : isCompleted ? '#16a34a' : '#b45309';
  const badgeBorder = isCancelled ? '#fecaca' : isCompleted ? '#bbf7d0' : '#fde68a';
  const isCOD       = normPayment(item.paymentType) === 'COD';

  return (
    <View style={dStyles.wrap}>
      <TouchableOpacity style={[dStyles.row, expanded && dStyles.rowExp]} onPress={() => setExpanded(!expanded)} activeOpacity={0.85}>
        <View style={{ width: 34, alignItems: 'center' }}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#94a3b8" />
        </View>
        <View style={{ flex: 0.8 }}>
          <View style={[dStyles.badge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: badgeTxt, letterSpacing: 0.5 }}>{item.status || 'ACTIVE'}</Text>
          </View>
        </View>
        <Text style={[dStyles.cell, { flex: 1.1, fontWeight: '700', color: '#0f172a' }]}>{item.orderNo}</Text>
        <Text style={[dStyles.cell, { flex: 1.0, fontSize: 12 }]}>{item.deliveryDate ? new Date(item.deliveryDate).toLocaleDateString('en-GB') : '—'}</Text>
        <Text style={[dStyles.cell, { flex: 0.8, fontSize: 12 }]}>{item.deliveryTime || '—'}</Text>
        <Text style={[dStyles.cell, { flex: 1.4 }]} numberOfLines={2}>
          {item.trainInfo || 'N/A'} <Text style={{ color: '#dc2626', fontWeight: '700' }}>({item.coach || 'N/A'}{item.seat ? `/${item.seat}` : ''})</Text>
        </Text>
        <Text style={[dStyles.cell, { flex: 1.0, fontSize: 12 }]} numberOfLines={1}>{item.contactNo || '—'}</Text>
        <View style={{ flex: 0.8 }}>
          <Text style={[dStyles.payTag, { color: isCOD ? '#b45309' : '#0f766e', borderColor: isCOD ? '#b45309' : '#0f766e' }]}>{isCOD ? 'COD' : 'ONLINE'}</Text>
        </View>
        <Text style={[dStyles.cell, { flex: 0.9, fontWeight: '700', color: '#0f172a' }]}>₹ {item.totalAmount || 0}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={dStyles.expContent}>
          <View style={dStyles.expLayout}>
            <View style={dStyles.secLeft}>
              <View style={dStyles.miniHead}>
                <Text style={[dStyles.miniHeadTxt, { flex: 1 }]}>ITEM</Text>
                <Text style={[dStyles.miniHeadTxt, { width: 52, textAlign: 'center' }]}>QTY</Text>
              </View>
              {item.items && item.items.map((p, idx) => (
                <View key={idx} style={dStyles.miniRow}>
                  <Text style={[dStyles.miniTxt, { flex: 1 }]}>{p.name}</Text>
                  <Text style={[dStyles.miniTxt, { width: 52, textAlign: 'center', fontWeight: '700', color: '#0f172a' }]}>{p.quantity}</Text>
                </View>
              ))}
            </View>
            <View style={dStyles.secMid}>
              <Text style={dStyles.secLbl}>CUSTOMER</Text>
              <Text style={dStyles.remTxt}>{item.customerName}</Text>
              <Text style={[dStyles.remTxt, { color: '#475569' }]}>Mo: {item.contactNo}</Text>
              {!!item.remark?.trim() && (
                <View style={dStyles.remBox}>
                  <Text style={dStyles.remAlert}>⚠ SPECIAL INSTRUCTIONS</Text>
                  <Text style={dStyles.remContent}>{item.remark}</Text>
                </View>
              )}
              {!!item.assignedExecutiveName && (
                <View style={dStyles.assignBox}>
                  <Text style={dStyles.assignLbl}>ASSIGNED TO</Text>
                  <Text style={dStyles.assignName}>{item.assignedExecutiveName}</Text>
                </View>
              )}
            </View>
            <View style={dStyles.secRight}>
              <Text style={dStyles.secLbl}>BILLING</Text>
              {[['Sub Total', item.subTotal], ['Tax / GST', item.tax], ['Delivery', item.deliveryCharge]].map(([l, v]) => (
                <View key={l} style={dStyles.finRow}><Text style={dStyles.finLbl}>{l}</Text><Text style={dStyles.finVal}>₹ {v || 0}</Text></View>
              ))}
              <View style={dStyles.finDiv} />
              <View style={dStyles.finRow}>
                <Text style={[dStyles.finLbl, { fontWeight: '700', color: '#0f172a' }]}>TOTAL</Text>
                <Text style={[dStyles.finVal, { fontSize: 15, fontWeight: '800', color: '#0f172a' }]}>₹ {item.totalAmount || 0}</Text>
              </View>
              {isCOD && (
                <View style={dStyles.collectBar}>
                  <Text style={dStyles.collectLbl}>COLLECT CASH</Text>
                  <Text style={dStyles.collectVal}>₹ {item.totalAmount || 0}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

// ─── Smart Pie Chart — auto-labels large slices, tap tooltip for small ones ──
const SMALL_SLICE = 0.05; // slices < 5% get tap-tooltip instead of auto-label

function PieChart({ data, size, title }) {
  const [tooltip, setTooltip] = useState(null);

  if (!data || data.length === 0) return null;

  const total   = data.reduce((s, d) => s + d.population, 0);
  // Keep SVG canvas tight — pie takes up center, labels get fixed side padding
  const LABEL_PAD = 90; // fixed px each side for leader-line labels
  const SW     = size + LABEL_PAD * 2;   // e.g. size=140 → SW=320
  const SH     = size * 1.1 + 20;        // just enough height, not 1.65×
  const cx     = SW / 2;
  const cy     = SH / 2;
  const R      = size * 0.38;            // pie radius relative to size
  const SMALL_R = R * 0.65;             // dot position inside small slices

  if (data.length === 1) {
    return (
      <View style={{ alignItems: 'center' }}>
        {title && <Text style={styles.pieTitle}>{title}</Text>}
        <Svg width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}>
          <Circle cx={cx} cy={cy} r={R} fill={data[0].color} />
          <Line x1={cx} y1={cy + R} x2={cx} y2={cy + R + 16} stroke={data[0].color} strokeWidth="1.5" />
          <SvgText x={cx} y={cy + R + 30} fontSize="12" fontWeight="700" fill="#1e293b" textAnchor="middle">
            {data[0].name} ({data[0].population})
          </SvgText>
        </Svg>
      </View>
    );
  }

  const slices = [];
  let angle = -Math.PI / 2;
  data.forEach((item) => {
    const frac    = item.population / total;
    const sweep   = frac * 2 * Math.PI;
    const end     = angle + sweep;
    const mid     = angle + sweep / 2;
    const x1      = cx + R * Math.cos(angle);
    const y1      = cy + R * Math.sin(angle);
    const x2      = cx + R * Math.cos(end);
    const y2      = cy + R * Math.sin(end);
    const largeArc = sweep > Math.PI ? 1 : 0;
    slices.push({
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`,
      color: item.color, mid, frac,
      name: item.name, count: item.population,
      pct: (frac * 100).toFixed(1),
      isSmall: frac < SMALL_SLICE,
      isRight: Math.cos(mid) >= 0,
      ax: cx + (R + 4)  * Math.cos(mid),
      ay: cy + (R + 4)  * Math.sin(mid),
      bx: cx + (R + 18) * Math.cos(mid),
      by: cy + (R + 18) * Math.sin(mid),
      dotX: cx + SMALL_R * Math.cos(mid),
      dotY: cy + SMALL_R * Math.sin(mid),
    });
    angle = end;
  });

  const LPAD = 14; // shorter leader line horizontal segment
  const distributeLabels = (list, side) => {
    const sorted = list.sort((a, b) => a.by - b.by);
    const out = [];
    sorted.forEach((s, i) => {
      let ly = s.by;
      if (i > 0 && ly - out[i - 1].ly < 26) ly = out[i - 1].ly + 26;
      // anchor label text at the SVG edge minus a small margin
      const lx = side === 'right' ? cx + R + LPAD + 10 : cx - R - LPAD - 10;
      out.push({ ...s, lx, ly, side });
    });
    return out;
  };

  const bigRight  = distributeLabels(slices.filter(s =>  s.isRight && !s.isSmall), 'right');
  const bigLeft   = distributeLabels(slices.filter(s => !s.isRight && !s.isSmall), 'left');
  const bigLabels = [...bigRight, ...bigLeft];
  const smallSlices = slices.filter(s => s.isSmall);

  const TT_W = 138, TT_H = 44;

  const handleSliceTap = (s) => {
    if (!s.isSmall) { setTooltip(null); return; }
    setTooltip(prev => prev?.name === s.name ? null : { name: s.name, count: s.count, pct: s.pct, x: s.dotX, y: s.dotY });
  };

  const ttBoxX = tooltip ? Math.max(4, Math.min(SW - TT_W - 4, tooltip.x - TT_W / 2)) : 0;
  const ttBoxY = tooltip ? (tooltip.y - TT_H - 14 < 4 ? tooltip.y + 14 : tooltip.y - TT_H - 14) : 0;

  return (
    <View style={{ alignItems: 'center' }}>
      {title && <Text style={styles.pieTitle}>{title}</Text>}
      <Svg width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}>
        {/* Slices */}
        {slices.map((s, i) => (
          <Path
            key={i} d={s.path}
            fill={tooltip?.name === s.name ? '#fbbf24' : s.color}
            stroke="white" strokeWidth="1.5"
            onPress={() => handleSliceTap(s)}
          />
        ))}

        {/* Labels for large slices */}
        {bigLabels.map((s, i) => {
          const ta  = s.side === 'right' ? 'start' : 'end';
          const tx  = s.side === 'right' ? s.lx + 4 : s.lx - 4;
          const lbl = s.name.length > 12 ? s.name.slice(0, 12) + '…' : s.name;
          return (
            <G key={`lbl-${i}`}>
              <Line x1={s.ax} y1={s.ay} x2={s.bx} y2={s.by} stroke={s.color} strokeWidth="1.2" />
              <Line x1={s.bx} y1={s.by} x2={s.lx} y2={s.ly} stroke={s.color} strokeWidth="1.2" />
              <Circle cx={s.ax} cy={s.ay} r="2" fill={s.color} />
              <Circle cx={s.lx} cy={s.ly} r="2" fill={s.color} />
              <SvgText x={tx} y={s.ly - 2}  fontSize="11" fontWeight="700" fill="#1e293b" textAnchor={ta}>{lbl}</SvgText>
              <SvgText x={tx} y={s.ly + 12} fontSize="10" fontWeight="500" fill="#64748b" textAnchor={ta}>{s.count} ({s.pct}%)</SvgText>
            </G>
          );
        })}

        {/* Tap-indicator dots for small slices */}
        {smallSlices.map((s, i) => (
          <G key={`sm-${i}`} onPress={() => handleSliceTap(s)}>
            <Circle cx={s.dotX} cy={s.dotY} r="5.5" fill="white" opacity="0.82" />
            <SvgText x={s.dotX} y={s.dotY + 3.5} fontSize="8" fontWeight="700" fill="#334155" textAnchor="middle">+</SvgText>
          </G>
        ))}

        {/* Tooltip */}
        {tooltip && (
          <G>
            <Rect x={ttBoxX} y={ttBoxY} width={TT_W} height={TT_H} rx="6" ry="6" fill="#0f172a" opacity="0.93" />
            <SvgText x={ttBoxX + TT_W / 2} y={ttBoxY + 16} fontSize="12" fontWeight="700" fill="white" textAnchor="middle">{tooltip.name}</SvgText>
            <SvgText x={ttBoxX + TT_W / 2} y={ttBoxY + 31} fontSize="10" fill="#94a3b8" textAnchor="middle">{tooltip.count} orders · {tooltip.pct}%</SvgText>
          </G>
        )}
      </Svg>

      {/* Legend for small slices */}
      {smallSlices.length > 0 && (
        <View style={styles.smallLegWrap}>
          <Text style={styles.smallLegHint}>Tap + to see small vendor details</Text>
          <View style={styles.smallLegRow}>
            {smallSlices.map((s, i) => (
              <TouchableOpacity key={i} style={styles.smallLegItem} onPress={() => handleSliceTap(s)} activeOpacity={0.7}>
                <View style={[styles.smallLegDot, { backgroundColor: s.color }]} />
                <Text style={styles.smallLegTxt}>{s.name} ({s.count})</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Vendor Detail View ───────────────────────────────────────────────────────
const VendorDetail = ({ vendor, orders, onBack, onExport, statusFilter, isMobile }) => {
  const [search, setSearch]                 = useState('');
  const [compareResult, setCompareResult]   = useState(null);
  const [uploadedOrders, setUploadedOrders] = useState([]);
  const [paymentFilter, setPaymentFilter]   = useState('All');
  const [toast, setToast]                   = useState(null);

  const showToast    = (msg, type = 'info') => setToast({ message: msg, type });
  const dismissToast = () => setToast(null);

  const PAY_FILTERS = [
    { label: 'All',    value: 'All',    activeColor: '#0f172a' },
    { label: 'COD',    value: 'COD',    activeColor: '#b45309' },
    { label: 'Online', value: 'ONLINE', activeColor: '#0f766e' },
  ];

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;

      const file = res.assets[0];
      let workbook;
      if (Platform.OS === 'web') {
        const ab = await (await fetch(file.uri)).arrayBuffer();
        workbook = XLSX.read(ab, { type: 'array' });
      } else {
        const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        workbook = XLSX.read(b64, { type: 'base64' });
      }

      const sheet  = workbook.Sheets[workbook.SheetNames[0]];
      const rawJson = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rawJson.length) { showToast('File is empty.', 'error'); return; }

      const ids = rawJson.map(r => extractOrderId(r)).filter(id => id && id !== 'undefined');
      if (!ids.length) {
        const cols = Object.keys(rawJson[0]).slice(0, 5).join('", "');
        showToast(`Could not find Order ID column. Found: "${cols}". Rename one to "Order ID".`, 'error');
        return;
      }

      let usedCol = Object.keys(rawJson[0])[0];
      for (const k of Object.keys(rawJson[0])) { if (String(rawJson[0][k]).trim() === ids[0]) { usedCol = k; break; } }

      setUploadedOrders(ids);
      setCompareResult(null);
      showToast(`✓ ${ids.length} orders loaded from "${file.name}" (col: "${usedCol}") — tap COMPARE.`, 'success');
    } catch { showToast('Failed to read file. Please try a valid .xlsx or .csv.', 'error'); }
  };

  // Orders belonging to this vendor, filtered down to whatever status the
  // main screen currently has selected (All / Completed / Cancelled / Delivered).
  // This is the single source of truth for the summary cards AND compare —
  // both must agree with each other and with the main screen's numbers.
  const statusFilteredOrders = orders.filter(o => {
    if (statusFilter === 'All')       return o.status === 'Completed' || o.status === 'Delivered' || o.status === 'Cancelled';
    if (statusFilter === 'Completed') return o.status === 'Completed';
    if (statusFilter === 'Cancelled') return o.status === 'Cancelled';
    if (statusFilter === 'Delivered') return o.status === 'Delivered' || o.status === 'Completed';
    return true;
  });

  const compareOrders = () => {
    if (!uploadedOrders.length) { showToast('Upload vendor file first.', 'warning'); return; }

    const sysRaw  = statusFilteredOrders.map(o => String(o.orderNo || '').trim());
    const sysNorm = sysRaw.map(id => id.toLowerCase());
    const upRaw   = uploadedOrders.map(id => id.trim());
    const upNorm  = upRaw.map(id => id.toLowerCase());
    const upSet   = new Set(upNorm);
    const sysSet  = new Set(sysNorm);

    const dedupe = (arr, normArr) => [...new Map(normArr.map((n, i) => [n, arr[i]])).values()];

    const missing = dedupe(sysRaw.filter((_, i) => !upSet.has(sysNorm[i])),  sysNorm.filter(n => !upSet.has(n)));
    const extra   = dedupe(upRaw.filter((_, i) => !sysSet.has(upNorm[i])),   upNorm.filter(n => !sysSet.has(n)));

    setCompareResult({
      missingInVendor: missing,
      extraInVendor:   extra,
      uploadedCount:   new Set(upNorm).size,
      systemCount:     new Set(sysNorm).size,
    });

    if (!missing.length && !extra.length) {
      showToast('Perfect match! All orders align.', 'success');
    } else {
      const parts = [];
      if (missing.length) parts.push(`${missing.length} missing in vendor file`);
      if (extra.length)   parts.push(`${extra.length} extra in vendor file`);
      showToast(`Discrepancies: ${parts.join(' · ')}.`, 'warning');
    }
  };

  // Summary cards now respect statusFilter too, so they match the main screen exactly.
  const completedForCalc = statusFilteredOrders.filter(o => o.status === 'Completed' || o.status === 'Delivered');
  const totalRevenue     = completedForCalc.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const codRevenue       = completedForCalc.filter(o => normPayment(o.paymentType) === 'COD').reduce((s, o) => s + (o.totalAmount || 0), 0);
  const onlineRevenue    = completedForCalc.filter(o => normPayment(o.paymentType) === 'ONLINE').reduce((s, o) => s + (o.totalAmount || 0), 0);
  const codCount         = completedForCalc.filter(o => normPayment(o.paymentType) === 'COD').length;
  const onlineCount      = completedForCalc.filter(o => normPayment(o.paymentType) === 'ONLINE').length;
  const totalOrderCount  = statusFilteredOrders.length;

  const displayOrders = orders.filter(o => {
    const q = search.toLowerCase();
    const mp = paymentFilter === 'All' || normPayment(o.paymentType) === paymentFilter;
    let ms = false;
    if (statusFilter === 'All')       ms = o.status === 'Completed' || o.status === 'Cancelled';
    if (statusFilter === 'Completed') ms = o.status === 'Completed';
    if (statusFilter === 'Cancelled') ms = o.status === 'Cancelled';
    if (statusFilter === 'Delivered') ms = o.status === 'Delivered' || o.status === 'Completed';
    return mp && ms && (!q || (o.orderNo||'').toLowerCase().includes(q) || (o.customerName||'').toLowerCase().includes(q) || (o.trainInfo||'').toLowerCase().includes(q));
  });

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled>

      {/* Row 1: back + vendor name + payment pills */}
      <View style={vStyles.row1}>
        <TouchableOpacity style={vStyles.backBtn} onPress={onBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={18} color="#0f172a" />
          <Text style={vStyles.backTxt}>Back</Text>
        </TouchableOpacity>
        <Text style={vStyles.vendorTitle} numberOfLines={2}>{vendor}</Text>
        <View style={vStyles.pills}>
          {PAY_FILTERS.map(({ label, value, activeColor }) => {
            const on = paymentFilter === value;
            return (
              <TouchableOpacity key={value} style={[vStyles.pill, on && { backgroundColor: activeColor, borderColor: activeColor }]} onPress={() => setPaymentFilter(value)} activeOpacity={0.8}>
                <Text style={[vStyles.pillTxt, on && { color: 'white' }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Row 2: search + action buttons */}
      <View style={vStyles.row2}>
        <View style={vStyles.searchBox}>
          <Ionicons name="search-outline" size={15} color="#94a3b8" />
          <TextInput style={vStyles.searchInput} placeholder="Search order / customer…" placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} />
          {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={15} color="#94a3b8" /></TouchableOpacity>}
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={vStyles.btn} onPress={onExport} activeOpacity={0.85}>
          <Ionicons name="download-outline" size={15} color="white" />
          <Text style={vStyles.btnTxt}>EXPORT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[vStyles.btn, uploadedOrders.length > 0 && { backgroundColor: '#16a34a' }]} onPress={pickFile} activeOpacity={0.85}>
          <Ionicons name={uploadedOrders.length > 0 ? 'document-attach-outline' : 'cloud-upload-outline'} size={15} color="white" />
          <Text style={vStyles.btnTxt}>{uploadedOrders.length > 0 ? `FILE (${uploadedOrders.length})` : 'UPLOAD'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[vStyles.btn, { backgroundColor: uploadedOrders.length > 0 ? '#2563eb' : '#94a3b8' }]} onPress={compareOrders} activeOpacity={0.85}>
          <Ionicons name="git-compare-outline" size={15} color="white" />
          <Text style={vStyles.btnTxt}>COMPARE</Text>
        </TouchableOpacity>
      </View>

      {/* Summary cards */}
      <View style={vStyles.sumRow}>
        {[
          { lbl: 'Total',  val: fmt(totalRevenue),  sub: `Orders: ${totalOrderCount}`, bg: '#16a34a' },
          { lbl: 'COD',    val: fmt(codRevenue),     sub: `Orders: ${codCount}`,        bg: '#0891b2' },
          { lbl: 'Online', val: fmt(onlineRevenue),  sub: `Orders: ${onlineCount}`,     bg: '#7c3aed' },
        ].map(({ lbl, val, sub, bg }) => (
          <View key={lbl} style={[vStyles.sumCard, { backgroundColor: bg }]}>
            <Text style={vStyles.sumLbl}>{lbl}</Text>
            <Text style={vStyles.sumVal}>{val}</Text>
            <Text style={vStyles.sumSub}>{sub}</Text>
          </View>
        ))}
      </View>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismissToast} />}
      {compareResult && <ComparePanel result={compareResult} onClose={() => setCompareResult(null)} />}

      {/* Order table — full width on desktop (matches main summary table); horizontal scroll only on mobile */}
      <ScrollView horizontal={isMobile} showsHorizontalScrollIndicator={false}>
        <View style={isMobile ? { minWidth: 800 } : { width: '100%' }}>
          <View style={vStyles.tHead}>
            <View style={{ width: 38 }} />
            {[['STATUS',0.9],['ORDER NO.',1.1],['DEL. DATE',1.0],['TIME',0.8],['TRAIN',1.4],['CONTACT',1.0],['PAY',0.8],['AMOUNT',0.9]].map(([l, f]) => (
              <Text key={l} style={[vStyles.tCol, { flex: f }]}>{l}</Text>
            ))}
          </View>
          {displayOrders.length === 0 ? (
            <View style={{ paddingVertical: 44, alignItems: 'center', gap: 10 }}>
              <Ionicons name="receipt-outline" size={36} color="#cbd5e1" />
              <Text style={{ fontSize: 14, color: '#94a3b8' }}>No orders found</Text>
            </View>
          ) : (
            displayOrders.map(item => <OrderRow key={item.id} item={item} />)
          )}
        </View>
      </ScrollView>
    </ScrollView>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ReportsScreen({ clientId }) {
  const [orders, setOrders]           = useState([]);
  const [filtered, setFiltered]       = useState([]);
  const [filterType, setFilterType]   = useState('Today');
  const [loading, setLoading]         = useState(true);
  const [selectedVendor, setVendor]   = useState(null);

  const [startDate, setStart] = useState(new Date());
  const [endDate,   setEnd]   = useState(new Date());
  const [showStart, setShowStart] = useState(false);
  const [showEnd,   setShowEnd]   = useState(false);

  const [showPeriodDrop, setPeriodDrop] = useState(false);
  const [showStatusDrop, setStatusDrop] = useState(false);
  const [statusFilter, setStatusFilter] = useState('Completed');
  const [search, setSearch]             = useState('');

  const { width: sw } = Dimensions.get('window');
  const isMobile = sw < 600;
  // PIE_SZ is the pie circle diameter — keep it compact so the full card fits on screen.
  // SW (total SVG width) = PIE_SZ + 2*90 label padding. So total card width ≈ 2*(PIE_SZ+180).
  // At sw=1400 desktop we want each pie to be ~150px → card uses ~2*(330)=660px ✓
  // At sw=800 we want ~110px → SVG=290px each, two pies = 580px ✓
  const PIE_SZ = isMobile
    ? Math.min(Math.floor(sw * 0.38), 130)        // mobile: scrollable, smaller
    : Math.min(Math.max(Math.floor((sw - 500) / 4), 100), 160); // desktop: capped 100–160

  const PERIOD_OPTS = ['Today','Week','Month','Custom'];
  const STATUS_OPTS = ['All','Completed','Cancelled'];

  const fetchReportOrders = (type, fromDate = startDate, toDate = endDate) => {
  if (!clientId) return () => {};

  let start = new Date();
  let end = new Date();

  if (type === "Today") {
    start = new Date();
    end = new Date();
  }

  else if (type === "Week") {
    end = new Date();
    start = new Date();
    start.setDate(end.getDate() - 6);
  }

  else if (type === "Month") {
    end = new Date();
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  }

  else if (type === "Custom") {
    start = fromDate;
    end = toDate;
  }

  const q = query(
    collection(db, "orders"),
    where("clientId", "==", clientId),
    where("status", "in", ["Completed", "Cancelled"]),
    where("deliveryDate", ">=", toISOLocal(start)),
    where("deliveryDate", "<=", toISOLocal(end))
  );

  return onSnapshot(q, (snap) => {

    const data = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    }));

    data.sort((a, b) => parseDate(b.deliveryDate) - parseDate(a.deliveryDate));

    console.log("=================================");
    console.log("Report :", type);
    console.log("Range :", toISOLocal(start), "→", toISOLocal(end));
    console.log("Orders Loaded :", data.length);

    const counts = {};

    data.forEach(order => {
      counts[order.status] = (counts[order.status] || 0) + 1;
    });

    console.log("Status Counts :", counts);
    console.log("=================================");

    setOrders(data);
    setFiltered(data);
    setLoading(false);

  });
};

useEffect(() => {
  setLoading(true);

  const unsubscribe = fetchReportOrders(
    filterType,
    startDate,
    endDate
  );

  return () => {
    if (unsubscribe) unsubscribe();
  };

}, [clientId, filterType, startDate, endDate]);

  const applyFilter = (data, type, sd, ed) => {
    const today = clearTime(new Date());
    let result = [];
    if (type === 'Today') {
      result = data.filter(o => clearTime(parseDate(o.deliveryDate)).getTime() === today.getTime());
    } else if (type === 'Week') {
      const from = new Date(today); from.setDate(today.getDate() - 7);
      result = data.filter(o => parseDate(o.deliveryDate) >= from);
    } else if (type === 'Month') {
      const from = new Date(today); from.setDate(today.getDate() - 30);
      result = data.filter(o => parseDate(o.deliveryDate) >= from);
    } else if (type === 'Custom') {
      const from = clearTime(sd);
      const to   = new Date(clearTime(ed)); to.setDate(to.getDate() + 1);
      result = data.filter(o => { const d = parseDate(o.deliveryDate); return d >= from && d < to; });
    }
    setFiltered(result);
    setFilterType(type);
    setVendor(null);
  };

  const handlePeriod = (type) => {
  setPeriodDrop(false);
  setFilterType(type);
};

  const displayOrders = filtered.filter(o => {
    const q = search.toLowerCase();
    let ms = false;
    if (statusFilter === 'All')       ms = o.status === 'Completed' || o.status === 'Cancelled';
    if (statusFilter === 'Completed') ms = o.status === 'Completed';
    if (statusFilter === 'Cancelled') ms = o.status === 'Cancelled';
    return ms && (!q || (o.vendorName||'').toLowerCase().includes(q) || (o.orderNo||'').toLowerCase().includes(q));
  });

  const vendorSummary = (() => {
    const map = {};
    displayOrders.forEach(o => {
      const v = normalizeVendor(o.vendorName);
      if (!map[v]) map[v] = { vendorName: v, delivered: 0, cancelled: 0, total: 0, cod: 0, codCount: 0, online: 0, onlineCount: 0, totalCount: 0 };
      if (o.status === 'Cancelled') { map[v].cancelled++; return; }
      map[v].delivered++;
      const pm = normPayment(o.paymentType), amt = o.totalAmount || 0;
      map[v].total += amt; map[v].totalCount++;
      if (pm === 'COD')    { map[v].cod    += amt; map[v].codCount++;    }
      if (pm === 'ONLINE') { map[v].online += amt; map[v].onlineCount++; }
    });
    return Object.values(map).sort((a, b) => (b.delivered + b.cancelled) - (a.delivered + a.cancelled));
  })();

  const completedOrders = displayOrders.filter(o => o.status === 'Completed');
  const totalRevenue    = completedOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const codRevenue      = completedOrders.filter(o => normPayment(o.paymentType) === 'COD').reduce((s, o) => s + (o.totalAmount || 0), 0);
  const onlineRevenue   = completedOrders.filter(o => normPayment(o.paymentType) === 'ONLINE').reduce((s, o) => s + (o.totalAmount || 0), 0);
  const codCount        = completedOrders.filter(o => normPayment(o.paymentType) === 'COD').length;
  const onlineCount     = completedOrders.filter(o => normPayment(o.paymentType) === 'ONLINE').length;

  const statusPieData = (() => {
    const d = displayOrders.filter(o => o.status === 'Completed').length;
    const c = displayOrders.filter(o => o.status === 'Cancelled').length;
    return [...(d > 0 ? [{ name: 'Delivered', population: d, color: '#22c55e' }] : []), ...(c > 0 ? [{ name: 'Cancelled', population: c, color: '#ef4444' }] : [])];
  })();

  const vendorPieData = (() => {
    const counts = {};
    completedOrders.forEach(o => { const v = normalizeVendor(o.vendorName); counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts).map((k, i) => ({ name: k, population: counts[k], color: PIE_COLORS[i % PIE_COLORS.length] })).sort((a, b) => b.population - a.population);
  })();

  const exportExcel = async (vendorFilter = null) => {
    try {
      const source = vendorFilter
        ? displayOrders.filter(o => normalizeVendor(o.vendorName) === vendorFilter)
        : displayOrders;

      // ── Sort: completed/delivered first, cancelled pushed to the bottom ──
      const completed = source.filter(o => o.status !== 'Cancelled');
      const cancelled = source.filter(o => o.status === 'Cancelled');
      const rows = [...completed, ...cancelled];

      // ── Build plain data array ──
      const HEADERS = [
        'Sr No', 'Order No', 'Delivery Date', 'Delivery Time',
        'Vendor', 'Customer', 'Contact', 'Train', 'Coach', 'Seat',
        'Subtotal', 'Tax', 'Delivery Charge', 'Total Amount',
        'Payment Type', 'Status',
      ];

      const dataRows = rows.map((o, idx) => [
        idx + 1,
        o.orderNo || '',
        fmtDateStr(o.deliveryDate),
        o.deliveryTime || '',
        o.vendorName || '',
        o.customerName || '',
        o.contactNo || '',
        o.trainInfo || '',
        o.coach || '',
        o.seat || '',
        o.subTotal || 0,
        o.tax || 0,
        o.deliveryCharge || 0,
        o.totalAmount || 0,
        normPayment(o.paymentType),
        o.status || '',
      ]);

      // ── Create sheet from array-of-arrays (gives us full cell control) ──
      const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);

      // ── Column widths ──
      ws['!cols'] = [
        { wch: 6 },  // Sr No
        { wch: 16 }, // Order No
        { wch: 14 }, // Delivery Date
        { wch: 12 }, // Delivery Time
        { wch: 18 }, // Vendor
        { wch: 20 }, // Customer
        { wch: 14 }, // Contact
        { wch: 22 }, // Train
        { wch: 8 },  // Coach
        { wch: 8 },  // Seat
        { wch: 10 }, // Subtotal
        { wch: 8 },  // Tax
        { wch: 14 }, // Delivery Charge
        { wch: 14 }, // Total Amount
        { wch: 12 }, // Payment Type
        { wch: 12 }, // Status
      ];

      // ── Helper: apply style to a cell (creates cell if missing) ──
      const styleCell = (ws, addr, style) => {
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = style;
      };

      // ── Header row style — dark navy background, white bold text ──
      const headerStyle = {
        fill: { fgColor: { rgb: '0F172A' } },
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Arial' },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
        border: {
          bottom: { style: 'medium', color: { rgb: '2563EB' } },
        },
      };
      HEADERS.forEach((_, ci) => {
        const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
        styleCell(ws, addr, headerStyle);
      });

      // ── Data row styles ──
      const completedStyle = {
        font: { name: 'Arial', sz: 10, color: { rgb: '1E293B' } },
        alignment: { vertical: 'center' },
        border: {
          bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
        },
      };
      const completedAltStyle = {
        ...completedStyle,
        fill: { fgColor: { rgb: 'F8FAFC' } },
      };

      // Yellow bg + dark amber text for entire cancelled row
      const cancelledStyle = {
        fill: { fgColor: { rgb: 'FEF08A' } },   // yellow-200
        font: { name: 'Arial', sz: 10, color: { rgb: '92400E' }, bold: false },
        alignment: { vertical: 'center' },
        border: {
          bottom: { style: 'thin', color: { rgb: 'FDE68A' } },
        },
      };
      // Order No cell in cancelled row — bold + slightly deeper yellow
      const cancelledOrderNoStyle = {
        ...cancelledStyle,
        fill: { fgColor: { rgb: 'FDE047' } },   // yellow-300 — slightly more vivid
        font: { name: 'Arial', sz: 10, color: { rgb: '78350F' }, bold: true },
      };

      rows.forEach((o, ri) => {
        const excelRow = ri + 1; // +1 for header
        const isCancelled = o.status === 'Cancelled';
        HEADERS.forEach((_, ci) => {
          const addr = XLSX.utils.encode_cell({ r: excelRow, c: ci });
          let style;
          if (isCancelled) {
            style = ci === 1 ? cancelledOrderNoStyle : cancelledStyle; // col 1 = Order No
          } else {
            style = ri % 2 === 0 ? completedStyle : completedAltStyle;
          }
          styleCell(ws, addr, style);
        });
      });

      // ── Freeze top header row ──
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

      // ── Summary sheet (cancelled count callout) ──
      const cancelledCount  = cancelled.length;
      const completedCount  = completed.length;
      const totalAmt        = completed.reduce((s, o) => s + (o.totalAmount || 0), 0);
      const summaryData = [
        ['Summary', ''],
        ['Vendor', vendorFilter || 'All Vendors'],
        ['Period', filterType],
        ['', ''],
        ['Completed Orders', completedCount],
        ['Cancelled Orders', cancelledCount],
        ['Total Orders', completedCount + cancelledCount],
        ['', ''],
        ['Total Revenue (Completed)', totalAmt],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      wsSummary['!cols'] = [{ wch: 28 }, { wch: 22 }];

      // Style summary header
      ['A1','B1'].forEach(addr => {
        if (!wsSummary[addr]) wsSummary[addr] = { t: 's', v: '' };
        wsSummary[addr].s = { fill: { fgColor: { rgb: '0F172A' } }, font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 } };
      });
      // Highlight cancelled count cell in yellow
      if (!wsSummary['B6']) wsSummary['B6'] = { t: 'n', v: cancelledCount };
      wsSummary['B6'].s = { fill: { fgColor: { rgb: 'FEF08A' } }, font: { bold: true, color: { rgb: '92400E' }, sz: 11 } };

      // ── Build workbook ──
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

      // ── Filename ──
      const today = new Date();
      let dr = '';
      if (filterType === 'Today') dr = fmtDateFile(today);
      else if (filterType === 'Week')   { const f = new Date(today); f.setDate(today.getDate()-7);  dr = `${fmtDateFile(f)}_to_${fmtDateFile(today)}`; }
      else if (filterType === 'Month')  { const f = new Date(today); f.setDate(today.getDate()-30); dr = `${fmtDateFile(f)}_to_${fmtDateFile(today)}`; }
      else if (filterType === 'Custom') dr = `${fmtDateFile(startDate)}_to_${fmtDateFile(endDate)}`;
      else dr = fmtDateFile(today);
      const vp = vendorFilter ? `_${vendorFilter.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}_` : '_';
      const fn = `Report${vp}${dr}.xlsx`;

      // ── Write ──
      if (Platform.OS === 'web') {
        XLSX.writeFile(wb, fn, { bookType: 'xlsx', cellStyles: true });
      } else {
        const out = XLSX.write(wb, { type: 'base64', bookType: 'xlsx', cellStyles: true });
        const uri = FileSystem.documentDirectory + fn;
        await FileSystem.writeAsStringAsync(uri, out, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(uri);
      }
    } catch (e) { console.log('Export error:', e); }
  };

  if (selectedVendor) {
    const vendorOrders = filtered.filter(o => normalizeVendor(o.vendorName) === selectedVendor);
    return (
      <View style={{ flex: 1, backgroundColor: '#eef2f7', padding: isMobile ? 8 : 14 }}>
        <VendorDetail vendor={selectedVendor} orders={vendorOrders} onBack={() => setVendor(null)} onExport={() => exportExcel(selectedVendor)} statusFilter={statusFilter} isMobile={isMobile} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#eef2f7' }}>

      {/* ── Controls bar ── */}
      <View style={styles.controlsBar}>
        {/* Row 1 */}
        <View style={styles.ctrlRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={14} color="#94a3b8" />
            <TextInput style={styles.searchInput} placeholder="Search vendor / order…" placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} returnKeyType="search" />
            {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top:8,bottom:8,left:8,right:8 }}><Ionicons name="close-circle" size={14} color="#94a3b8" /></TouchableOpacity>}
          </View>

          {/* Period dropdown */}
          <View style={styles.dropWrap}>
            <TouchableOpacity style={styles.dropBtn} onPress={() => { setPeriodDrop(p => !p); setStatusDrop(false); }} activeOpacity={0.8}>
              <Text style={styles.dropTxt}>{filterType}</Text>
              <Ionicons name="chevron-down" size={12} color="#334155" />
            </TouchableOpacity>
            {showPeriodDrop && (
              <View style={styles.dropMenu}>
                {PERIOD_OPTS.map(p => (
                  <TouchableOpacity key={p} style={[styles.dropItem, filterType === p && styles.dropItemOn]} onPress={() => handlePeriod(p)}>
                    <Text style={[styles.dropItemTxt, filterType === p && styles.dropItemTxtOn]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Status dropdown */}
          <View style={styles.dropWrap}>
            <TouchableOpacity style={styles.dropBtn} onPress={() => { setStatusDrop(s => !s); setPeriodDrop(false); }} activeOpacity={0.8}>
              <Text style={styles.dropTxt}>{statusFilter}</Text>
              <Ionicons name="chevron-down" size={12} color="#334155" />
            </TouchableOpacity>
            {showStatusDrop && (
              <View style={styles.dropMenu}>
                {STATUS_OPTS.map(s => (
                  <TouchableOpacity key={s} style={[styles.dropItem, statusFilter === s && styles.dropItemOn]} onPress={() => { setStatusFilter(s); setStatusDrop(false); }}>
                    <Text style={[styles.dropItemTxt, statusFilter === s && styles.dropItemTxtOn]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.exportBtn} onPress={() => exportExcel()} activeOpacity={0.85}>
            <Text style={styles.exportTxt}>EXPORT</Text>
          </TouchableOpacity>
        </View>

        {/* Row 2: date pickers */}
        <View style={styles.dateRow}>
          <View style={styles.dateBtn}>
            <Ionicons name="calendar-outline" size={13} color="#2563eb" />
            <Text style={styles.dateLbl}>From:</Text>
            {Platform.OS === 'web' ? (
              <input type="date" value={toISOLocal(startDate)}
                onChange={e => { if (e.target.value) { const [y,m,d] = e.target.value.split('-').map(Number); const nd = new Date(y,m-1,d); setStart(nd); setFilterType("Custom"); }}}
                style={{ border:'none',outline:'none',fontSize:12,color:'#1d4ed8',fontWeight:'600',backgroundColor:'transparent',cursor:'pointer' }} />
            ) : (
              <>
                <TouchableOpacity onPress={() => { setShowStart(true); setShowEnd(false); }}><Text style={styles.dateVal}>{fmtDate(startDate)}</Text></TouchableOpacity>
                {showStart && <DateTimePicker value={startDate} mode="date" onChange={(_, d) => { if (d) { setStart(d); setFilterType("Custom"); } setShowStart(false); }} />}
              </>
            )}
          </View>
          <Text style={styles.dateArrow}>→</Text>
          <View style={styles.dateBtn}>
            <Ionicons name="calendar-outline" size={13} color="#2563eb" />
            <Text style={styles.dateLbl}>To:</Text>
            {Platform.OS === 'web' ? (
              <input type="date" value={toISOLocal(endDate)}
                onChange={e => { if (e.target.value) { const [y,m,d] = e.target.value.split('-').map(Number); const nd = new Date(y,m-1,d); setEnd(nd); setFilterType("Custom"); }}}
                style={{ border:'none',outline:'none',fontSize:12,color:'#1d4ed8',fontWeight:'600',backgroundColor:'transparent',cursor:'pointer' }} />
            ) : (
              <>
                <TouchableOpacity onPress={() => { setShowEnd(true); setShowStart(false); }}><Text style={styles.dateVal}>{fmtDate(endDate)}</Text></TouchableOpacity>
                {showEnd && <DateTimePicker value={endDate} mode="date" onChange={(_, d) => { if (d) { setEnd(d); setFilterType("Custom"); } setShowEnd(false); }} />}
              </>
            )}
          </View>
        </View>
      </View>

      {/* ── Main content ── */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: isMobile ? 8 : 14, paddingBottom: 100 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {loading ? <SkeletonLoader /> : (
          <>
            {/* Chart card */}
            <View style={styles.chartCard}>
              {isMobile ? (
                <>
                  <View style={styles.sumRowMobile}>
                    {[
                      { t: `Total : ${fmt(totalRevenue)}`,   s: `Orders: ${completedOrders.length}`, bg: '#16a34a' },
                      { t: `COD : ${fmt(codRevenue)}`,       s: `Orders: ${codCount}`,               bg: '#0891b2' },
                      { t: `Online : ${fmt(onlineRevenue)}`, s: `Orders: ${onlineCount}`,             bg: '#7c3aed' },
                    ].map(({ t, s, bg }) => (
                      <View key={t} style={[styles.sumCard, { backgroundColor: bg, flex: 1 }]}>
                        <Text style={styles.sumTitle}>{t}</Text>
                        <Text style={styles.sumSub}>{s}</Text>
                      </View>
                    ))}
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {statusPieData.length > 0 ? <PieChart data={statusPieData} size={PIE_SZ} title="Order Status" /> : <View style={[styles.emptyPie,{width:PIE_SZ,height:PIE_SZ}]}><Ionicons name="pie-chart-outline" size={32} color="#cbd5e1" /><Text style={styles.emptyTxt}>No data</Text></View>}
                      {vendorPieData.length > 0  ? <PieChart data={vendorPieData}  size={PIE_SZ} title="Vendor Share"  /> : <View style={[styles.emptyPie,{width:PIE_SZ,height:PIE_SZ}]}><Ionicons name="pie-chart-outline" size={32} color="#cbd5e1" /><Text style={styles.emptyTxt}>No data</Text></View>}
                    </View>
                  </ScrollView>
                </>
              ) : (
                <View style={styles.chartRow}>
                  <View style={styles.piesWrap}>
                    {[{ data: statusPieData, t: 'Order Status' }, { data: vendorPieData, t: 'Vendor Share' }].map(({ data, t }) => (
                      <View key={t} style={{ alignItems: 'center' }}>
                        {data.length > 0 ? <PieChart data={data} size={PIE_SZ} title={t} /> : (
                          <View style={[styles.emptyPie, { width: PIE_SZ, height: PIE_SZ }]}>
                            <Ionicons name="pie-chart-outline" size={40} color="#cbd5e1" />
                            <Text style={styles.emptyTxt}>No data</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                  <View style={styles.sumCol}>
                    {[
                      { t: `Total : ${fmt(totalRevenue)}`,   s: `Orders : ${completedOrders.length}`, bg: '#16a34a' },
                      { t: `COD : ${fmt(codRevenue)}`,       s: `Orders : ${codCount}`,               bg: '#0891b2' },
                      { t: `Online : ${fmt(onlineRevenue)}`, s: `Orders : ${onlineCount}`,             bg: '#7c3aed' },
                    ].map(({ t, s, bg }) => (
                      <View key={t} style={[styles.sumCard, { backgroundColor: bg }]}>
                        <Text style={styles.sumTitle}>{t}</Text>
                        <Text style={styles.sumSub}>{s}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* Vendor table — stretches full width like the chart card; only scrolls horizontally if screen is narrower than the table's natural width */}
            <ScrollView horizontal={isMobile} showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={[styles.tableCard, isMobile ? { width: 720 } : { width: '100%' }]}>
                <View style={[styles.tableHead, !isMobile && { flexDirection: 'row' }]}>
                  {[['No',36,0.4],['Vendor',140,1.8],['Delivered',74,0.9],['Cancelled',74,0.9],['Total',130,1.5],['COD',120,1.3],['Online',110,1.3],['Actions',56,0.7]].map(([l,w,f]) => (
                    <Text key={l} style={[styles.th, isMobile ? { width: w } : { flex: f }]}>{l}</Text>
                  ))}
                </View>
                {vendorSummary.length === 0 ? (
                  <View style={styles.tableEmpty}><Ionicons name="receipt-outline" size={32} color="#cbd5e1" /><Text style={styles.emptyTxt}>No orders found</Text></View>
                ) : (
                  vendorSummary.map((v, i) => (
                    <View key={v.vendorName} style={[styles.tableRow, i%2===0 && styles.tableRowAlt]}>
                      <Text style={[styles.td, isMobile ? { width:36 } : { flex:0.4 }, { color:'#94a3b8' }]}>{i+1}</Text>
                      <Text style={[styles.td, isMobile ? { width:140 } : { flex:1.8 }, { fontWeight:'600', color:'#1e293b' }]} numberOfLines={2}>{v.vendorName}</Text>
                      <Text style={[styles.td, isMobile ? { width:74 } : { flex:0.9 }, { color:'#16a34a', fontWeight:'700' }]}>{v.delivered}</Text>
                      <Text style={[styles.td, isMobile ? { width:74 } : { flex:0.9 }, { color: v.cancelled>0?'#dc2626':'#94a3b8', fontWeight:'700' }]}>{v.cancelled}</Text>
                      <View style={isMobile ? { width:130 } : { flex:1.5 }}><Text style={styles.tdAmt}>{fmt(v.total)}</Text><Text style={styles.tdCnt}>({v.totalCount} orders)</Text></View>
                      <View style={isMobile ? { width:120 } : { flex:1.3 }}><Text style={[styles.tdAmt,{color:'#0891b2'}]}>{fmt(v.cod)}</Text><Text style={styles.tdCnt}>({v.codCount})</Text></View>
                      <View style={isMobile ? { width:110 } : { flex:1.3 }}><Text style={[styles.tdAmt,{color:'#7c3aed'}]}>{fmt(v.online)}</Text><Text style={styles.tdCnt}>({v.onlineCount})</Text></View>
                      <View style={[isMobile ? { width:56 } : { flex:0.7 }, { alignItems:'center' }]}>
                        <TouchableOpacity style={styles.actionBtn} onPress={() => setVendor(v.vendorName)} activeOpacity={0.8}>
                          <Ionicons name="chevron-forward" size={14} color="white" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </>
        )}
      </ScrollView>

      {(showPeriodDrop || showStatusDrop) && (
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => { setPeriodDrop(false); setStatusDrop(false); }} activeOpacity={1} pointerEvents="box-only" />
      )}
    </View>
  );
}

// ─── Main Styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  controlsBar: { backgroundColor: '#eef2f7', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, zIndex: 100 },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' },

  searchBox: { flex: 1, minWidth: 90, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 9, paddingHorizontal: 11 },
  searchInput: { flex: 1, fontSize: 13, color: '#1e293b', padding: 0, margin: 0, outlineStyle: 'none' },

  dropWrap: { zIndex: 200 },
  dropBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 9, paddingHorizontal: 11 },
  dropTxt: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  dropMenu: { position: 'absolute', top: 42, left: 0, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, elevation: 20, minWidth: 120, zIndex: 9999 },
  dropItem: { paddingVertical: 11, paddingHorizontal: 16 },
  dropItemOn: { backgroundColor: '#eff6ff' },
  dropItemTxt: { fontSize: 13, color: '#475569', fontWeight: '500' },
  dropItemTxtOn: { color: '#2563eb', fontWeight: '700' },

  exportBtn: { backgroundColor: '#0f172a', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  exportTxt: { color: 'white', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },

  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#eff6ff', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 6 },
  dateLbl: { fontSize: 11, color: '#2563eb', fontWeight: '500' },
  dateVal: { fontSize: 12, color: '#1d4ed8', fontWeight: '700' },
  dateArrow: { color: '#94a3b8', fontWeight: '700', fontSize: 16 },

  chartCard: { backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, marginBottom: 14, elevation: 2 },
  chartRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 12 },
  // piesWrap: no minWidth — let flex handle it. overflow hidden to clip SVG if somehow oversized
  piesWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: 0, overflow: 'hidden' },

  sumCol: { width: 180, flexShrink: 0, gap: 8 },
  sumRowMobile: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  sumCard: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, elevation: 2 },
  sumTitle: { fontSize: 12, fontWeight: '700', color: 'white', marginBottom: 2 },
  sumSub: { fontSize: 11, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },

  pieTitle: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 6, letterSpacing: 0.3, textAlign: 'center' },
  emptyPie: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTxt: { fontSize: 12, color: '#94a3b8', textAlign: 'center' },

  smallLegWrap: { marginTop: 4, paddingHorizontal: 6 },
  smallLegHint: { fontSize: 9, color: '#94a3b8', textAlign: 'center', marginBottom: 4 },
  smallLegRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  smallLegItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 4 },
  smallLegDot:  { width: 8, height: 8, borderRadius: 4 },
  smallLegTxt:  { fontSize: 10, color: '#475569', fontWeight: '600' },

  tableCard: { backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', elevation: 2 },
  tableHead: { flexDirection: 'row', backgroundColor: '#0f172a', paddingVertical: 12, paddingHorizontal: 10 },
  th: { fontSize: 10, fontWeight: '700', color: 'white', letterSpacing: 0.3 },
  tableRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: '#f1f5f9', alignItems: 'center' },
  tableRowAlt: { backgroundColor: '#f8fafc' },
  td: { fontSize: 12, color: '#475569' },
  tdAmt: { fontSize: 11.5, color: '#1e293b', fontWeight: '700' },
  tdCnt: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  tableEmpty: { paddingVertical: 44, alignItems: 'center', gap: 10 },
  actionBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' },
});

// ─── Vendor Detail Styles ─────────────────────────────────────────────────────
const vStyles = StyleSheet.create({
  row1: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'white', borderRadius: 9, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 9, paddingHorizontal: 13 },
  backTxt: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  vendorTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', flexShrink: 1 },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: 'white' },
  pillTxt: { fontSize: 12, fontWeight: '700', color: '#475569' },

  row2: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  searchBox: { flexGrow: 1, flexShrink: 1, flexBasis: 220, maxWidth: 320, minWidth: 130, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'white', borderRadius: 9, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 9, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 13, color: '#1e293b', padding: 0, margin: 0, outlineStyle: 'none' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0f172a', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 9 },
  btnTxt: { color: 'white', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },

  sumRow: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  sumCard: { flex: 1, minWidth: 90, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 13 },
  sumLbl: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.75)', marginBottom: 2 },
  sumVal: { fontSize: 13, fontWeight: '800', color: 'white', marginBottom: 2 },
  sumSub: { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },

  tHead: { flexDirection: 'row', backgroundColor: '#0f172a', paddingVertical: 13, paddingHorizontal: 14, alignItems: 'center' },
  tCol: { fontSize: 10, fontWeight: '700', color: '#ffffff', letterSpacing: 0.8 },
});

// ─── Order Row Styles ─────────────────────────────────────────────────────────
const dStyles = StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderColor: '#f1f5f9' },
  row: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center', backgroundColor: 'white' },
  rowExp: { backgroundColor: '#f8fafc' },
  cell: { fontSize: 13, color: '#334155', fontWeight: '700' },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1, alignSelf: 'flex-start' },
  payTag: { fontSize: 10, fontWeight: '700', borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', letterSpacing: 0.5 },

  expContent: { backgroundColor: '#f8fafc', padding: 14, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  expLayout:  { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },

  secLeft: { flex: 1.5, minWidth: 150, backgroundColor: 'white', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' },
  miniHead:    { flexDirection: 'row', backgroundColor: '#f8fafc', padding: 8, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  miniHeadTxt: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.6 },
  miniRow: { flexDirection: 'row', padding: 9, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  miniTxt: { fontSize: 13, color: '#0f172a', fontWeight: '700' },

  secMid:     { flex: 1, minWidth: 130, padding: 12, backgroundColor: 'white', borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  secLbl:     { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8, marginBottom: 8 },
  remTxt:     { fontSize: 13, color: '#0f172a', fontWeight: '700', marginBottom: 3 },
  remBox:     { marginTop: 10, padding: 10, backgroundColor: '#fffbeb', borderRadius: 6, borderWidth: 1, borderColor: '#fde68a' },
  remAlert:   { fontSize: 10, fontWeight: '700', color: '#b45309', marginBottom: 3, letterSpacing: 0.5 },
  remContent: { fontSize: 12, color: '#92400e', fontWeight: '600', lineHeight: 16 },
  assignBox:  { marginTop: 12, padding: 10, backgroundColor: '#f0fdf4', borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  assignLbl:  { fontSize: 10, fontWeight: '700', color: '#16a34a', marginBottom: 2, letterSpacing: 0.5 },
  assignName: { fontSize: 13, fontWeight: '700', color: '#14532d' },

  secRight:    { flex: 1, minWidth: 130, backgroundColor: 'white', borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0', padding: 12 },
  finRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  finLbl:      { fontSize: 12, color: '#334155', fontWeight: '600' },
  finVal:      { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  finDiv:      { height: 1, backgroundColor: '#e2e8f0', marginVertical: 8 },
  collectBar:  { backgroundColor: '#0f172a', padding: 10, borderRadius: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  collectLbl:  { color: '#94a3b8', fontWeight: '700', fontSize: 10, letterSpacing: 0.8 },
  collectVal:  { color: 'white', fontWeight: '800', fontSize: 15 },
});
