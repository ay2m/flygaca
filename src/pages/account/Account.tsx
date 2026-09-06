import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gear,
  SignOut,
  ShieldCheck,
  Warning,
  Sparkle,
  Airplane,
  IdentificationBadge,
  LinkSimple,
  LockKey,
  CreditCard,
} from '@phosphor-icons/react';
import { Alert } from '@/components/Alert';
import { Disclaimer } from '@/components/Disclaimer';
import { CaptainAvatar } from '@/components/CaptainAvatar';
import { StatusPill } from '@/components/StatusPill';
import { Button, ButtonLink } from '@/components/ui/Button';
import { refreshAccount, signOut, useAccount } from '@/lib/services/account';
import { uiPlan } from '@/lib/services/entitlements';
import { isAuthAvailable, isSupabaseAuthAvailable, resendEmailVerification, getCurrentUser, type AuthUser } from '@/lib/services/auth';
import { useNoindexMeta } from '@/hooks/usePageMeta';
import { AccountSignedOut } from './AccountSignedOut';
import { AccountOverviewTab } from './AccountOverviewTab';
import { AccountDossierTab } from './AccountDossierTab';
import { AccountConnectedTab } from './AccountConnectedTab';
import { AccountSecurityTab } from './AccountSecurityTab';
import { AccountMembershipTab } from './AccountMembershipTab';
import styles from './AccountPage.module.css';

type AccountTab = 'overview' | 'dossier' | 'connected' | 'security' | 'membership';

