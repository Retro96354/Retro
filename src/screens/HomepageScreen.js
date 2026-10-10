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

const colors = {
  ink: '#121212',
  paper: '#FAFAFA',
  mist: '#F0F0EE',
  line: '#DCDCDA',
  graphite: '#5A5A57',
  stamp: '#0B0B0B',
  white: '#FFFFFF',
};

const vendors = [
  'Vendor 1',
  'Vendor 2',
  'Vendor 3',
  'Vendor 4',
  'Vendor 5',
  'Vendor 6',
  'Vendor 7',
  'Vendor 8',
  'Vendor 9',
  'Any email vendor',
];

const features = [
  ['Vendor mail intake', 'Bring every order email into one system, even when each vendor uses a different format.'],
  ['Structured dashboard', 'See vendor, train, item, quantity, customer and delivery details without opening raw emails.'],
  ['Fast order search', 'Look up records by vendor, date, train number, item or status in seconds.'],
  ['Review flags', 'Catch duplicates, missing fields and unknown formats before they become end-of-day cleanup.'],
  ['Clean exports', 'Download order records by vendor or date range for reporting, audits and accounting.'],
  ['No vendor setup', 'No portal changes, no vendor training and no API requests. If they email orders, Migme can read them.'],
];

const steps = [
  ['01', 'Connect the order inbox', 'Use the mailbox or alias where vendors already send orders. Vendor behavior stays exactly the same.'],
  ['02', 'Parse each order automatically', 'Migme reads confirmations, invoices, tables, PDFs and plain text emails as they arrive.'],
  ['03', 'Review the live dashboard', 'Orders appear with vendor, train, item, quantity, delivery details and status in a clean operating view.'],
  ['04', 'Search, flag and export', 'Find old orders, catch duplicates, review mismatches and export records whenever accounting needs them.'],
];

const faqs = [
  ['Which vendors does Migme work with?', 'Any vendor that sends orders by email. Migme is built for train food delivery order mail from platforms like Vendor 1, Vendor 2, Vendor 3, Yatri Restro and similar vendors.'],
  ['Does it change how vendors send orders?', 'No. Vendors keep sending emails the way they already do. Migme works on your side by reading the connected order mailbox.'],
  ['What happens when an email format is unclear?', 'Migme flags the order for review so your team can check it. Unknown formats are not silently ignored.'],
  ['Can the team export records?', 'Yes. You can export order records by vendor, status or date range for reporting and accounting work.'],
];

const NAV_ITEMS = [
  { label: 'Overview', key: 'overview' },
  { label: 'Workflow', key: 'workflow' },
  { label: 'Features', key: 'features' },
  { label: 'Vendors', key: 'vendors' },
  { label: 'FAQ', key: 'faq' },
];

const stats = [
  { icon: 'box', value: '5000+', label: 'Monthly Order Processing' },
  { icon: 'list', value: '11000+', label: 'Saved Orders' },
  { icon: 'target', value: '90%', label: 'Business Automation' },
];

