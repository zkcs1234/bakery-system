import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { redirect } = await login(email, password);
      navigate(redirect, { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Login failed. Check your credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── LEFT PANEL ── */}
      <div 
        className="hidden lg:flex lg:w-1/2 relative flex-col overflow-hidden"
        style={{
          backgroundImage: 'url("/assets/login.jpg")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Dark overlay to maintain text readability over the image */}
        <div className="absolute inset-0 bg-blue-950/30 bg-gradient-to-b from-blue-950/20 to-blue-900/60" />
        
        {/* Background decorative elements */}
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-white/5" />
        <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full bg-white/5" />
        <div className="absolute top-1/3 right-12 w-40 h-40 rounded-full bg-white/5" />

        {/* Subtle gradient overlays */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(1200px circle at 20% 20%, rgba(30,79,173,0.3) 0%, rgba(0,0,0,0) 55%), radial-gradient(900px circle at 80% 70%, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0) 60%)',
          }}
        />

        {/* Content wrapper — 3-section: logo top | hero center | badges bottom */}
        <div className="relative z-10 flex flex-col h-full px-10 pb-10 pt-6">
          {/* ── TOP: Logo ── */}
          <div className="flex items-center">
            <div className="w-48 h-auto flex-shrink-0">
              <img
                src="/assets/shopperlogo.png"
                alt="Bakery Production Management"
                className="w-full h-auto object-contain"
              />
            </div>
          </div>

          {/* ── MIDDLE: Hero text — vertically centered ── */}
          <div className="flex-1 flex flex-col justify-center">
            <h2
              className="text-white font-display font-bold leading-tight mb-4"
              style={{
                fontSize: '2.75rem',
                textShadow: '0 2px 24px rgba(0,0,0,0.5)',
              }}
            >
              Bakery Production Management
            </h2>
            <p
              className="text-blue-100 font-body leading-relaxed max-w-sm"
              style={{
                fontSize: '1rem',
              }}
            >
              Manage orders, production plans, ingredient stock, and worker tasks — all in one console.
            </p>
          </div>

          {/* ── BOTTOM: Role badges ── */}
          <div>
            <p className="text-blue-300 text-xs uppercase tracking-widest mb-3 font-body">
              System Roles
            </p>
            <div className="flex flex-nowrap gap-1.5 overflow-hidden">
              {['Admin', 'Supervisor', 'Branch Manager', 'Scaler', 'Mixer', 'Baker', 'Repacker'].map(
                (role) => (
                  <span
                    key={role}
                    className="px-2.5 py-1 bg-blue-800/50 rounded-full text-blue-100 text-sm font-medium whitespace-nowrap shrink font-body"
                  >
                    {role}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL: login form ── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-blue-50">
        <div className="w-full max-w-sm -mt-16 lg:-mt-24">
          {/* Mobile brand */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <div className="w-48 h-auto flex-shrink-0">
              <img
                src="/assets/shopperlogo.png"
                alt="Bakery Production Management"
                className="w-full h-auto object-contain"
              />
            </div>
          </div>

          <div className="mb-8 text-center">
            <h2 className="font-display text-2xl font-semibold text-blue-950 mb-1">Welcome back</h2>
            <p className="text-slate-500 text-sm mb-8 font-body">Sign in to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="alert alert-danger flex items-center gap-2">
                <span className="text-danger">⚠</span>
                {error}
              </div>
            )}

            <fieldset disabled={loading}>
              <div>
                <label className="label">Email address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@bakery.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                />
              </div>

              <div className="mt-4">
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPw(!showPw)}
                    disabled={loading}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5 mt-4">
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </fieldset>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400 font-body">
            Forgot your password? Contact your system administrator.
          </p>
        </div>
      </div>
    </div>
  );
}

