import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
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
  CheckCircle,
  WarningCircle,
  GraduationCap,
  PaperPlaneTilt,
  Plus,
} from '@phosphor-icons/react';
import type { Profile, Flight, PilotRecord } from '@/lib/services/account';
import { summarizeLogbook } from '@/calc/pilot/logbook';
import { computeCurrency, recordCurrency, actionNeeded } from '@/calc/pilot/currency';
import { CaptainAvatar } from '@/components/CaptainAvatar';
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
  const navigate = useNavigate();
  const [askQuery, setAskQuery] = useState('');

  const log = summarizeLogbook(flights);
  const currency = [...computeCurrency(profile, flights), ...recordCurrency(records)];
  const needsAction = actionNeeded(currency);
  const isFlightReady = needsAction.length === 0;

  // Retrieve key regulatory currency items
  const medicalItem = currency.find((c) => c.id === 'medical');
  const medicalDays = medicalItem?.daysLeft;

  let medicalStatus = t('account.valid');
  let medicalTone: 'good' | 'warn' | 'bad' | 'neutral' = 'good';
  if (medicalDays !== undefined && medicalDays !== null) {
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

  // 90-day passenger recency
  const paxDayItem = currency.find((c) => c.id === 'passenger-day');
  const paxNightItem = currency.find((c) => c.id === 'passenger-night');
  const paxStatusGood =
    paxDayItem?.status === 'current' &&
    (!paxNightItem || paxNightItem.status === 'current');

  // Flight review currency
  const bfrItem = currency.find((c) => c.id === 'flight-review');
  const bfrGood = bfrItem?.status === 'current';

  // Logbook breakdown percentages
  const totalHrs = log.total;
  const picPct = totalHrs > 0 ? Math.min(100, Math.round((log.pic / totalHrs) * 100)) : 0;
  const nightPct = totalHrs > 0 ? Math.min(100, Math.round((log.night / totalHrs) * 100)) : 0;
  const ifrPct = totalHrs > 0 ? Math.min(100, Math.round((log.ifr / totalHrs) * 100)) : 0;

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!askQuery.trim()) {
      navigate('/chat');
      return;
    }
    navigate(`/chat?q=${encodeURIComponent(askQuery.trim())}`);
  };

  return (
    <motion.div
      className={styles.hubContainer}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      {/* ── GACA Flight Readiness Radar ── */}
      <section className={styles.radarCard} aria-label={t('account.gacaCurrencyRadar')}>
        <div className={styles.radarHeader}>
          <div className={styles.radarTitleGroup}>
            <div className={styles.radarStatusPill} data-ready={isFlightReady}>
              {isFlightReady ? (
                <>
                  <CheckCircle size={18} weight="fill" color="var(--color-success)" />
                  <span>{t('account.flightReady')}</span>
                </>
              ) : (
                <>
                  <WarningCircle size={18} weight="fill" color="var(--warning)" />
                  <span>{t('account.actionNeededCount', { count: needsAction.length })}</span>
                </>
              )}
            </div>
            <h2 className={styles.radarHeading}>{t('account.gacaCurrencyRadar')}</h2>
          </div>
          <Link to="/currency" className={styles.radarLink}>
            <span>{t('account.currency')}</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className={styles.radarGrid}>
          {/* Passenger Currency Card (GACAR §61.57) */}
          <Link to="/currency" className={styles.radarMetricTile}>
            <div className={styles.radarMetricHead}>
              <span className={styles.radarMetricLabel}>{t('account.passengerCurrency')}</span>
              <span
                className={styles.radarBadge}
                data-tone={paxStatusGood ? 'good' : 'warn'}
              >
                {paxStatusGood ? '✓ ' + t('account.valid') : 'Review'}
              </span>
            </div>
            <div className={styles.radarMetricSub}>
              <span>GACAR §61.57 (90 Days)</span>
              <span>{paxDayItem?.count ? `${paxDayItem.count.have}/3 landings` : '3 landings req.'}</span>
            </div>
            <div className={styles.bentoMiniBar}>
              <div
                className={styles.bentoMiniBarFill}
                style={{
                  width: paxStatusGood ? '100%' : `${Math.min(100, ((paxDayItem?.count?.have ?? 0) / 3) * 100)}%`,
                  background: paxStatusGood ? 'var(--color-success)' : 'var(--warning)',
                }}
              />
            </div>
          </Link>

          {/* Medical Certificate Card (GACAR Part 67) */}
          <Link to="/currency" className={styles.radarMetricTile}>
            <div className={styles.radarMetricHead}>
              <span className={styles.radarMetricLabel}>{t('account.medicalValidity')}</span>
              <span className={styles.radarBadge} data-tone={medicalTone}>
                {medicalStatus}
              </span>
            </div>
            <div className={styles.radarMetricSub}>
              <span>GACAR Part 67</span>
              <span>{profile.medicalExpiry ? profile.medicalExpiry : t('account.notSet')}</span>
            </div>
            <div className={styles.bentoMiniBar}>
              <div
                className={styles.bentoMiniBarFill}
                style={{
                  width: medicalTone === 'good' ? '100%' : medicalTone === 'warn' ? '50%' : '20%',
                  background:
                    medicalTone === 'good'
                      ? 'var(--color-success)'
                      : medicalTone === 'warn'
                      ? 'var(--warning)'
                      : 'var(--color-error)',
                }}
              />
            </div>
          </Link>

          {/* Biennial Flight Review (GACAR §61.56) */}
          <Link to="/currency" className={styles.radarMetricTile}>
            <div className={styles.radarMetricHead}>
              <span className={styles.radarMetricLabel}>{t('account.flightReview')}</span>
              <span className={styles.radarBadge} data-tone={bfrGood ? 'good' : 'neutral'}>
                {bfrGood ? '✓ ' + t('account.valid') : bfrItem?.daysLeft !== null && (bfrItem?.daysLeft ?? 0) < 0 ? t('account.expired') : t('account.notSet')}
              </span>
            </div>
            <div className={styles.radarMetricSub}>
              <span>GACAR §61.56 (24 Mos)</span>
              <span>{profile.lastFlightReview ? profile.lastFlightReview : t('account.notSet')}</span>
            </div>
            <div className={styles.bentoMiniBar}>
              <div
                className={styles.bentoMiniBarFill}
                style={{
                  width: bfrGood ? '100%' : '25%',
                  background: bfrGood ? 'var(--color-success)' : 'var(--border-bright)',
                }}
              />
            </div>
          </Link>
        </div>
      </section>

      {/* ── Bento Stats Grid ── */}
      <div className={styles.bentoStatsGrid}>
        {/* Total Hours Tile */}
        <div className={styles.bentoStatCard}>
          <div className={styles.bentoHeader}>
            <span className={styles.bentoStatLabel}>{t('account.totalHours')}</span>
            <div className={styles.bentoIconBadge}>
              <Airplane size={20} weight="duotone" />
            </div>
          </div>
          <div className={styles.bentoStatNumRow}>
            <span className={styles.bentoStatNum}>{log.total.toFixed(1)}h</span>
            <Link to="/logbook" className={styles.quickAddLink} title={t('account.logNewFlight')}>
              <Plus size={14} weight="bold" />
              <span>{t('account.logNewFlight')}</span>
            </Link>
          </div>
          <span className={styles.note}>{t('account.flightsLogged', { n: log.count })}</span>
          <div
            className={styles.bentoMiniBar}
            title={`PIC: ${picPct}% (${log.pic}h) | Night: ${nightPct}% (${log.night}h) | IFR: ${ifrPct}% (${log.ifr}h)`}
          >
            <div className={styles.bentoMiniBarFill} style={{ width: `${Math.max(10, picPct)}%` }} />
          </div>
          <div className={styles.bentoSubMetrics}>
            <span>PIC: {log.pic.toFixed(1)}h</span>
            <span>Night: {log.night.toFixed(1)}h</span>
            <span>IFR: {log.ifr.toFixed(1)}h</span>
          </div>
        </div>

        {/* Currency & Validity Tile */}
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
              ? t('account.actionNeededCount', { count: needsAction.length })
              : t('account.allCurrencyCurrent')}
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
          <div className={styles.bentoSubMetrics}>
            <span>{needsAction.length} actions needed</span>
            <span>{currency.length} tracked items</span>
          </div>
        </Link>

        {/* Captain Adel AI Credits Tile */}
        <div className={styles.bentoStatCard}>
          <div className={styles.bentoHeader}>
            <span className={styles.bentoStatLabel}>{t('account.adelCredits')}</span>
            <div className={styles.bentoIconBadge}>
              <Sparkle size={20} weight="duotone" />
            </div>
          </div>
          <div className={styles.adelCreditsHeroRow}>
            <CaptainAvatar size="sm" decorative />
            <span className={styles.bentoStatNum}>
              {isPro ? 'Unlimited' : `${chatCredits} left`}
            </span>
          </div>
          <span className={styles.note}>{t('account.adelCreditsDesc')}</span>

          <form onSubmit={handleAskSubmit} className={styles.quickAskBar}>
            <input
              type="text"
              placeholder={t('account.askAdelPlaceholder')}
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              className={styles.quickAskInput}
            />
            <button type="submit" className={styles.quickAskBtn} aria-label={t('account.askAdelCta')}>
              <PaperPlaneTilt size={14} weight="fill" />
            </button>
          </form>
        </div>

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
            <div
              className={styles.bentoMiniBarFill}
              style={{ width: `${Math.min(100, Math.max(15, records.length * 25))}%` }}
            />
          </div>
          <div className={styles.bentoSubMetrics}>
            <span>Ratings & Endorsements</span>
            <span>+ Add New</span>
          </div>
        </Link>
      </div>

      {/* ── Cockpit Flight Deck Quick Launcher ── */}
      <section className={styles.quickDeckSection}>
        <h2 className={styles.quickDeckTitle}>{t('account.quickLaunch')}</h2>
        <div className={styles.quickDeckGrid}>
          <Link to="/logbook" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <div className={styles.quickTileIconWrap}>
                <Airplane size={22} weight="duotone" />
              </div>
              <div>
                <span className={styles.quickTileTitle}>{t('account.logbook')}</span>
                <span className={styles.quickTileDesc}>Log flights, PIC & night hours</span>
              </div>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/currency" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <div className={styles.quickTileIconWrap}>
                <Clock size={22} weight="duotone" />
              </div>
              <div>
                <span className={styles.quickTileTitle}>{t('account.currency')}</span>
                <span className={styles.quickTileDesc}>GACAR 90-day & medical check</span>
              </div>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/tools" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <div className={styles.quickTileIconWrap}>
                <Compass size={22} weight="duotone" />
              </div>
              <div>
                <span className={styles.quickTileTitle}>{t('nav.tools')}</span>
                <span className={styles.quickTileDesc}>Crosswind, altimetry & W&B</span>
              </div>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/library" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <div className={styles.quickTileIconWrap}>
                <Books size={22} weight="duotone" />
              </div>
              <div>
                <span className={styles.quickTileTitle}>{t('nav.library')}</span>
                <span className={styles.quickTileDesc}>Search official GACAR corpus</span>
              </div>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/chat" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <div className={styles.quickTileIconWrap}>
                <ChatTeardropText size={22} weight="duotone" />
              </div>
              <div>
                <span className={styles.quickTileTitle}>Captain Adel AI</span>
                <span className={styles.quickTileDesc}>Ask regulations & exam citations</span>
              </div>
            </div>
            <ArrowRight size={16} />
          </Link>

          <Link to="/study" className={styles.quickDeckTile}>
            <div className={styles.quickTileInner}>
              <div className={styles.quickTileIconWrap}>
                <GraduationCap size={22} weight="duotone" />
              </div>
              <div>
                <span className={styles.quickTileTitle}>{t('nav.study')}</span>
                <span className={styles.quickTileDesc}>Ground school exam questions</span>
              </div>
            </div>
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </motion.div>
  );
}
