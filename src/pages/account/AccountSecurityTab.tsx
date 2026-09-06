import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ShieldCheck, LockKey, DownloadSimple, Trash } from '@phosphor-icons/react';
import { PasswordField } from '@/components/calc/PasswordField';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/Alert';
import { PasswordStrength } from '@/components/account/PasswordStrength';
import { meetsPasswordPolicy } from '@/calc/app/passwordPolicy';
import { updateUserPassword, resendEmailVerification, type AuthUser } from '@/lib/services/auth';
import { exportAll, deleteAllData } from '@/lib/services/account';
import { triggerDownload } from '@/lib/download';
import styles from './AccountPage.module.css';

interface AccountSecurityTabProps {
  user: AuthUser | null;
  emailVerified: boolean;
}

export function AccountSecurityTab({ user, emailVerified }: AccountSecurityTabProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError(t('account.passwordRequired'));
      return;
    }
    if (!meetsPasswordPolicy(password)) {
      setError(t('account.errors.passwordTooWeak'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('account.errors.passwordsDoNotMatch'));
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await updateUserPassword(password);
      setSuccess(t('account.passwordUpdated'));
      setPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || t('account.authError');
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
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

  function handleExport() {
    triggerDownload('flygaca-account.json', exportAll(), 'application/json');
  }

  function handleDelete() {
    if (
      window.confirm(
        'Are you sure you want to delete your stored pilot data? This cannot be undone.',
      )
    ) {
      deleteAllData();
      window.location.reload();
    }
  }

  return (
    <motion.div
      className={styles.hubContainer}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      <div className={styles.securityStack}>
        {/* Email Verification Status Card */}
        <div className={styles.securityCard}>
          <div className={styles.bentoHeader}>
            <div className={styles.heroLeft}>
              <ShieldCheck size={28} weight="duotone" color="var(--brand-hover)" />
              <div>
                <h3 className={styles.quickDeckTitle}>{user?.email || t('account.email')}</h3>
                <span className={emailVerified ? styles.verifiedPill : styles.unverifiedPill}>
                  {emailVerified ? `✓ ${t('account.valid')}` : t('account.emailNotVerified')}
                </span>
              </div>
            </div>

            {!emailVerified && (
              <Button
                type="button"
                variant="clay"
                disabled={resendBusy || resendSent}
                onClick={() => void handleResend()}
              >
                {resendSent ? t('account.verificationSent') : t('account.resendVerification')}
              </Button>
            )}
          </div>
        </div>

        {/* Change Password Form */}
        <form className={styles.securityCard} onSubmit={(e) => void handlePasswordChange(e)}>
          <div className={styles.bentoHeader}>
            <div className={styles.heroLeft}>
              <LockKey size={28} weight="duotone" color="var(--brand-hover)" />
              <div>
                <h3 className={styles.quickDeckTitle}>{t('account.updatePassword')}</h3>
                <p className={styles.note}>
                  Ensure your account uses a strong, complex passphrase.
                </p>
              </div>
            </div>
          </div>

          <div className={styles.fields}>
            <PasswordField
              label={t('account.newPassword')}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PasswordStrength password={password} />

            <PasswordField
              label={t('account.confirmNewPassword')}
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />

            {error && (
              <Alert tone="error" role="alert" icon="⚠">
                {error}
              </Alert>
            )}

            {success && (
              <Alert tone="success" role="status" icon="✓">
                {success}
              </Alert>
            )}

            <Button
              type="submit"
              variant="clayPrimary"
              className={styles.fullWidth}
              disabled={busy || !password || !confirmPassword}
            >
              {busy ? 'Updating…' : t('account.updatePassword')}
            </Button>
          </div>
        </form>

        {/* PDPL & Data Ownership */}
        <div className={styles.securityCard}>
          <div className={styles.pdplBanner}>
            <div>
              <h4 className={styles.pdplTitle}>{t('account.pdplBadge')}</h4>
              <p className={styles.pdplText}>{t('account.pdplNote')}</p>
            </div>
          </div>

          <div className={styles.bentoHeader} style={{ marginTop: 'var(--space-2)' }}>
            <Button
              type="button"
              variant="clay"
              icon={<DownloadSimple size={16} />}
              onClick={handleExport}
            >
              Export Pilot Data (JSON)
            </Button>

            <Button type="button" variant="clay" icon={<Trash size={16} />} onClick={handleDelete}>
              Delete Local Cache
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