const PRIVACY_SECTIONS = [

  ['Introduction', 'This Privacy Policy explains how Imperiial ("Imperiial", "we", "us" or "our"), an MSME-registered company, collects, uses, stores, and protects information when you use Migme (the "Service"). Migme is a billing and order management software product owned and operated by Imperiial. Migme connects to an email inbox designated and authorized by the customer, identifies order-related emails, extracts relevant order information, and presents that information through a searchable dashboard. By using Migme, you acknowledge and agree to the practices described in this Privacy Policy.'],
  ['Information We Collect','We collect only the information reasonably required to provide the Migme Service. This may include your name, business or restaurant name, mobile number, email address, Migme login credentials, the App Password or other authentication information provided by you for connecting your designated email inbox, and order information extracted from your order-related emails.'],
  ['Email Access and Processing','To provide the Service, Migme requires access to an email inbox designated and authorized by you. You authorize Migme to access and process emails from that inbox for the purpose of identifying order-related emails and extracting relevant order information. Email content may be temporarily processed while determining whether an email is relevant to the Service. Migme stores the order information required to provide the dashboard and order-management functionality.'],
  ['Order Information We Store','Migme stores information extracted from order-related emails that is necessary for providing the Service. Depending on the information contained in an order email, this may include order ID, order date, train or journey information, passenger or customer details, delivery information, ordered items, quantity, amount, payment-related order information, order status, and other information relevant to managing the order.'],
  ['Information We Do Not Store','Migme does not intentionally store unrelated personal emails, personal conversations, banking emails, or other non-order email content in the Migme order database. If an email is not relevant to an order, it is not intentionally stored as order data.'],
  ['How We Use Information','We use the information collected from you and your authorized email inbox only for providing and operating Migme. This includes connecting your designated email inbox, identifying and processing order-related emails, extracting order information, displaying and managing orders through the Migme dashboard, providing search and reporting functionality, maintaining your account, and providing customer support.'],
  ['Email Account Credentials','If you provide an email-account App Password or other authentication information to connect your designated email inbox to Migme, that information is used solely for establishing and maintaining the authorized email connection required for the Service. We do not use your email-account credentials for unrelated purposes. Sensitive authentication information is protected using appropriate security measures and is not intentionally displayed through the Migme user interface.'],
  ['Sharing of Information','We do not sell, rent, or otherwise provide your personal information or order information to third parties for their own marketing purposes. Information may be accessed by service providers used by Imperiial where reasonably necessary to operate and maintain the Migme Service. We may also disclose information where required by applicable law, regulation, court order, government authority, or other valid legal process.'],
  ['Vendor Relationship and Data Source','Migme processes order-related emails received in the email inbox authorized by the customer. Migme does not obtain order information by directly accessing a vendor account, vendor application, vendor website, or vendor API for the email-processing functionality described in this Privacy Policy. Migme does not claim to be affiliated with, endorsed by, sponsored by, or officially partnered with any vendor whose order-related emails may be processed through the Service, unless such relationship is expressly stated by Imperiial.'],
  ['Automated Processing','Migme uses automated processing to identify relevant order emails and extract and organize order information. Automated processing is used to provide the Service and may produce errors or omissions where an email contains incomplete information, an unexpected format, or information that cannot be correctly interpreted.'],
  ['Data Security','We take reasonable measures to protect your information against unauthorized access, disclosure, alteration, loss, or destruction. Sensitive information, including email authentication information and order data, is protected using appropriate security measures. Access to sensitive information is restricted to authorized systems and personnel where necessary to operate the Service. However, no electronic storage or transmission system can be guaranteed to be completely secure.'],
  ['Data Retention','We retain your account and order information for as long as reasonably necessary to provide the Migme Service and maintain your order history. When you request deletion of your account, information that we are not required to retain will be deleted or otherwise removed from our active systems, subject to applicable legal or legitimate business requirements.'],
  ['Email Disconnection','You may request that Migme stop accessing your designated email inbox. After the email connection is disconnected, Migme will stop using that connection to process new emails. Previously stored order information will continue to be handled according to this Privacy Policy and applicable deletion and retention requirements.'],
  ['Account and Data Deletion','You may request deletion of your Migme account and associated information by contacting Imperiial using the contact details provided in this Privacy Policy. We will process the request within a reasonable period. Information that we are not required to retain will be deleted. Information may be retained where required by applicable law or where reasonably necessary for legitimate business, security, dispute-resolution, or legal purposes.'],
  ['User Rights','Subject to applicable law, you may request access to information associated with your Migme account, correction of inaccurate information, deletion of information that we are not required to retain, and disconnection of your authorized email account. You may also withdraw your authorization for email processing where applicable. Requests may be submitted using the contact details provided in this Privacy Policy.'],
  ['Account Security','You are responsible for maintaining the confidentiality of your Migme login credentials and should notify Imperiial promptly if you suspect unauthorized access to your account. Imperiial is not responsible for unauthorized activity resulting from credentials that a customer has improperly disclosed or failed to protect, except to the extent such limitation is not permitted by applicable law.'],
  ['Changes to This Privacy Policy','We may update this Privacy Policy from time to time to reflect changes to the Migme Service, our data practices, or applicable requirements. The updated version will be published on this page with an updated "Last Updated" date. Where appropriate, material changes may also be communicated to registered customers.'],
  ['Contact Us','For questions, concerns, requests, or complaints regarding this Privacy Policy or the handling of your information, you may contact Imperiial at +91 9175185122 / +91 7627073230 or visit https://imperiial.tech.']
];

