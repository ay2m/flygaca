import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/components/calc/TextField';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/Button';
import { looksLikeEmail } from '@/calc/app/emailShape';
import styles from './AccountPage.module.css';

interface MagicLinkFormBodyProps {
  busy: boolean;
  errorAlert: ReactNode;
  notice: string;
  onSubmit: (email: string) => Promise<void>;
}

/** Passwordless Magic Link email authentication form. */
export function MagicLinkFormBody({
  busy,
  errorAlert,
  notice,
  onSubmit,
}: MagicLinkFormBodyProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t('account.errors.invalidEmail'));
      return;
    }
    if (!looksLikeEmail(trimmed)) {
      setError(t('account.errors.invalidEmail'));
      return;
    }
    setError('');
    await onSubmit(trimmed);
  }

  return (
    <form className={styles.fields} onSubmit={(e) => void handleSubmit(e)} noValidate>
      <div className={styles.magicLinkInfo}>
        <p className={styles.magicLinkDesc}>{t('account.magicLinkDesc')}</p>
      </div>

      <TextField
        label={t('account.email')}
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (error) setError('');
        }}
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={error || undefined}
      />

      {errorAlert}

      {notice && (
        <Alert tone="success" role="status" icon="✓">
          {notice}
        </Alert>
      )}

      <Button
        type="submit"
        variant="clayPrimary"
        className={styles.fullWidth}
        aria-busy={busy || undefined}
        disabled={busy || !email.trim()}
      >
        {t('account.sendMagicLink')}
      </Button>
    </form>
  );
}
