import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Airplane,
  Clock,
  ChatTeardropText,
  Books,
  Compass,
  ArrowRight,
  Sparkle,
  IdentificationBadge,
} from '@phosphor-icons/react';
import type { Profile, Flight, PilotRecord } from '@/lib/services/account';
import { summarizeLogbook } from '@/calc/pilot/logbook';
import { computeCurrency, recordCurrency, actionNeeded } from '@/calc/pilot/currency';
import styles from './AccountPage.module.css';

interface AccountOverviewTabProps {
  profile: Profile;
  flights: Flight[];
  records: PilotRecord[];
  chatCredits: number;
  isPro: boolean;
}

export function AccountOverviewTab({
  profile,
  flights,
  records,
  chatCredits,
  isPro,
}: AccountOverviewTabProps) {
  const { t } = useTranslation();

  const log = summarizeLogbook(flights);
  const currency = [...computeCurrency(profile, flights), ...recordCurrency(records)];
  const needsAction = actionNeeded(currency);

  // Determine medical expiry status
  const medicalItem = currency.find((c) => c.kind === 'medical');
  const medicalDays = medicalItem?.daysRemaining;
  let medicalStatus = t('account.valid');
  let medicalTone = 'good';
  if (medicalDays !== undefined) {
    if (medicalDays < 0) {
      medicalStatus = t('account.expired');
      medicalTone = 'bad';
    } else if (medicalDays <= 60) {
      medicalStatus = `${medicalDays}d left`;
      medicalTone = 'warn';
    } else {
      medicalStatus = `${medicalDays}d left`;
      medicalTone = 'good';
    }
  } else {
    medicalStatus = t('account.notSet');
    medicalTone = 'neutral';
  }

  // Logbook breakdown percentages
  const totalHrs = log.total;
  const picPct = totalHrs > 0 ? Math.min(100, Math.round((log.pic / totalHrs) * 100)) : 0;
  const nightPct = totalHrs > 0 ? Math.min(100, Math.round((log.night / totalHrs) * 100)) : 0;
  const ifrPct = totalHrs > 0 ? Math.min(100, Math.round((log.ifr / totalHrs) * 100)) : 0;

  return (
    <motion.div
      className={styles.hubContainer}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      {/* ── Bento Stats Grid ── */}
      <div className={styles.bentoStatsGrid}>
        {/* Total Hours Tile */}
        <Link to="/logbook" className={styles.bentoStatCard}>
          <div className={styles.bentoHeader}>
            <span className={styles.bentoStatLabel}>{t('account.totalHours')}</span>
            <div className={styles.bentoIconBadge}>
              <Airplane size={20} weight="duotone" />
            </div>
          </div>
          <span className={styles.bentoStatNum}>{log.total.toFixed(1)}h</span>
          <span className={styles.note}>{t('account.flightsLogged', { n: log.count })}</span>
          <div className={styles.bentoMiniBar} title={`PIC: ${picPct}% | Night: ${nightPct}% | IFR: ${ifrPct}%`}>
            <div className={styles.bentoMiniBarFill} style={{ width: `${Math.max(10, picPct)}%` }} />
          </div>
        </Link>

        {/* Currency & Medical Validity Tile */}
        <Link to="/currency" className={styles.bentoStatCard}>
          <div className={styles.bentoHeader}>
            <span className={styles.bentoStatLabel}>{t('account.currency')}</span>
            <div className={styles.bentoIconBadge}>
              <Clock size={20} weight="duotone" />
            </div>
          </div>
          <span className={styles.bentoStatNum}>{medicalStatus}</span>
          <span className={styles.note}>
            {needsAction.length > 0
              ? `${needsAction.length} items need review`
              : 'All currency items current'}
          </span>
          <div className={styles.bentoMiniBar}>
            <div
              className={styles.bentoMiniBarFill}
              style={{
                width: medicalTone === 'good' ? '100%' : medicalTone === 'warn' ? '40%' : '15%',
                background: medicalTone === 'good' ? 'var(--color-success)' : 'var(--warning)',
              }}
            />
          </div>
        </Link>

        {/* Captain Adel AI Credits Tile */}
        <Link to="/chat" className={styles.bentoStatCard}>
          <div className={styles.bentoHeader}>
            <span className={styles.bentoStatLabel}>{t('account.adelCredits')}</span>
            <div className={styles.bentoIconBadge}>
              <Sparkle size={20} weight="duotone" />
            </div>
          </div>
          <span className={styles.bentoStatNum}>
            {isPro ? 'Unlimited' : `${chatCredits} left`}
          </span>
          <span className={styles.note}>GACAR regulations grounded</span>
          <div className={styles.bentoMiniBar}>
            <div
              className={styles.bentoMiniBarFill}
              style={{
                width: isPro ? '100%' : `${Math.min(100, (chatCredits / 50) * 100)}%`,
              }}
            />
          </div>
        </Link>

        {/* Pilot Records & Ratings Tile */}
        <Link to="/records" className={styles.bentoStatCard}>
          <div className={styles.bentoHeader}>
            <span className={styles.bentoStatLabel}>{t('nav.records')}</span>
            <div className={styles.bentoIconBadge}>
              <IdentificationBadge size={20} weight="duotone" />
            </div>
          </div>
          <span className={styles.bentoStatNum}>{records.length}</span>
          <span className={styles.note}>
            {profile.licenceType ? `${profile.licenceType} Pilot` : 'Licences & Ratings'}
          </span>
          <div className={styles.bentoMiniBar}>
            <div className={styles.bentoMiniBarFill} style={{ width: `${Math.min(100, records.length * 20)}%` }} />
          </div>
        </Link>
      </div>

      {/* ── Cockpit Flight Deck Quick Launcher ── */}
      <section className={styles.quickDeckSection}>
        <h2 className={styles.quickDeckTitle}>{t('account.quickLaunch')}</h2>
        <div className={styles.quickDeckGrid}>
          <Link to="/logbook" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <Airplane size={22} weight="duotone" />
              <span className={styles.quickTileTitle}>{t('account.logbook')}</span>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/currency" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <Clock size={22} weight="duotone" />
              <span className={styles.quickTileTitle}>{t('account.currency')}</span>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/tools" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <Compass size={22} weight="duotone" />
              <span className={styles.quickTileTitle}>{t('nav.tools')}</span>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/library" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <Books size={22} weight="duotone" />
              <span className={styles.quickTileTitle}>{t('nav.library')}</span>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/chat" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <ChatTeardropText size={22} weight="duotone" />
              <span className={styles.quickTileTitle}>Captain Adel AI</span>
            </div>
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </motion.div>
  );
}
