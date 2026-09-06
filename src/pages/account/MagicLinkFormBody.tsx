import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/Button';
import styles from './AccountPage.module.css';

interface MagicLinkFormBodyProps {
  email: string;
  busy?: boolean;
  errorAlert?: ReactNode;
  notice?: string;
  onBack: () => void;
  onSwitchToPassword: () => void;
  onSubmit?: (email: string) => Promise<void>;
}

/** Magic Link verification step in the redesigned flow. */
export function MagicLinkFormBody({
  email,
  busy = false,
  errorAlert,
  notice,
  onBack,
  onSwitchToPassword,
  onSubmit,
}: MagicLinkFormBodyProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.stepContent}>
      <div className={styles.stepHeader}>
        <h2 className={styles.stepTitle}>{t('account.checkEmail') || 'Check Your Email'}</h2>
        <p className={styles.stepSubtitle}>
          {t('account.magicLinkSent', { email }) ||
            `We sent a magic link to ${email}. Click it to sign in.`}
        </p>
      </div>

      <div className={styles.magicLinkInfo}>
        <p className={styles.magicLinkDesc}>{t('account.magicLinkDesc')}</p>
      </div>

      {errorAlert}

      {notice && (
        <Alert tone="success" role="status" icon="✓">
          {notice}
        </Alert>
      )}

      <div className={styles.altOptions}>
        <button
          type="button"
          className={styles.altBtn}
          onClick={onSwitchToPassword}
          disabled={busy}
        >
          {t('account.usePassword') || 'Use Password Instead'}
        </button>
      </div>

      <div className={styles.stepFooter}>
        <button type="button" className={styles.backBtn} onClick={onBack} disabled={busy}>
          ← {t('account.back') || 'Back'}
        </button>
      </div>
    </div>
  );
}
