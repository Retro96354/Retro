import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

/* ---------- Design tokens: railway station signage ---------- */
const c = {
  board: '#12294D',      // station sign blue
  boardDeep: '#0B1A33',
  signal: '#FFC72C',     // signal yellow
  tomato: '#E24A2B',     // small accent only
  paper: '#F3F5F8',
  white: '#FFFFFF',
  ink: '#15233B',
  muted: '#55627A',
  line: '#D5DBE5',
  ok: '#2E9E6B',
};

const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' });
const mono = Platform.select({ ios: 'Courier', android: 'monospace', default: 'Courier New, monospace' });

/* ---------- Content ---------- */
const NAV_ITEMS = [
  { label: 'Home', key: 'overview' },
  { label: 'How it works', key: 'workflow' },
  { label: 'Features', key: 'features' },
  { label: 'Order sources', key: 'sources' },
  { label: 'FAQ', key: 'faq' },
];

const features = [
  ['All order mail, one place', 'Every order email from every platform lands in the Retro Foods dashboard, whatever format it arrives in.'],
  ['Orders at a glance', 'See train, item, quantity, customer and delivery details without opening a single email.'],
  ['Find any order fast', 'Search by platform, date, train number, item or status.'],
  ['Review flags', 'Duplicates, missing fields and unfamiliar formats are flagged before they cause trouble at delivery time.'],
  ['Clean exports', 'Download orders by platform or date range for reports, audits and accounts.'],
  ['No platform changes', 'No portal setup and no API access needed. If an order arrives by email, Retro Foods can read it.'],
];

const steps = [
  ['1', 'Order arrives by email', 'Platforms keep sending orders to the Retro Foods order mailbox, exactly as they do today.'],
  ['2', 'It is read automatically', 'Confirmations, invoices, tables, PDFs and plain-text emails are parsed as soon as they arrive.'],
  ['3', 'It appears on the board', 'Train, item, quantity, delivery details and status show up in the live dashboard.'],
  ['4', 'Check, flag, export', 'Search old orders, review mismatches and export records whenever accounts need them.'],
];

const sources = ['Platform 1', 'Platform 2', 'Platform 3', 'Platform 4', 'Platform 5', 'Platform 6', 'Platform 7', 'Platform 8', 'Platform 9', 'Any platform that emails orders'];

const faqs = [
  ['Which platforms are supported?', 'Any platform that sends orders by email. The dashboard is built around train food delivery order mail, including Yatri Restro and similar services.'],
  ['Do platforms need to change anything?', 'No. They keep emailing orders the way they already do. Retro Foods reads the connected order mailbox.'],
  ['What if an email looks unfamiliar?', 'The order is flagged for review so you can check it. Unfamiliar formats are never silently dropped.'],
  ['Can I export my records?', 'Yes. Export orders by platform, status or date range for reporting and accounts.'],
];

const stats = [
  ['5000+', 'Orders handled every month'],
  ['11000+', 'Orders saved'],
  ['90%', 'Of order entry automated'],
];

const BOARD_ROWS = [
  ['12951', 'Veg Thali', '2', 'Rajdhani Express'],
  ['22691', 'Chicken Biryani', '1', 'Rajdhani Express'],
  ['12627', 'Paneer Roll', '3', 'Karnataka Express'],
  ['16525', 'Masala Dosa', '2', 'Island Express'],
];
const BOARD_STATUS = ['Received', 'Preparing', 'Ready'];

