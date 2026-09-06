import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { CheckCircle, LinkSimple } from '@phosphor-icons/react';
import { GoogleMark } from './GoogleMark';
import { AppleMark } from './AppleMark';
import { GithubMark } from './GithubMark';
import { DiscordMark } from './DiscordMark';
import { signInWithOAuthProvider, type AuthUser } from '@/lib/services/auth';
import type { AuthOAuthProvider } from '@/lib/supabase/client';
import styles from './AccountPage.module.css';

interface AccountConnectedTabProps {
  user: AuthUser | null;
}

interface ProviderInfo {
  id: AuthOAuthProvider;
  name: string;
  mark: React.ReactNode;
  desc: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'google',
    name: 'Google',
    mark: <GoogleMark />,
    desc: 'Link your Google account for seamless one-tap sign-in.',
  },
  {
    id: 'apple',
    name: 'Apple',
    mark: <AppleMark />,
    desc: 'Sign in with Apple ID and iCloud keychain synchronization.',
  },
  {
    id: 'github',
    name: 'GitHub',
    mark: <GithubMark />,
    desc: 'Link your developer GitHub profile to your pilot account.',
  },
  {
    id: 'discord',
    name: 'Discord',
    mark: <DiscordMark />,
    desc: 'Connect with Saudi aviation and flight simulation communities.',
  },
];

export function AccountConnectedTab({ user }: AccountConnectedTabProps) {
  const { t } = useTranslation();
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  async function handleLink(provider: AuthOAuthProvider) {
    setBusyProvider(provider);
    try {
      await signInWithOAuthProvider(provider, '/account?tab=connected');
    } catch (err) {
      console.warn(`Failed to link ${provider}:`, err);
    } finally {
      setBusyProvider(null);
    }
  }

  // Active provider from user metadata
  const activeProvider = user?.provider?.toLowerCase() || '';

  return (
    <motion.div
      className={styles.hubContainer}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      <div>
        <h2 className={styles.quickDeckTitle}>{t('account.connectedAccounts')}</h2>
        <p className={styles.note}>{t('account.connectedDesc')}</p>
      </div>

      <div className={styles.connectedList}>
        {PROVIDERS.map((p) => {
          const isConnected = activeProvider.includes(p.id);

          return (
            <div key={p.id} className={styles.connectedCard}>
              <div className={styles.connectedProviderInfo}>
                <div className={styles.providerIconWrap}>{p.mark}</div>
                <div>
                  <h3 className={styles.providerName}>{p.name}</h3>
                  <p className={styles.providerStatus}>{p.desc}</p>
                </div>
              </div>

              <div>
                {isConnected ? (
                  <span className={styles.badgeConnected}>
                    <CheckCircle size={14} weight="fill" />
                    {t('account.connected')}
                  </span>
                ) : (
                  <motion.button
                    type="button"
                    className={styles.oauthBtn}
                    disabled={busyProvider === p.id}
                    onClick={() => void handleLink(p.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <LinkSimple size={16} />
                    <span>{t('account.connect')}</span>
                  </motion.button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Security notice */}
      <div className={styles.pdplBanner}>
        <ShieldNotice />
      </div>
    </motion.div>
  );
}

function ShieldNotice() {
  const { t } = useTranslation();
  return (
    <div>
      <h4 className={styles.pdplTitle}>{t('account.pdplBadge')}</h4>
      <p className={styles.pdplText}>{t('account.pdplNote')}</p>
    </div>
  );
}
