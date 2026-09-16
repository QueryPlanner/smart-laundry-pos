import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import {
  Zap,
  Receipt,
  MessageSquare,
  BarChart3,
  Store,
  Gift,
  Megaphone,
  Smartphone,
  ClipboardList,
  Globe,
  Wifi,
  Download,
  ArrowRight,
  ArrowUpRight,
} from 'lucide-react';
import { PWAInstallButton } from '@/components/ui/PWAInstallButton';
import { WhatsAppFloatingButton } from '@/components/ui/WhatsAppFloatingButton';
import './LandingPage.css';

const FONT_LINK_ID = 'tk-landing-fonts';

/** Fixed-name release asset that release-android.yml re-publishes on every
 * tagged build, so this URL never has to be updated for new versions. */
const ANDROID_APK_URL =
  'https://github.com/fahrudina/smart-laundry-pos/releases/latest/download/smart-laundry-pos-latest.apk';

/** lucide-react has no Android glyph, so this is the standard bugdroid head
 * outline (Material Design Icons, Apache-2.0) — lets the download button
 * read as "Android app" at a glance instead of the generic Smartphone icon. */
const AndroidIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M16.61 15.15C16.15 15.15 15.77 14.78 15.77 14.32S16.15 13.5 16.61 13.5H16.61C17.07 13.5 17.45 13.86 17.45 14.32C17.45 14.78 17.07 15.15 16.61 15.15M7.41 15.15C6.95 15.15 6.57 14.78 6.57 14.32C6.57 13.86 6.95 13.5 7.41 13.5H7.41C7.87 13.5 8.24 13.86 8.24 14.32C8.24 14.78 7.87 15.15 7.41 15.15M16.91 10.14L18.58 7.26C18.67 7.09 18.61 6.88 18.45 6.79C18.28 6.69 18.07 6.75 18 6.92L16.29 9.83C14.95 9.22 13.5 8.9 12 8.91C10.47 8.91 9 9.24 7.73 9.82L6.04 6.91C5.95 6.74 5.74 6.68 5.57 6.78C5.4 6.87 5.35 7.08 5.44 7.25L7.1 10.13C4.25 11.69 2.29 14.58 2 18H22C21.72 14.59 19.77 11.7 16.91 10.14H16.91Z" />
  </svg>
);

/** Loads the ticket-stub type pair only while the landing page is mounted,
 * so authenticated app sessions never pay for this download. */
const useLandingFonts = () => {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);
};

const features = [
  {
    serial: '0231',
    icon: Zap,
    title: 'Super-Fast Order Entry',
    description: 'Weigh, select a service, and print — morning queues no longer pile up at the counter.',
  },
  {
    serial: '0454',
    icon: Receipt,
    title: 'Automatic Receipts & E-Receipts',
    description: 'Every transaction produces a neat receipt with the weight and price breakdown.',
  },
  {
    serial: '0512',
    icon: MessageSquare,
    title: 'Notifications WhatsApp Real-time',
    description: 'Customers know exactly when their laundry is ready for pickup, without having to call first.',
  },
  {
    serial: '0687',
    icon: BarChart3,
    title: 'Revenue Dashboard & Daily Reports',
    description: 'Revenue, outlet performance, and peak hours are visible on one screen.',
  },
  {
    serial: '0733',
    icon: Store,
    title: 'Multi-Outlet & Multi-Cashier',
    description: 'Open a second, third, or fourth branch — all data stays in one system, not one notebook per store.',
  },
  {
    serial: '0810',
    icon: Gift,
    title: 'Smart Points for Loyal Customers',
    description: 'Points accumulate automatically with every transaction, giving customers another reason to return.',
  },
  {
    serial: '0902',
    icon: Megaphone,
    title: 'Broadcast Promotions to Customers',
    description: 'Send promotions to your entire customer list through WhatsApp with one click.',
  },
];

const benefits = [
  'Multi-store management',
  'Real-time order tracking',
  'Automatic price calculation',
  'Customer notification system',
  'Inventory management',
  'Financial reporting',
  'Staff management tools',
  'Offline mode support',
];

