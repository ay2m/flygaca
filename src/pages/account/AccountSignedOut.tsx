import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { CaptainAvatar } from '@/components/CaptainAvatar';
import { BrandMark } from '@/components/BrandMark';
import { Disclaimer } from '@/components/Disclaimer';
import { isAuthAvailable, isSupabaseAuthAvailable } from '@/lib/services/auth';
import { AmbientGlow } from '@/components/AmbientGlow';
import { AuthUnavailable, BackendSignIn, LocalSignIn } from './SignInForms';
import account from './account.module.css';
import styles from './AccountPage.module.css';

/**
 * The signed-out /account screen: a dramatic 2027 split-screen design.
 * The left side floats the authentication forms on frosted glass.
 * The right side features a vibrant animated AmbientGlow background with Captain Adel.
 */
export function AccountSignedOut() {
  const { t } = useTranslation();
  const authReady = isAuthAvailable() || isSupabaseAuthAvailable();

  return (
    <section className={`container ${styles.splitScreenPage}`}>
      <AmbientGlow variant="auth" />

      <div className={styles.splitScreenContent}>
        {/* Left side: The Auth Forms floating on glass */}
        <motion.div
          className={styles.authColumn}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.authHeader}>
            <BrandMark />
            <h1 className={styles.authTitle}>{t('account.signInTitle')}</h1>
            <p className={styles.authIntro}>{t('account.signInIntro')}</p>
          </div>

          <Card variant="raised" className={`${styles.authCard} card-clay`}>
            {authReady ? (
              <BackendSignIn />
            ) : import.meta.env.DEV ? (
              <LocalSignIn />
            ) : (
              <AuthUnavailable />
            )}
          </Card>

          <div className={styles.disclaimerWrapper}>
            <Disclaimer compact />
          </div>
        </motion.div>

        {/* Right side: Benefits and Captain Adel in 3D-like space */}
        <motion.div
          className={styles.benefitsColumn}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
        >
          <CaptainAvatar size="xl" glow pose="wave" decorative className={styles.heroAvatar} />

          <Card
            as="aside"
            variant="accent"
            accent="var(--falcon-mist)"
            className={`${styles.benefitsCard} card-clay`}
          >
            <p className={styles.asideEyebrow}>{t('account.benefits.eyebrow')}</p>
            <h2 className={styles.asideTitle}>{t('account.benefits.title')}</h2>
            <ul className={styles.benefitList}>
              <li>
                <strong>{t('account.roles.pilot')}</strong>
                <span>{t('account.benefits.pilot')}</span>
              </li>
              <li>
                <strong>{t('account.roles.student')}</strong>
                <span>{t('account.benefits.student')}</span>
              </li>
              <li>
                <strong>{t('account.roles.instructor')}</strong>
                <span>{t('account.benefits.instructor')}</span>
              </li>
            </ul>
            <p className={account.note}>{t('account.benefits.local')}</p>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}
