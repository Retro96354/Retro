import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Dimensions, Modal } from 'react-native';
import { collection, onSnapshot, addDoc, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';

const isWeb = Dimensions.get('window').width > 768;

const PRIORITY_VENDORS = ['Direct', 'IRCTC', 'ZOOP', 'YatriBhojan'];

const OTHER_VENDORS = [
  'Go_Food', 'OLF',
  'Rail_Food', 'Rail_Restro', 'Rail_Yatri', 'Rajdhani',
   'Khana_Online', 'Train_Bhojan', 'Rail_Recipe',
  'Etos', 'Rail_Meal', 'SpicyWagon', 'Rajbhog', 'Dibrail', 'RailFeast',
  'YatriRestro', 'HomeBytes',
].sort();

const VENDOR_LIST = [...PRIORITY_VENDORS, ...OTHER_VENDORS];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// Generates an automatic Order ID: "PS" + a 10-digit random number (e.g. PS1542632514)
function generateOrderId() {
  const min = 1000000000; // 10 digits, smallest
  const max = 9999999999; // 10 digits, largest
  const randomDigits = Math.floor(Math.random() * (max - min + 1)) + min;
  return `PS${randomDigits}`;
}

function DateTimePicker({ visible, onClose, onConfirm, initialDate, initialTime }) {
  const now = new Date();
  const parseInitial = () => {
    if (initialDate) { const [y, m, d] = initialDate.split('-').map(Number); if (y && m && d) return new Date(y, m - 1, d); }
    return new Date();
  };
  const [viewDate, setViewDate] = useState(parseInitial);
  const [selectedDate, setSelectedDate] = useState(parseInitial);
  const [hour, setHour] = useState(() => { if (initialTime) return parseInt(initialTime.split(':')[0]) || now.getHours(); return now.getHours(); });
  const [minute, setMinute] = useState(() => { if (initialTime) return parseInt(initialTime.split(':')[1]) || now.getMinutes(); return now.getMinutes(); });
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarCells = [];
  for (let i = 0; i < firstDay; i++) { calendarCells.push({ date: new Date(year, month, -firstDay + i + 1), current: false }); }
  for (let d = 1; d <= daysInMonth; d++) { calendarCells.push({ date: new Date(year, month, d), current: true }); }
  for (let d = calendarCells.length; d < 42; d++) { calendarCells.push({ date: new Date(year, month + 1, d - firstDay - daysInMonth + 1), current: false }); }
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const handleConfirm = () => {
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(selectedDate.getDate()).padStart(2, '0');
    onConfirm(`${y}-${m}-${d}`, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    onClose();
  };
  const handleNow = () => { const n = new Date(); setSelectedDate(n); setViewDate(n); setHour(n.getHours()); setMinute(n.getMinutes()); };
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const hourScrollRef = useRef(null);
  const minScrollRef = useRef(null);
  const ITEM_H = 44;
  useEffect(() => { if (visible) { setTimeout(() => { hourScrollRef.current?.scrollTo({ y: hour * ITEM_H, animated: false }); minScrollRef.current?.scrollTo({ y: minute * ITEM_H, animated: false }); }, 50); } }, [visible]);
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={dtp.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation()}>
          <View style={dtp.container}>
            <View style={dtp.header}>
              <TouchableOpacity style={dtp.monthBtn} onPress={() => setShowMonthDropdown(!showMonthDropdown)}>
                <Text style={dtp.monthText}>{MONTHS[month].toUpperCase()} {year}</Text>
                <Ionicons name="chevron-down" size={14} color="#0f172a" />
              </TouchableOpacity>
              <View style={dtp.navBtns}>
                <TouchableOpacity onPress={() => setViewDate(new Date(year, month - 1, 1))}><Ionicons name="chevron-back" size={16} color="#475569" /></TouchableOpacity>
                <TouchableOpacity onPress={() => setViewDate(new Date(year, month + 1, 1))}><Ionicons name="chevron-forward" size={16} color="#475569" /></TouchableOpacity>
              </View>
            </View>
            <View style={dtp.body}>
              <View style={dtp.calendar}>
                <View style={dtp.dayRow}>{DAYS_SHORT.map(d => (<View key={d} style={dtp.dayCell}><Text style={dtp.dayHeadText}>{d}</Text></View>))}</View>
                {Array.from({ length: 6 }, (_, row) => (
                  <View key={row} style={dtp.dayRow}>
                    {calendarCells.slice(row * 7, row * 7 + 7).map((cell, col) => (
                      <TouchableOpacity key={col} style={[dtp.dateCell, isSameDay(cell.date, selectedDate) && dtp.dateCellSelected]} onPress={() => { setSelectedDate(cell.date); setViewDate(cell.date); }}>
                        <Text style={[dtp.dateCellText, !cell.current && dtp.dateCellFaded, isSameDay(cell.date, now) && !isSameDay(cell.date, selectedDate) && dtp.dateCellToday, isSameDay(cell.date, selectedDate) && dtp.dateCellTextSelected]}>{cell.date.getDate()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
              <View style={dtp.timePicker}>
                <Text style={dtp.timeLabel}>Hr</Text>
                <Text style={dtp.timeLabel}>Min</Text>
                <View style={dtp.timeColumns}>
                  <View style={dtp.timeColWrap}>
                    <View style={dtp.timeHighlight} pointerEvents="none" />
                    <ScrollView ref={hourScrollRef} snapToInterval={ITEM_H} decelerationRate="fast" onMomentumScrollEnd={e => setHour(Math.round(e.nativeEvent.contentOffset.y / ITEM_H))}>
                      <View style={{ height: ITEM_H * 2 }} />
                      {hours.map(h => (<TouchableOpacity key={h} style={[dtp.timeItem, h === hour && dtp.timeItemSelected]} onPress={() => { setHour(h); hourScrollRef.current?.scrollTo({ y: h * ITEM_H, animated: true }); }}><Text style={[dtp.timeItemText, h === hour && dtp.timeItemTextSelected]}>{String(h).padStart(2, '0')}</Text></TouchableOpacity>))}
                      <View style={{ height: ITEM_H * 2 }} />
                    </ScrollView>
                  </View>
                  <Text style={dtp.timeSep}>:</Text>
                  <View style={dtp.timeColWrap}>
                    <View style={dtp.timeHighlight} pointerEvents="none" />
                    <ScrollView ref={minScrollRef} snapToInterval={ITEM_H} decelerationRate="fast" onMomentumScrollEnd={e => setMinute(Math.round(e.nativeEvent.contentOffset.y / ITEM_H))}>
                      <View style={{ height: ITEM_H * 2 }} />
                      {minutes.map(m => (<TouchableOpacity key={m} style={[dtp.timeItem, m === minute && dtp.timeItemSelected]} onPress={() => { setMinute(m); minScrollRef.current?.scrollTo({ y: m * ITEM_H, animated: true }); }}><Text style={[dtp.timeItemText, m === minute && dtp.timeItemTextSelected]}>{String(m).padStart(2, '0')}</Text></TouchableOpacity>))}
                      <View style={{ height: ITEM_H * 2 }} />
                    </ScrollView>
                  </View>
                </View>
              </View>
            </View>
            <View style={dtp.footer}>
              <TouchableOpacity onPress={handleNow}><Text style={dtp.nowText}>NOW</Text></TouchableOpacity>
              <TouchableOpacity style={dtp.okBtn} onPress={handleConfirm}><Text style={dtp.okText}>OK</Text></TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const dtp = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
  container: { backgroundColor: '#fff', borderRadius: 12, width: 480, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  monthBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthText: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  navBtns: { flexDirection: 'row', gap: 4 },
  body: { flexDirection: 'row', padding: 16 },
  calendar: { flex: 1 },
  dayRow: { flexDirection: 'row' },
  dayCell: { flex: 1, height: 36, justifyContent: 'center', alignItems: 'center' },
  dayHeadText: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  dateCell: { flex: 1, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 6, margin: 1 },
  dateCellSelected: { backgroundColor: '#0f172a' },
  dateCellText: { fontSize: 13, color: '#0f172a', fontWeight: '500' },
  dateCellFaded: { color: '#cbd5e1' },
  dateCellToday: { color: '#0f172a', fontWeight: '800', textDecorationLine: 'underline' },
  dateCellTextSelected: { color: '#fff', fontWeight: '700' },
  timePicker: { width: 120, alignItems: 'center', marginLeft: 16 },
  timeLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', alignSelf: 'flex-start' },
  timeColumns: { flexDirection: 'row', alignItems: 'center' },
  timeColWrap: { width: 52, height: 220, position: 'relative', overflow: 'hidden' },
  timeHighlight: { position: 'absolute', top: '50%', left: 0, right: 0, height: 44, marginTop: -22, backgroundColor: '#f1f5f9', borderRadius: 6 },
  timeItem: { height: 44, justifyContent: 'center', alignItems: 'center' },
  timeItemSelected: { backgroundColor: '#0f172a', borderRadius: 6 },
  timeItemText: { fontSize: 15, color: '#475569' },
  timeItemTextSelected: { color: '#fff', fontWeight: '800' },
  timeSep: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginHorizontal: 2, marginTop: -8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderColor: '#f1f5f9' },
  nowText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  okBtn: { backgroundColor: '#0f172a', paddingVertical: 9, paddingHorizontal: 24, borderRadius: 6 },
  okText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});

function DateTimeField({ deliveryDate, deliveryTime, onChange }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const displayDate = () => { if (!deliveryDate) return '—'; const [y, m, d] = deliveryDate.split('-'); return `${d}/${m}/${y}`; };
  return (
    <View style={dtf.wrapper}>
      <Text style={dtf.label}>Delivery Date & Time</Text>
      <TouchableOpacity style={dtf.field} onPress={() => setPickerOpen(true)} activeOpacity={0.75}>
        <Ionicons name="calendar-outline" size={15} color="#64748b" style={{ marginRight: 8 }} />
        <Text style={dtf.dateText}>{displayDate()}</Text>
        <View style={dtf.timePill}><Ionicons name="time-outline" size={12} color="#0f172a" /><Text style={dtf.timeText}>{deliveryTime || '--:--'}</Text></View>
        <Ionicons name="chevron-down" size={13} color="#94a3b8" style={{ marginLeft: 'auto' }} />
      </TouchableOpacity>
      <DateTimePicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={(date, time) => onChange(date, time)} initialDate={deliveryDate} initialTime={deliveryTime} />
    </View>
  );
}

const dtf = StyleSheet.create({
  wrapper: { width: '100%', marginBottom: 4 },
  label: { fontSize: 11, fontWeight: '600', color: '#64748b', marginBottom: 5 },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: '#f8fafc' },
  dateText: { fontSize: 13, color: '#0f172a', fontWeight: '600' },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0f172a', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 10 },
  timeText: { fontSize: 12, color: '#fff', fontWeight: '700' },
});

const RadioButton = ({ label, selected, onSelect }) => (
  <TouchableOpacity style={styles.radioContainer} onPress={onSelect} activeOpacity={0.7}>
    <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>{selected && <View style={styles.radioInnerCircle} />}</View>
    <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{label}</Text>
  </TouchableOpacity>
);

export default function AddOrderScreen({ onNavigate, clientId }) {
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  // Order ID is now client-editable. Blank = auto-generated at submit time (PS + 10 digits).
  const [orderId, setOrderId] = useState('');
  const [vendorName, setVendorName] = useState(VENDOR_LIST[0]);
  const [trainNo, setTrainNo] = useState('');
  const [coach, setCoach] = useState('');
  const [seat, setSeat] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [orderType, setOrderType] = useState('Vegetarian');
  const [paymentType, setPaymentType] = useState('COD');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [deliveryTime, setDeliveryTime] = useState(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
  const [cart, setCart] = useState([]);
  const [deliveryChargeInput, setDeliveryChargeInput] = useState('0');
  const [gstPercent, setGstPercent] = useState('0');
  const [discountPercent, setDiscountPercent] = useState('0');

  // Coach number is always stored/displayed in uppercase, regardless of
  // how the client types it (e.g. "b5" or "B5" both become "B5").
  const handleCoachChange = (text) => setCoach(text.toUpperCase());

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'categories'), where('clientId', '==', clientId)), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(data);
      if (data.length > 0 && !selectedCat) setSelectedCat(data[0].id);
    }, error => { console.error('AddOrderScreen categories sync error:', error.message); Alert.alert('Sync Error', error.message); });
    const u2 = onSnapshot(query(collection(db, 'menuItems'), where('clientId', '==', clientId)), snap => {
      setMenuItems(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    }, error => { console.error('AddOrderScreen menuItems sync error:', error.message); Alert.alert('Sync Error', error.message); });
    return () => { u1(); u2(); };
  }, [clientId]);

  const addToCart = (item) => {
    setCart(prev => { const existing = prev.find(p => p.id === item.id); if (existing) return prev.map(p => p.id === item.id ? { ...p, quantity: p.quantity + 1 } : p); return [...prev, { ...item, quantity: 1 }]; });
  };
  const updateQty = (id, delta) => {
    setCart(prev => prev.map(p => p.id === id ? { ...p, quantity: Math.max(0, p.quantity + delta) } : p).filter(p => p.quantity > 0));
  };
  const subTotal = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const delivery = parseFloat(deliveryChargeInput) || 0;
  const tax = (subTotal * (parseFloat(gstPercent) || 0)) / 100;
  const discount = (subTotal * (parseFloat(discountPercent) || 0)) / 100;
  const totalAmount = Math.round(subTotal + tax + delivery - discount);

  const handlePlaceOrder = async () => {
    if (cart.length === 0) { Alert.alert('Error', 'Cart is empty'); return; }
    // Use client-typed Order ID if provided, otherwise auto-generate one (PS + 10 digits)
    const finalOrderId = orderId.trim() ? orderId.trim() : generateOrderId();
    const orderData = {
      orderNo: finalOrderId, vendorName, contactNo: mobileNo, trainInfo: trainNo, coach,
      seat, orderType, paymentType,
      orderDate: new Date().toISOString().split('T')[0],
      orderTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      deliveryDate, deliveryTime,
      items: cart.map(i => ({ name: i.name, quantity: i.quantity, price: i.price })),
      subTotal, tax, deliveryCharge: delivery, totalAmount, status: 'Active',
      createdAt: new Date().toISOString(), clientId
    };
    try { await addDoc(collection(db, 'orders'), orderData); onNavigate('Dashboard'); }
    catch (error) { console.error('AddOrderScreen place order error:', error.message); Alert.alert('Error', error.message); }
  };

  const renderInput = (label, value, onChange, placeholder, keyboard = 'default', editable = true) => (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, !editable && styles.disabledInput]} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#cbd5e1" keyboardType={keyboard} editable={editable} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => onNavigate('Dashboard')} style={styles.backBtn}><Ionicons name="arrow-back" size={18} color="#64748b" /></TouchableOpacity>
          <Text style={styles.headerTitle}>New Order</Text>
        </View>
        <Text style={styles.orderIdBadge}>{orderId.trim() ? `#${orderId.trim().slice(-6)}` : '#Auto'}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.mainLayout}>
          <View style={[styles.card, styles.leftCard]}>
            <View style={styles.cardTitleRow}><View style={styles.cardTitleDot} /><Text style={styles.cardTitle}>Order Details</Text></View>
            <View style={styles.formGrid}>
              {renderInput('Order ID', orderId, setOrderId, 'Leave blank for auto ID')}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Vendor Name</Text>
                <View style={styles.pickerBorder}><Picker selectedValue={vendorName} onValueChange={setVendorName} style={styles.picker}>{VENDOR_LIST.map(v => <Picker.Item key={v} label={v} value={v} />)}</Picker></View>
              </View>
              {renderInput('Train Number & Name', trainNo, setTrainNo, 'Train Number & Name')}
              {renderInput('Coach Number', coach, handleCoachChange, 'Coach Number')}
              {renderInput('Seat Number', seat, setSeat, 'Seat Number')}
              {renderInput('Mobile No', mobileNo, setMobileNo, 'Mobile Number', 'phone-pad')}
              <View style={{ width: '100%' }}><DateTimeField deliveryDate={deliveryDate} deliveryTime={deliveryTime} onChange={(date, time) => { setDeliveryDate(date); setDeliveryTime(time); }} /></View>
            </View>
            <View style={styles.radioSection}>
              <View style={styles.radioGroup}><Text style={styles.radioGroupLabel}>Order Type</Text><View style={styles.radioRow}><RadioButton label="Vegetarian" selected={orderType === 'Vegetarian'} onSelect={() => setOrderType('Vegetarian')} /><RadioButton label="Non-Veg" selected={orderType === 'Non Vegetarian'} onSelect={() => setOrderType('Non Vegetarian')} /></View></View>
              <View style={styles.radioGroup}><Text style={styles.radioGroupLabel}>Payment Type</Text><View style={styles.radioRow}><RadioButton label="COD" selected={paymentType === 'COD'} onSelect={() => setPaymentType('COD')} /><RadioButton label="ONLINE" selected={paymentType === 'ONLINE'} onSelect={() => setPaymentType('ONLINE')} /></View></View>
            </View>
          </View>
          <View style={[styles.card, styles.rightCard]}>
            <View style={styles.cardTitleRow}><View style={styles.cardTitleDot} /><Text style={styles.cardTitle}>Order Overview</Text>{cart.length > 0 && (<View style={styles.cartCountBadge}><Text style={styles.cartCountText}>{cart.length}</Text></View>)}</View>
            <View style={styles.tableHeader}><Text style={[styles.th, { flex: 2 }]}>ITEM NAME</Text><Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>QTY</Text><Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>RATE</Text><Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>TOTAL</Text></View>
            {cart.length === 0 ? (<View style={styles.emptyCart}><Ionicons name="cart-outline" size={28} color="#cbd5e1" /><Text style={styles.emptyCartText}>No items selected</Text></View>) : (
              cart.map(item => (
                <View key={item.id} style={styles.tableRow}>
                  <Text style={[styles.cartItemName, { flex: 2 }]}>{item.name}</Text>
                  <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                    <TouchableOpacity onPress={() => updateQty(item.id, -1)} style={styles.qtyBtn}><Text style={styles.qtyBtnText}>−</Text></TouchableOpacity>
                    <Text style={styles.qtyValue}>{item.quantity}</Text>
                    <TouchableOpacity onPress={() => updateQty(item.id, 1)} style={styles.qtyBtn}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                  </View>
                  <Text style={[styles.cartCell, { flex: 1, textAlign: 'right' }]}>₹{item.price}</Text>
                  <Text style={[styles.cartCell, { flex: 1, textAlign: 'right', fontWeight: '700', color: '#0f172a' }]}>₹{item.price * item.quantity}</Text>
                </View>
              ))
            )}
          </View>
          <View style={[styles.card, styles.leftCard, { height: 420 }]}>
            <View style={styles.cardTitleRow}><View style={styles.cardTitleDot} /><Text style={styles.cardTitle}>Add Items</Text></View>
            <View style={{ flexDirection: 'row', height: 320 }}>
              <View style={styles.categorySidebar}>
                <Text style={styles.sidebarHeading}>CATEGORY</Text>
                <ScrollView>{categories.map(cat => (<TouchableOpacity key={cat.id} style={[styles.catItem, selectedCat === cat.id && styles.catItemActive]} onPress={() => setSelectedCat(cat.id)}><Text style={[styles.catText, selectedCat === cat.id && styles.catTextActive]}>{cat.name}</Text></TouchableOpacity>))}</ScrollView>
              </View>
              <View style={styles.itemsPanel}>
                <Text style={styles.sidebarHeading}>ITEMS</Text>
                <ScrollView contentContainerStyle={styles.itemGrid}>
                  {menuItems.filter(m => m.categoryId === selectedCat).map(item => {
                    const inCart = cart.some(p => p.id === item.id);
                    return (<TouchableOpacity key={item.id} style={[styles.itemBox, inCart && styles.itemBoxSelected]} onPress={() => addToCart(item)}><Text style={[styles.itemName, inCart && styles.itemNameSelected]} numberOfLines={2}>{item.name}</Text><View style={styles.itemFooter}><Text style={[styles.itemPrice, inCart && styles.itemPriceSelected]}>₹{item.price}</Text><View style={[styles.vegDot, { backgroundColor: item.isVeg ? '#16a34a' : '#dc2626' }]} /></View></TouchableOpacity>);
                  })}
                </ScrollView>
              </View>
            </View>
          </View>
          <View style={[styles.card, styles.rightCard]}>
            <View style={styles.cardTitleRow}><View style={styles.cardTitleDot} /><Text style={styles.cardTitle}>Pricing Details</Text></View>
            <View style={styles.formGrid}>
              {renderInput('Sub Total', subTotal.toFixed(2), null, '', 'default', false)}
              {renderInput('Delivery Charges', deliveryChargeInput, setDeliveryChargeInput, '0', 'numeric')}
              {renderInput('GST (1-100)%', gstPercent, setGstPercent, '0', 'numeric')}
              {renderInput('Discount (1-100)%', discountPercent, setDiscountPercent, '0', 'numeric')}
            </View>
            <View style={styles.totalBar}><Text style={styles.totalLabel}>AMOUNT TO COLLECT</Text><Text style={styles.totalValue}>₹ {totalAmount.toFixed(2)}</Text></View>
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => onNavigate('Dashboard')}><Text style={styles.cancelBtnText}>CANCEL</Text></TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={handlePlaceOrder}><Ionicons name="checkmark" size={16} color="white" /><Text style={styles.saveBtnText}>PLACE ORDER</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: 'white', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { width: 32, height: 32, borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  orderIdBadge: { fontSize: 11, fontWeight: '600', color: '#94a3b8', backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, borderWidth: 1, borderColor: '#e2e8f0' },
  scrollContent: { padding: 20 },
  mainLayout: { flexDirection: isWeb ? 'row' : 'column', flexWrap: 'wrap', gap: 20 },
  card: { backgroundColor: 'white', borderRadius: 8, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 20 },
  leftCard: { width: isWeb ? '48.5%' : '100%' },
  rightCard: { width: isWeb ? '48.5%' : '100%' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  cardTitleDot: { width: 3, height: 16, backgroundColor: '#0f172a', borderRadius: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  cartCountBadge: { backgroundColor: '#0f172a', width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginLeft: 4 },
  cartCountText: { color: 'white', fontSize: 10, fontWeight: '800' },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  inputGroup: { width: isWeb ? '30%' : '47%', marginBottom: 4, flexGrow: 1 },
  label: { fontSize: 11, fontWeight: '600', color: '#64748b', marginBottom: 5, letterSpacing: 0.3 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, paddingVertical: 9, paddingHorizontal: 11, fontSize: 13, color: '#0f172a', backgroundColor: '#f8fafc' },
  disabledInput: { backgroundColor: '#f1f5f9', color: '#94a3b8' },
  pickerBorder: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, backgroundColor: '#f8fafc', overflow: 'hidden' },
  picker: { height: 40, width: '100%' },
  radioSection: { flexDirection: 'row', gap: 24, marginTop: 16, flexWrap: 'wrap' },
  radioGroup: { gap: 8 },
  radioGroupLabel: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  radioRow: { flexDirection: 'row', gap: 16 },
  radioContainer: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  radioCircle: { height: 17, width: 17, borderRadius: 9, borderWidth: 2, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  radioCircleSelected: { borderColor: '#0f172a' },
  radioInnerCircle: { height: 9, width: 9, borderRadius: 5, backgroundColor: '#0f172a' },
  radioLabel: { fontSize: 13, color: '#64748b' },
  radioLabelSelected: { color: '#0f172a', fontWeight: '600' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f8fafc', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, marginBottom: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  th: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.7 },
  tableRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: '#f1f5f9', alignItems: 'center' },
  cartItemName: { fontSize: 13, color: '#0f172a', fontWeight: '500' },
  cartCell: { fontSize: 13, color: '#334155' },
  emptyCart: { alignItems: 'center', gap: 8, padding: 32 },
  emptyCartText: { color: '#94a3b8', fontSize: 13 },
  qtyBtn: { width: 24, height: 24, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  qtyBtnText: { fontSize: 14, color: '#0f172a', fontWeight: '700', lineHeight: 16 },
  qtyValue: { fontSize: 13, fontWeight: '700', color: '#0f172a', minWidth: 16, textAlign: 'center' },
  categorySidebar: { width: '30%', flex: 1, borderRightWidth: 1, borderColor: '#e2e8f0', paddingRight: 12 },
  sidebarHeading: { fontSize: 12, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  catItem: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 5, marginBottom: 2 },
  catItemActive: { backgroundColor: '#0f172a' },
  catText: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  catTextActive: { color: 'white', fontWeight: '700' },
  itemsPanel: { width: '70%', flex: 1, paddingLeft: 14 },
  itemGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  itemBox: { width: '47%', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, padding: 10, backgroundColor: 'white' },
  itemBoxSelected: { backgroundColor: '#38bdf8', borderColor: '#0ea5e9' },
  itemNameSelected: { color: '#ffffff', fontWeight: '700' },
  itemPriceSelected: { color: '#ffffff' },
  itemName: { fontSize: 12, fontWeight: '500', color: '#0f172a', marginBottom: 8, lineHeight: 16 },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemPrice: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  vegDot: { width: 9, height: 9, borderRadius: 5 },
  totalBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 7, paddingHorizontal: 16, paddingVertical: 14, marginTop: 16 },
  totalLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  totalValue: { fontSize: 18, fontWeight: '800', color: 'white' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: 16, backgroundColor: 'white', borderTopWidth: 1, borderColor: '#e2e8f0' },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  cancelBtnText: { color: '#64748b', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  saveBtn: { flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: '#0f172a', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  saveBtnText: { color: 'white', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});