const comparisonRows: {
  feature: string;
  smart: 'yes';
  qasir: 'yes' | 'no' | 'partial';
  pawoon: 'yes' | 'no' | 'partial';
  majoo: 'yes' | 'no' | 'partial';
  note?: { qasir?: string; pawoon?: string; majoo?: string };
}[] = [
  {
    feature: 'Optimized for laundry businesses',
    smart: 'yes',
    qasir: 'no',
    pawoon: 'no',
    majoo: 'no',
    note: { qasir: 'General POS', pawoon: 'General POS', majoo: 'General POS' },
  },
  { feature: 'Fast laundry entry (per kg / item)', smart: 'yes', qasir: 'no', pawoon: 'no', majoo: 'no' },
  {
    feature: 'Laundry receipts + e-receipts',
    smart: 'yes',
    qasir: 'partial',
    pawoon: 'partial',
    majoo: 'partial',
    note: { qasir: 'Basic', pawoon: 'Basic', majoo: 'Basic' },
  },
  {
    feature: 'Laundry-specific loyalty (Smart Point)',
    smart: 'yes',
    qasir: 'no',
    pawoon: 'no',
    majoo: 'yes',
    note: { majoo: 'Universal points' },
  },
  { feature: 'Automatic WhatsApp notifications', smart: 'yes', qasir: 'no', pawoon: 'no', majoo: 'no' },
  {
    feature: 'Customer promotion broadcasts',
    smart: 'yes',
    qasir: 'partial',
    pawoon: 'partial',
    majoo: 'partial',
    note: { qasir: 'Manual', pawoon: 'Manual', majoo: 'Limited' },
  },
  { feature: 'Multi-outlet laundry', smart: 'yes', qasir: 'partial', pawoon: 'yes', majoo: 'yes' },
  { feature: 'Laundry status tracking', smart: 'yes', qasir: 'no', pawoon: 'no', majoo: 'no' },
  { feature: 'Laundry queue & labels', smart: 'yes', qasir: 'no', pawoon: 'no', majoo: 'no' },
  {
    feature: 'Small-business-friendly pricing',
    smart: 'yes',
    qasir: 'yes',
    pawoon: 'no',
    majoo: 'no',
    note: { pawoon: 'More expensive', majoo: 'More expensive' },
  },
];

const faqs: { question: string; answer: string }[] = [
  {
    question: 'Is Smart Laundry POS free to use?',
    answer:
      'Yes. Smart Laundry POS is free to use immediately, with no credit card or long-term contract required. Initial store setup takes about 5 minutes.',
  },
  {
    question: 'Can it be used without an internet connection?',
    answer:
      'Yes. Smart Laundry POS supports offline mode, so order entry keeps working when the store connection is unstable and data syncs automatically when connectivity returns.',
  },
  {
    question: 'Does it support by-weight, per-item, and combined laundry?',
    answer:
      'It supports all three. By-weight services are calculated from weight (kg), per-item services from the number of items (such as shoes or bed covers), and combined services use both weight and item quantity in one order.',
  },
  {
    question: 'Can it be used for more than one laundry branch or outlet?',
    answer:
      'Yes. Smart Laundry POS supports multiple outlets and cashiers in one system, so business owners can monitor every branch without separate notebooks.',
  },
  {
    question: 'Do customers get an automatic notification when laundry is finished?',
    answer:
      'Yes. Orders that change to ready for pickup can automatically notify customers on WhatsApp, so they do not need to call the store for an update.',
  },
  {
    question: 'How is Smart Laundry POS different from general POS apps such as Qasir, Pawoon, or Majoo?',
    answer:
      'General POS apps are built for grocery stores or restaurants and then adapted for laundry. Smart Laundry POS is designed for the laundry workflow: weigh items, calculate per-kg/unit prices automatically, track laundry status, and send WhatsApp notifications — features general POS apps typically lack.',
  },
  {
    question: 'Does Smart Laundry POS include a customer loyalty points system?',
    answer:
      'Yes. Smart Point automatically awards points for paid transactions when the store owner enables it in Settings (disabled by default).',
  },
  {
    question: 'Do I need a special app, or can I use it directly from my phone?',
    answer:
      'No app-store download is needed. Smart Laundry POS runs in a browser and can be installed as an app (PWA) directly from the home screen on phones, tablets, or computers — supporting Android, iOS, Windows, and Mac.',
  },
];

