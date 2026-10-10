import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, SectionList,
  StyleSheet, Modal, Animated, ScrollView, Dimensions, Platform,
} from 'react-native';
import { collection, addDoc, onSnapshot, deleteDoc, doc, query, where, updateDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
// Responsive hook
// ─────────────────────────────────────────────────────────────────────────────
const useIsWide = () => {
  const [isWide, setIsWide] = useState(Dimensions.get('window').width >= 700);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setIsWide(window.width >= 700);
    });
    return () => sub?.remove?.();
  }, []);
  return isWide;
};

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton Loader
// ─────────────────────────────────────────────────────────────────────────────
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
    <View style={[{
      flexDirection: 'row', paddingVertical: 18, paddingHorizontal: 16,
      borderBottomWidth: 1, borderBottomColor: '#f1f5f9', alignItems: 'center', gap: 12,
    }, alt && { backgroundColor: '#fafafa' }]}>
      <Box flex={0.6} /><Box flex={2} /><Box flex={1.4} /><Box flex={1} /><Box flex={1.2} /><Box flex={1.2} />
    </View>
  );
};
const SkeletonLoader = () => (
  <View>{Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} alt={i % 2 !== 0} />)}</View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
const Toast = ({ msg, type }) => {
  if (!msg) return null;
  const bg = type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : '#16a34a';
  return (
    <View style={{
      position: 'absolute', bottom: 28, left: '50%', transform: [{ translateX: -160 }],
      backgroundColor: bg, paddingHorizontal: 20, paddingVertical: 12,
      borderRadius: 10, zIndex: 9999, width: 320, shadowColor: '#000',
      shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
    }}>
      <Text style={{ color: 'white', fontWeight: '700', fontSize: 13, textAlign: 'center' }}>{msg}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// VegBadge
// ─────────────────────────────────────────────────────────────────────────────
const VegBadge = ({ isVeg, size = 22 }) => (
  <View style={{
    width: size, height: size, borderRadius: size / 2,
    backgroundColor: isVeg ? '#16a34a' : '#dc2626',
    justifyContent: 'center', alignItems: 'center',
  }}>
    <View style={{
      width: size * 0.4, height: size * 0.4, borderRadius: size * 0.2,
      backgroundColor: 'white',
    }} />
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// RadioGroup
// ─────────────────────────────────────────────────────────────────────────────
const RadioGroup = ({ value, onChange }) => (
  <View style={styles.radioRow}>
    {[{ label: 'Vegetarian', val: true }, { label: 'Non-Vegetarian', val: false }].map(opt => (
      <TouchableOpacity key={String(opt.val)} style={styles.radioOption} onPress={() => onChange(opt.val)}>
        <View style={[styles.radioOuter, value === opt.val && styles.radioOuterActive]}>
          {value === opt.val && <View style={styles.radioInner} />}
        </View>
        <VegBadge isVeg={opt.val} size={14} />
        <Text style={styles.radioLabel}>{opt.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function MenuScreen({ clientId }) {
  const isWide = useIsWide();

  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems]   = useState([]);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);

  // Toast
  const [toast, setToast] = useState({ msg: '', type: 'success' });
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: 'success' }), 3000);
  };

  // Add Category modal
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Add Menu Item modal
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [newItemName, setNewItemName]           = useState('');
  const [newItemPrice, setNewItemPrice]         = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isVeg, setIsVeg]                       = useState(true);

  // Edit Item modal
  const [editItemModalVisible, setEditItemModalVisible] = useState(false);
  const [editingItem, setEditingItem]                   = useState(null);
  const [editItemName, setEditItemName]                 = useState('');
  const [editItemPrice, setEditItemPrice]               = useState('');
  const [editItemCategory, setEditItemCategory]         = useState('');
  const [editItemIsVeg, setEditItemIsVeg]               = useState(true);

  // Edit Category modal
  const [editCatModalVisible, setEditCatModalVisible] = useState(false);
  const [editingCat, setEditingCat]                   = useState(null);
  const [editCatName, setEditCatName]                 = useState('');

  // Bulk Import modal
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importPreview, setImportPreview]           = useState(null); // { categories: [], items: [] }
  const [importFile, setImportFile]                 = useState(null);
  const [importing, setImporting]                   = useState(false);

  // ── Firebase ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!clientId) return;
    let catsLoaded = false, itemsLoaded = false;
    const catUnsub = onSnapshot(query(collection(db, 'categories'), where('clientId', '==', clientId)), (snap) => {
      const cats = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(cats);
      if (cats.length > 0 && !selectedCategory) setSelectedCategory(cats[0].id);
      catsLoaded = true;
      if (itemsLoaded) setLoading(false);
    });
    const menuUnsub = onSnapshot(query(collection(db, 'menuItems'), where('clientId', '==', clientId)), (snap) => {
      setMenuItems(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      itemsLoaded = true;
      if (catsLoaded) setLoading(false);
    });
    return () => { catUnsub(); menuUnsub(); };
  }, [clientId]);

  // ── Add Category ───────────────────────────────────────────────────────────
  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    await addDoc(collection(db, 'categories'), { name: newCategoryName.trim(), clientId });
    setNewCategoryName('');
    setCatModalVisible(false);
    showToast('Category added successfully');
  };

  // ── Add Menu Item ──────────────────────────────────────────────────────────
  const handleAddItem = async () => {
    if (!newItemName || !newItemPrice || !selectedCategory) return;
    await addDoc(collection(db, 'menuItems'), {
      name: newItemName.trim(),
      price: parseFloat(newItemPrice),
      categoryId: selectedCategory,
      isVeg,
      clientId,
    });
    setItemModalVisible(false);
    setNewItemName(''); setNewItemPrice(''); setIsVeg(true);
    showToast('Menu item added successfully');
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (col, id) => {
    try { await deleteDoc(doc(db, col, id)); showToast('Deleted successfully'); }
    catch (e) { showToast('Delete failed', 'error'); }
  };

  // ── Edit Item ──────────────────────────────────────────────────────────────
  const handleEditItem = (item) => {
    setEditingItem(item);
    setEditItemName(item.name);
    setEditItemPrice(String(item.price));
    setEditItemCategory(item.categoryId);
    setEditItemIsVeg(item.isVeg !== false);
    setEditItemModalVisible(true);
  };
  const handleSaveItem = async () => {
    if (!editItemName.trim() || !editItemPrice || !editingItem) return;
    await updateDoc(doc(db, 'menuItems', editingItem.id), {
      name: editItemName.trim(),
      price: parseFloat(editItemPrice),
      categoryId: editItemCategory,
      isVeg: editItemIsVeg,
    });
    setEditItemModalVisible(false); setEditingItem(null);
    showToast('Item updated');
  };

  // ── Edit Category ──────────────────────────────────────────────────────────
  const handleEditCategory = (cat) => {
    setEditingCat(cat); setEditCatName(cat.name); setEditCatModalVisible(true);
  };
  const handleSaveCategory = async () => {
    if (!editCatName.trim() || !editingCat) return;
    await updateDoc(doc(db, 'categories', editingCat.id), { name: editCatName.trim() });
    setEditCatModalVisible(false); setEditingCat(null);
    showToast('Category updated');
  };

  // ── Excel Import ───────────────────────────────────────────────────────────
  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      setImportFile(file);

      // Read & parse
      let base64;
      if (Platform.OS === 'web') {
        // Web: read via fetch blob
        const resp = await fetch(file.uri);
        const buf  = await resp.arrayBuffer();
        const wb   = XLSX.read(buf, { type: 'array' });
        parseWorkbook(wb);
      } else {
        base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        const wb = XLSX.read(base64, { type: 'base64' });
        parseWorkbook(wb);
      }
    } catch (e) {
      showToast('Failed to read file', 'error');
    }
  };

  const parseWorkbook = (wb) => {
    // Categories sheet
    const catSheet = wb.Sheets['Categories'];
    const parsedCats = [];
    if (catSheet) {
      const rows = XLSX.utils.sheet_to_json(catSheet, { header: 1, defval: '' });
      rows.slice(1).forEach(r => {
        const name = String(r[0] || '').trim();
        if (name && name !== '⚠ Note:') parsedCats.push(name);
      });
    }

    // Menu Items sheet
    const itemSheet = wb.Sheets['Menu Items'];
    const parsedItems = [];
    if (itemSheet) {
      const rows = XLSX.utils.sheet_to_json(itemSheet, { header: 1, defval: '' });
      rows.slice(1).forEach(r => {
        const name     = String(r[0] || '').trim();
        const catName  = String(r[1] || '').trim();
        const price    = parseFloat(r[2]);
        const vegRaw   = String(r[3] || '').trim().toLowerCase();
        if (!name || !catName || isNaN(price)) return;
        if (String(name).startsWith('⚠')) return;
        parsedItems.push({ name, categoryName: catName, price, isVeg: vegRaw !== 'nonveg' });
      });
    }

    if (parsedCats.length === 0 && parsedItems.length === 0) {
      showToast('No data found. Check sheet names match template.', 'error');
      return;
    }
    setImportPreview({ categories: parsedCats, items: parsedItems });
    setImportModalVisible(true);
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      // 1. Build map of existing category names → ids
      const existingCatMap = {};
      categories.forEach(c => { existingCatMap[c.name.toLowerCase()] = c.id; });

      // 2. Add new categories
      const newCatMap = { ...existingCatMap };
      for (const catName of importPreview.categories) {
        const key = catName.toLowerCase();
        if (!newCatMap[key]) {
          const ref = await addDoc(collection(db, 'categories'), { name: catName, clientId });
          newCatMap[key] = ref.id;
        }
      }

      // 3. Add items
      for (const item of importPreview.items) {
        const catId = newCatMap[item.categoryName.toLowerCase()];
        if (!catId) continue; // skip if category not found
        await addDoc(collection(db, 'menuItems'), {
          name: item.name,
          price: item.price,
          categoryId: catId,
          isVeg: item.isVeg,
          clientId,
        });
      }

      setImportModalVisible(false);
      setImportPreview(null);
      setImportFile(null);
      showToast(`Imported ${importPreview.categories.length} categories & ${importPreview.items.length} items`);
    } catch (e) {
      showToast('Import failed: ' + e.message, 'error');
    }
    setImporting(false);
  };

  // ── Download Menu as Excel ─────────────────────────────────────────────────
  const handleDownloadMenu = async () => {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: All Items
      const header = ['Sr. No.', 'Item Name', 'Category', 'Price (₹)', 'Type'];
      const rows = [header];
      let sr = 1;
      const grouped = {};
      menuItems.forEach(item => {
        const catName = categories.find(c => c.id === item.categoryId)?.name || 'Unknown';
        if (!grouped[catName]) grouped[catName] = [];
        grouped[catName].push(item);
      });
      Object.keys(grouped).sort().forEach(catName => {
        grouped[catName].forEach(item => {
          rows.push([sr++, item.name, catName, item.price, item.isVeg !== false ? 'Veg' : 'NonVeg']);
        });
      });
      const ws1 = XLSX.utils.aoa_to_sheet(rows);
      ws1['!cols'] = [{ wch: 8 }, { wch: 32 }, { wch: 22 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'Menu Items');

      // Sheet 2: Categories
      const catRows = [['Category Name', 'Item Count']];
      Object.keys(grouped).sort().forEach(cat => catRows.push([cat, grouped[cat].length]));
      const ws2 = XLSX.utils.aoa_to_sheet(catRows);
      ws2['!cols'] = [{ wch: 28 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Categories');

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

      if (Platform.OS === 'web') {
        const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'menu_export.xlsx'; a.click();
        URL.revokeObjectURL(url);
      } else {
        const path = FileSystem.documentDirectory + 'menu_export.xlsx';
        await FileSystem.writeAsStringAsync(path, wbout, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(path);
      }
      showToast('Menu exported successfully');
    } catch (e) {
      showToast('Export failed: ' + e.message, 'error');
    }
  };

  // ── Build sections ─────────────────────────────────────────────────────────
  const buildSections = () => {
    const filtered = menuItems.filter(item =>
      item.name?.toLowerCase().includes(search.toLowerCase())
    );
    const grouped = {};
    filtered.forEach(item => {
      const catName = categories.find(c => c.id === item.categoryId)?.name || 'Unknown';
      if (!grouped[catName]) grouped[catName] = [];
      grouped[catName].push(item);
    });
    return Object.keys(grouped).sort((a, b) => a.localeCompare(b))
      .map(catName => ({ title: catName, data: grouped[catName] }));
  };
  const sections = buildSections();

  const buildSerialMap = () => {
    const map = {}; let counter = 1;
    sections.forEach(sec => sec.data.forEach(item => { map[item.id] = counter++; }));
    return map;
  };
  const serialMap = buildSerialMap();

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>

      {/* ── Page Header ── */}
      <View style={[styles.pageHeader, !isWide && { marginBottom: 12 }]}>
        <View>
          <Text style={[styles.pageTitle, !isWide && { fontSize: 18 }]}>Menu Management</Text>
          <Text style={styles.pageSub}>{categories.length} categories · {menuItems.length} items</Text>
        </View>
        {/* Download button in header on wide */}
        {isWide && (
          <TouchableOpacity style={styles.downloadBtn} onPress={handleDownloadMenu}>
            <Ionicons name="download-outline" size={16} color="white" />
            <Text style={styles.downloadBtnText}>EXPORT MENU</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Action Bar ── */}
      <View style={[styles.actionBar, !isWide && styles.actionBarMobile]}>
        <View style={[styles.searchBox, !isWide && { flex: 1 }]}>
          <Ionicons name="search-outline" size={15} color="#94a3b8" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search items..."
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <View style={[{ flexDirection: 'row', gap: 8 }, !isWide && { flexWrap: 'wrap' }]}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => {
            if (categories.length > 0) setItemModalVisible(true);
          }}>
            <Ionicons name="add" size={15} color="white" />
            <Text style={styles.actionBtnText}>{isWide ? 'MENU ITEM' : 'ITEM'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setCatModalVisible(true)}>
            <Ionicons name="add" size={15} color="white" />
            <Text style={styles.actionBtnText}>{isWide ? 'CATEGORY' : 'CAT'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#0369a1' }]} onPress={handlePickFile}>
            <Ionicons name="cloud-upload-outline" size={15} color="white" />
            <Text style={styles.actionBtnText}>{isWide ? 'IMPORT EXCEL' : 'IMPORT'}</Text>
          </TouchableOpacity>
          {!isWide && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#065f46' }]} onPress={handleDownloadMenu}>
              <Ionicons name="download-outline" size={15} color="white" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Table (wide) / Card list (mobile) ── */}
      {isWide ? (
        <View style={styles.tableWrapper}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 0.5 }]}>#</Text>
            <Text style={[styles.th, { flex: 2 }]}>Item Name</Text>
            <Text style={[styles.th, { flex: 1.4 }]}>Category</Text>
            <Text style={[styles.th, { flex: 1 }]}>Price</Text>
            <Text style={[styles.th, { flex: 1 }]}>Type</Text>
            <Text style={[styles.th, { flex: 1.2 }]}>Actions</Text>
          </View>
          {loading ? <SkeletonLoader /> : (
            <SectionList
              sections={sections}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 40 }}
              stickySectionHeadersEnabled
              renderSectionHeader={({ section }) => {
                const cat = categories.find(c => c.name === section.title);
                return (
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionCategoryBadge}>
                      <Text style={styles.sectionCategoryText}>{section.title}</Text>
                    </View>
                    <View style={styles.sectionDividerLine} />
                    <Text style={styles.sectionCount}>{section.data.length} item{section.data.length !== 1 ? 's' : ''}</Text>
                    {cat && (
                      <TouchableOpacity style={styles.catEditBtn} onPress={() => handleEditCategory(cat)}>
                        <Ionicons name="pencil" size={12} color="#475569" />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }}
              renderItem={({ item, index }) => {
                const catName = categories.find(c => c.id === item.categoryId)?.name || 'Unknown';
                const veg = item.isVeg !== false;
                return (
                  <View style={[styles.tableRow, index % 2 !== 0 && styles.tableRowAlt]}>
                    <Text style={[styles.td, { flex: 0.5 }]}>{serialMap[item.id]}</Text>
                    <Text style={[styles.td, styles.tdBold, { flex: 2 }]}>{item.name}</Text>
                    <Text style={[styles.td, { flex: 1.4 }]}>{catName}</Text>
                    <Text style={[styles.td, styles.tdBold, { flex: 1 }]}>₹{item.price}</Text>
                    <View style={[styles.tdCell, { flex: 1 }]}>
                      <VegBadge isVeg={veg} />
                      <Text style={{ fontSize: 11, color: veg ? '#16a34a' : '#dc2626', fontWeight: '700' }}>
                        {veg ? 'VEG' : 'NON-VEG'}
                      </Text>
                    </View>
                    <View style={[styles.tdCell, { flex: 1.2, gap: 8 }]}>
                      <TouchableOpacity style={styles.editBtn} onPress={() => handleEditItem(item)}>
                        <Ionicons name="pencil" size={13} color="white" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete('menuItems', item.id)}>
                        <Ionicons name="trash" size={13} color="white" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyRow}>
                  <Ionicons name="restaurant-outline" size={28} color="#cbd5e1" />
                  <Text style={styles.emptyText}>No menu items yet. Click + MENU ITEM to add one.</Text>
                </View>
              }
            />
          )}
        </View>
      ) : (
        /* ── Mobile Card List ── */
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {loading ? <SkeletonLoader /> : sections.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="restaurant-outline" size={28} color="#cbd5e1" />
              <Text style={styles.emptyText}>No menu items yet.</Text>
            </View>
          ) : sections.map(section => (
            <View key={section.title}>
              <View style={styles.mobileSectionHeader}>
                <View style={styles.sectionCategoryBadge}>
                  <Text style={styles.sectionCategoryText}>{section.title}</Text>
                </View>
                <Text style={styles.sectionCount}>{section.data.length} items</Text>
                {(() => {
                  const cat = categories.find(c => c.name === section.title);
                  return cat ? (
                    <TouchableOpacity style={styles.catEditBtn} onPress={() => handleEditCategory(cat)}>
                      <Ionicons name="pencil" size={12} color="#475569" />
                    </TouchableOpacity>
                  ) : null;
                })()}
              </View>
              {section.data.map((item, idx) => {
                const veg = item.isVeg !== false;
                return (
                  <View key={item.id} style={[styles.mobileCard, idx % 2 !== 0 && { backgroundColor: '#fafafa' }]}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <VegBadge isVeg={veg} size={16} />
                        <Text style={styles.mobileItemName}>{item.name}</Text>
                      </View>
                      <Text style={styles.mobileItemMeta}>₹{item.price} · {veg ? 'Veg' : 'Non-Veg'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={styles.editBtn} onPress={() => handleEditItem(item)}>
                        <Ionicons name="pencil" size={13} color="white" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete('menuItems', item.id)}>
                        <Ionicons name="trash" size={13} color="white" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Toast ── */}
      <Toast msg={toast.msg} type={toast.type} />

      {/* ── Add Category Modal ── */}
      <Modal visible={catModalVisible} transparent animationType="fade" onRequestClose={() => setCatModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <ModalHeader title="Add Category" onClose={() => { setCatModalVisible(false); setNewCategoryName(''); }} />
            <Text style={styles.fieldLabel}>Category Name</Text>
            <TextInput style={styles.fieldInput} placeholder="Category Name" placeholderTextColor="#b0b8c9"
              value={newCategoryName} onChangeText={setNewCategoryName} />
            <ModalFooter
              onCancel={() => { setCatModalVisible(false); setNewCategoryName(''); }}
              onConfirm={handleAddCategory}
              confirmLabel="ADD"
              disabled={!newCategoryName.trim()}
            />
          </View>
        </View>
      </Modal>

      {/* ── Add Menu Item Modal ── */}
      <Modal visible={itemModalVisible} transparent animationType="fade" onRequestClose={() => setItemModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { maxWidth: 500 }]}>
            <ModalHeader title="Add Menu Item" onClose={() => { setItemModalVisible(false); setNewItemName(''); setNewItemPrice(''); setIsVeg(true); }} />

            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={selectedCategory} onValueChange={v => setSelectedCategory(v)} style={styles.picker}>
                <Picker.Item label="Select Category" value="" color="#b0b8c9" />
                {categories.map(cat => <Picker.Item key={cat.id} label={cat.name} value={cat.id} />)}
              </Picker>
            </View>

            <Text style={styles.fieldLabel}>Item Type</Text>
            <RadioGroup value={isVeg} onChange={setIsVeg} />

            <Text style={styles.fieldLabel}>Item Name</Text>
            <TextInput style={styles.fieldInput} placeholder="Item Name" placeholderTextColor="#b0b8c9"
              value={newItemName} onChangeText={setNewItemName} />

            <Text style={styles.fieldLabel}>Item Price (₹)</Text>
            <TextInput style={[styles.fieldInput, { width: '50%' }]} placeholder="0.00" placeholderTextColor="#b0b8c9"
              keyboardType="numeric" value={newItemPrice} onChangeText={setNewItemPrice} />

            <ModalFooter
              onCancel={() => { setItemModalVisible(false); setNewItemName(''); setNewItemPrice(''); setIsVeg(true); }}
              onConfirm={handleAddItem}
              confirmLabel="ADD"
              disabled={!newItemName.trim() || !newItemPrice || !selectedCategory}
            />
          </View>
        </View>
      </Modal>

      {/* ── Edit Menu Item Modal ── */}
      <Modal visible={editItemModalVisible} transparent animationType="fade" onRequestClose={() => setEditItemModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { maxWidth: 500 }]}>
            <ModalHeader title="Edit Menu Item" onClose={() => { setEditItemModalVisible(false); setEditingItem(null); }} />

            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={editItemCategory} onValueChange={v => setEditItemCategory(v)} style={styles.picker}>
                {categories.map(cat => <Picker.Item key={cat.id} label={cat.name} value={cat.id} />)}
              </Picker>
            </View>

            <Text style={styles.fieldLabel}>Item Type</Text>
            <RadioGroup value={editItemIsVeg} onChange={setEditItemIsVeg} />

            <Text style={styles.fieldLabel}>Item Name</Text>
            <TextInput style={styles.fieldInput} placeholder="Item Name" placeholderTextColor="#b0b8c9"
              value={editItemName} onChangeText={setEditItemName} />

            <Text style={styles.fieldLabel}>Item Price (₹)</Text>
            <TextInput style={[styles.fieldInput, { width: '50%' }]} placeholder="0.00" placeholderTextColor="#b0b8c9"
              keyboardType="numeric" value={editItemPrice} onChangeText={setEditItemPrice} />

            <ModalFooter
              onCancel={() => { setEditItemModalVisible(false); setEditingItem(null); }}
              onConfirm={handleSaveItem}
              confirmLabel="SAVE"
              disabled={!editItemName.trim() || !editItemPrice}
            />
          </View>
        </View>
      </Modal>

      {/* ── Edit Category Modal ── */}
      <Modal visible={editCatModalVisible} transparent animationType="fade" onRequestClose={() => setEditCatModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <ModalHeader title="Edit Category" onClose={() => { setEditCatModalVisible(false); setEditingCat(null); }} />
            <Text style={styles.fieldLabel}>Category Name</Text>
            <TextInput style={styles.fieldInput} placeholder="Category Name" placeholderTextColor="#b0b8c9"
              value={editCatName} onChangeText={setEditCatName} />
            <ModalFooter
              onCancel={() => { setEditCatModalVisible(false); setEditingCat(null); }}
              onConfirm={handleSaveCategory}
              confirmLabel="SAVE"
              disabled={!editCatName.trim()}
            />
          </View>
        </View>
      </Modal>

      {/* ── Bulk Import Preview Modal ── */}
      <Modal visible={importModalVisible} transparent animationType="fade" onRequestClose={() => setImportModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { maxWidth: 560, maxHeight: '80%' }]}>
            <ModalHeader title="Import Preview" onClose={() => { setImportModalVisible(false); setImportPreview(null); }} />

            {importPreview && (
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                {/* Categories */}
                {importPreview.categories.length > 0 && (
                  <View style={styles.importSection}>
                    <Text style={styles.importSectionTitle}>
                      <Ionicons name="folder-outline" size={13} /> Categories ({importPreview.categories.length})
                    </Text>
                    {importPreview.categories.map((c, i) => (
                      <View key={i} style={styles.importRow}>
                        <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
                        <Text style={styles.importRowText}>{c}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Items */}
                {importPreview.items.length > 0 && (
                  <View style={styles.importSection}>
                    <Text style={styles.importSectionTitle}>
                      <Ionicons name="restaurant-outline" size={13} /> Menu Items ({importPreview.items.length})
                    </Text>
                    {importPreview.items.map((item, i) => (
                      <View key={i} style={[styles.importRow, i % 2 !== 0 && { backgroundColor: '#f8fafc' }]}>
                        <VegBadge isVeg={item.isVeg} size={14} />
                        <Text style={[styles.importRowText, { flex: 1 }]}>{item.name}</Text>
                        <Text style={styles.importRowMeta}>{item.categoryName}</Text>
                        <Text style={[styles.importRowMeta, { fontWeight: '700' }]}>₹{item.price}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}

            <View style={[styles.importNote, { marginTop: 12 }]}>
              <Ionicons name="information-circle-outline" size={14} color="#0369a1" />
              <Text style={styles.importNoteText}>
                New categories will be created. Existing categories won't be duplicated.
              </Text>
            </View>

            <ModalFooter
              onCancel={() => { setImportModalVisible(false); setImportPreview(null); }}
              onConfirm={handleConfirmImport}
              confirmLabel={importing ? 'IMPORTING...' : 'IMPORT ALL'}
              disabled={importing}
            />
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Modal sub-components
// ─────────────────────────────────────────────────────────────────────────────
const ModalHeader = ({ title, onClose }) => (
  <>
    <View style={styles.modalTop}>
      <Text style={styles.modalTitle}>{title}</Text>
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>×</Text>
      </TouchableOpacity>
    </View>
    <View style={styles.divider} />
  </>
);

const ModalFooter = ({ onCancel, onConfirm, confirmLabel, disabled }) => (
  <View style={styles.modalFooter}>
    <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
      <Text style={styles.cancelBtnText}>CANCEL</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.addBtn, disabled && styles.addBtnDisabled]}
      onPress={onConfirm}
      disabled={disabled}
    >
      <Text style={styles.addBtnText}>{confirmLabel}</Text>
    </TouchableOpacity>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f5f9', padding: 20 },

  // Header
  pageHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  pageTitle:   { fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.3 },
  pageSub:     { fontSize: 13, color: '#94a3b8', marginTop: 3, fontWeight: '500' },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#065f46', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8 },
  downloadBtnText: { color: 'white', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },

  // Action Bar
  actionBar:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  actionBarMobile: { flexWrap: 'wrap', gap: 8 },
  searchBox:  { width: 200, flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a', outlineStyle: 'none' },
  actionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  actionBtnText: { color: 'white', fontWeight: '700', fontSize: 12, letterSpacing: 0.4 },

  // Table (wide)
  tableWrapper: { flex: 1, backgroundColor: 'white', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  tableHeader:  { flexDirection: 'row', backgroundColor: '#111827', paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  th:  { fontSize: 11, fontWeight: '700', color: 'white', textAlign: 'center', letterSpacing: 0.4 },
  tableRow:    { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', alignItems: 'center' },
  tableRowAlt: { backgroundColor: '#fafafa' },
  td:     { fontSize: 13, color: '#374151', textAlign: 'center' },
  tdBold: { fontWeight: '700', color: '#111827' },
  tdCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },

  // Section header
  sectionHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderTopWidth: 1, borderColor: '#e2e8f0', gap: 10 },
  sectionCategoryBadge: { backgroundColor: '#111827', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  sectionCategoryText:  { fontSize: 11, fontWeight: '800', color: 'white', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionDividerLine:   { flex: 1, height: 1, backgroundColor: '#cbd5e1' },
  sectionCount: { fontSize: 11, fontWeight: '600', color: '#94a3b8' },
  catEditBtn: { width: 28, height: 28, borderRadius: 6, backgroundColor: 'white', borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center' },

  // Mobile cards
  mobileSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4, marginTop: 8 },
  mobileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  mobileItemName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  mobileItemMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },

  // Row buttons
  editBtn:   { width: 30, height: 30, borderRadius: 15, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center' },
  deleteBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center' },

  emptyRow:  { paddingVertical: 50, alignItems: 'center', gap: 10 },
  emptyText: { color: '#94a3b8', fontSize: 14, textAlign: 'center' },

  // Modal
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard:  { backgroundColor: 'white', borderRadius: 12, padding: 24, width: '100%', maxWidth: 420, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  modalTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  closeBtn:   { width: 30, height: 30, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  closeBtnText: { fontSize: 18, color: '#374151', lineHeight: 20 },
  divider:    { height: 1, backgroundColor: '#e2e8f0', marginBottom: 18 },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 6, letterSpacing: 0.3 },
  fieldInput: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, fontSize: 14, color: '#0f172a', backgroundColor: '#f8fafc', marginBottom: 14, outlineStyle: 'none' },

  pickerWrap: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, backgroundColor: '#f8fafc', overflow: 'hidden', marginBottom: 14 },
  picker:     { height: 46, width: '100%' },

  radioRow:    { flexDirection: 'row', gap: 20, marginBottom: 14, flexWrap: 'wrap' },
  radioOption: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radioOuter:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#cbd5e1', justifyContent: 'center', alignItems: 'center' },
  radioOuterActive: { borderColor: '#374151' },
  radioInner:       { width: 9, height: 9, borderRadius: 5, backgroundColor: '#374151' },
  radioLabel:       { fontSize: 13, color: '#374151', fontWeight: '600' },

  modalFooter:   { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
  cancelBtn:     { backgroundColor: '#9f1239', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  cancelBtnText: { color: 'white', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },
  addBtn:        { backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  addBtnDisabled:{ opacity: 0.45 },
  addBtnText:    { color: 'white', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },

  // Import modal
  importSection:     { marginBottom: 16 },
  importSectionTitle:{ fontSize: 12, fontWeight: '800', color: '#0f172a', letterSpacing: 0.4, marginBottom: 8, textTransform: 'uppercase' },
  importRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
  importRowText:     { fontSize: 13, color: '#374151', fontWeight: '600' },
  importRowMeta:     { fontSize: 12, color: '#64748b' },
  importNote:        { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#eff6ff', borderRadius: 8, padding: 10 },
  importNoteText:    { fontSize: 12, color: '#1e40af', flex: 1, lineHeight: 17 },
});
