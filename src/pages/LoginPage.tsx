import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/AuthContext';
import { signup, forgotPassword, resetPassword, storeAuth } from '../lib/api';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login, verifyMfa, sendMfaCode, mfaEmail } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<'login' | 'mfa' | 'register' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Detect reset_token from URL
  const resetToken = searchParams.get('reset_token');
  useEffect(() => {
    if (resetToken) {
      setStep('reset');
    }
  }, [resetToken]);

  useEffect(() => {
    // Google OAuth return: /sign-in/#google_token=...&google_refresh=...&google_email=...
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const token = params.get('google_token');
    if (token) {
      storeAuth(token, params.get('google_email') || '', params.get('google_refresh') || '');
      navigate('/dashboard', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const t = prefersDark ? 'dark' : 'light';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result === 'success') {
        navigate('/dashboard', { replace: true });
      } else {
        setStep('mfa');
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
      }
    } catch (err: any) {
      setError(err?.detail || err?.message || t('login.errorLogin'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('login.errorPasswordMismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('login.errorPasswordShort'));
      return;
    }
    setLoading(true);
    try {
      const res = await signup(email, password, displayName);
      storeAuth(res.access_token, email, res.refresh_token);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.detail || err?.message || t('login.errorRegister'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await forgotPassword(email);
      setSuccess(res.message || t('login.resetSent'));
    } catch (err: any) {
      setError(err?.detail || err?.message || t('login.errorSendReset'));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('login.errorPasswordMismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('login.errorPasswordShort'));
      return;
    }
    if (!resetToken) {
      setError(t('login.errorInvalidToken'));
      return;
    }
    setLoading(true);
    try {
      await resetPassword(resetToken, password);
      setSuccess(t('login.resetSuccess'));
      setTimeout(() => {
        setStep('login');
        setSuccess('');
      }, 2000);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('login.errorResetFailed'));
    } finally {
      setLoading(false);
    }
  };

  const goTo = (s: typeof step) => {
    setStep(s);
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
    const code = next.join('');
    if (code.length === 6) handleVerifyMfa(code);
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyMfa = async (code?: string) => {
    const otpCode = code || otp.join('');
    if (otpCode.length !== 6) return;
    setError('');
    setLoading(true);
    try {
      await verifyMfa(otpCode);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.detail || err?.message || t('login.errorVerify'));
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await sendMfaCode();
      setSuccess(t('login.codeResent'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.detail || t('login.errorResend'));
    }
  };

  return (
    <div className="login-page">
      <a className="skip-link" href="#authMain">Skip to content</a>
      <div className="app">
        {/* ── Brand pane ── */}
        <aside className="brand-pane">
          <div>
            <div className="brand-top">
              <div className="brand-mark" aria-label="Penguin logo">
                <img src="/assets/logo/logo_square.png" alt="PenguinCRM" className="brand-mark-img" />
                <span>{t('app.name')}</span>
              </div>
              <button className="theme-btn" onClick={toggleTheme} aria-label="Switch theme">
                {theme === 'dark' ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5"/>
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                )}
              </button>
            </div>
            <div className="hero-copy">
              <div className="eyebrow">{t('login.eyebrow')}</div>
              <h1>{t('login.heroTitle')}</h1>
              <p>{t('login.heroSubtitle')}</p>
              <div className="mini-proof" aria-label="benefits">
                <div className="proof-card">
                  <div className="n">{t('login.proofGoogleTitle')}</div>
                  <div className="l">{t('login.proofGoogleDesc')}</div>
                </div>
                <div className="proof-card">
                  <div className="n">{t('login.proofLocalTitle')}</div>
                  <div className="l">{t('login.proofLocalDesc')}</div>
                </div>
                <div className="proof-card">
                  <div className="n">{t('login.proofRecoveryTitle')}</div>
                  <div className="l">{t('login.proofRecoveryDesc')}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="brand-bottom">
            <span>{t('login.badgeJwt')}</span>
            <span>•</span>
            <span>{t('login.badgeMobile')}</span>
            <span>•</span>
            <span>{t('login.badgeWcag')}</span>
          </div>
        </aside>

        {/* ── Auth pane ── */}
        <main className="auth-pane" id="authMain">
          <div className="auth-shell">
            <section className="auth-card" aria-live="polite">
              <div className="auth-head">
                <h2 id="pageTitle">
                  {step === 'login' && t('login.title')}
                  {step === 'register' && t('login.createAccount')}
                  {step === 'forgot' && t('login.forgotPassword')}
                  {step === 'reset' && t('login.resetTitle')}
                  {step === 'mfa' && t('login.mfaTitle')}
                </h2>
                <p id="pageSubtitle">
                  {step === 'login' && t('login.subtitle')}
                  {step === 'register' && t('login.registerSubtitle')}
                  {step === 'forgot' && t('login.forgotSubtitle')}
                  {step === 'reset' && t('login.resetSubtitle')}
                  {step === 'mfa' && <>{t('login.mfaSentTo')} <strong>{mfaEmail}</strong>.</>}
                </p>
              </div>
              <div className="auth-body">

                {/* ──── LOGIN ──── */}
                {step === 'login' && (
                  <section className="page active" data-page="login">
                    <div className={`notice error ${error ? 'show' : ''}`}>{error}</div>
                    <div className={`notice success ${success ? 'show' : ''}`}>{success}</div>
                    <button className="btn btn-secondary google-btn" type="button" onClick={() => { window.location.href = '/api/v1/auth/google/start'; }}>
                      <span className="gmark" aria-hidden="true"></span>
                      <span className="btn-label">{t('login.continueGoogle')}</span>
                    </button>
                    <div className="divider">{t('login.divider')}</div>
                    <form className="form" onSubmit={handleLogin} noValidate>
                      <div className="field">
                        <label htmlFor="loginEmail">{t('login.emailLabel')}</label>
                        <input
                          className="input"
                          id="loginEmail"
                          name="email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder={t('login.emailPlaceholder')}
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="field">
                        <div className="field-row">
                          <label htmlFor="loginPassword">{t('login.passwordLabel')}</label>
                        </div>
                        <div className="input-wrap">
                          <input
                            className="input"
                            id="loginPassword"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            placeholder={t('login.passwordPlaceholder')}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <div className="meta-row">
                        <label className="check">
                          <input type="checkbox" defaultChecked />
                          <span>{t('login.keepSignedIn')}</span>
                        </label>
                      </div>
                      <button className="btn btn-primary" type="submit" disabled={loading}>
                        <span className="btn-label">
                          {loading ? <><span className="spinner"></span> {t('login.signingIn')}</> : t('login.signIn')}
                        </span>
                      </button>
                    </form>
                    <div className="switcher">
                      <a href="#register" onClick={e => { e.preventDefault(); goTo('register'); }}>
                        {t('login.noAccount')} {t('login.signUp')}
                      </a>
                      <span style={{ margin: '0 8px', color: 'var(--color-text-faint)' }}>·</span>
                      <a href="#forgot" onClick={e => { e.preventDefault(); goTo('forgot'); }}>
                        {t('login.forgotPassword')}
                      </a>
                    </div>
                    <div className="panel-note">
                      {t('login.panelNote')}
                    </div>
                  </section>
                )}

                {/* ──── REGISTER ──── */}
                {step === 'register' && (
                  <section className="page active" data-page="register">
                    <div className={`notice error ${error ? 'show' : ''}`}>{error}</div>
                    <form className="form" onSubmit={handleRegister} noValidate>
                      <div className="field">
                        <label htmlFor="regName">{t('login.fullName')}</label>
                        <input
                          className="input"
                          id="regName"
                          type="text"
                          autoComplete="name"
                          placeholder={t('login.namePlaceholder')}
                          value={displayName}
                          onChange={e => setDisplayName(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="regEmail">{t('login.emailLabel')}</label>
                        <input
                          className="input"
                          id="regEmail"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder={t('login.emailPlaceholder')}
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="regPassword">{t('login.passwordLabel')}</label>
                        <input
                          className="input"
                          id="regPassword"
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('login.passwordMin')}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="regConfirm">{t('login.confirmPassword')}</label>
                        <input
                          className="input"
                          id="regConfirm"
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('login.repeatPassword')}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          required
                        />
                      </div>
                      <button className="btn btn-primary" type="submit" disabled={loading}>
                        <span className="btn-label">
                          {loading ? <><span className="spinner"></span> {t('login.creating')}</> : t('login.createAccount')}
                        </span>
                      </button>
                    </form>
                    <div className="switcher">
                      <a href="#login" onClick={e => { e.preventDefault(); goTo('login'); }}>
                        {t('login.haveAccount')}
                      </a>
                    </div>
                  </section>
                )}

                {/* ──── FORGOT PASSWORD ──── */}
                {step === 'forgot' && (
                  <section className="page active" data-page="forgot">
                    <div className={`notice error ${error ? 'show' : ''}`}>{error}</div>
                    <div className={`notice success ${success ? 'show' : ''}`}>{success}</div>
                    <form className="form" onSubmit={handleForgotPassword} noValidate>
                      <div className="field">
                        <label htmlFor="forgotEmail">{t('login.emailLabel')}</label>
                        <input
                          className="input"
                          id="forgotEmail"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder={t('login.emailPlaceholder')}
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <button className="btn btn-primary" type="submit" disabled={loading}>
                        <span className="btn-label">
                          {loading ? <><span className="spinner"></span> {t('login.sending')}</> : t('login.sendReset')}
                        </span>
                      </button>
                    </form>
                    <div className="switcher">
                      <a href="#login" onClick={e => { e.preventDefault(); goTo('login'); }}>
                        {t('login.backToLogin')}
                      </a>
                    </div>
                  </section>
                )}

                {/* ──── RESET PASSWORD ──── */}
                {step === 'reset' && (
                  <section className="page active" data-page="reset">
                    <div className={`notice error ${error ? 'show' : ''}`}>{error}</div>
                    <div className={`notice success ${success ? 'show' : ''}`}>{success}</div>
                    <form className="form" onSubmit={handleResetPassword} noValidate>
                      <div className="field">
                        <label htmlFor="resetPassword">{t('login.newPassword')}</label>
                        <input
                          className="input"
                          id="resetPassword"
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('login.passwordMin')}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="resetConfirm">{t('login.confirmNewPassword')}</label>
                        <input
                          className="input"
                          id="resetConfirm"
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('login.repeatNewPassword')}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          required
                        />
                      </div>
                      <button className="btn btn-primary" type="submit" disabled={loading}>
                        <span className="btn-label">
                          {loading ? <><span className="spinner"></span> {t('login.resetting')}</> : t('login.resetPassword')}
                        </span>
                      </button>
                    </form>
                    <div className="switcher">
                      <a href="#login" onClick={e => { e.preventDefault(); goTo('login'); }}>
                        {t('login.backToLogin')}
                      </a>
                    </div>
                  </section>
                )}

                {/* ──── MFA ──── */}
                {step === 'mfa' && (
                  <section className="page active" data-page="mfa">
                    <div className="steps">
                      <div className="step active"><span></span></div>
                      <div className="step"><span></span></div>
                    </div>
                    <div className={`notice error ${error ? 'show' : ''}`}>{error}</div>
                    <div className={`notice success ${success ? 'show' : ''}`}>{success}</div>
                    <form id="mfaForm" onSubmit={e => { e.preventDefault(); handleVerifyMfa(); }}>
                      <div className="form">
                        <div className="field">
                          <label htmlFor="mfaCode">{t('login.verificationCode')}</label>
                          <div className="input-wrap">
                            <div className="otp-row">
                              {otp.map((digit, i) => (
                                <input
                                  key={i}
                                  ref={el => { otpRefs.current[i] = el; }}
                                  className="input otp-input"
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={1}
                                  value={digit}
                                  onChange={e => handleOtpChange(i, e.target.value)}
                                  onKeyDown={e => handleOtpKeyDown(i, e)}
                                  autoFocus={i === 0}
                                  required
                                />
                              ))}
                            </div>
                          </div>
                          <span className="error">{t('login.enterCode')}</span>
                        </div>
                        <div className="notice" id="mfaNotice"></div>
                        <div className="field">
                          <label className="check" style={{ fontSize: 'var(--text-sm)' } as React.CSSProperties}>
                            <input type="checkbox" id="trustDevice" />
                            {t('login.trustDevice30')}
                          </label>
                        </div>
                        <button
                          className="btn btn-primary"
                          type="submit"
                          id="mfaSubmit"
                          disabled={loading || otp.join('').length !== 6}
                        >
                          <span className="btn-label">
                            {loading ? <><span className="spinner"></span> {t('login.verifying')}</> : t('login.mfaVerify')}
                          </span>
                        </button>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          id="mfaResend"
                          onClick={handleResend}
                          disabled={loading}
                        >
                          <span className="btn-label">{t('login.resendCode')}</span>
                        </button>
                        <div className="switcher" style={{ textAlign: 'center', marginTop: '12px' } as React.CSSProperties}>
                          <a
                            href="#login"
                            onClick={e => { e.preventDefault(); setStep('login'); setError(''); setOtp(['', '', '', '', '', '']); }}
                          >
                            {t('login.backToLogin')}
                          </a>
                        </div>
                      </div>
                    </form>
                  </section>
                )}

                <p className="legal">
                  {t('login.legalNote')}
                </p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
