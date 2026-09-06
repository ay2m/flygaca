import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Sparkle, CheckCircle, CreditCard } from '@phosphor-icons/react';
import { SubscriptionPanel } from '@/components/account/SubscriptionPanel';
import { ButtonLink } from '@/components/ui/Button';
import type { Entitlement } from '@/lib/services/entitlements';
import styles from './AccountPage.module.css';

interface AccountMembershipTabProps {
  entitlement: Entitlement | null;
  plan: 'free' | 'pro' | 'school';
  chatCredits: number;
}

export function AccountMembershipTab({
  plan,
  chatCredits,
}: AccountMembershipTabProps) {
  const { t } = useTranslation();
  const isPro = plan !== 'free';

  return (
    <motion.div
      className={styles.hubContainer}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      <div className={styles.securityStack}>
        {/* Plan Overview Card */}
        <div className={styles.securityCard}>
          <div className={styles.bentoHeader}>
            <div>
              <span className={styles.planTierTag} data-plan={plan}>
                {t(`account.plan.${plan}`)}
              </span>
              <h2 className={styles.quickDeckTitle} style={{ marginTop: 'var(--space-2)' }}>
                {isPro ? 'Fly GACA Pro Aviator' : 'Fly GACA Free Cadet'}
              </h2>
              <p className={styles.note}>
                {isPro
                  ? 'Unlimited Captain Adel AI grounding, full exam question bank, offline cloud backup.'
                  : 'Core regulations, basic tools, and daily AI questions included.'}
              </p>
            </div>
            <CreditCard size={32} weight="duotone" color="var(--brand-hover)" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
              <CheckCircle size={18} weight="fill" color="var(--color-success)" />
              <span>Full Saudi Civil Aviation Regulations (GACAR) Library</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
              <CheckCircle size={18} weight="fill" color="var(--color-success)" />
              <span>Electronic Pilot Logbook & Currency Validity Tracker</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
              <CheckCircle size={18} weight="fill" color="var(--color-success)" />
              <span>
                {isPro
                  ? 'Unlimited Captain Adel AI questions with official citations'
                  : '5 free Captain Adel AI questions per day'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
              <CheckCircle size={18} weight="fill" color="var(--color-success)" />
              <span>AIRAC 28-day cycle updates & Saudi airport charts</span>
            </div>
          </div>

          {!isPro && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <ButtonLink to="/pricing" variant="clayPrimary">
                Upgrade to Pro Aviator
              </ButtonLink>
            </div>
          )}
        </div>

        {/* Captain Adel AI Credits Refill Card */}
        <div className={styles.securityCard}>
          <div className={styles.bentoHeader}>
            <div className={styles.heroLeft}>
              <Sparkle size={28} weight="duotone" color="var(--gold)" />
              <div>
                <h3 className={styles.quickDeckTitle}>{t('account.adelCredits')}</h3>
                <p className={styles.note}>
                  {isPro
                    ? 'Unlimited questions included with your Pro subscription.'
                    : `${chatCredits} credits remaining. Refill for continuous exam study.`}
                </p>
              </div>
            </div>

            {!isPro && (
              <ButtonLink to="/pricing#credits" variant="clay">
                {t('account.refillCredits')}
              </ButtonLink>
            )}
          </div>
        </div>

        {/* Existing Subscription Panel (Moyasar / Webhook / Receipt management) */}
        <SubscriptionPanel />
      </div>
    </motion.div>
  );
}