export function Account() {
  const { t } = useTranslation();
  useNoindexMeta(t('meta.account'));

  const { session, uid, emailVerified, profile, flights, records, entitlement, chatCredits, syncError } =
    useAccount();
  const plan = uiPlan(entitlement);
  const isPro = plan !== 'free';

  const [params, setParams] = useSearchParams();
  const checkout = params.get('checkout');
  const rawTab = params.get('tab') as AccountTab | null;
  const activeTab: AccountTab =
    rawTab && ['overview', 'dossier', 'connected', 'security', 'membership'].includes(rawTab)
      ? rawTab
      : 'overview';

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  useEffect(() => {
    void getCurrentUser().then(setCurrentUser);
  }, [session, uid]);

  // Poll after checkout return
  useEffect(() => {
    if (checkout !== 'success') return;
    void refreshAccount();
    let n = 0;
    const id = window.setInterval(() => {
      void refreshAccount();
      if (++n >= 8) window.clearInterval(id);
    }, 2500);
    return () => window.clearInterval(id);
  }, [checkout]);

  function switchTab(newTab: AccountTab) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (newTab === 'overview') {
          next.delete('tab');
        } else {
          next.set('tab', newTab);
        }
        return next;
      },
      { replace: true },
    );
  }

  async function handleResendVerification() {
    setResendBusy(true);
    try {
      await resendEmailVerification();
      setResendSent(true);
    } catch {
      /* ignore */
    } finally {
      setResendBusy(false);
    }
  }

  if (!session) return <AccountSignedOut />;

  const pilotName = profile.displayName || currentUser?.displayName || profile.email || 'Pilot';
  const roleLabel = profile.role ? t(`account.roles.${profile.role}`, { defaultValue: profile.role }) : 'Pilot';

  return (
    <section className={`container ${styles.hubContainer}`}>
      {/* ── Pilot Command Deck (Hero Header Card) ── */}
      <motion.header
        className={styles.heroDeck}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className={styles.heroLeft}>
          <div className={styles.avatarRing}>
            <CaptainAvatar size="lg" pose="smile" glow live decorative />
          </div>

          <div className={styles.pilotIdentity}>
            <h1>
              <span>{pilotName}</span>
              <span className={styles.planTierTag} data-plan={plan}>
                {t(`account.plan.${plan}`)}
              </span>
            </h1>

            <div className={styles.pilotMetaRow}>
              <span>✈️ {roleLabel}</span>
              {profile.homeBase && <span>📍 {profile.homeBase}</span>}
              <span>•</span>
              <span>{profile.email || currentUser?.email}</span>

              {/* Email verified status indicator */}
              {(isAuthAvailable() || isSupabaseAuthAvailable()) && (
                <>
                  <span>•</span>
                  {emailVerified ? (
                    <span className={styles.verifiedPill}>
                      <ShieldCheck size={16} weight="fill" />
                      <span>{t('account.valid')}</span>
                    </span>
                  ) : (
                    <span className={styles.unverifiedPill}>
                      <Warning size={14} weight="fill" />
                      <span>{t('account.emailNotVerified')}</span>
                      {!resendSent ? (
                        <button
                          type="button"
                          className={styles.unverifiedBtn}
                          disabled={resendBusy}
                          onClick={() => void handleResendVerification()}
                        >
                          {t('account.resendVerification')}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--color-success)' }}>✓ Sent</span>
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className={styles.heroActions}>
          <ButtonLink to="/settings" variant="clay" icon={<Gear size={16} />}>
            {t('account.settings')}
          </ButtonLink>
          <Button type="button" variant="clay" icon={<SignOut size={16} />} onClick={() => signOut()}>
            {t('account.signOut')}
          </Button>
        </div>
      </motion.header>

      {/* Checkout return banners */}
      {checkout === 'success' && (
        <div className={styles.verifyBanner} role="status">
          <StatusPill tone={plan !== 'free' ? 'success' : 'warning'}>
            {plan !== 'free'
              ? t('account.subscription.checkoutSuccess')
              : t('account.subscription.activating')}
          </StatusPill>
          <button type="button" className={styles.linkBtn} onClick={() => setParams({})}>
            {t('common.close')}
          </button>
        </div>
      )}
      {checkout === 'cancel' && (
        <p className={styles.note} role="status">
          {t('account.subscription.checkoutCanceled')}
        </p>
      )}

      {syncError && (
        <Alert tone="warning" role="status" icon="⚠">
          {t('account.syncError')}
        </Alert>
      )}

      {/* ── Animated Bento Navigation Tabs ── */}
      <nav className={styles.hubNavStrip} aria-label="Account sections">
        <button
          type="button"
          className={`${styles.hubNavBtn} ${activeTab === 'overview' ? styles.hubNavBtnActive : ''}`}
          onClick={() => switchTab('overview')}
        >
          {activeTab === 'overview' && (
            <motion.span
              layoutId="hubActivePill"
              className={styles.hubNavIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <Airplane size={18} weight={activeTab === 'overview' ? 'fill' : 'regular'} />
          <span>{t('account.overview')}</span>
        </button>

        <button
          type="button"
          className={`${styles.hubNavBtn} ${activeTab === 'dossier' ? styles.hubNavBtnActive : ''}`}
          onClick={() => switchTab('dossier')}
        >
          {activeTab === 'dossier' && (
            <motion.span
              layoutId="hubActivePill"
              className={styles.hubNavIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <IdentificationBadge size={18} weight={activeTab === 'dossier' ? 'fill' : 'regular'} />
          <span>{t('account.pilotDossier')}</span>
        </button>

        <button
          type="button"
          className={`${styles.hubNavBtn} ${activeTab === 'connected' ? styles.hubNavBtnActive : ''}`}
          onClick={() => switchTab('connected')}
        >
          {activeTab === 'connected' && (
            <motion.span
              layoutId="hubActivePill"
              className={styles.hubNavIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <LinkSimple size={18} weight={activeTab === 'connected' ? 'bold' : 'regular'} />
          <span>{t('account.connectedAccounts')}</span>
        </button>

        <button
          type="button"
          className={`${styles.hubNavBtn} ${activeTab === 'security' ? styles.hubNavBtnActive : ''}`}
          onClick={() => switchTab('security')}
        >
          {activeTab === 'security' && (
            <motion.span
              layoutId="hubActivePill"
              className={styles.hubNavIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <LockKey size={18} weight={activeTab === 'security' ? 'fill' : 'regular'} />
          <span>{t('account.security')}</span>
        </button>

        <button
          type="button"
          className={`${styles.hubNavBtn} ${activeTab === 'membership' ? styles.hubNavBtnActive : ''}`}
          onClick={() => switchTab('membership')}
        >
          {activeTab === 'membership' && (
            <motion.span
              layoutId="hubActivePill"
              className={styles.hubNavIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <CreditCard size={18} weight={activeTab === 'membership' ? 'fill' : 'regular'} />
          <span>{t('account.membership')}</span>
        </button>
      </nav>

      {/* ── Active Tab Content (Animated with Framer Motion) ── */}
      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <AccountOverviewTab
            key="overview"
            profile={profile}
            flights={flights}
            records={records}
            chatCredits={chatCredits}
            isPro={isPro}
          />
        )}

        {activeTab === 'dossier' && <AccountDossierTab key="dossier" profile={profile} />}

        {activeTab === 'connected' && <AccountConnectedTab key="connected" user={currentUser} />}

        {activeTab === 'security' && (
          <AccountSecurityTab key="security" user={currentUser} emailVerified={emailVerified} />
        )}

        {activeTab === 'membership' && (
          <AccountMembershipTab
            key="membership"
            entitlement={entitlement}
            plan={plan}
            chatCredits={chatCredits}
          />
        )}
      </AnimatePresence>

      <Disclaimer compact />
    </section>
  );
}
export default Account;
