import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export default function LoginPage() {
  const { login, verifyMfa, sendMfaCode, mfaEmail } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'login' | 'mfa'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

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
      setError(err?.detail || err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
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
      setError(err?.detail || err?.message || 'Verification failed');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendMsg('');
    try {
      await sendMfaCode();
      setResendMsg('Code resent!');
      setTimeout(() => setResendMsg(''), 3000);
    } catch (err: any) {
      setError(err?.detail || 'Failed to resend');
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
              <div className="brand-mark" aria-label="NEXUS logo">
                <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M4 24V4l10 16V4l10 16"/>
                  <path d="M24 20v4H4"/>
                </svg>
                <span>NEXUS CRM</span>
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
              <div className="eyebrow">Sales portal access</div>
              <h1>One clean entry point for your whole workspace.</h1>
              <p>Designed with a calm, Notion-like layout: low-friction Google sign-in first, local account fallback, and a full recovery loop for signup and forgotten passwords.</p>
              <div className="mini-proof" aria-label="benefits">
                <div className="proof-card">
                  <div className="n">Google first</div>
                  <div className="l">Faster sign-in for teams using Google Workspace</div>
                </div>
                <div className="proof-card">
                  <div className="n">Local account</div>
                  <div className="l">Email and password flow for direct workspace access</div>
                </div>
                <div className="proof-card">
                  <div className="n">Full recovery</div>
                  <div className="l">Create account, reset password, and return without dead ends</div>
                </div>
              </div>
            </div>
          </div>
          <div className="brand-bottom">
            <span>JWT + refresh token ready</span>
            <span>•</span>
            <span>Mobile-first auth flow</span>
            <span>•</span>
            <span>WCAG-friendly contrast</span>
          </div>
        </aside>

        {/* ── Auth pane ── */}
        <main className="auth-pane" id="authMain">
          <div className="auth-shell">
            <section className="auth-card" aria-live="polite">
              <div className="auth-head">
                <h2 id="pageTitle">
                  {step === 'login' ? 'Welcome back' : 'Check your email'}
                </h2>
                <p id="pageSubtitle">
                  {step === 'login'
                    ? 'Sign in to continue to your team workspace.'
                    : <>We sent a verification code to <strong>{mfaEmail}</strong>.</>
                  }
                </p>
              </div>
              <div className="auth-body">

                {/* ──── LOGIN ──── */}
                {step === 'login' && (
                  <section className="page active" data-page="login">
                    <div className={`notice error ${error ? 'show' : ''}`}>{error}</div>
                    <button className="btn btn-secondary google-btn" type="button">
                      <span className="gmark" aria-hidden="true"></span>
                      <span className="btn-label">Continue with Google</span>
                    </button>
                    <div className="divider">or continue with email</div>
                    <form className="form" onSubmit={handleLogin} noValidate>
                      <div className="field">
                        <label htmlFor="loginEmail">Work email</label>
                        <input
                          className="input"
                          id="loginEmail"
                          name="email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder="name@company.com"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="field">
                        <div className="field-row">
                          <label htmlFor="loginPassword">Password</label>
                        </div>
                        <div className="input-wrap">
                          <input
                            className="input"
                            id="loginPassword"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <div className="meta-row">
                        <label className="check">
                          <input type="checkbox" defaultChecked />
                          <span>Keep me signed in on this device</span>
                        </label>
                      </div>
                      <button className="btn btn-primary" type="submit" disabled={loading}>
                        <span className="btn-label">
                          {loading ? <><span className="spinner"></span> Signing in...</> : 'Sign in'}
                        </span>
                      </button>
                    </form>
                    <div className="panel-note">
                      Use Google when your workspace email matches your Google account. Use email login when your team manages local credentials.
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
                    <div className={`notice success ${resendMsg ? 'show' : ''}`}>{resendMsg}</div>
                    <form id="mfaForm" onSubmit={e => { e.preventDefault(); handleVerifyMfa(); }}>
                      <div className="form">
                        <div className="field">
                          <label htmlFor="mfaCode">Verification code</label>
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
                          <span className="error">Enter the 6-digit code from your email.</span>
                        </div>
                        <div className="notice" id="mfaNotice"></div>
                        <div className="field">
                          <label className="check" style={{ fontSize: 'var(--text-sm)' } as React.CSSProperties}>
                            <input type="checkbox" id="trustDevice" />
                            Trust this device for 30 days — no OTP needed
                          </label>
                        </div>
                        <button
                          className="btn btn-primary"
                          type="submit"
                          id="mfaSubmit"
                          disabled={loading || otp.join('').length !== 6}
                        >
                          <span className="btn-label">
                            {loading ? <><span className="spinner"></span> Verifying...</> : 'Verify & sign in'}
                          </span>
                        </button>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          id="mfaResend"
                          onClick={handleResend}
                          disabled={loading}
                        >
                          <span className="btn-label">Resend code</span>
                        </button>
                        <div className="switcher" style={{ textAlign: 'center', marginTop: '12px' } as React.CSSProperties}>
                          <a
                            href="#login"
                            onClick={e => { e.preventDefault(); setStep('login'); setError(''); setOtp(['', '', '', '', '', '']); }}
                          >
                            Back to login
                          </a>
                        </div>
                      </div>
                    </form>
                  </section>
                )}

                <p className="legal">
                  By continuing, you acknowledge the workspace security rules and team access model for this CRM portal.
                </p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
