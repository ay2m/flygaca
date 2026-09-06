import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { TextField } from '@/components/calc/TextField';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/Button';
import { signIn } from '@/lib/services/account';
import { looksLikeEmail } from '@/calc/app/emailShape';
import { useSignInForm } from '@/hooks/useSignInForm';
import { getOAuthConfig } from '@/lib/services/auth';
import { GoogleMark } from './GoogleMark';
import { AppleMark } from './AppleMark';
import { GithubMark } from './GithubMark';
import { DiscordMark } from './DiscordMark';
import { SignInFormBody } from './SignInFormBody';
import { SignUpFormBody } from './SignUpFormBody';
import { MagicLinkFormBody } from './MagicLinkFormBody';
import styles from './AccountPage.module.css';

export function BackendSignIn() {
  const { t } = useTranslation();
  const [oauthConfig, setOauthConfig] = useState<{ google: { configured: boolean }; apple: { configured: boolean } } | null>(null);

  useEffect(() => {
    void getOAuthConfig().then(setOauthConfig);
  }, []);
  const {
    mode,
    animating,
    busy,
    errors,
    notice,
    mainSiteHref,
    setMode,
    forgotPassword,
    sendMagic,
    loginForm,
    signupForm,
    runGoogle,
    runApple,
    runGithub,
    runDiscord,
  } = useSignInForm();

  const containerClass = `${styles.fadeTransition} ${animating ? styles.animating : ''}`;

  const errorAlert = errors.general ? (
    <Alert tone="error" role="alert" icon="⚠">
      {errors.general}
      {mainSiteHref && (
        <>
          {' '}
          <a className={styles.alertLink} href={mainSiteHref}>
            {t('account.errors.useMainSite')}
          </a>
        </>
      )}
    </Alert>
  ) : null;

  return (
    <>
      {/* Multi-Provider OAuth Buttons (Google, Apple, GitHub, Discord) */}
      <div className={styles.oauthGrid}>
        {oauthConfig?.google.configured && (
          <motion.button
            type="button"
            className={styles.oauthBtn}
            disabled={busy}
            onClick={runGoogle}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <GoogleMark />
            <span>Google</span>
          </motion.button>
        )}
        {oauthConfig?.apple.configured && (
          <motion.button
            type="button"
            className={styles.oauthBtn}
            disabled={busy}
            onClick={runApple}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <AppleMark />
            <span>Apple</span>
          </motion.button>
        )}
        <motion.button
          type="button"
          className={styles.oauthBtn}
          disabled={busy}
          onClick={runGithub}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <GithubMark />
          <span>GitHub</span>
        </motion.button>
        <motion.button
          type="button"
          className={styles.oauthBtn}
          disabled={busy}
          onClick={runDiscord}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <DiscordMark />
          <span>Discord</span>
        </motion.button>
      </div>

      <p className={styles.divider}>{t('account.or')}</p>

      {/* Animated Segmented Tab Switcher */}
      <nav className={styles.tabStrip} aria-label="Sign-in method">
        <button
          type="button"
          className={`${styles.tabBtn} ${mode === 'in' ? styles.tabBtnActive : ''}`}
          onClick={() => setMode('in')}
        >
          {mode === 'in' && (
            <motion.span
              layoutId="authTabPill"
              className={styles.tabActiveIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <span>{t('account.tabSignIn')}</span>
        </button>

        <button
          type="button"
          className={`${styles.tabBtn} ${mode === 'up' ? styles.tabBtnActive : ''}`}
          onClick={() => setMode('up')}
        >
          {mode === 'up' && (
            <motion.span
              layoutId="authTabPill"
              className={styles.tabActiveIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <span>{t('account.tabSignUp')}</span>
        </button>

        <button
          type="button"
          className={`${styles.tabBtn} ${mode === 'magic' ? styles.tabBtnActive : ''}`}
          onClick={() => setMode('magic')}
        >
          {mode === 'magic' && (
            <motion.span
              layoutId="authTabPill"
              className={styles.tabActiveIndicator}
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <span>{t('account.tabMagicLink')}</span>
        </button>
      </nav>

      {/* Animated Form Body */}
      <div className={containerClass}>
        <AnimatePresence mode="wait">
          {mode === 'in' && (
            <motion.div
              key="signin"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <SignInFormBody form={loginForm} busy={busy} errorAlert={errorAlert} notice={notice} />
            </motion.div>
          )}

          {mode === 'up' && (
            <motion.div
              key="signup"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <SignUpFormBody form={signupForm} busy={busy} errorAlert={errorAlert} notice={notice} />
            </motion.div>
          )}

          {mode === 'magic' && (
            <motion.div
              key="magic"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <MagicLinkFormBody
                busy={busy}
                errorAlert={errorAlert}
                notice={notice}
                onSubmit={sendMagic}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={styles.signInLinks}>
        {mode === 'in' && (
          <>
            <button type="button" className={styles.linkBtn} onClick={() => setMode('up')}>
              {t('account.needAccount')}
            </button>
            <button
              type="button"
              className={styles.linkBtn}
              disabled={busy}
              onClick={forgotPassword}
            >
              {t('account.forgotPassword')}
            </button>
          </>
        )}
        {mode === 'up' && (
          <button type="button" className={styles.linkBtn} onClick={() => setMode('in')}>
            {t('account.haveAccount')}
          </button>
        )}
        {mode === 'magic' && (
          <button type="button" className={styles.linkBtn} onClick={() => setMode('in')}>
            {t('account.haveAccount')}
          </button>
        )}
      </div>
    </>
  );
}

export function LocalSignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <>
      <form
        className={styles.fields}
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
        <TextField
          label={t('account.email')}
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (error) setError('');
          }}
          type="email"
          placeholder="you@example.com"
          error={error}
        />
        <TextField label={t('account.name')} value={name} onChange={setName} />
        <Button
          type="submit"
          variant="clayPrimary"
          className={styles.fullWidth}
          disabled={!email.trim()}
        >
          {t('account.signIn')}
        </Button>
      </form>
      <p className={styles.note}>{t('account.localNote')}</p>
    </>
  );
}

/**
 * Shown in a PRODUCTION build when the auth backend isn't configured. It deliberately
 * offers NO form and mints NO session — a config-less deploy must never present a
 * working "email + name" sign-in that looks like a real account. The email+name
 * `LocalSignIn` is a local-first dev convenience only (see the chooser in
 * AccountSignedOut).
 */
export function AuthUnavailable() {
  const { t } = useTranslation();
  return (
    <Alert tone="warning" role="status">
      <strong>{t('account.unavailableTitle')}</strong> {t('account.unavailableBody')}
    </Alert>
  );
}