const Mark: React.FC<{ value: 'yes' | 'no' | 'partial'; note?: string }> = ({ value, note }) => {
  if (value === 'yes') return <span className="tk-check">✓</span>;
  if (value === 'no')
    return (
      <span className="tk-cross">
        ✕{note ? <span className="block text-[0.65rem] font-normal normal-case tk-mono text-[var(--tk-graphite-soft)]">{note}</span> : null}
      </span>
    );
  return (
    <span className="tk-partial">
      ~{note ? <span className="block text-[0.65rem] font-normal normal-case tk-mono text-[var(--tk-graphite-soft)]">{note}</span> : null}
    </span>
  );
};

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  useLandingFonts();
  // index.html already ships these as the default (matches this page), but this
  // keeps them pinned to "/" when the SPA navigates back here from /login or /install.
  usePageMeta({
    title: 'Smart Laundry POS - Modern POS System for Laundry Businesses',
    description:
      'A modern Point of Sale (POS) system for laundry businesses in Indonesia. Easily manage orders, customers, and payments. Mobile, cloud-based, and installable like a native app.',
    path: '/',
  });

  return (
    <div className="tk-page min-h-screen pb-24 sm:pb-0">
      {/* SEO/OG meta tags live in index.html (React 18 does not hoist tags rendered here) */}

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--tk-line)] bg-[rgba(245,240,228,0.95)] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center min-w-0 flex-1 gap-2 sm:gap-3">
              <div className="w-9 h-9 flex-shrink-0 border-2 border-[var(--tk-ink)] rounded-sm flex items-center justify-center tk-mono font-bold text-[var(--tk-ink)] text-sm">
                SL
              </div>
              <div className="min-w-0">
                <span className="block text-base sm:text-lg font-bold text-[var(--tk-graphite)] truncate">
                  Smart Laundry POS
                </span>
              <p className="text-[0.7rem] tk-mono tracking-wide text-[var(--tk-graphite-soft)] hidden sm:block">
                  LAUNDRY POS SYSTEM
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <PWAInstallButton className="!bg-transparent !border-[var(--tk-line)] !text-[var(--tk-ink)] hover:!bg-[var(--tk-paper-soft)]" />
              <button
                onClick={() => navigate('/install')}
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--tk-line)] rounded-sm text-[var(--tk-ink-soft)] hover:bg-[var(--tk-paper-soft)] transition-colors"
              >
                <Download className="h-4 w-4" />
                Install Manual
              </button>
              <a
                href={ANDROID_APK_URL}
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-sm border border-[var(--tk-line)] text-[var(--tk-ink-soft)] hover:bg-[var(--tk-paper-soft)] transition-colors"
              >
                <AndroidIcon className="h-4 w-4" />
                Download Android
              </a>
              <button
                onClick={() => navigate('/login')}
                className="inline-flex items-center px-4 sm:px-5 py-2 text-sm sm:text-base font-semibold rounded-sm bg-[var(--tk-ink)] text-[var(--tk-paper)] hover:bg-[var(--tk-graphite)] transition-colors"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-14 pb-20 sm:pt-20 sm:pb-28 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <div className="tk-hero-ticket rounded-sm overflow-hidden">
            <div className="tk-hero-barcode" />
            <div className="flex items-center justify-between px-6 sm:px-10 py-3 border-b border-dashed border-[var(--tk-line)] tk-mono text-xs sm:text-sm text-[var(--tk-graphite-soft)] tracking-widest uppercase">
              <span>Laundry Receipt — POS App</span>
              <span>No. 00142</span>
            </div>

            <div className="px-6 sm:px-10 py-10 sm:py-14">
              <span className="tk-eyebrow mb-6">For By-Weight &amp; Per-Item Laundry</span>

              <h1 className="text-[2.1rem] leading-[1.12] sm:text-5xl sm:leading-[1.1] lg:text-6xl font-bold text-[var(--tk-graphite)] mb-6 max-w-3xl">
                A laundry POS that moves as fast as the morning queue.
              </h1>
              <p className="text-lg sm:text-xl text-[var(--tk-ink-soft)] mb-3 max-w-2xl">
                Smart Laundry POS tracks weight, pricing, and laundry status from intake to pickup
                — not a general POS forced into a laundry workflow.
              </p>
              <p className="text-base sm:text-lg text-[var(--tk-graphite-soft)] mb-8 max-w-2xl">
                No handwritten receipts to lose. No manual calculator work.
              </p>

              <div className="flex flex-wrap gap-x-8 gap-y-3 mb-9 tk-mono text-sm">
                <div>
                  <div className="text-[var(--tk-graphite-soft)] text-xs tracking-widest uppercase">Weight</div>
                  <div className="font-bold text-[var(--tk-graphite)] text-lg">2.4 KG</div>
                </div>
                <div>
                  <div className="text-[var(--tk-graphite-soft)] text-xs tracking-widest uppercase">Total</div>
                  <div className="font-bold text-[var(--tk-graphite)] text-lg">Rp 24.000</div>
                </div>
                <div className="flex items-end">
                  <span className="tk-stamp">Ready for Pickup</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <button
                  onClick={() => navigate('/login?tab=signup')}
                  className="inline-flex items-center justify-center gap-2 px-7 py-4 text-base sm:text-lg font-bold rounded-sm bg-[var(--tk-ink)] text-[var(--tk-paper)] hover:bg-[var(--tk-graphite)] transition-colors"
                >
                  Get Your Free Ticket
                  <ArrowRight className="h-5 w-5" />
                </button>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center gap-2 px-7 py-4 text-base sm:text-lg font-semibold rounded-sm border border-[var(--tk-ink)] text-[var(--tk-ink)] hover:bg-[rgba(35,50,74,0.05)] transition-colors"
                >
                  See How It Works
                </a>
              </div>
            </div>
          </div>

          <p className="text-center mt-6 text-sm sm:text-base text-[var(--tk-graphite-soft)] tk-mono">
            FREE TO USE &middot; NO CREDIT CARD &middot; READY IN 5 MINUTES
          </p>
        </div>
      </section>

      <div className="tk-perforation" />

      {/* App Screenshots */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <span className="tk-eyebrow mb-5">The Real Interface</span>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--tk-graphite)] mb-4">
              From the Counter to Your Hand
            </h2>
            <p className="text-lg text-[var(--tk-ink-soft)] max-w-2xl mx-auto">
              From store summaries to new orders, everything is available from the cashier's phone.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            {/* Mobile View - dashboard */}
            <div className="tk-stub rounded-sm">
              <div className="tk-stub__num">No. 0021</div>
              <div className="flex items-center gap-2 mb-5">
                <Smartphone className="h-5 w-5 text-[var(--tk-ink)]" />
                <h3 className="text-lg font-bold text-[var(--tk-graphite)]">Store Summary</h3>
              </div>
              <div className="relative bg-[var(--tk-paper-soft)] overflow-hidden border-8 border-[var(--tk-graphite)] rounded-2xl aspect-[9/19] max-h-[420px] mx-auto">
                <img
                  src="/screenshots/mobile-1.png"
                  alt="Smart Laundry POS dashboard on a phone"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      parent.innerHTML = `
                        <div class="flex flex-col items-center justify-center h-full text-[var(--tk-graphite-soft)] p-8">
                          <p class="text-center text-base font-medium">Mobile POS App</p>
                          <p class="text-center text-sm mt-2">Manage orders from your smartphone</p>
                        </div>
                      `;
                    }
                  }}
                />
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center tk-mono">
                <div>
                  <Zap className="h-4 w-4 mx-auto mb-1 text-[var(--tk-ink)]" />
                  <div className="text-xs text-[var(--tk-graphite-soft)]">Fast</div>
                </div>
                <div>
                  <Smartphone className="h-4 w-4 mx-auto mb-1 text-[var(--tk-ink)]" />
                  <div className="text-xs text-[var(--tk-graphite-soft)]">Touch Friendly</div>
                </div>
                <div>
                  <Wifi className="h-4 w-4 mx-auto mb-1 text-[var(--tk-ink)]" />
                  <div className="text-xs text-[var(--tk-graphite-soft)]">Offline Mode</div>
                </div>
              </div>
            </div>

            {/* Mobile View - create order */}
            <div className="tk-stub rounded-sm">
              <div className="tk-stub__num">No. 0022</div>
              <div className="flex items-center gap-2 mb-5">
                <ClipboardList className="h-5 w-5 text-[var(--tk-ink)]" />
                <h3 className="text-lg font-bold text-[var(--tk-graphite)]">Create Order</h3>
              </div>
              <div className="relative bg-[var(--tk-paper-soft)] overflow-hidden border-8 border-[var(--tk-graphite)] rounded-2xl aspect-[9/19] max-h-[420px] mx-auto">
                <img
                  src="/screenshots/mobile-2.png"
                  alt="Service selection screen for creating a new order"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      parent.innerHTML = `
                        <div class="flex flex-col items-center justify-center h-full text-[var(--tk-graphite-soft)] p-8">
                          <p class="text-center text-lg font-medium">Create New Order</p>
                          <p class="text-center text-sm mt-2">Select a service directly from your smartphone</p>
                        </div>
                      `;
                    }
                  }}
                />
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center tk-mono">
                <div>
                  <BarChart3 className="h-4 w-4 mx-auto mb-1 text-[var(--tk-ink)]" />
                  <div className="text-xs text-[var(--tk-graphite-soft)]">Automatic Calculation</div>
                </div>
                <div>
                  <Zap className="h-4 w-4 mx-auto mb-1 text-[var(--tk-ink)]" />
                  <div className="text-xs text-[var(--tk-graphite-soft)]">Estimated Completion</div>
                </div>
                <div>
                  <Receipt className="h-4 w-4 mx-auto mb-1 text-[var(--tk-ink)]" />
                  <div className="text-xs text-[var(--tk-graphite-soft)]">Ready to Print</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-14 text-center">
            <p className="text-base text-[var(--tk-ink-soft)] mb-5">
              Works perfectly on smartphones, tablets, and desktop computers
            </p>
            <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 tk-mono text-sm text-[var(--tk-graphite-soft)] uppercase tracking-wide">
              <span>iOS &amp; Android</span>
              <span aria-hidden="true" className="text-[var(--tk-line)]">/</span>
              <span>Windows &amp; Mac</span>
              <span aria-hidden="true" className="text-[var(--tk-line)]">/</span>
              <span>Chrome · Safari · Firefox</span>
            </div>
          </div>
        </div>
      </section>

      <div className="tk-perforation" />

      {/* Features */}
      <section id="features" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <span className="tk-eyebrow mb-5">What's on the Ticket</span>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--tk-graphite)] mb-4">
              What You Get from Every Transaction
            </h2>
            <p className="text-lg text-[var(--tk-ink-soft)] max-w-2xl mx-auto">
              Seven things that usually get lost between notebooks and the store's WhatsApp group.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 sm:gap-10">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.serial} className="tk-stub rounded-sm">
                  <div className="tk-stub__num">No. {feature.serial}</div>
                  <div className="w-12 h-12 rounded-full border-2 border-[var(--tk-ink)] flex items-center justify-center mb-5 text-[var(--tk-ink)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-bold text-[var(--tk-graphite)] mb-2">{feature.title}</h3>
                  <p className="text-[var(--tk-ink-soft)]">{feature.description}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-16 tk-ink-band rounded-sm p-8 sm:p-10 text-center">
            <p className="text-xl sm:text-2xl font-bold mb-1">
              &ldquo;More than a POS app — this is a laundry record system from pickup to payment.&rdquo;
            </p>
          </div>
        </div>
      </section>

      <div className="tk-perforation" />

      {/* Comparison ledger */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <span className="tk-eyebrow mb-5">Compared with General POS Apps</span>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--tk-graphite)] mb-4">
              Why not a regular POS app?
            </h2>
            <p className="text-lg text-[var(--tk-ink-soft)] max-w-2xl mx-auto mb-2">
              An honest comparison with Qasir, Pawoon, and Majoo — three widely used general POS apps.
            </p>
            <p className="text-sm text-[var(--tk-graphite-soft)] md:hidden tk-mono">
              Swipe the table to see more &rarr;
            </p>
          </div>

          <div className="tk-ledger overflow-x-auto rounded-sm -mx-4 sm:mx-0">
            <div className="min-w-[640px] sm:min-w-0">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="tk-ink-band tk-mono text-xs sm:text-sm uppercase tracking-wide">
                    <th className="px-4 sm:px-6 py-4 font-semibold">Feature</th>
                    <th className="px-4 sm:px-6 py-4 font-semibold text-center">Smart Laundry POS</th>
                    <th className="px-4 sm:px-6 py-4 font-semibold text-center">Qasir</th>
                    <th className="px-4 sm:px-6 py-4 font-semibold text-center">Pawoon</th>
                    <th className="px-4 sm:px-6 py-4 font-semibold text-center">Majoo</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.feature} className="border-b border-[var(--tk-line)] last:border-0">
                      <td className="px-4 sm:px-6 py-4 text-sm sm:text-base font-medium text-[var(--tk-graphite)] border-r border-[var(--tk-line)]">
                        {row.feature}
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-center border-r border-[var(--tk-line)] bg-[rgba(46,107,76,0.05)]">
                        <Mark value={row.smart} />
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-center border-r border-[var(--tk-line)]">
                        <Mark value={row.qasir} note={row.note?.qasir} />
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-center border-r border-[var(--tk-line)]">
                        <Mark value={row.pawoon} note={row.note?.pawoon} />
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-center">
                        <Mark value={row.majoo} note={row.note?.majoo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#fffdf8] border border-[var(--tk-line)] border-l-4 border-l-[var(--tk-carbon-deep)] rounded-sm p-6">
              <p className="font-bold text-[var(--tk-graphite)] mb-2">General POS apps do not understand the laundry workflow.</p>
              <p className="text-[var(--tk-ink-soft)]">
                Built for grocery stores or restaurants, then adapted to record weight, services, and laundry status.
              </p>
            </div>
            <div className="bg-[#fffdf8] border border-[var(--tk-line)] border-l-4 border-l-[var(--tk-paid)] rounded-sm p-6">
              <p className="font-bold text-[var(--tk-graphite)] mb-2">Smart Laundry POS is built for the laundry ecosystem.</p>
              <p className="text-[var(--tk-ink-soft)]">
                Every feature follows the real workflow: weigh, record, notify, pick up, pay.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Emotional hook — ink band */}
      <section className="tk-ink-band py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <span className="tk-eyebrow tk-eyebrow--light mb-8">Before You Continue</span>
          <h2 className="text-3xl md:text-4xl font-bold mb-8 leading-tight">
            You have worked hard to build this laundry business.
          </h2>
          <div className="space-y-3 text-lg sm:text-xl mb-10 opacity-90">
            <p>You have already invested in washing and ironing equipment.</p>
            <p>You have already trained staff to deliver neat, on-time laundry.</p>
          </div>
          <div className="border-t border-b border-dashed border-white/25 py-8 mb-10">
            <p className="text-xl sm:text-2xl font-bold mb-3">
              Only one thing is still messy: the records.
            </p>
            <p className="text-lg text-[var(--tk-carbon)]">
              Do not let handwritten tickets hold back the business you worked so hard to build.
            </p>
          </div>
          <button
            onClick={() => navigate('/login?tab=signup')}
            className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold rounded-sm bg-[var(--tk-paper)] text-[var(--tk-ink)] hover:bg-white transition-colors"
          >
            Start Your Transformation Now
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="tk-eyebrow mb-6">The Complete Solution</span>
              <h2 className="text-3xl md:text-4xl font-bold text-[var(--tk-graphite)] mb-5">
                Why Choose Smart Laundry POS?
              </h2>
              <p className="text-lg text-[var(--tk-ink-soft)] mb-8">
                Built for laundry businesses with local payment methods, Indonesian Rupiah pricing,
                and the features that matter for daily operations.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                {benefits.map((benefit) => (
                  <div key={benefit} className="flex items-center gap-3">
                    <span className="tk-mono text-[var(--tk-paid)] font-bold">✓</span>
                    <span className="text-[var(--tk-graphite)]">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="tk-boarding rounded-sm p-8 sm:p-10">
              <Smartphone className="h-10 w-10 mb-4 text-[var(--tk-carbon)]" />
              <h3 className="text-2xl font-bold mb-2">Install as a Mobile App</h3>
              <p className="opacity-80 mb-6">
                Get a complete mobile experience with offline support and instant access from your home screen.
              </p>
              <div className="space-y-3 tk-mono text-sm">
                <div className="flex items-center gap-3">
                  <Wifi className="h-4 w-4 flex-shrink-0" />
                  <span>Works offline when needed</span>
                </div>
                <div className="flex items-center gap-3">
                  <Zap className="h-4 w-4 flex-shrink-0" />
                  <span>Super-fast performance</span>
                </div>
                <div className="flex items-center gap-3">
                  <Globe className="h-4 w-4 flex-shrink-0" />
                  <span>Access it from anywhere</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="tk-perforation" />

      {/* FAQ — content mirrors the FAQPage JSON-LD in index.html, keep them in sync */}
      <section id="faq" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <span className="tk-eyebrow mb-5">Frequently Asked Questions</span>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--tk-graphite)] mb-4">
              What Laundry Owners Usually Ask
            </h2>
            <p className="text-lg text-[var(--tk-ink-soft)] max-w-2xl mx-auto">
              Quick answers before you move on from handwritten tickets.
            </p>
          </div>

          <div className="space-y-5">
            {faqs.map((faq) => (
              <div key={faq.question} className="tk-stub rounded-sm">
                <h3 className="text-lg font-bold text-[var(--tk-graphite)] mb-2">{faq.question}</h3>
                <p className="text-[var(--tk-ink-soft)]">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-20 sm:pb-28 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center bg-[#fffdf8] border border-[var(--tk-line)] rounded-sm p-8 sm:p-14">
          <span className="tk-eyebrow mb-6">Offer for New Store Owners</span>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--tk-graphite)] mb-6 leading-tight">
            Ready to modernize your laundry business?
          </h2>
          <p className="text-lg text-[var(--tk-ink-soft)] mb-10 max-w-2xl mx-auto">
            Join laundry businesses using Smart Laundry POS to improve efficiency and customer satisfaction.
          </p>

          <div className="grid sm:grid-cols-3 gap-4 mb-10 text-left">
            <div className="tk-stub rounded-sm !p-5">
              <div className="tk-stub__num">A</div>
              <p className="font-bold text-[var(--tk-graphite)] mb-1">Start for free</p>
              <p className="text-sm text-[var(--tk-graphite-soft)]">No credit card required</p>
            </div>
            <div className="tk-stub rounded-sm !p-5">
              <div className="tk-stub__num">B</div>
              <p className="font-bold text-[var(--tk-graphite)] mb-1">Set up in 5 minutes</p>
              <p className="text-sm text-[var(--tk-graphite-soft)]">Experience the difference today</p>
            </div>
            <div className="tk-stub rounded-sm !p-5">
              <div className="tk-stub__num">C</div>
              <p className="font-bold text-[var(--tk-graphite)] mb-1">Get started now</p>
              <p className="text-sm text-[var(--tk-graphite-soft)]">No long-term contract</p>
            </div>
          </div>

          <div className="tk-tear pt-8">
            <button
              onClick={() => navigate('/login?tab=signup')}
              className="inline-flex items-center gap-2 px-8 sm:px-10 py-4 text-lg font-bold rounded-sm bg-[var(--tk-ink)] text-[var(--tk-paper)] hover:bg-[var(--tk-graphite)] transition-colors"
            >
              Get Your Free Ticket Now
              <ArrowRight className="h-5 w-5" />
            </button>
            <p className="mt-5 text-sm tk-mono uppercase tracking-wide text-[var(--tk-graphite-soft)]">
              No setup fee &middot; No contract &middot; Get started now
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="tk-ink-band py-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 border-2 border-[var(--tk-paper)] rounded-sm flex items-center justify-center tk-mono font-bold text-sm">
                  SL
                </div>
                <span className="text-lg font-bold">Smart Laundry POS</span>
              </div>
              <p className="opacity-75 mb-6 max-w-md">
                A modern point-of-sale system built for laundry businesses. Simplify operations,
                improve efficiency, and grow your business.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <PWAInstallButton
                  variant="outline"
                  className="!bg-transparent !border-white/25 !text-[var(--tk-paper)] hover:!bg-white/10"
                />
                <button
                  onClick={() => navigate('/install')}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-white/25 rounded-sm hover:bg-white/10 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Install Guide
                </button>
                <a
                  href={ANDROID_APK_URL}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-white/25 rounded-sm hover:bg-white/10 transition-colors"
                >
                  <AndroidIcon className="h-4 w-4" />
                  Download Android APK
                </a>
              </div>
              <div className="opacity-80 text-sm">
                <p className="mb-1">
                  <strong className="opacity-100">Contact:</strong>{' '}
                  <a
                    href="mailto:fahrudinjaya@gmail.com"
                    className="underline decoration-white/30 hover:decoration-white"
                  >
                    fahrudinjaya@gmail.com
                  </a>
                </p>
                <p>For questions, technical support, or a product demo</p>
              </div>
            </div>

            <div>
              <h3 className="tk-mono text-xs uppercase tracking-widest mb-4 opacity-70">Features</h3>
              <ul className="space-y-2 opacity-80 text-sm">
                <li>Order Management</li>
                <li>Customer Database</li>
                <li>Payment Processing</li>
                <li>Reports &amp; Analytics</li>
                <li>Multi-store Support</li>
              </ul>
            </div>

            <div>
              <h3 className="tk-mono text-xs uppercase tracking-widest mb-4 opacity-70">Support</h3>
              <ul className="space-y-2 opacity-80 text-sm">
                <li>Documentation</li>
                <li>Video Tutorials</li>
                <li>Customer Support</li>
                <li>Feature Requests</li>
                <li>System Status</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/15 mt-10 pt-8 text-center opacity-70 text-sm">
            <p>&copy; 2025 Smart Laundry POS. Built for laundry businesses.</p>
            <p className="mt-2">
              Contact:{' '}
              <a href="mailto:fahrudinjaya@gmail.com" className="underline decoration-white/30 hover:decoration-white">
                fahrudinjaya@gmail.com
              </a>
            </p>
          </div>
        </div>
      </footer>

      {/* Sticky mobile CTA */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[rgba(245,240,228,0.95)] backdrop-blur-sm border-t border-[var(--tk-line)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          onClick={() => navigate('/login?tab=signup')}
          className="w-full inline-flex items-center justify-center gap-2 rounded-sm bg-[var(--tk-ink)] text-[var(--tk-paper)] py-4 text-base font-bold"
        >
          Get Your Free Ticket
          <ArrowUpRight className="h-5 w-5" />
        </button>
      </div>

      {/* WhatsApp Floating Button */}
      <WhatsAppFloatingButton
        phoneNumber="6281280272326"
        message="Hello, I am interested in Smart Laundry POS and would like to learn more!"
        position="bottom-right"
      />
    </div>
  );
};
