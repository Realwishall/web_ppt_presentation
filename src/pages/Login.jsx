import { useRef, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth'
import { Atom, Mail, Lock, LogIn, Phone, KeyRound, ArrowLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { auth } from '../firebase'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('email') // 'email' | 'phone'

  const from = location.state?.from?.pathname || '/'
  if (user) return <Navigate to={from} replace />

  const goHome = () => navigate(from, { replace: true })

  return (
    <div className="app-bg grid min-h-screen place-items-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass w-full max-w-md rounded-3xl border p-8 shadow-2xl shadow-indigo-950/40"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/40 animate-floaty">
            <Atom className="h-7 w-7" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            Physics<span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Board</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">Interactive JEE physics slides</p>
        </div>

        {/* Mode switch */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1">
          <TabButton active={mode === 'email'} onClick={() => setMode('email')} icon={Mail} label="Email" />
          <TabButton active={mode === 'phone'} onClick={() => setMode('phone')} icon={Phone} label="Phone" />
        </div>

        {mode === 'email' ? (
          <motion.div key="email" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <EmailForm login={login} onSuccess={goHome} />
          </motion.div>
        ) : (
          <motion.div key="phone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <PhoneForm onSuccess={goHome} />
          </motion.div>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          Accounts are created by your institute. Contact your teacher for access.
        </p>
      </motion.div>

      {/* Invisible reCAPTCHA lives here for phone auth. */}
      <div id="recaptcha-container" />
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition ${
        active ? 'bg-white/10 text-indigo-300 shadow-sm' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  )
}

function EmailForm({ login, onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email.trim(), password)
      onSuccess()
    } catch (err) {
      setError(friendlyError(err.code) || 'Could not sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Email" icon={Mail}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={inputCls}
        />
      </Field>
      <Field label="Password" icon={Lock}>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className={inputCls}
        />
      </Field>

      {error && <ErrorText>{error}</ErrorText>}

      <PrimaryButton busy={busy} icon={LogIn}>
        {busy ? 'Signing in…' : 'Sign in'}
      </PrimaryButton>
    </form>
  )
}

function PhoneForm({ onSuccess }) {
  const [phone, setPhone] = useState('+91')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState('phone') // 'phone' | 'otp'
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const verifierRef = useRef(null)
  const confirmationRef = useRef(null)

  function getVerifier() {
    if (!verifierRef.current) {
      verifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' })
    }
    return verifierRef.current
  }

  function resetVerifier() {
    try {
      verifierRef.current?.clear()
    } catch {
      /* ignore */
    }
    verifierRef.current = null
  }

  async function sendOtp(e) {
    e.preventDefault()
    setError('')
    if (!/^\+\d{8,15}$/.test(phone.trim())) {
      setError('Enter your number in international format, e.g. +919876543210.')
      return
    }
    setBusy(true)
    try {
      confirmationRef.current = await signInWithPhoneNumber(auth, phone.trim(), getVerifier())
      setStep('otp')
    } catch (err) {
      resetVerifier()
      setError(friendlyError(err.code) || 'Could not send the code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyOtp(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await confirmationRef.current.confirm(otp.trim())
      onSuccess()
    } catch (err) {
      setError(friendlyError(err.code) || 'Incorrect code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'otp') {
    return (
      <form onSubmit={verifyOtp} className="space-y-4">
        <p className="text-sm text-slate-400">
          Enter the 6-digit code we sent to <span className="font-medium text-slate-200">{phone}</span>.
        </p>
        <Field label="Verification code" icon={KeyRound}>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            className={`${inputCls} tracking-[0.4em]`}
          />
        </Field>

        {error && <ErrorText>{error}</ErrorText>}

        <PrimaryButton busy={busy} icon={LogIn}>
          {busy ? 'Verifying…' : 'Verify & sign in'}
        </PrimaryButton>

        <button
          type="button"
          onClick={() => {
            setStep('phone')
            setOtp('')
            setError('')
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Change number
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={sendOtp} className="space-y-4">
      <Field label="Phone number" icon={Phone}>
        <input
          type="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+919876543210"
          className={inputCls}
        />
      </Field>

      {error && <ErrorText>{error}</ErrorText>}

      <PrimaryButton busy={busy} icon={KeyRound}>
        {busy ? 'Sending code…' : 'Send code'}
      </PrimaryButton>
    </form>
  )
}

// -------- small presentational helpers --------
const inputCls =
  'w-full rounded-xl border border-white/10 bg-black/25 py-2.5 pl-10 pr-3 text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/25'

function Field({ label, icon: Icon, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-300">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        {children}
      </div>
    </div>
  )
}

function ErrorText({ children }) {
  return <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-400">{children}</p>
}

function PrimaryButton({ busy, icon: Icon, children }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 py-2.5 font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-60"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  )
}

function friendlyError(code) {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.'
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/invalid-phone-number':
      return 'That phone number looks invalid. Use international format, e.g. +91…'
    case 'auth/missing-phone-number':
      return 'Please enter your phone number.'
    case 'auth/invalid-verification-code':
      return 'That code is incorrect. Please check and try again.'
    case 'auth/code-expired':
      return 'That code has expired. Please request a new one.'
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
      return 'reCAPTCHA check failed. Reload the page and try again.'
    case 'auth/quota-exceeded':
      return 'SMS quota exceeded for now. Please try again later.'
    default:
      return ''
  }
}
