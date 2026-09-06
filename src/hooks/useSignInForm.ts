/**
 * All of the sign-in / sign-up form state and choreography in one hook:
 * the in↔up mode toggle, both `useForm` instances (with validation), the shared
 * auth-call runner (`run` — dismiss handling, error-code → field/general mapping,
 * the mirror-host "use the main site" link), and forgot-password. The page keeps
 * only the JSX. Pure decisions are reused from `@/calc/app/*`
 * (`authError`, `emailShape`, `passwordPolicy`); the auth side effects stay in
 * `@/lib/services/auth`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  registerWithEmail,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signInWithApple,
  signInWithOAuthProvider,
  signInWithMagicLink,
} from '@/lib/services/auth';
import {
  AUTH_TIMEOUT_CODE,
  authErrorInfo,
  isAuthDismiss,
  isDomainAuthError,
} from '@/calc/app/authError';
import { looksLikeEmail } from '@/calc/app/emailShape';
import { meetsPasswordPolicy } from '@/calc/app/passwordPolicy';
import { SITE_ORIGIN, isMirrorHost } from '@/lib/seo/seo';
import { useForm } from '@/hooks/useForm';

/** How long an auth call may run before the watchdog reports a timeout. */
export const AUTH_TIMEOUT_MS = 20_000;

export interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  general?: string;
}

export type LoginForm = ReturnType<typeof useForm<{ email: string; password: string }>>;
export type SignupForm = ReturnType<
  typeof useForm<{ name: string; email: string; password: string; confirmPassword: string; role: string }>
>;

export interface SignInForm {
  mode: 'in' | 'up' | 'magic';
  animating: boolean;
  busy: boolean;
  errors: FieldErrors;
  notice: string;
  /** Set when auth fails because this (mirror/preview) host isn't authorized. */
  mainSiteHref: string | null;
  toggleMode: () => void;
  setMode: (m: 'in' | 'up' | 'magic') => void;
  forgotPassword: () => void;
  sendMagic: (email: string) => Promise<void>;
  loginForm: LoginForm;
  signupForm: SignupForm;
  /** Continue-with-Google, wrapped in the shared runner. */
  runGoogle: () => void;
  /** Continue-with-Apple, wrapped in the shared runner. */
  runApple: () => void;
  /** Continue-with-GitHub, wrapped in the shared runner. */
  runGithub: () => void;
  /** Continue-with-Discord, wrapped in the shared runner. */
  runDiscord: () => void;
}

export function useSignInForm(): SignInForm {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [animating, setAnimating] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when a sign-in fails because *this* host isn't an allowed origin (a
  // preview/mirror deploy the API's CORS allowlist doesn't cover). The remedy is to sign in on the canonical
  // site, so we surface a real click-through link on the error alert.
  const [mainSiteHref, setMainSiteHref] = useState<string | null>(null);

  const toggleMode = () => {
    setAnimating(true);
    setTimeout(() => {
      setMode((m) => (m === 'in' ? 'up' : 'in'));
      setErrors({});
      setNotice('');
      loginForm.resetForm();
      signupForm.resetForm();
    }, 200);
    setTimeout(() => {
      setAnimating(false);
    }, 400);
  };

  const switchMode = (newMode: 'in' | 'up' | 'magic') => {
    if (newMode === mode) return;
    setAnimating(true);
    setTimeout(() => {
      setMode(newMode);
      setErrors({});
      setNotice('');
      loginForm.resetForm();
      signupForm.resetForm();
    }, 150);
    setTimeout(() => {
      setAnimating(false);
    }, 300);
  };

  async function run(
    fn: () => Promise<unknown>,
    setFormErrors?: (errs: Partial<Record<string, string>>) => void,
  ) {
    setBusy(true);
    setErrors({});
    setNotice('');
    setMainSiteHref(null);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject({ code: AUTH_TIMEOUT_CODE }), AUTH_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (isAuthDismiss(code)) return;
      const { field, key } = authErrorInfo(code);
      const generic = key === 'account.authError';
      if (generic) console.error('Auth failure', code, e);

      let errorMessage = t(key);
      if (field === 'general' && code) {
        errorMessage = `${errorMessage} ${t('account.errors.technicalDetail', { code })}`;
      }

      if (
        isDomainAuthError(code) &&
        typeof window !== 'undefined' &&
        isMirrorHost(window.location.hostname)
      ) {
        setMainSiteHref(`${SITE_ORIGIN}${window.location.pathname}`);
      }

      if (setFormErrors && (field === 'email' || field === 'password')) {
        setFormErrors({ [field]: errorMessage });
      } else {
        setErrors({ [field]: errorMessage });
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setBusy(false);
    }
  }

  const loginForm = useForm({
    initialValues: { email: '', password: '' },
    validate: (values) => {
      const errs: FieldErrors = {};
      if (!values.email.trim()) {
        errs.email = t('account.errors.invalidEmail');
      } else if (!looksLikeEmail(values.email.trim())) {
        errs.email = t('account.errors.invalidEmail');
      }
      if (!values.password) {
        errs.password = t('account.passwordRequired');
      }
      return errs;
    },
    onSubmit: async (values) => {
      await run(() => signInWithEmail(values.email.trim(), values.password), loginForm.setErrors);
    },
  });

  const signupForm = useForm({
    initialValues: { name: '', email: '', password: '', confirmPassword: '', role: 'pilot' },
    validate: (values) => {
      const errs: FieldErrors & { confirmPassword?: string } = {};
      if (!values.name.trim()) {
        errs.name = t('account.nameRequired');
      }
      if (!values.email.trim()) {
        errs.email = t('account.errors.invalidEmail');
      } else if (!looksLikeEmail(values.email.trim())) {
        errs.email = t('account.errors.invalidEmail');
      }
      if (!values.password) {
        errs.password = t('account.passwordRequired');
      } else if (!meetsPasswordPolicy(values.password)) {
        errs.password = t('account.errors.passwordTooWeak');
      }
      if (values.password !== values.confirmPassword) {
        errs.confirmPassword = t('account.errors.passwordsDoNotMatch');
      }
      return errs;
    },
    onSubmit: async (values) => {
      await run(
        () =>
          registerWithEmail(
            values.email.trim(),
            values.password,
            values.name.trim() || undefined,
            values.role || undefined,
          ),
        signupForm.setErrors,
      );
    },
  });

  function forgotPassword() {
    const emailToUse =
      mode === 'in' ? loginForm.values.email.trim() : signupForm.values.email.trim();
    if (!emailToUse) {
      if (mode === 'in') {
        loginForm.setErrors({ email: t('account.resetNeedEmail') });
      } else {
        signupForm.setErrors({ email: t('account.resetNeedEmail') });
      }
      return;
    }
    void run(async () => {
      await sendPasswordReset(emailToUse);
      setNotice(t('account.resetSent'));
    });
  }

  async function sendMagic(email: string) {
    await run(async () => {
      await signInWithMagicLink(email);
      setNotice(t('account.magicLinkSent'));
    });
  }

  return {
    mode,
    animating,
    busy,
    errors,
    notice,
    mainSiteHref,
    toggleMode,
    setMode: switchMode,
    forgotPassword,
    sendMagic,
    loginForm,
    signupForm,
    runGoogle: () => void run(signInWithGoogle),
    runApple: () => void run(signInWithApple),
    runGithub: () => void run(() => signInWithOAuthProvider('github')),
    runDiscord: () => void run(() => signInWithOAuthProvider('discord')),
  };
}