const PRIVACY_SECTIONS = [
  ['Introduction', 'This Privacy Policy explains how Retro Foods ("Retro Foods", "we", "us" or "our") collects, uses, stores and protects information when you use the Retro Foods order management application (the "Service"). The Service was developed by Imperiial, an MSME-registered company, and connects to an email inbox designated by Retro Foods, identifies order-related emails, extracts order information and shows it in a searchable dashboard. By using the Service, you agree to the practices described here.'],
  ['Information We Collect', 'We collect only what is needed to run the Service: user names, mobile numbers, email addresses, login credentials, the App Password or other authentication details used to connect the designated inbox, and order information extracted from order-related emails.'],
  ['Email Access and Processing', 'The Service accesses an inbox designated and authorized by Retro Foods to identify order-related emails and extract order details. Email content may be processed temporarily to decide whether it is relevant. Only the order information needed for the dashboard is stored.'],
  ['Order Information We Store', 'Depending on the email, stored order information may include order ID, date, train or journey details, customer or passenger details, delivery information, items, quantity, amount, payment-related order details and order status.'],
  ['Information We Do Not Store', 'The Service does not intentionally store personal emails, personal conversations, banking emails or any other non-order content in the order database.'],
  ['How We Use Information', 'Information is used only to operate the Service: connecting the inbox, processing order emails, displaying and managing orders, providing search and reports, maintaining accounts and giving support.'],
  ['Email Account Credentials', 'Any App Password or authentication detail provided is used solely to establish and maintain the authorized email connection. It is never used for unrelated purposes, is protected with appropriate security measures and is not shown in the user interface.'],
  ['Sharing of Information', 'We do not sell or rent personal or order information, or share it for third-party marketing. Service providers who help operate and maintain the Service may access information where reasonably necessary. Information may also be disclosed where required by law or valid legal process.'],
  ['Order Platforms and Data Source', 'Order information comes only from order emails received in the authorized inbox. The Service does not access any order platform\'s account, app, website or API. Retro Foods and the Service are not affiliated with, endorsed by or officially partnered with any order platform unless expressly stated.'],
  ['Automated Processing', 'Orders are identified and extracted automatically. Errors or omissions can occur when an email is incomplete, unusually formatted or cannot be interpreted correctly. Important orders should be reviewed before they are relied on.'],
  ['Data Security', 'We take reasonable measures to protect information against unauthorized access, disclosure, alteration, loss or destruction, and restrict access to authorized systems and personnel. No electronic storage or transmission method can be guaranteed to be completely secure.'],
  ['Data Retention', 'Account and order information is kept as long as reasonably necessary to provide the Service and maintain order history. After a deletion request, information we are not required to keep is removed from active systems, subject to legal or legitimate business requirements.'],
  ['Email Disconnection', 'You may ask us to stop accessing the designated inbox. Once disconnected, no new emails are processed. Previously stored order information is handled according to this policy.'],
  ['Account and Data Deletion', 'You may request deletion of your account and associated information using the contact details below. Requests are processed within a reasonable period. Information may be retained where required by law or reasonably necessary for security, dispute-resolution or legal purposes.'],
  ['Your Rights', 'Subject to applicable law, you may request access to your information, correction of inaccurate information, deletion of information we are not required to keep, and disconnection of the authorized email account.'],
  ['Account Security', 'Keep your login credentials confidential and tell us promptly if you suspect unauthorized access. We are not responsible for activity resulting from credentials that were improperly disclosed or not protected, except where the law does not allow this limitation.'],
  ['Changes to This Policy', 'We may update this policy from time to time. The updated version will be published here with a new "Last updated" date.'],
  ['Contact Us', 'For questions, requests or complaints about this policy, contact us at +91 9175185122 / +91 7627073230 or visit https://imperiial.tech.'],
];

