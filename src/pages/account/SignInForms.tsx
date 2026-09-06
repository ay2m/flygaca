/**
 * Redesigned sign-in/sign-up forms with magic link as primary flow.
 *
 * Flow:
 * 1. Email entry (magic link default)
 * 2. Verification (magic link) or password entry (if switching modes)
 * 3. OAuth as secondary fallback
 *
 * Mobile-optimized: single-column, large touch targets, minimal choices visible at once.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { TextField } from '@/components/calc/TextField';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/Button';
import { signIn } from '@/lib/services/account';
import { looksLikeEmail } from '@/calc/app/emailShape';
import { useSignInForm } from '@/hooks/useSignInForm';
import { getOAuthConfig } from '@/lib/services/auth';
import { GoogleMark } from './GoogleMark';
import { AppleMark } from './AppleMark';
import { SignInFormBody } from './SignInFormBody';
import { SignUpFormBody } from './SignUpFormBody';
import { MagicLinkFormBody } from './MagicLinkFormBody';
import styles from './AccountPage.module.css';

type AuthStep = 'email' | 'magic' | 'password' | 'signup';

export function BackendSignIn() {
  const { t } = useTranslation();
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [oauthConfig, setOauthConfig] = useState<{
    google: { configured: boolean };
    apple: { configured: boolean };
  } | null>(null);

  useEffect(() => {
    void getOAuthConfig().then(setOauthConfig);
  }, []);

  const {
    busy,
    errors,
    notice,
    loginForm,
    signupForm,
    sendMagic,
    runGoogle,
    runApple,
  } = useSignInForm();

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!looksLikeEmail(trimmed)) return;
    setEmail(trimmed);
    setStep('magic');
  };

  const handleSwitchToPassword = () => {
    setStep('password');
  };

  const handleSwitchToSignup = () => {
    setStep('signup');
  };

  const handleBack = () => {
    setStep('email');
    loginForm.resetForm();
    signupForm.resetForm();
  };

  const errorAlert = errors.general ? (
    <Alert tone="error" role="alert" icon="⚠">
      {errors.general}
    </Alert>
  ) : null;

  const noticeAlert = notice ? (
    <Alert tone="success" role="status" icon="✓">
      {notice}
    </Alert>
  ) : null;

  return (
    <div className={styles.signInContainer}>
      {errorAlert || noticeAlert}

      <div className={styles.stepContainer}>
        {/* Step 1: Email Entry - Primary Flow */}
        {step === 'email' && (
          <motion.form
            onSubmit={handleEmailSubmit}
            className={styles.stepContent}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <div className={styles.stepHeader}>
              <h2 className={styles.stepTitle}>{t('account.signInTitle')}</h2>
              <p className={styles.stepSubtitle}>{t('account.signInIntro')}</p>
            </div>

            <TextField
              label={t('account.email')}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              disabled={busy}
              autoFocus
              className={styles.emailInput}
            />

            <Button
              type="submit"
              variant="primary"
              className={styles.submitBtn}
              disabled={!email.trim() || busy}
              aria-busy={busy}
            >
              {t('account.continueMagic') || 'Continue with Magic Link'}
            </Button>

            <div className={styles.divider}>{t('account.or')}</div>

            {/* OAuth Options - Secondary */}
            {(oauthConfig?.google.configured ||
              oauthConfig?.apple.configured) && (
              <div className={styles.oauthGrid}>
                {oauthConfig?.google.configured && (
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<GoogleMark />}
                    disabled={busy}
                    onClick={runGoogle}
                    className={styles.oauthBtn}
                  >
                    Google
                  </Button>
                )}
                {oauthConfig?.apple.configured && (
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<AppleMark />}
                    disabled={busy}
                    onClick={runApple}
                    className={styles.oauthBtn}
                  >
                    Apple
                  </Button>
                )}
              </div>
            )}

            <div className={styles.altOptions}>
              <button
                type="button"
                className={styles.altBtn}
                onClick={handleSwitchToPassword}
                disabled={busy}
              >
                {t('account.usePassword') || 'Use Password Instead'}
              </button>
              <button
                type="button"
                className={styles.altBtn}
                onClick={handleSwitchToSignup}
                disabled={busy}
              >
                {t('account.createAccount') || 'Create Account'}
              </button>
            </div>
          </motion.form>
        )}

        {/* Step 2: Magic Link Verification */}
        {step === 'magic' && (
          <motion.div
            className={styles.stepContent}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <MagicLinkFormBody
              email={email}
              onBack={handleBack}
              onSwitchToPassword={handleSwitchToPassword}
            />
          </motion.div>
        )}

        {/* Step 3: Password Sign-In */}
        {step === 'password' && (
          <motion.form
            className={styles.stepContent}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            onSubmit={(e) => {
              e.preventDefault();
              loginForm.onSubmit();
            }}
          >
            <div className={styles.stepHeader}>
              <h2 className={styles.stepTitle}>{t('account.signIn')}</h2>
            </div>

            <SignInFormBody
              form={loginForm}
              busy={busy}
              errorAlert={null}
              notice={notice}
            />

            <div className={styles.stepFooter}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={handleBack}
                disabled={busy}
              >
                ← {t('account.back') || 'Back'}
              </button>
            </div>
          </motion.form>
        )}

        {/* Step 4: Sign-Up */}
        {step === 'signup' && (
          <motion.form
            className={styles.stepContent}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            onSubmit={(e) => {
              e.preventDefault();
              signupForm.onSubmit();
            }}
          >
            <div className={styles.stepHeader}>
              <h2 className={styles.stepTitle}>{t('account.createAccount')}</h2>
            </div>

            <SignUpFormBody
              form={signupForm}
              busy={busy}
              errorAlert={null}
              notice={notice}
            />

            <div className={styles.stepFooter}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={handleBack}
                disabled={busy}
              >
                ← {t('account.back') || 'Back'}
              </button>
            </div>
          </motion.form>
        )}
      </div>
    </div>
  );
}

export function LocalSignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  return (
    <form
      className={styles.localForm}
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = email.trim();
        if (!trimmed) return;
        if (!looksLikeEmail(trimmed)) {
          setError(t('account.errors.invalidEmail'));
          return;
        }
        setError('');
        signIn(trimmed, name);
      }}
    >
      <div className={styles.stepHeader}>
        <h2 className={styles.stepTitle}>{t('account.signIn')}</h2>
        <p className={styles.stepSubtitle}>{t('account.localNote')}</p>
      </div>

      <TextField
        label={t('account.email')}
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (error) setError('');
        }}
        error={error}
      />

      <TextField
        label={t('account.name')}
        placeholder={t('account.displayName') || 'Your name'}
        value={name}
        onChange={setName}
      />

      <Button type="submit" variant="primary" className={styles.submitBtn}>
        {t('account.signIn')}
      </Button>
    </form>
  );
}

export function AuthUnavailable() {
  const { t } = useTranslation();
  return (
    <Alert tone="warning" role="status">
      <strong>{t('account.unavailableTitle')}</strong> {t('account.unavailableBody')}
    </Alert>
  );
}