const TERMS_SECTIONS = [

  ['Acceptance of Terms','These Terms and Conditions ("Terms") govern your use of Migme, a SaaS billing and order management service owned and operated by Imperiial ("Imperiial", "we", "us", or "our"). By creating an account or using Migme, you agree to these Terms. If you do not agree with these Terms, please do not use the Service.'],
  ['About Migme','Migme is a billing and order management software that helps businesses organize order information received through their authorized email inbox. Migme processes relevant order emails and displays the extracted order information through the Migme dashboard.'],
  ['Account Registration','You must provide accurate information when creating your Migme account. You are responsible for keeping your Migme login credentials secure and for all activity performed through your account. If you believe that your account has been accessed without your permission, you should contact Imperiial.'],
  ['Email Access and Authorization','To use the email-processing features of Migme, you authorize Migme to access the email account provided by you. You confirm that you have the right and permission to provide access to that email account. Migme uses this access to identify and process order-related emails required to provide the Service.'],
  ['How Migme Processes Order Emails','Migme automatically identifies order-related emails and extracts relevant order information from them. The extracted information is organized and displayed in your Migme dashboard. Because email formats and information may change, the extracted information may occasionally contain errors or missing details.'],
  ['Customer Responsibilities','You are responsible for providing correct account and email information and for ensuring that you are authorized to provide access to the email account connected to Migme. You must not use Migme to access another person’s email account without permission, interfere with the Service, attempt to bypass security controls, or use the Service for unlawful purposes.'],
  ['Subscription and Payment','The applicable Migme subscription or service fee will be communicated to you before you start using the applicable paid service. Unless otherwise agreed, applicable fees must be paid according to the payment terms communicated to you. Imperiial may suspend access to paid features if applicable payments are not made.'],
  ['Order Information','Migme organizes order information extracted from emails for use within the dashboard. You are responsible for reviewing important order information before relying on it for business, financial, or operational decisions.'],
  ['Privacy and Data','The collection, use, storage, security, and deletion of information through Migme are described in the Migme Privacy Policy. By using Migme, you acknowledge and agree to the processing of information as described in the Privacy Policy.'],
  ['Service Availability','We make reasonable efforts to keep Migme available and functioning properly. However, the Service may occasionally be unavailable or interrupted because of maintenance, technical problems, network issues, or other circumstances. We do not guarantee that the Service will always be uninterrupted or completely error-free.'],
  ['Intellectual Property','Migme, including its software, design, interface, branding, features, and underlying technology, belongs to Imperiial or is used by Imperiial with the necessary rights. You may use Migme only as permitted by these Terms. These Terms do not give you ownership of Migme or its technology.'],
  ['Account Suspension or Termination','Imperiial may suspend or terminate an account if there is misuse of Migme, unauthorized access, violation of these Terms, non-payment, or activity that may harm the Service or its users. You may also request termination of your account by contacting Imperiial.'],
  ['Changes to These Terms','We may update these Terms from time to time to reflect changes to Migme or our business practices. Updated Terms will be published on the applicable Migme page. Your continued use of Migme after the updated Terms become effective means that you accept the updated Terms.'],
  ['Contact Us','If you have any questions or concerns about these Terms, you can contact Imperiial at +91 9175185122 / +91 7627073230 or visit https://imperiial.tech.']
];