const TERMS_SECTIONS = [
  ['Acceptance of Terms', 'These Terms and Conditions ("Terms") govern your use of the Retro Foods order management application (the "Service"), operated by Retro Foods and developed and maintained by Imperiial. By creating an account or using the Service, you agree to these Terms. If you do not agree, please do not use the Service.'],
  ['About the Service', 'The Service helps Retro Foods organize order information received through an authorized email inbox. It processes relevant order emails and shows the extracted details in the dashboard.'],
  ['Account Registration', 'Provide accurate information when creating an account. You are responsible for keeping your login credentials secure and for all activity under your account. Contact us if you believe your account was accessed without permission.'],
  ['Email Access and Authorization', 'To use email processing, you authorize the Service to access the email account you provide. You confirm you have the right to grant that access. The access is used only to identify and process order-related emails.'],
  ['How Orders Are Processed', 'Order emails are identified and read automatically, and the extracted details are shown in the dashboard. Because email formats can change, extracted information may occasionally contain errors or missing details.'],
  ['User Responsibilities', 'You must provide correct account and email information and be authorized to connect the email account. You must not access another person\'s email account without permission, interfere with the Service, bypass security controls or use the Service unlawfully.'],
  ['Fees and Payment', 'Any applicable fee will be communicated before you use a paid feature. Unless agreed otherwise, fees must be paid under the payment terms communicated to you. Access to paid features may be suspended if payment is not made.'],
  ['Order Information', 'You are responsible for reviewing important order information before relying on it for business, financial or operational decisions.'],
  ['Privacy and Data', 'How information is collected, used, stored, secured and deleted is described in the Privacy Policy. By using the Service you agree to that processing.'],
  ['Service Availability', 'We make reasonable efforts to keep the Service running, but it may be interrupted by maintenance, technical problems, network issues or other circumstances. We do not guarantee uninterrupted or error-free operation.'],
  ['Intellectual Property', 'The software, design, interface, branding and technology of the Service belong to Imperiial or are used with the necessary rights. These Terms do not transfer ownership of any of it to you.'],
  ['Suspension or Termination', 'An account may be suspended or terminated for misuse, unauthorized access, violation of these Terms, non-payment or activity that may harm the Service or its users. You may also request termination of your account.'],
  ['Changes to These Terms', 'We may update these Terms from time to time. Updated Terms will be published in the app. Continued use after they take effect means you accept them.'],
  ['Contact Us', 'For questions about these Terms, contact us at +91 9175185122 / +91 7627073230 or visit https://imperiial.tech.'],
];

