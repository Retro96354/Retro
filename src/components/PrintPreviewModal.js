import React from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { receiptToPreviewLines } from '../services/PrintFormatter';

const ALIGN_MAP = { left: 'flex-start', center: 'center', right: 'flex-end' };

export default function PrintPreviewModal({ visible, receipt = [], printerName, printing = false, onPrint, onClose }) {
  const lines = receiptToPreviewLines(receipt);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Print Preview</Text>
          {printerName ? <Text style={styles.sub}>Printer: {printerName}</Text> : null}

          <ScrollView style={styles.paper} contentContainerStyle={styles.paperContent}>
            {lines.map((l, i) => (
              <View key={i} style={{ alignItems: ALIGN_MAP[l.align] || 'flex-start' }}>
                <Text style={[styles.line, l.bold && styles.bold, l.big && styles.big]}>{l.text}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.cancel]} onPress={onClose} disabled={printing}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.print]} onPress={onPrint} disabled={printing}>
              {printing ? <ActivityIndicator color="#fff" /> : <Text style={styles.printText}>Print</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const MONO = { fontFamily: 'Courier New, Courier, monospace' };

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, maxHeight: '90%', backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: '#111' },
  sub: { fontSize: 12, color: '#666', marginTop: 2, marginBottom: 8 },
  paper: { backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 8, marginVertical: 8 },
  paperContent: { padding: 12 },
  line: { ...MONO, fontSize: 13, color: '#111' },
  bold: { fontWeight: '700' },
  big: { fontSize: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  btn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, marginLeft: 8, minWidth: 90, alignItems: 'center' },
  cancel: { backgroundColor: '#f0f0f0' },
  cancelText: { color: '#333', fontWeight: '600' },
  print: { backgroundColor: '#1a73e8' },
  printText: { color: '#fff', fontWeight: '600' },
});