export default function MigmeLandingNative({ onLogin, onSignup }) {
  const { width } = useWindowDimensions();
  const screen = useMemo(() => getScreen(width), [width]);
  const isWide = width >= 940;
  const isTwoCol = width >= 760;
  const flowSize = width < 480 ? 'sm' : width < 900 ? 'md' : 'lg';

  const scrollRef = useRef(null);
  const sectionOffsets = useRef({});
  const [modalContent, setModalContent] = useState(null); // 'privacy' | 'terms' | null

  const registerSection = (key) => (e) => {
    sectionOffsets.current[key] = e.nativeEvent.layout.y;
  };

  const scrollToSection = (key) => {
    const y = sectionOffsets.current[key];
    if (scrollRef.current && typeof y === 'number') {
      scrollRef.current.scrollTo({ y: Math.max(y - 20, 0), animated: true });
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView ref={scrollRef} style={styles.page} contentContainerStyle={styles.pageContent}>
        <View style={[styles.header, screen.wrap]}>
          <Brand />
          <View style={styles.headerRight}>
            {isWide ? (
              <View style={styles.nav}>
                {NAV_ITEMS.map((item) => (
                  <Pressable key={item.key} onPress={() => scrollToSection(item.key)}>
                    <Text style={styles.navText}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.headerActions}>
              <MigmeButton label="Login" onPress={onLogin} compact={!isWide} outline />
              <MigmeButton label="Signup" onPress={onSignup} compact={!isWide} />
            </View>
          </View>
        </View>

        <View
          style={[screen.wrap, styles.hero, isWide ? styles.heroWide : styles.heroStack]}
          onLayout={registerSection('overview')}
        >
          <View style={styles.heroCopy}>
            <Eyebrow>Order inbox to operating dashboard</Eyebrow>
            <Text style={[styles.display, screen.display]}>Migme keeps every train food order in one clean view.</Text>
            <Text style={[styles.lead, screen.lead]}>
              Connect the inbox your vendors already use. Migme reads order emails, extracts the details that matter and gives your team a live dashboard without manual copy-paste.
            </Text>
            <View style={styles.heroActions}>
              <MigmeButton label="Get Started Free" onPress={onSignup} large />
              <MigmeButton label="Login" onPress={onLogin} large outline />
            </View>
            <View style={styles.proofs}>
              {['Multi-vendor intake', 'Instant order parsing', 'Searchable ledger'].map((item) => (
                <Text key={item} style={styles.proof}>{item}</Text>
              ))}
            </View>
          </View>

          <FlowDiagram size={flowSize} />
        </View>

        <StatsSection wrapStyle={screen.wrap} isTwoCol={isTwoCol} small={width < 480} />

        <Section background="mist">
          <View style={[screen.wrap, isTwoCol ? styles.twoCol : styles.stackGap]}>
            <View>
              <Eyebrow>What Migme does</Eyebrow>
              <Text style={[styles.h2, screen.h2]}>It turns scattered vendor emails into a dependable order desk.</Text>
            </View>
            <View style={styles.copyBlock}>
              <Text style={styles.bodyText}>
                Train food delivery teams do not need another place to manually enter orders. Migme works with the inbox already receiving order confirmations, invoices and summaries, then converts each email into structured records your team can act on.
              </Text>
              <Text style={styles.bodyText}>
                The result is a calmer day: fewer missed orders, faster checks, cleaner handoffs and a ledger that stays current as mail arrives.
              </Text>
            </View>
          </View>
        </Section>

        <Section onLayout={registerSection('workflow')}>
          <View style={screen.wrap}>
            <Eyebrow>Workflow</Eyebrow>
            <Text style={[styles.h2, screen.h2]}>Four steps from incoming mail to a live order board.</Text>
            <View style={styles.steps}>
              {steps.map(([num, title, text]) => (
                <View key={num} style={[styles.step, screen.step]}>
                  <Text style={styles.stepNum}>{num}</Text>
                  <View style={styles.stepBody}>
                    <Text style={styles.cardTitle}>{title}</Text>
                    <Text style={styles.bodyText}>{text}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </Section>

        <Section background="mist" onLayout={registerSection('features')}>
          <View style={screen.wrap}>
            <Eyebrow>Built for daily order handling</Eyebrow>
            <Text style={[styles.h2, screen.h2]}>Everything your team needs after the email arrives.</Text>
            <View style={[styles.grid, screen.grid]}>
              {features.map(([title, text]) => (
                <View key={title} style={[styles.feature, screen.feature]}>
                  <View style={styles.featureIcon}>
                    <Text style={styles.featureIconText}>{title.slice(0, 1)}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <Text style={styles.smallText}>{text}</Text>
                </View>
              ))}
            </View>
          </View>
        </Section>

        <Section onLayout={registerSection('vendors')}>
          <View style={[screen.wrap, isTwoCol ? styles.twoCol : styles.stackGap]}>
            <View>
              <Eyebrow>Vendor coverage</Eyebrow>
              <Text style={[styles.h2, screen.h2]}>Works with the platforms already sending your order mail.</Text>
            </View>
            <View>
              <View style={styles.tags}>
                {vendors.map((vendor) => (
                  <Text key={vendor} style={styles.tag}>{vendor}</Text>
                ))}
              </View>
              <Text style={styles.bodyText}>
                When a new vendor format appears, Migme flags it for review instead of letting the order disappear inside the inbox.
              </Text>
            </View>
          </View>
        </Section>

        <Section onLayout={registerSection('faq')}>
          <View style={[screen.wrap, isTwoCol ? styles.twoCol : styles.stackGap]}>
            <View>
              <Eyebrow>Questions</Eyebrow>
              <Text style={[styles.h2, screen.h2]}>Before you connect the order inbox.</Text>
            </View>
            <View style={styles.faqList}>
              {faqs.map(([question, answer]) => (
                <View key={question} style={styles.faqItem}>
                  <Text style={styles.cardTitle}>{question}</Text>
                  <Text style={styles.bodyText}>{answer}</Text>
                </View>
              ))}
            </View>
          </View>
        </Section>

        <View style={styles.cta}>
          <View style={[screen.wrap, styles.ctaInner]}>
            <Text style={styles.darkEyebrow}>Migme is ready for the inbox you already use</Text>
            <Text style={[styles.displaySmall, screen.displaySmall]}>See the day's orders without hunting through email.</Text>
            <MigmeButton label="Signup" onPress={onSignup} inverse large />
          </View>
        </View>

        <View style={[screen.wrap, styles.footer, isWide ? styles.footerWide : styles.footerStack]}>
          <View style={styles.footerBrand}>
            <Brand />
            <Text style={styles.footerText}>Train food order emails, parsed into one dashboard.</Text>
          </View>
          <View style={styles.footerLinks}>
            {NAV_ITEMS.map((item) => (
              <Pressable key={item.key} onPress={() => scrollToSection(item.key)}>
                <Text style={styles.footerLink}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.footerContact}>
            <Eyebrow>Support</Eyebrow>
            <Pressable onPress={() => Linking.openURL('tel:+919175185122')}>
              <Text style={styles.phone}>+91 9175185122</Text>
            </Pressable>
            <Pressable onPress={() => Linking.openURL('tel:+917627073230')}>
              <Text style={styles.phone}>+91 7627073230</Text>
            </Pressable>
          </View>
        </View>

        <View style={[screen.wrap, styles.footerBottom]}>
          <View style={[styles.footerBottomRow, !isWide && styles.footerBottomRowStack]}>
            <Text style={styles.footerBottomText}>
              © 2026 Imperiial. Migme is a SaaS product of Imperiial. All rights reserved.
            </Text>
            <View style={styles.legalLinks}>
              <Pressable onPress={() => setModalContent('privacy')}>
                <Text style={styles.legalLink}>Privacy Policy</Text>
              </Pressable>
              <Text style={styles.legalDot}>·</Text>
              <Pressable onPress={() => setModalContent('terms')}>
                <Text style={styles.legalLink}>Terms & Conditions</Text>
              </Pressable>
              <Text style={styles.legalDot}>·</Text>
              <Pressable onPress={() => Linking.openURL('https://imperiial.tech')}>
                <Text style={styles.legalLink}>imperiial.tech</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <LegalModal
        visible={modalContent === 'privacy'}
        title="Privacy Policy"
        sections={PRIVACY_SECTIONS}
        onClose={() => setModalContent(null)}
      />
      <LegalModal
        visible={modalContent === 'terms'}
        title="Terms & Conditions"
        sections={TERMS_SECTIONS}
        onClose={() => setModalContent(null)}
      />
    </SafeAreaView>
  );
}

function getScreen(width) {
  const small = width < 480;
  const medium = width >= 480 && width < 940;
  const columns = width >= 1040 ? 3 : width >= 680 ? 2 : 1;

  return {
    wrap: [
      styles.wrap,
      { paddingHorizontal: small ? 16 : medium ? 22 : 32 },
      width >= 1280 ? { maxWidth: 1240 } : null,
    ],
    display: {
      fontSize: small ? 34 : medium ? 46 : 64,
      lineHeight: small ? 38 : medium ? 52 : 68,
    },
    displaySmall: {
      fontSize: small ? 28 : medium ? 36 : 46,
      lineHeight: small ? 34 : medium ? 42 : 54,
    },
    h2: {
      fontSize: small ? 24 : medium ? 30 : 36,
      lineHeight: small ? 30 : medium ? 38 : 44,
    },
    lead: {
      fontSize: small ? 16 : 18,
      lineHeight: small ? 26 : 30,
    },
    grid: Platform.OS === 'web'
      ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
      : {},
    feature: {
      width: Platform.OS === 'web' ? undefined : columns === 3 ? '33.333%' : columns === 2 ? '50%' : '100%',
    },
    step: Platform.OS === 'web'
      ? { display: 'grid', gridTemplateColumns: small ? '42px 1fr' : '72px 1fr' }
      : {},
  };
}

function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>M</Text>
      </View>
      <Text style={styles.wordmark}>MIGME</Text>
    </View>
  );
}

function Eyebrow({ children }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

function MigmeButton({ label, onPress, inverse, large, compact, outline }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        large && styles.buttonLarge,
        compact && styles.buttonCompact,
        outline ? styles.buttonOutline : (inverse ? styles.buttonInverse : styles.buttonSolid),
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, outline ? styles.buttonTextOutline : (inverse ? styles.buttonTextInverse : styles.buttonTextSolid)]}>{label}</Text>
    </Pressable>
  );
}

function Section({ children, background, onLayout }) {
  return (
    <View style={[styles.section, background === 'mist' && styles.sectionMist]} onLayout={onLayout}>
      {children}
    </View>
  );
}

function StatIcon({ type }) {
  if (type === 'box') {
    return (
      <View style={styles.statIconBox}>
        <View style={styles.statBoxLid} />
      </View>
    );
  }
  if (type === 'list') {
    return (
      <View style={styles.statIconList}>
        <View style={styles.statListLine} />
        <View style={styles.statListLine} />
        <View style={styles.statListLineShort} />
      </View>
    );
  }
  if (type === 'target') {
    return (
      <View style={styles.statTargetOuter}>
        <View style={styles.statTargetMid}>
          <View style={styles.statTargetInner} />
        </View>
      </View>
    );
  }
  return null;
}

function StatsSection({ wrapStyle, isTwoCol, small }) {
  return (
    <View style={[styles.statsSection, small && styles.statsSectionCompact]}>
      <View style={[wrapStyle, styles.statsInner]}>
        <Text style={[styles.statsHeading, small && styles.statsHeadingCompact]}>
          Growing teams trust Migme to keep every order accounted for
        </Text>
        <View style={[styles.statsRow, !isTwoCol && styles.statsRowStack]}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statItem}>
              <StatIcon type={s.icon} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function LegalModal({ visible, title, sections, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.modalClose} accessibilityRole="button">
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            <Text style={styles.modalUpdated}>Last updated: 6 September 2026</Text>
            {sections.map(([heading, body]) => (
              <View key={heading} style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>{heading}</Text>
                <Text style={styles.modalSectionText}>{body}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// X-axis travel range and Y-axis keyframes for each of the 4 flow paths, per screen tier.
// Only the X range scales with tier — the Y keyframes (the curve into/out of the hub) stay constant.
const FLOW_PATHS = {
  sm: { AB: [24, 190], CD: [215, 360] },
  md: { AB: [24, 222], CD: [248, 420] },
  lg: { AB: [24, 245], CD: [275, 460] },
};

function useFlowParticle(duration, delay) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, delay]);
  return value;
}

// Fades a particle in as it leaves its origin and out as it reaches its destination,
// so the loop reset is invisible and the flow reads as continuous rather than one-shot.
function particleStyle(value, xRange, yStops, yRange) {
  return {
    opacity: value.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
    transform: [
      { translateX: value.interpolate({ inputRange: [0, 1], outputRange: xRange }) },
      { translateY: value.interpolate({ inputRange: yStops, outputRange: yRange }) },
    ],
  };
}

function FlowDiagram({ size = 'lg' }) {
  const DURATION = 3200;
  // Two particles per path, started half a cycle apart, so a dot is always in flight.
  const p1 = useFlowParticle(DURATION, 0);
  const p2 = useFlowParticle(DURATION, DURATION / 2);

  const paths = FLOW_PATHS[size];
  const compact = size !== 'lg';
  const medium = size === 'md';

  const nodeStyle = (base, compactStyle, mediumStyle) => [
    base,
    medium ? mediumStyle : compact ? compactStyle : null,
  ];

  const dots = [p1, p2].flatMap((val) => ([
    particleStyle(val, paths.AB, [0, .5, 1], [86, 210, 210]),
    particleStyle(val, paths.AB, [0, 1], [210, 210]),
    particleStyle(val, paths.CD, [0, .5, 1], [210, 102, 102]),
    particleStyle(val, paths.CD, [0, 1], [210, 210]),
  ]));

  return (
    <View style={[styles.flowCard, compact && styles.flowCardCompact]}>
      <View style={styles.flowTop}>
        <Text style={styles.flowTopText}>Live order flow</Text>
        <Text style={styles.flowTopText}>Inbox connected</Text>
      </View>
      <View style={[styles.flowCanvas, medium && styles.flowCanvasMedium, size === 'sm' && styles.flowCanvasCompact]}>
        <FlowNode label="VENDOR 1" type="mail" style={nodeStyle(styles.inputA, styles.compactInputA, styles.mediumInputA)} />
        <FlowNode label="VENDOR 2" type="mail" style={nodeStyle(styles.inputB, styles.compactInputB, styles.mediumInputB)} />
        <FlowNode label="VENDOR 3" type="mail" style={nodeStyle(styles.inputC, styles.compactInputC, styles.mediumInputC)} />
        <View style={[styles.hLine, nodeStyle(styles.lineInA, styles.compactLineInA, styles.mediumLineInA)]} />
        <View style={[styles.hLine, nodeStyle(styles.lineInB, styles.compactLineInB, styles.mediumLineInB)]} />
        <View style={[styles.hLine, nodeStyle(styles.lineOutA, styles.compactLineOutA, styles.mediumLineOutA)]} />
        <View style={[styles.hLine, nodeStyle(styles.lineOutB, styles.compactLineOutB, styles.mediumLineOutB)]} />
        <View style={[styles.hub, medium && styles.hubMedium, size === 'sm' && styles.hubCompact]}>
          <View style={styles.hubInner}>
            <Text style={styles.hubIcon}>M</Text>
          </View>
          <Text style={styles.hubText}>MIGME PARSES</Text>
        </View>
        <FlowNode label="DASHBOARD" type="panel" style={nodeStyle(styles.outputA, styles.compactOutputA, styles.mediumOutputA)} />
        <FlowNode label="ALERTS" type="alert" style={nodeStyle(styles.outputB, styles.compactOutputB, styles.mediumOutputB)} />
        <FlowNode label="LEDGER" type="ledger" style={nodeStyle(styles.outputC, styles.compactOutputC, styles.mediumOutputC)} />
        {dots.map((d, i) => (
          <Animated.View key={i} style={[styles.packet, d]} />
        ))}
      </View>
      <View style={styles.flowNote}>
        <View style={styles.dot} />
        <Text style={styles.flowNoteText}>Vendor emails become structured orders automatically</Text>
      </View>
    </View>
  );
}

function FlowNode({ label, type, style }) {
  return (
    <View style={[styles.flowNode, style]}>
      <View style={styles.nodeIcon}>
        {type === 'mail' ? (
          <>
            <View style={styles.mailLid} />
            <View style={styles.mailLine} />
          </>
        ) : null}
        {type === 'panel' ? (
          <View style={styles.panelLines}>
            <View style={styles.panelLine} />
            <View style={styles.panelLineShort} />
            <View style={styles.panelLine} />
          </View>
        ) : null}
        {type === 'alert' ? <Text style={styles.alertIcon}>!</Text> : null}
        {type === 'ledger' ? (
          <View style={styles.panelLines}>
            <View style={styles.panelLine} />
            <View style={styles.panelLine} />
            <View style={styles.panelLineShort} />
          </View>
        ) : null}
      </View>
      <Text style={styles.nodeLabel}>{label}</Text>
    </View>
  );
}

const shadow = Platform.select({
  web: { boxShadow: '18px 18px 0 #F0F0EE' },
  default: {
    shadowColor: colors.line,
    shadowOffset: { width: 10, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
});

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  page: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  pageContent: {
    paddingBottom: 0,
  },
  wrap: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
  },
  header: {
    minHeight: 76,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 3,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    color: colors.paper,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 18,
    fontWeight: '700',
  },
  wordmark: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nav: {
    flexDirection: 'row',
    gap: 24,
  },
  navText: {
    color: colors.graphite,
    fontSize: 14,
  },
  hero: {
    paddingTop: 88,
    paddingBottom: 96,
    gap: 56,
  },
  heroWide: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroStack: {
    flexDirection: 'column',
  },
  heroCopy: {
    flex: 1.04,
  },
  eyebrow: {
    color: colors.graphite,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  display: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontWeight: '600',
    marginBottom: 24,
    maxWidth: 780,
  },
  displaySmall: {
    color: colors.paper,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 30,
    maxWidth: 780,
  },
  h2: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontWeight: '600',
    maxWidth: 700,
  },
  lead: {
    color: colors.graphite,
    maxWidth: 620,
    marginBottom: 30,
  },
  heroActions: {
    flexDirection: 'row',
    marginBottom: 26,
    gap: 12,
    flexWrap: 'wrap',
  },
  button: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  buttonLarge: {
    minHeight: 50,
    paddingHorizontal: 28,
  },
  buttonCompact: {
    minHeight: 40,
    paddingHorizontal: 15,
  },
  buttonSolid: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  buttonInverse: {
    backgroundColor: colors.paper,
    borderColor: colors.paper,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderColor: colors.ink,
  },
  buttonPressed: {
    opacity: .78,
  },
  buttonText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: .8,
    textTransform: 'uppercase',
  },
  buttonTextSolid: {
    color: colors.paper,
  },
  buttonTextInverse: {
    color: colors.stamp,
  },
  buttonTextOutline: {
    color: colors.ink,
  },
  proofs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  proof: {
    color: colors.graphite,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
  },
  flowCard: {
    flex: .86,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
    padding: 18,
    ...shadow,
  },
  flowCardCompact: {
    width: '100%',
    padding: 14,
  },
  flowTop: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  flowTopText: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  flowCanvas: {
    height: 430,
    marginTop: 10,
    position: 'relative',
  },
  flowCanvasCompact: {
    height: 360,
  },
  flowCanvasMedium: {
    height: 400,
  },
  flowNode: {
    position: 'absolute',
    width: 104,
    alignItems: 'center',
  },
  nodeIcon: {
    width: 88,
    height: 58,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: 3,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeLabel: {
    color: colors.graphite,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    letterSpacing: .9,
    marginTop: 10,
  },
  inputA: { left: 0, top: 36 },
  inputB: { left: 0, top: 170 },
  inputC: { left: 0, top: 304 },
  outputA: { right: 0, top: 52 },
  outputB: { right: 0, top: 170 },
  outputC: { right: 0, top: 288 },
  compactInputA: { left: 0, top: 28 },
  compactInputB: { left: 0, top: 142 },
  compactInputC: { left: 0, top: 256 },
  compactOutputA: { right: 0, top: 34 },
  compactOutputB: { right: 0, top: 142 },
  compactOutputC: { right: 0, top: 250 },
  mediumInputA: { left: 0, top: 32 },
  mediumInputB: { left: 0, top: 156 },
  mediumInputC: { left: 0, top: 280 },
  mediumOutputA: { right: 0, top: 44 },
  mediumOutputB: { right: 0, top: 156 },
  mediumOutputC: { right: 0, top: 268 },
  hLine: {
    position: 'absolute',
    height: 1,
    borderTopWidth: 2,
    borderTopColor: colors.line,
    borderStyle: 'dashed',
  },
  lineInA: { left: 104, top: 116, width: 185 },
  lineInB: { left: 104, top: 226, width: 185 },
  lineOutA: { right: 104, top: 116, width: 185 },
  lineOutB: { right: 104, top: 226, width: 185 },
  compactLineInA: { left: 98, top: 94, width: 112 },
  compactLineInB: { left: 98, top: 208, width: 112 },
  compactLineOutA: { right: 98, top: 94, width: 112 },
  compactLineOutB: { right: 98, top: 208, width: 112 },
  mediumLineInA: { left: 100, top: 100, width: 150 },
  mediumLineInB: { left: 100, top: 210, width: 150 },
  mediumLineOutA: { right: 100, top: 100, width: 150 },
  mediumLineOutB: { right: 100, top: 210, width: 150 },
  hub: {
    position: 'absolute',
    left: '50%',
    top: 160,
    width: 132,
    height: 132,
    marginLeft: -66,
    borderRadius: 66,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubCompact: {
    top: 150,
    width: 116,
    height: 116,
    marginLeft: -58,
    borderRadius: 58,
  },
  hubMedium: {
    top: 155,
    width: 124,
    height: 124,
    marginLeft: -62,
    borderRadius: 62,
  },
  hubInner: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubIcon: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 36,
    fontWeight: '700',
  },
  hubText: {
    position: 'absolute',
    bottom: -28,
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: .9,
  },
  packet: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.ink,
  },
  mailLid: {
    width: 44,
    height: 1,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
    transform: [{ rotate: '25deg' }],
  },
  mailLine: {
    width: 42,
    height: 1,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
    transform: [{ rotate: '-25deg' }],
    marginTop: -1,
  },
  panelLines: {
    gap: 7,
  },
  panelLine: {
    width: 42,
    height: 1,
    backgroundColor: colors.ink,
  },
  panelLineShort: {
    width: 30,
    height: 1,
    backgroundColor: colors.ink,
  },
  alertIcon: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
  },
  flowNote: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.ink,
  },
  flowNoteText: {
    color: colors.graphite,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    flexShrink: 1,
  },
  statsSection: {
    backgroundColor: colors.stamp,
    paddingVertical: 72,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  statsSectionCompact: {
    paddingVertical: 52,
  },
  statsInner: {
    alignItems: 'center',
  },
  statsHeading: {
    color: colors.paper,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 700,
    alignSelf: 'center',
    marginBottom: 46,
    lineHeight: 30,
  },
  statsHeadingCompact: {
    fontSize: 18,
    lineHeight: 25,
    marginBottom: 34,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    flexWrap: 'wrap',
    gap: 32,
  },
  statsRowStack: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    minWidth: 150,
  },
  statValue: {
    color: colors.paper,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 34,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 6,
  },
  statLabel: {
    color: '#B9B9B4',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 13,
    textAlign: 'center',
    letterSpacing: .4,
  },
  statIconBox: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderColor: colors.paper,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statBoxLid: {
    width: 26,
    height: 1,
    backgroundColor: colors.paper,
  },
  statIconList: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderColor: colors.paper,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  statListLine: {
    width: 22,
    height: 1,
    backgroundColor: colors.paper,
  },
  statListLineShort: {
    width: 14,
    height: 1,
    backgroundColor: colors.paper,
  },
  statTargetOuter: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTargetMid: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTargetInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.paper,
  },
  section: {
    paddingVertical: 96,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  sectionMist: {
    backgroundColor: colors.mist,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 56,
    alignItems: 'flex-start',
  },
  stackGap: {
    gap: 26,
  },
  copyBlock: {
    flex: 1,
    gap: 18,
  },
  bodyText: {
    color: colors.graphite,
    fontSize: 16,
    lineHeight: 25,
  },
  smallText: {
    color: colors.graphite,
    fontSize: 15,
    lineHeight: 24,
  },
  steps: {
    marginTop: 46,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  step: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 30,
    gap: 22,
    flexDirection: Platform.OS === 'web' ? undefined : 'row',
  },
  stepNum: {
    color: colors.line,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 34,
    fontStyle: 'italic',
    lineHeight: 38,
  },
  stepBody: {
    flex: 1,
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 19,
    fontWeight: '600',
    lineHeight: 25,
    marginBottom: 10,
  },
  grid: {
    marginTop: 46,
    display: Platform.OS === 'web' ? 'grid' : 'flex',
    flexDirection: Platform.OS === 'web' ? undefined : 'row',
    flexWrap: Platform.OS === 'web' ? undefined : 'wrap',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.line,
    gap: 1,
  },
  feature: {
    backgroundColor: colors.paper,
    padding: 30,
  },
  featureIcon: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  featureIconText: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    fontWeight: '600',
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  tag: {
    color: colors.ink,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
  },
  faqList: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  faqItem: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 22,
  },
  cta: {
    backgroundColor: colors.stamp,
    paddingVertical: 96,
  },
  ctaInner: {
    alignItems: 'center',
  },
  darkEyebrow: {
    color: '#B9B9B4',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 14,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 58,
    paddingBottom: 50,
    gap: 36,
  },
  footerWide: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  footerStack: {
    flexDirection: 'column',
  },
  footerBrand: {
    maxWidth: 360,
  },
  footerText: {
    color: colors.graphite,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 14,
  },
  footerLinks: {
    gap: 12,
  },
  footerLink: {
    color: colors.graphite,
    fontSize: 14,
  },
  footerContact: {
    gap: 9,
  },
  phone: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 2,
  },
  footerBottom: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 22,
  },
  footerBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  footerBottomRowStack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  footerBottomText: {
    color: colors.graphite,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
  },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  legalLink: {
    color: colors.ink,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  legalDot: {
    color: colors.line,
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18,18,18,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '85%',
    backgroundColor: colors.paper,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.ink,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  modalTitle: {
    color: '#000000',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 20,
    fontWeight: '600',
  },
  modalClose: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modalCloseText: {
    color: '#000000',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  modalBody: {
    paddingHorizontal: 20,
  },
  modalBodyContent: {
    paddingVertical: 20,
    paddingBottom: 36,
  },
  modalUpdated: {
    color: '#000000',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    letterSpacing: .5,
    textTransform: 'uppercase',
    marginBottom: 20,
  },
  modalSection: {
    marginBottom: 22,
  },
  modalSectionTitle: {
    color: '#000000',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : undefined,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalSectionText: {
    color: '#000000',
    fontSize: 14,
    lineHeight: 22,
  },
});