/* ---------- Screen ---------- */
export default function RetroFoodsLanding({ onLogin, onSignup }) {
  const { width } = useWindowDimensions();
  const small = width < 480;
  const isWide = width >= 940;
  const isTwoCol = width >= 760;
  const columns = width >= 1040 ? 3 : width >= 680 ? 2 : 1;

  const wrap = useMemo(
    () => [s.wrap, { paddingHorizontal: small ? 16 : width < 940 ? 22 : 32 }],
    [small, width]
  );
  const t = useMemo(
    () => ({
      display: { fontSize: small ? 34 : width < 940 ? 44 : 56, lineHeight: small ? 40 : width < 940 ? 52 : 64 },
      h2: { fontSize: small ? 26 : width < 940 ? 31 : 38, lineHeight: small ? 32 : width < 940 ? 38 : 46 },
      lead: { fontSize: small ? 16 : 18, lineHeight: small ? 25 : 29 },
    }),
    [small, width]
  );

  const scrollRef = useRef(null);
  const offsets = useRef({});
  const [modal, setModal] = useState(null);

  const reg = (key) => (e) => { offsets.current[key] = e.nativeEvent.layout.y; };
  const goTo = (key) => {
    const y = offsets.current[key];
    if (scrollRef.current && typeof y === 'number') scrollRef.current.scrollTo({ y: Math.max(y - 10, 0), animated: true });
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView ref={scrollRef} style={s.page}>
        {/* Header */}
        <View style={s.headerBar}>
          <View style={[wrap, s.header]}>
            <Brand />
            <View style={s.headerRight}>
              {isWide && (
                <View style={s.nav}>
                  {NAV_ITEMS.map((n) => (
                    <Pressable key={n.key} onPress={() => goTo(n.key)}>
                      <Text style={s.navText}>{n.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Btn label="Login" onPress={onLogin} variant="ghost" compact={!isWide} />
              <Btn label="Sign up" onPress={onSignup} variant="signal" compact={!isWide} />
            </View>
          </View>
        </View>

        {/* Hero: station signboard */}
        <View style={s.heroBand} onLayout={reg('overview')}>
          <View style={s.stripe} />
          <View style={[wrap, s.hero, isWide ? s.heroWide : s.heroStack]}>
            <View style={s.heroCopy}>
              <Text style={s.heroTag}>Train food orders, handled</Text>
              <Text style={[s.display, t.display]}>Every Retro Foods order, on one board.</Text>
              <Text style={[s.heroLead, t.lead]}>
                Orders reach our inbox from every platform. Retro Foods reads them, pulls out the details and puts them on a live board, so nobody has to copy and paste again.
              </Text>
              <View style={s.row}>
                <Btn label="Get started" onPress={onSignup} variant="signal" large />
                <Btn label="Login" onPress={onLogin} variant="light" large />
              </View>
            </View>
            <DepartureBoard compact={small} />
          </View>
          <View style={s.stripe} />
        </View>

        {/* Stats */}
        <View style={s.statsBand}>
          <View style={[wrap, s.statsRow, !isTwoCol && s.statsStack]}>
            {stats.map(([v, l]) => (
              <View key={l} style={s.stat}>
                <Text style={s.statValue}>{v}</Text>
                <Text style={s.statLabel}>{l}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* About */}
        <View style={s.section}>
          <View style={[wrap, isTwoCol ? s.twoCol : s.stackGap]}>
            <View style={s.half}>
              <Text style={[s.h2, t.h2]}>From a crowded inbox to a calm order desk.</Text>
            </View>
            <View style={[s.half, s.copyBlock]}>
              <Text style={s.body}>
                A train food order is time-critical: the right dish has to reach the right seat at the right station. Retro Foods does not ask the team to key orders in by hand. It reads the mailbox that already receives confirmations and invoices, and turns each email into a clean record.
              </Text>
              <Text style={s.body}>
                The result is fewer missed orders, quicker checks and handoffs, and a ledger that stays current as mail arrives.
              </Text>
            </View>
          </View>
        </View>

        {/* Workflow */}
        <View style={[s.section, s.sectionAlt]} onLayout={reg('workflow')}>
          <View style={wrap}>
            <Text style={[s.h2, t.h2]}>Four stops from inbox to kitchen.</Text>
            <View style={s.steps}>
              {steps.map(([n, title, text]) => (
                <View key={n} style={s.step}>
                  <View style={s.stepBadge}><Text style={s.stepNum}>{n}</Text></View>
                  <View style={s.stepBody}>
                    <Text style={s.cardTitle}>{title}</Text>
                    <Text style={s.body}>{text}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Features */}
        <View style={s.section} onLayout={reg('features')}>
          <View style={wrap}>
            <Text style={[s.h2, t.h2]}>Everything the team needs once the email arrives.</Text>
            <View style={s.grid}>
              {features.map(([title, text]) => (
                <View key={title} style={[s.featureCell, { width: `${100 / columns}%` }]}>
                  <View style={s.feature}>
                    <View style={s.featureMark} />
                    <Text style={s.cardTitle}>{title}</Text>
                    <Text style={s.small}>{text}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Sources */}
        <View style={[s.section, s.sectionAlt]} onLayout={reg('sources')}>
          <View style={[wrap, isTwoCol ? s.twoCol : s.stackGap]}>
            <View style={s.half}>
              <Text style={[s.h2, t.h2]}>Works with every platform that sends us orders.</Text>
            </View>
            <View style={s.half}>
              <View style={s.tags}>
                {sources.map((v) => <Text key={v} style={s.tag}>{v}</Text>)}
              </View>
              <Text style={s.body}>
                When a new email format shows up, it is flagged for review instead of getting lost in the inbox.
              </Text>
            </View>
          </View>
        </View>

        {/* FAQ */}
        <View style={s.section} onLayout={reg('faq')}>
          <View style={[wrap, isTwoCol ? s.twoCol : s.stackGap]}>
            <View style={s.half}>
              <Text style={[s.h2, t.h2]}>Quick answers.</Text>
            </View>
            <View style={[s.half, s.faqList]}>
              {faqs.map(([q, a]) => (
                <View key={q} style={s.faqItem}>
                  <Text style={s.cardTitle}>{q}</Text>
                  <Text style={s.body}>{a}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* CTA */}
        <View style={s.cta}>
          <View style={[wrap, s.ctaInner]}>
            <Text style={[s.ctaTitle, t.h2]}>See today's orders without digging through email.</Text>
            <Btn label="Sign up" onPress={onSignup} variant="signal" large />
          </View>
        </View>

        {/* Footer */}
        <View style={s.footerBand}>
          <View style={[wrap, s.footer, isWide ? s.footerWide : s.footerStack]}>
            <View style={s.footerBrand}>
              <Brand dark />
              <Text style={s.footerText}>Train food order emails, read and organized into one dashboard.</Text>
            </View>
            <View style={s.footerLinks}>
              {NAV_ITEMS.map((n) => (
                <Pressable key={n.key} onPress={() => goTo(n.key)}>
                  <Text style={s.footerLink}>{n.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.footerContact}>
              <Text style={s.footerHead}>Support</Text>
              <Pressable onPress={() => Linking.openURL('tel:+919175185122')}><Text style={s.phone}>+91 9175185122</Text></Pressable>
              <Pressable onPress={() => Linking.openURL('tel:+917627073230')}><Text style={s.phone}>+91 7627073230</Text></Pressable>
            </View>
          </View>
          <View style={[wrap, s.footerBottom, !isWide && s.footerBottomStack]}>
            <Text style={s.footerSmall}>© 2026 Retro Foods. Application built and maintained by Imperiial.</Text>
            <View style={s.legalLinks}>
              <Pressable onPress={() => setModal('privacy')}><Text style={s.legalLink}>Privacy Policy</Text></Pressable>
              <Pressable onPress={() => setModal('terms')}><Text style={s.legalLink}>Terms & Conditions</Text></Pressable>
              <Pressable onPress={() => Linking.openURL('https://imperiial.tech')}><Text style={s.legalLink}>imperiial.tech</Text></Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <LegalModal visible={modal === 'privacy'} title="Privacy Policy" sections={PRIVACY_SECTIONS} onClose={() => setModal(null)} />
      <LegalModal visible={modal === 'terms'} title="Terms & Conditions" sections={TERMS_SECTIONS} onClose={() => setModal(null)} />
    </SafeAreaView>
  );
}

/* ---------- Components ---------- */
function Brand({ dark }) {
  return (
    <View style={s.brand}>
      <View style={s.brandMark}><Text style={s.brandMarkText}>R</Text></View>
      <Text style={[s.wordmark, dark && { color: c.white }]}>Retro Foods</Text>
    </View>
  );
}

function Btn({ label, onPress, variant = 'signal', large, compact }) {
  const v = {
    signal: [s.btnSignal, s.btnTextDark],
    light: [s.btnLight, s.btnTextDark],
    ghost: [s.btnGhost, s.btnTextInk],
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.btn, large && s.btnLarge, compact && s.btnCompact, v[0], pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.btnText, v[1]]}>{label}</Text>
    </Pressable>
  );
}

// The one memorable element: a live departure-board style order feed.
function DepartureBoard({ compact }) {
  const [tick, setTick] = useState(0);
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 2200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.25, duration: 700, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);

  return (
    <View style={s.boardWrap}>
      <View style={s.board}>
        <View style={s.boardTop}>
          <Text style={s.boardTitle}>Orders today</Text>
          <View style={s.liveRow}>
            <Animated.View style={[s.liveDot, { opacity: blink }]} />
            <Text style={s.boardTitle}>Live</Text>
          </View>
        </View>
        <View style={s.boardHead}>
          <Text style={[s.bCell, s.bTrain, s.bHeadText]}>Train</Text>
          <Text style={[s.bCell, s.bItem, s.bHeadText]}>Item</Text>
          {!compact && <Text style={[s.bCell, s.bQty, s.bHeadText]}>Qty</Text>}
          <Text style={[s.bCell, s.bStatus, s.bHeadText]}>Status</Text>
        </View>
        {BOARD_ROWS.map(([train, item, qty], i) => {
          const status = BOARD_STATUS[(tick + i) % 3];
          const hot = status === 'Received';
          return (
            <View key={train} style={[s.boardRow, hot && s.boardRowHot]}>
              <Text style={[s.bCell, s.bTrain, s.bText]}>{train}</Text>
              <Text style={[s.bCell, s.bItem, s.bText]} numberOfLines={1}>{item}</Text>
              {!compact && <Text style={[s.bCell, s.bQty, s.bText]}>{qty}</Text>}
              <Text style={[s.bCell, s.bStatus, s.bText, status === 'Ready' && { color: '#7DE0AB' }]}>{status}</Text>
            </View>
          );
        })}
        <Text style={s.boardNote}>New order emails appear here as they arrive.</Text>
      </View>
    </View>
  );
}

function LegalModal({ visible, title, sections, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} style={s.modalClose} accessibilityRole="button">
              <Text style={s.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={s.modalBody} contentContainerStyle={s.modalBodyContent}>
            <Text style={s.modalUpdated}>Last updated: 6 September 2026</Text>
            {sections.map(([h, b]) => (
              <View key={h} style={s.modalSection}>
                <Text style={s.modalSectionTitle}>{h}</Text>
                <Text style={s.modalSectionText}>{b}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- Styles ---------- */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper },
  page: { flex: 1, backgroundColor: c.paper },
  wrap: { width: '100%', maxWidth: 1180, alignSelf: 'center' },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  half: { flex: 1 },

  /* header */
  headerBar: { backgroundColor: c.white, borderBottomWidth: 1, borderBottomColor: c.line },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.board, borderWidth: 3, borderColor: c.signal, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: c.white, fontFamily: serif, fontSize: 17, fontWeight: '700' },
  wordmark: { color: c.ink, fontFamily: serif, fontSize: 20, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nav: { flexDirection: 'row', gap: 22, marginRight: 14 },
  navText: { color: c.muted, fontSize: 14, fontWeight: '500' },

  /* buttons */
  btn: { minHeight: 44, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  btnLarge: { minHeight: 52, paddingHorizontal: 28 },
  btnCompact: { minHeight: 38, paddingHorizontal: 14 },
  btnSignal: { backgroundColor: c.signal, borderColor: c.signal },
  btnLight: { backgroundColor: c.white, borderColor: c.white },
  btnGhost: { backgroundColor: 'transparent', borderColor: c.board },
  btnText: { fontSize: 15, fontWeight: '700' },
  btnTextDark: { color: c.boardDeep },
  btnTextInk: { color: c.board },

  /* hero */
  heroBand: { backgroundColor: c.board },
  stripe: { height: 8, backgroundColor: c.signal },
  hero: { paddingTop: 64, paddingBottom: 72, gap: 48 },
  heroWide: { flexDirection: 'row', alignItems: 'center' },
  heroStack: { flexDirection: 'column' },
  heroCopy: { flex: 1 },
  heroTag: { color: c.signal, fontSize: 15, fontWeight: '600', marginBottom: 14 },
  display: { color: c.white, fontFamily: serif, fontWeight: '700', marginBottom: 22, maxWidth: 640 },
  heroLead: { color: '#C9D4E8', maxWidth: 560, marginBottom: 30 },

  /* departure board */
  boardWrap: { flex: 1, minWidth: 0 },
  board: { backgroundColor: c.boardDeep, borderRadius: 8, borderWidth: 3, borderColor: c.signal, padding: 18 },
  boardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#2A3F66' },
  boardTitle: { color: c.signal, fontFamily: mono, fontSize: 14, fontWeight: '700' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.tomato },
  boardHead: { flexDirection: 'row', paddingVertical: 10 },
  boardRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: '#1C3158', borderRadius: 4 },
  boardRowHot: { backgroundColor: '#1B3359' },
  bCell: { paddingRight: 8 },
  bTrain: { width: 64 },
  bItem: { flex: 1 },
  bQty: { width: 36 },
  bStatus: { width: 92 },
  bHeadText: { color: '#8FA3C7', fontFamily: mono, fontSize: 12 },
  bText: { color: c.white, fontFamily: mono, fontSize: 14 },
  boardNote: { color: '#8FA3C7', fontSize: 13, marginTop: 14 },

  /* stats */
  statsBand: { backgroundColor: c.white, borderBottomWidth: 1, borderBottomColor: c.line },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 44, gap: 24 },
  statsStack: { flexDirection: 'column' },
  stat: { flex: 1, borderLeftWidth: 4, borderLeftColor: c.signal, paddingLeft: 16 },
  statValue: { color: c.board, fontFamily: serif, fontSize: 38, fontWeight: '700' },
  statLabel: { color: c.muted, fontSize: 15, marginTop: 4 },

  /* sections */
  section: { paddingVertical: 88 },
  sectionAlt: { backgroundColor: c.white, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line },
  twoCol: { flexDirection: 'row', gap: 56, alignItems: 'flex-start' },
  stackGap: { gap: 24 },
  copyBlock: { gap: 18 },
  h2: { color: c.board, fontFamily: serif, fontWeight: '700', maxWidth: 620 },
  body: { color: c.muted, fontSize: 16, lineHeight: 26 },
  small: { color: c.muted, fontSize: 15, lineHeight: 24 },
  cardTitle: { color: c.ink, fontFamily: serif, fontSize: 19, fontWeight: '700', lineHeight: 25, marginBottom: 8 },

  /* steps */
  steps: { marginTop: 40, gap: 14 },
  step: { flexDirection: 'row', gap: 18, backgroundColor: c.paper, borderRadius: 8, borderWidth: 1, borderColor: c.line, padding: 22, alignItems: 'flex-start' },
  stepBadge: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.board, alignItems: 'center', justifyContent: 'center' },
  stepNum: { color: c.signal, fontFamily: serif, fontSize: 20, fontWeight: '700' },
  stepBody: { flex: 1 },

  /* features */
  grid: { marginTop: 40, flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
  featureCell: { padding: 8 },
  feature: { backgroundColor: c.white, borderRadius: 8, borderWidth: 1, borderColor: c.line, borderTopWidth: 5, borderTopColor: c.board, padding: 24, minHeight: 190 },
  featureMark: { width: 28, height: 6, borderRadius: 3, backgroundColor: c.signal, marginBottom: 18 },

  /* sources */
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },
  tag: { color: c.board, backgroundColor: c.paper, borderWidth: 1, borderColor: c.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, fontWeight: '500', overflow: 'hidden' },

  /* faq */
  faqList: { borderBottomWidth: 1, borderBottomColor: c.line },
  faqItem: { borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 22 },

  /* cta */
  cta: { backgroundColor: c.board, borderTopWidth: 8, borderTopColor: c.signal, paddingVertical: 80 },
  ctaInner: { alignItems: 'center', gap: 28 },
  ctaTitle: { color: c.white, textAlign: 'center' },

  /* footer */
  footerBand: { backgroundColor: c.boardDeep },
  footer: { paddingTop: 52, paddingBottom: 40, gap: 32 },
  footerWide: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  footerStack: { flexDirection: 'column' },
  footerBrand: { maxWidth: 340 },
  footerText: { color: '#9FB0CF', fontSize: 14, lineHeight: 22, marginTop: 14 },
  footerLinks: { gap: 12 },
  footerLink: { color: '#C9D4E8', fontSize: 14 },
  footerContact: { gap: 9 },
  footerHead: { color: c.signal, fontSize: 14, fontWeight: '700' },
  phone: { color: c.white, fontSize: 14 },
  footerBottom: { borderTopWidth: 1, borderTopColor: '#22385F', paddingVertical: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  footerBottomStack: { flexDirection: 'column', alignItems: 'flex-start' },
  footerSmall: { color: '#9FB0CF', fontSize: 13 },
  legalLinks: { flexDirection: 'row', gap: 18, flexWrap: 'wrap' },
  legalLink: { color: c.white, fontSize: 13, textDecorationLine: 'underline' },

  /* modal */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11,26,51,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 640, maxHeight: '85%', backgroundColor: c.white, borderRadius: 8, borderTopWidth: 6, borderTopColor: c.signal, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: c.line },
  modalTitle: { color: c.board, fontFamily: serif, fontSize: 20, fontWeight: '700' },
  modalClose: { paddingHorizontal: 10, paddingVertical: 6 },
  modalCloseText: { color: c.board, fontSize: 14, fontWeight: '700' },
  modalBody: { paddingHorizontal: 20 },
  modalBodyContent: { paddingVertical: 20, paddingBottom: 36 },
  modalUpdated: { color: c.muted, fontSize: 13, marginBottom: 20 },
  modalSection: { marginBottom: 22 },
  modalSectionTitle: { color: c.ink, fontFamily: serif, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  modalSectionText: { color: c.ink, fontSize: 14, lineHeight: 22 },
});
