'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard, Wallet, FileCheck2, ClipboardList, PiggyBank, Store,
  Users, ScrollText, Bell, Search, Plus, ArrowUpRight, ArrowDownRight,
  Check, X, MessageSquare, ChevronRight, Shield, Sparkles, TrendingUp,
  CircleDollarSign, Landmark, Receipt, LogOut, Eye, FileBarChart, Download,
  FileText, FileSpreadsheet, Calendar, Mail, Lock, User as UserIcon,
  ShieldCheck, UserCog, KeyRound, UserX, UserCheck, Crown,
  Send, Clock, Inbox, Zap, Upload, Paperclip, Copy, ExternalLink,
  GitCompare, Trophy, Folder
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast, Toaster } from 'sonner'

const ROLES = [
  { id: 'super_admin', name: 'Super Admin' },
  { id: 'partner', name: 'Partner' },
  { id: 'admin_officer', name: 'Admin Officer' },
]

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: Wallet },
  { id: 'documents', label: 'Documents', icon: Folder },
  { id: 'approvals', label: 'Approvals', icon: FileCheck2 },
  { id: 'quotations', label: 'Quotations', icon: ClipboardList },
  { id: 'budgets', label: 'Budgets', icon: PiggyBank },
  { id: 'vendors', label: 'Vendors', icon: Store },
  { id: 'ledger', label: 'Partner Ledger', icon: Users },
  { id: 'reports', label: 'Reports', icon: FileBarChart },
  { id: 'audit', label: 'Audit Trail', icon: ScrollText },
]

const CHART_COLORS = ['#d4af37', '#0f0f0f', '#b8860b', '#e5c76b', '#8a6b1a', '#f4d97a']

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)

const compact = (n) => {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'
  if (abs >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L'
  if (abs >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'k'
  return '₹' + n
}

const timeAgo = (iso) => {
  const d = new Date(iso); const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

async function api(path, opts = {}, user) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': user?.id || 'system',
      'x-user-name': user?.name || 'System',
      'x-user-role': user?.role || 'super_admin',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || 'Request failed')
  }
  return res.json()
}

const StatusPill = ({ status }) => {
  const map = {
    approved: { c: 'bg-emerald-100 text-emerald-800', l: 'Approved' },
    pending: { c: 'bg-amber-100 text-amber-800', l: 'Pending' },
    rejected: { c: 'bg-rose-100 text-rose-800', l: 'Rejected' },
    submitted: { c: 'bg-blue-100 text-blue-800', l: 'Submitted' },
    under_review: { c: 'bg-violet-100 text-violet-800', l: 'Under Review' },
  }
  const s = map[status] || { c: 'bg-muted text-foreground', l: status }
  return <span className={'approval-pill ' + s.c}>{s.l}</span>
}

const TypeBadge = ({ type }) => {
  const map = {
    income: { c: 'text-emerald-600', l: 'Income', icon: ArrowUpRight },
    expense: { c: 'text-rose-600', l: 'Expense', icon: ArrowDownRight },
    vendor_payment: { c: 'text-rose-600', l: 'Vendor Payment', icon: ArrowDownRight },
    investment: { c: 'text-indigo-600', l: 'Investment', icon: TrendingUp },
    partner_contribution: { c: 'text-amber-600', l: 'Partner Contribution', icon: CircleDollarSign },
  }
  const s = map[type] || { c: 'text-foreground', l: type, icon: Receipt }
  const Icon = s.icon
  return (
    <span className={'inline-flex items-center gap-1.5 text-xs font-medium ' + s.c}>
      <Icon className="h-3.5 w-3.5" /> {s.l}
    </span>
  )
}

const ConsensusBar = ({ progress, compact: mini = false }) => {
  if (!progress || !progress.required) return null
  const pct = progress.required > 0 ? (progress.approvedCount / progress.required) * 100 : 0
  const rejected = progress.rejectedCount > 0
  return (
    <div className={mini ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground uppercase tracking-wider font-semibold">
          Partner Consensus
        </span>
        <span className="font-semibold">
          {rejected ? (
            <span className="text-rose-600">{progress.rejectedCount} rejected</span>
          ) : (
            <>
              <span className="text-emerald-600">{progress.approvedCount}</span>
              <span className="text-muted-foreground"> / {progress.required} approved</span>
            </>
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={'h-full transition-all ' + (rejected ? 'bg-rose-500' : 'gold-gradient')}
          style={{ width: (rejected ? 100 : pct) + '%' }} />
      </div>
      {!mini && (
        <div className="flex items-center gap-1 flex-wrap pt-1">
          {progress.partners.map(p => (
            <div key={p.userId} title={`${p.name} · ${p.decision}`}
              className={'relative h-6 w-6 rounded-full grid place-items-center text-[9px] font-bold border-2 ' +
                (p.decision === 'approved' ? 'bg-emerald-500 text-white border-emerald-600' :
                 p.decision === 'rejected' ? 'bg-rose-500 text-white border-rose-600' :
                 'bg-muted text-muted-foreground border-border')}>
              {p.name.split(' ').map(x => x[0]).join('').slice(0, 2)}
              {p.decision === 'approved' && <Check className="absolute -top-1 -right-1 h-3 w-3 bg-emerald-600 text-white rounded-full p-0.5" />}
              {p.decision === 'rejected' && <X className="absolute -top-1 -right-1 h-3 w-3 bg-rose-600 text-white rounded-full p-0.5" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const userHasVoted = (progress, userId) =>
  progress?.partners?.some(p => p.userId === userId && p.decision !== 'pending')

const LoginScreen = ({ onLogin }) => {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [pendingSignup, setPendingSignup] = useState(null)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  const sendForgot = async () => {
    if (!forgotEmail) return toast.error('Enter your email')
    setForgotLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      })
      toast.success('If an account with that email exists, a reset email has been sent.')
      setForgotOpen(false); setForgotEmail('')
    } catch (e) { toast.error(e.message) } finally { setForgotLoading(false) }
  }

  const submit = async () => {
    setLoading(true)
    try {
      const path = mode === 'signin' ? '/auth/login' : '/auth/signup'
      const body = mode === 'signin'
        ? { email: form.email, password: form.password }
        : form
      const res = await fetch('/api' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      if (data.pending) {
        // New signup awaiting super admin approval — don't log them in
        setPendingSignup(data)
        toast.success('Account created — awaiting approval')
      } else {
        toast.success(mode === 'signin' ? 'Welcome back' : 'Account created')
        onLogin(data.user, data.token)
      }
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }

  if (pendingSignup) {
    return (
      <div className="min-h-screen dark-panel text-neutral-100 flex items-center justify-center p-6">
        <Toaster position="top-right" richColors />
        <div className="max-w-lg w-full rounded-2xl bg-neutral-950/80 border border-amber-400/30 backdrop-blur-xl p-10 text-center">
          <div className="h-16 w-16 rounded-full gold-gradient grid place-items-center mx-auto mb-4">
            <Clock className="h-8 w-8 text-neutral-900" />
          </div>
          <h1 className="font-display text-3xl font-bold">Awaiting Approval</h1>
          <p className="text-neutral-400 mt-3">
            Thank you, <b className="text-amber-300">{pendingSignup.user?.name}</b>. Your account has been created and is now pending review by a Super Admin.
          </p>
          <div className="mt-6 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-left">
            <div className="text-xs uppercase tracking-wider text-amber-300 mb-2">What happens next</div>
            <div className="text-sm text-neutral-300 space-y-2">
              <div className="flex items-start gap-2"><Check className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" /> A Super Admin will review your details</div>
              <div className="flex items-start gap-2"><Check className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" /> You&apos;ll be able to sign in once approved</div>
              <div className="flex items-start gap-2"><Check className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" /> Every step is captured in the audit trail</div>
            </div>
          </div>
          <Button onClick={() => { setPendingSignup(null); setMode('signin') }} className="mt-6 gold-gradient text-neutral-900 font-semibold">
            Back to Sign In
          </Button>
          <p className="text-[11px] text-neutral-500 mt-4">Account: {pendingSignup.user?.email}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen dark-panel text-neutral-100 flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 opacity-40 pointer-events-none"
           style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(212,175,55,0.25), transparent 40%), radial-gradient(circle at 80% 70%, rgba(212,175,55,0.15), transparent 40%)' }} />
      <div className="grid md:grid-cols-2 gap-10 max-w-5xl w-full relative">
        <div className="flex flex-col justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-400/30 bg-amber-400/5 w-fit mb-6">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-200">Premium Corporate Portal</span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl font-bold leading-tight">
            Partner<span className="gold-text">Sync</span>
          </h1>
          <p className="mt-4 text-neutral-300 text-lg max-w-md">
            Complete transparency for business partners. Every rupee, every approval, every decision — traceable, versioned, and visible.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
            {[{ l: 'Real-time', v: 'Visibility' }, { l: 'Immutable', v: 'Audit Trail' }, { l: 'Multi-level', v: 'Approvals' }].map((f) => (
              <div key={f.l} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-neutral-400">{f.l}</div>
                <div className="text-sm font-semibold gold-text">{f.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-lg border border-white/10 bg-white/5 p-5 max-w-md">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              <div className="text-xs uppercase tracking-wider text-amber-300 font-semibold">Enterprise-grade security</div>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Passwords are salted &amp; hashed with scrypt. Every sign-in, approval, and modification is captured in an immutable audit trail with timestamp, user, and IP.
            </p>
          </div>
        </div>

        <div className="rounded-2xl p-8 bg-neutral-950/80 border border-amber-400/20 backdrop-blur-xl shadow-2xl self-center">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-5 w-5 text-amber-400" />
            <h3 className="font-display text-2xl font-semibold">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h3>
          </div>
          <p className="text-sm text-neutral-400 mb-5">
            {mode === 'signin' ? 'Access your partner portal.' : 'Join as a partner or team member.'}
          </p>

          <div className="flex p-1 rounded-lg bg-neutral-900 mb-5">
            <button onClick={() => setMode('signin')}
              className={'flex-1 py-2 text-sm font-medium rounded-md transition-all ' + (mode === 'signin' ? 'gold-gradient text-neutral-900' : 'text-neutral-400 hover:text-white')}>
              Sign In
            </button>
            <button onClick={() => setMode('signup')}
              className={'flex-1 py-2 text-sm font-medium rounded-md transition-all ' + (mode === 'signup' ? 'gold-gradient text-neutral-900' : 'text-neutral-400 hover:text-white')}>
              Create Account
            </button>
          </div>

          <div className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label className="text-xs text-neutral-400 flex items-center gap-1.5"><UserIcon className="h-3 w-3" /> Full Name</label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Priya Sharma" className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
              </div>
            )}
            <div>
              <label className="text-xs text-neutral-400 flex items-center gap-1.5"><Mail className="h-3 w-3" /> Email</label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="you@company.com" className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
            </div>
            <div>
              <label className="text-xs text-neutral-400 flex items-center gap-1.5"><Lock className="h-3 w-3" /> Password</label>
              <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder={mode === 'signup' ? 'Minimum 6 characters' : '••••••••'}
                className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
            </div>
            {mode === 'signup' && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                <div className="text-xs text-amber-200 font-medium">Your role, share % and capital will be assigned by a Super Admin during approval.</div>
              </div>
            )}
          </div>

          <Button
            className="mt-6 w-full gold-gradient text-neutral-900 hover:opacity-90 font-semibold"
            disabled={loading}
            onClick={submit}
          >
            {loading ? 'Please wait…' : (mode === 'signin' ? 'Sign in' : 'Create Account')}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          {mode === 'signin' && (
            <button onClick={() => { setForgotOpen(true); setForgotEmail(form.email || '') }}
              className="mt-3 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 w-full text-center">
              Forgot password?
            </button>
          )}
          <p className="text-[11px] text-neutral-500 mt-4 text-center">Passwords are salted &amp; hashed · Every action is audit-logged</p>
        </div>
      </div>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><KeyRound className="h-5 w-5" /> Reset password</DialogTitle>
            <DialogDescription>Enter your email and we&apos;ll send a temporary password. Use it to sign in and then change your password.</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <Input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
              placeholder="you@company.com" className="mt-1" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForgotOpen(false)}>Cancel</Button>
            <Button onClick={sendForgot} disabled={forgotLoading} className="gold-gradient text-neutral-900 font-semibold">
              {forgotLoading ? 'Sending…' : 'Send reset email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const Kpi = ({ label, value, sub, icon: Icon, tone = 'default' }) => (
  <div className="kpi-tile">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <div className="mt-2 text-2xl font-display font-bold">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </div>
      {Icon && (
        <div className={'h-10 w-10 rounded-lg grid place-items-center ' +
          (tone === 'gold' ? 'gold-gradient text-neutral-900' :
           tone === 'dark' ? 'bg-neutral-900 text-amber-400' :
           'bg-muted text-foreground')}>
          <Icon className="h-5 w-5" />
        </div>
      )}
    </div>
  </div>
)

const Dashboard = ({ user, refresh }) => {
  const [data, setData] = useState(null)
  useEffect(() => {
    api('/dashboard', {}, user).then(setData).catch(e => toast.error(e.message))
  }, [user, refresh])
  if (!data) return <div className="p-6 text-muted-foreground">Loading dashboard…</div>
  const { kpis, series, pieData, recent } = data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Executive Dashboard</h1>
        <p className="text-muted-foreground">Real-time visibility into every rupee, every approval, every decision.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Kpi label="Total Budget"     value={compact(kpis.totalBudget)}    sub={`${((kpis.budgetUsed/kpis.totalBudget)*100||0).toFixed(1)}% utilized`} icon={PiggyBank} tone="gold" />
        <Kpi label="Monthly Income"   value={compact(kpis.income)}         sub="Approved inflows"        icon={ArrowUpRight} />
        <Kpi label="Monthly Expenses" value={compact(kpis.expense)}        sub="Approved outflows"       icon={ArrowDownRight} />
        <Kpi label="Net Profit"       value={compact(kpis.profit)}         sub="Income − Expenses"       icon={TrendingUp} tone="dark" />
        <Kpi label="Cash Flow"        value={compact(kpis.cashFlow)}       sub="Incl. investments"       icon={CircleDollarSign} />
        <Kpi label="Bank Balance"     value={compact(kpis.bankBalance)}    sub="Aggregated"              icon={Landmark} />
        <Kpi label="Pending Approvals" value={kpis.pendingApprovals}       sub="Requires your review"    icon={FileCheck2} tone="gold" />
        <Kpi label="Outstanding Payables" value={compact(kpis.upcomingPayments)} sub="Due to vendors"    icon={Receipt} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-lg font-semibold">Cash Flow · Last 6 Months</h3>
              <p className="text-xs text-muted-foreground">Income vs Expenses trend</p>
            </div>
            <Badge variant="outline" className="border-amber-400/40 text-amber-700">Live</Badge>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4af37" stopOpacity={0.6}/>
                    <stop offset="100%" stopColor="#d4af37" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f0f0f" stopOpacity={0.35}/>
                    <stop offset="100%" stopColor="#0f0f0f" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12}/>
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => compact(v)}/>
                <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }}/>
                <Area type="monotone" dataKey="income" stroke="#d4af37" strokeWidth={2.5} fill="url(#gInc)" />
                <Area type="monotone" dataKey="expense" stroke="#0f0f0f" strokeWidth={2} fill="url(#gExp)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="font-display text-lg font-semibold">Expense Breakdown</h3>
          <p className="text-xs text-muted-foreground mb-2">By category · approved only</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={55} outerRadius={90} dataKey="value" paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => inr(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-xs mt-2">
            {pieData.slice(0, 6).map((p, i) => (
              <div key={p.name} className="flex items-center gap-1.5 truncate">
                <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="text-muted-foreground truncate">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card">
          <div className="p-5 border-b border-border/60">
            <h3 className="font-display text-lg font-semibold">Recent Activity</h3>
            <p className="text-xs text-muted-foreground">Latest transactions across the business</p>
          </div>
          <div className="divide-y divide-border/60">
            {recent.map(t => (
              <div key={t.id} className="p-4 flex items-center gap-4 hover:bg-muted/50">
                <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <TypeBadge type={t.type} />
                    <span className="text-sm font-medium truncate">{t.description}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.category} · {t.invoiceNumber} · {t.createdByName} · {timeAgo(t.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{compact(t.amount)}</div>
                  <StatusPill status={t.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="font-display text-lg font-semibold">Quotations</h3>
          <p className="text-xs text-muted-foreground mb-4">Status snapshot</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">Submitted</span>
              <span className="font-semibold">{kpis.quotationsSubmitted}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10">
              <span className="text-sm">Approved</span>
              <span className="font-semibold text-emerald-600">{kpis.quotationsApproved}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-rose-500/10">
              <span className="text-sm">Rejected</span>
              <span className="font-semibold text-rose-600">{kpis.quotationsRejected}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg gold-gradient text-neutral-900">
              <span className="text-sm font-medium">Partner Contributions</span>
              <span className="font-bold">{compact(kpis.partnerContributions)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const UploadStatementModal = ({ user, onUploaded }) => {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0]
    if (selected) {
      if (selected.type !== 'application/pdf' && !selected.name.endsWith('.pdf')) {
        toast.error('Please select a valid PDF file.')
        return
      }
      setFile(selected)
    }
  }

  const upload = async () => {
    if (!file) return toast.error('Please select a PDF bank statement file')
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64Str = reader.result
          const res = await api('/bank-statements/upload', {
            method: 'POST',
            body: JSON.stringify({
              fileName: file.name,
              fileData: base64Str,
            })
          }, user)
          toast.success('Bank statement uploaded successfully!')
          setOpen(false)
          setFile(null)
          onUploaded()
        } catch (err) {
          toast.error(err.message || 'Failed to upload bank statement PDF')
        } finally {
          setUploading(false)
        }
      }
      reader.onerror = () => {
        toast.error('Failed to read file')
        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch (e) {
      toast.error(e.message)
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-amber-400/40 text-amber-900 dark:text-amber-300 hover:bg-amber-400/10 font-semibold">
          <Upload className="h-4 w-4 mr-1.5" /> Upload Transaction Details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Landmark className="h-5 w-5 text-amber-500" /> Upload Transaction Details
          </DialogTitle>
          <DialogDescription>
            Upload PDF transaction details or bank statements to securely store and view/download them anytime.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-amber-400/60 transition-colors bg-muted/30">
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="hidden"
              id="pdf-statement-input"
            />
            <label htmlFor="pdf-statement-input" className="cursor-pointer space-y-2 block">
              <div className="h-12 w-12 rounded-full bg-amber-500/10 text-amber-600 grid place-items-center mx-auto">
                <Paperclip className="h-6 w-6" />
              </div>
              <div className="text-sm font-medium">
                {file ? <span className="text-foreground font-semibold">{file.name}</span> : 'Click to select PDF document'}
              </div>
              <div className="text-xs text-muted-foreground">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : 'PDF transaction details or bank statement'}
              </div>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={upload} disabled={!file || uploading} className="gold-gradient text-neutral-900 font-semibold">
            {uploading ? 'Uploading…' : 'Upload Transaction Details'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const BankStatementsListModal = ({ user }) => {
  const [open, setOpen] = useState(false)
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api('/bank-statements', {}, user)
      setStatements(data)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const downloadPdf = async (id, fileName) => {
    setDownloadingId(id)
    try {
      const doc = await api(`/bank-statements/${id}`, {}, user)
      if (!doc.base64Data) throw new Error('PDF file content unavailable')

      const link = document.createElement('a')
      link.href = doc.base64Data.startsWith('data:') ? doc.base64Data : `data:application/pdf;base64,${doc.base64Data}`
      link.download = fileName || 'document.pdf'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('Downloaded original PDF')
    } catch (e) {
      toast.error(e.message || 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) load() }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
          <FileText className="h-3.5 w-3.5 mr-1" /> View Uploaded PDFs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Folder className="h-5 w-5 text-amber-500" /> Uploaded Documents
          </DialogTitle>
          <DialogDescription>
            View and download PDF transaction details and bank statements uploaded to PartnerSync.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {loading && <p className="text-xs text-muted-foreground py-4 text-center">Loading documents…</p>}
          {!loading && statements.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">No transaction documents uploaded yet.</p>
          )}
          {statements.map(st => (
            <div key={st.id} className="p-3.5 rounded-xl border border-border/60 bg-muted/30 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="truncate">{st.fileName}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Uploaded by {st.uploadedByName} · {timeAgo(st.uploadedAt)} · {(st.fileSize / 1024).toFixed(1)} KB
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-3 shrink-0"
                disabled={downloadingId === st.id}
                onClick={() => downloadPdf(st.id, st.fileName)}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                {downloadingId === st.id ? 'Downloading…' : 'Download PDF'}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const DocumentsView = ({ user, refresh, triggerRefresh }) => {
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [downloadingId, setDownloadingId] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api('/bank-statements', {}, user)
      setStatements(data)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [user, refresh])

  const downloadPdf = async (id, fileName) => {
    setDownloadingId(id)
    try {
      const doc = await api(`/bank-statements/${id}`, {}, user)
      if (!doc || !doc.base64Data) throw new Error('File data unavailable')
      const link = document.createElement('a')
      link.href = doc.base64Data.startsWith('data:') ? doc.base64Data : `data:application/pdf;base64,${doc.base64Data}`
      link.download = fileName || 'document.pdf'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('Downloaded PDF document')
    } catch (e) {
      toast.error(e.message || 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  const filtered = statements.filter(st =>
    (st.fileName || '').toLowerCase().includes(search.toLowerCase()) ||
    (st.uploadedByName || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Documents</h1>
          <p className="text-muted-foreground mt-1">
            Securely stored transaction details and PDF bank statements available to all partners.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UploadStatementModal user={user} onUploaded={() => { load(); if (triggerRefresh) triggerRefresh() }} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by document name or uploader…"
              className="pl-9"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Showing <b>{filtered.length}</b> of <b>{statements.length}</b> documents
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading documents…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Folder className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <div className="font-medium text-base text-foreground">No documents found</div>
              <p className="text-xs text-muted-foreground mt-1">
                {search ? 'Try adjusting your search query.' : 'Upload PDF transaction details or bank statements to view them here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="p-3.5">Document Name</th>
                    <th className="p-3.5">File Size</th>
                    <th className="p-3.5">Uploaded By</th>
                    <th className="p-3.5">Date Uploaded</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map(st => (
                    <tr key={st.id} className="hover:bg-muted/40">
                      <td className="p-3.5 font-medium">
                        <div className="flex items-center gap-2.5">
                          <Paperclip className="h-4 w-4 text-amber-500 shrink-0" />
                          <span className="truncate max-w-md">{st.fileName}</span>
                        </div>
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        {st.fileSize ? `${(st.fileSize / 1024).toFixed(1)} KB` : 'PDF'}
                      </td>
                      <td className="p-3.5">{st.uploadedByName}</td>
                      <td className="p-3.5 text-muted-foreground">
                        {st.uploadedAt ? timeAgo(st.uploadedAt) : '—'}
                      </td>
                      <td className="p-3.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={downloadingId === st.id}
                          onClick={() => downloadPdf(st.id, st.fileName)}
                          className="border-amber-400/40 text-amber-900 dark:text-amber-300 hover:bg-amber-400/10 font-semibold"
                        >
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          {downloadingId === st.id ? 'Downloading…' : 'Download'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const TransactionForm = ({ user, onCreated }) => {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ type: 'expense', category: '', amount: '', mode: 'bank', description: '', gstPct: 18, invoiceNumber: '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!form.amount || !form.category) return toast.error('Amount and category are required')
    setSaving(true)
    try {
      await api('/transactions', { method: 'POST', body: JSON.stringify(form) }, user)
      toast.success('Transaction submitted for approval')
      setOpen(false)
      setForm({ type: 'expense', category: '', amount: '', mode: 'bank', description: '', gstPct: 18, invoiceNumber: '' })
      onCreated()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gold-gradient text-neutral-900 hover:opacity-90 font-semibold"><Plus className="h-4 w-4 mr-1" /> New Transaction</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">New Transaction</DialogTitle>
          <DialogDescription>Every entry is logged and requires approval.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Type</label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="vendor_payment">Vendor Payment</SelectItem>
                <SelectItem value="investment">Investment</SelectItem>
                <SelectItem value="partner_contribution">Partner Contribution</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Category</label>
            <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Marketing" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Amount (₹)</label>
            <Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Payment Mode</label>
            <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">Bank Transfer</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">GST %</label>
            <Input type="number" value={form.gstPct} onChange={e => setForm({ ...form, gstPct: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Invoice #</label>
            <Input value={form.invoiceNumber} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} placeholder="Auto if empty" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Description</label>
            <Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description with context" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="gold-gradient text-neutral-900 font-semibold">{saving ? 'Submitting…' : 'Submit for Approval'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TransactionDetail = ({ tx, user, onChange }) => {
  const [text, setText] = useState('')
  const addComment = async () => {
    if (!text.trim()) return
    try {
      const c = await api(`/transactions/${tx.id}/comment`, { method: 'POST', body: JSON.stringify({ text }) }, user)
      tx.comments = [...(tx.comments || []), c]
      setText('')
      onChange()
    } catch (e) { toast.error(e.message) }
  }
  const doAction = async (action) => {
    try {
      await api(`/transactions/${tx.id}/${action}`, { method: 'POST', body: JSON.stringify({ comment: '' }) }, user)
      toast.success('Transaction ' + action + 'd')
      onChange()
    } catch (e) { toast.error(e.message) }
  }
  const downloadStatementPdf = async (statementId, fileName) => {
    try {
      const doc = await api(`/bank-statements/${statementId}`, {}, user)
      if (!doc.base64Data) throw new Error('PDF file content unavailable')
      const link = document.createElement('a')
      link.href = doc.base64Data.startsWith('data:') ? doc.base64Data : `data:application/pdf;base64,${doc.base64Data}`
      link.download = fileName || 'bank_statement.pdf'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('Downloaded original bank statement PDF')
    } catch (e) {
      toast.error(e.message || 'Download failed')
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        <div className="rounded-lg border border-border/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <TypeBadge type={tx.type} />
            <StatusPill status={tx.status} />
          </div>
          <div className="text-2xl font-display font-bold">{inr(tx.amount)}</div>
          <div className="text-xs text-muted-foreground">GST: {inr(tx.gst)} · {tx.category} · {(tx.mode||'').toUpperCase()}</div>
          <div className="text-sm mt-3">{tx.description}</div>
          <div className="text-xs text-muted-foreground mt-3 grid grid-cols-2 gap-2">
            <div><b className="text-foreground">Invoice</b>: {tx.invoiceNumber}</div>
            <div><b className="text-foreground">Created</b>: {new Date(tx.createdAt).toLocaleString()}</div>
            <div><b className="text-foreground">Created by</b>: {tx.createdByName}</div>
            <div><b className="text-foreground">Approved by</b>: {tx.approvedByName || '—'}</div>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 p-4">
          <div className="flex items-center gap-2 mb-3"><MessageSquare className="h-4 w-4" /><b className="text-sm">Discussion</b></div>
          <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
            {(tx.comments || []).length === 0 && <p className="text-xs text-muted-foreground">No comments yet. Partners can discuss and clarify here.</p>}
            {(tx.comments || []).map(c => (
              <div key={c.id} className="p-2.5 rounded bg-muted/50">
                <div className="text-xs text-muted-foreground">{c.userName} · {(c.userRole||'').replace('_',' ')} · {timeAgo(c.createdAt)}</div>
                <div className="text-sm mt-0.5">{c.text}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment…" />
            <Button onClick={addComment} variant="outline">Post</Button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {tx.status === 'pending' && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-50 p-4">
            <div className="text-sm font-semibold mb-2">Awaiting Partner Consensus</div>
            <p className="text-xs text-muted-foreground mb-3">
              Every partner must approve. Any rejection immediately rejects the entry. All votes are audit-logged.
            </p>
            <ConsensusBar progress={tx.approvalProgress} />
            {userHasVoted(tx.approvalProgress, user.id) ? (
              <div className="mt-3 p-2 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 text-center font-medium">
                ✓ You have already voted
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button onClick={() => doAction('approve')} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="h-4 w-4 mr-1" /> Approve</Button>
                <Button onClick={() => doAction('reject')} variant="destructive" className="flex-1"><X className="h-4 w-4 mr-1" /> Reject</Button>
              </div>
            )}
          </div>
        )}
        {(tx.status === 'approved' || tx.status === 'rejected') && tx.approvalProgress?.required > 0 && (
          <div className={'rounded-lg border p-4 ' + (tx.status === 'approved' ? 'border-emerald-400/40 bg-emerald-50' : 'border-rose-400/40 bg-rose-50')}>
            <div className="text-sm font-semibold mb-2">
              {tx.status === 'approved' ? '✓ Approved by all partners' : '✗ Rejected'}
            </div>
            <ConsensusBar progress={tx.approvalProgress} />
          </div>
        )}
        <div className="rounded-lg border border-border/60 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Transparency</div>
          <ul className="text-xs space-y-1.5">
            <li>✓ Logged to immutable audit trail</li>
            <li>✓ Requires unanimous partner approval</li>
            <li>✓ Every vote is timestamped and signed</li>
            <li>✓ Cannot be deleted, only versioned</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

const TransactionsView = ({ user, refresh, triggerRefresh }) => {
  const [txs, setTxs] = useState([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const load = () => api('/transactions', {}, user).then(setTxs).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [user, refresh])

  const filtered = useMemo(() => {
    return txs.filter(t => {
      if (filter !== 'all' && t.status !== filter) return false
      if (search && !`${t.description} ${t.category} ${t.invoiceNumber} ${t.createdByName} ${t.bankStatementName || ''}`.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [txs, filter, search])

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold">Transactions</h1>
            <BankStatementsListModal user={user} />
          </div>
          <p className="text-muted-foreground">Complete log with bank statement verification, approval flow, GST, and discussion threads.</p>
        </div>
        <div className="flex items-center gap-2">
          <UploadStatementModal user={user} onUploaded={() => { load(); triggerRefresh() }} />
          <TransactionForm user={user} onCreated={() => { load(); triggerRefresh() }} />
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search description, category, invoice, or user" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Description</th>
              <th className="text-left p-3">Category</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">Created By</th>
              <th className="text-left p-3">When</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filtered.map(t => (
              <tr key={t.id} className="hover:bg-muted/40">
                <td className="p-3"><TypeBadge type={t.type} /></td>
                <td className="p-3 max-w-xs">
                  <div className="font-medium truncate">{t.description}</div>
                  <div className="text-xs text-muted-foreground">{t.invoiceNumber} · {(t.mode||'').toUpperCase()}</div>
                </td>
                <td className="p-3">{t.category}</td>
                <td className="p-3 text-right font-semibold">{compact(t.amount)}</td>
                <td className="p-3">{t.createdByName}</td>
                <td className="p-3 text-muted-foreground">{timeAgo(t.createdAt)}</td>
                <td className="p-3"><StatusPill status={t.status} /></td>
                <td className="p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(t)}><Eye className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No transactions match your filter.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">Transaction Detail</DialogTitle>
            <DialogDescription>Immutable record — every action is logged.</DialogDescription>
          </DialogHeader>
          {selected && <TransactionDetail tx={selected} user={user} onChange={() => { load(); triggerRefresh() }} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ApprovalsView = ({ user, refresh, triggerRefresh }) => {
  const [txs, setTxs] = useState([])
  const [budgets, setBudgets] = useState([])
  const [quotes, setQuotes] = useState([])

  const load = async () => {
    const [t, b, q] = await Promise.all([api('/transactions', {}, user), api('/budgets', {}, user), api('/quotations', {}, user)])
    setTxs(t.filter(x => x.status === 'pending'))
    setBudgets(b.filter(x => x.status === 'pending'))
    setQuotes(q.filter(x => ['submitted', 'under_review'].includes(x.status)))
  }
  useEffect(() => { load() }, [user, refresh])

  const act = async (kind, id, action) => {
    try {
      await api(`/${kind}/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) }, user)
      toast.success(`${kind} ${action}d`)
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Approvals Center</h1>
        <p className="text-muted-foreground">Every important decision passes through here. Nothing slips.</p>
      </div>

      <Tabs defaultValue="tx">
        <TabsList className="bg-muted">
          <TabsTrigger value="tx">Transactions <Badge className="ml-2" variant="secondary">{txs.length}</Badge></TabsTrigger>
          <TabsTrigger value="bd">Budgets <Badge className="ml-2" variant="secondary">{budgets.length}</Badge></TabsTrigger>
          <TabsTrigger value="qt">Quotations <Badge className="ml-2" variant="secondary">{quotes.length}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="tx" className="mt-4 space-y-3">
          {txs.length === 0 && <div className="text-muted-foreground p-8 text-center border border-dashed rounded-xl">All caught up. No pending transactions.</div>}
          {txs.map(t => {
            const voted = userHasVoted(t.approvalProgress, user.id)
            return (
            <div key={t.id} className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2"><TypeBadge type={t.type} /><span className="text-sm font-medium">{t.description}</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{t.category} · {t.invoiceNumber} · by {t.createdByName} · {timeAgo(t.createdAt)}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-display font-bold">{inr(t.amount)}</div>
                  <div className="text-xs text-muted-foreground">GST {inr(t.gst)}</div>
                </div>
                {voted ? (
                  <div className="text-xs text-emerald-700 font-semibold px-3">✓ You voted</div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act('transactions', t.id, 'approve')} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="h-4 w-4 mr-1" /> Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => act('transactions', t.id, 'reject')}><X className="h-4 w-4 mr-1" /> Reject</Button>
                  </div>
                )}
              </div>
              <ConsensusBar progress={t.approvalProgress} />
            </div>
          )})}
        </TabsContent>

        <TabsContent value="bd" className="mt-4 space-y-3">
          {budgets.length === 0 && <div className="text-muted-foreground p-8 text-center border border-dashed rounded-xl">No pending budgets.</div>}
          {budgets.map(b => {
            const voted = userHasVoted(b.approvalProgress, user.id)
            return (
            <div key={b.id} className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{b.type} · {b.period} · by {b.createdByName}</div>
                </div>
                <div className="text-right"><div className="text-lg font-display font-bold">{inr(b.amount)}</div></div>
                {voted ? (
                  <div className="text-xs text-emerald-700 font-semibold px-3">✓ You voted</div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act('budgets', b.id, 'approve')} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="h-4 w-4 mr-1" /> Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => act('budgets', b.id, 'reject')}><X className="h-4 w-4 mr-1" /> Reject</Button>
                  </div>
                )}
              </div>
              <ConsensusBar progress={b.approvalProgress} />
            </div>
          )})}
        </TabsContent>

        <TabsContent value="qt" className="mt-4 space-y-3">
          {quotes.length === 0 && <div className="text-muted-foreground p-8 text-center border border-dashed rounded-xl">No pending quotations.</div>}
          {quotes.map(q => {
            const voted = userHasVoted(q.approvalProgress, user.id)
            return (
            <div key={q.id} className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-medium">{q.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">Vendor: {q.vendorName} · v{q.versions} · by {q.createdByName}</div>
                </div>
                <div className="text-right"><div className="text-lg font-display font-bold">{inr(q.amount)}</div></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => act('quotations', q.id, 'review')}>Under Review</Button>
                  {voted ? (
                    <div className="text-xs text-emerald-700 font-semibold px-3">✓ You voted</div>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => act('quotations', q.id, 'approve')} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="h-4 w-4 mr-1" /> Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => act('quotations', q.id, 'reject')}><X className="h-4 w-4 mr-1" /> Reject</Button>
                    </>
                  )}
                </div>
              </div>
              <ConsensusBar progress={q.approvalProgress} />
            </div>
          )})}
        </TabsContent>
      </Tabs>
    </div>
  )
}

const CompareQuotations = ({ user, refresh }) => {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api('/quotations/compare', {}, user)
      .then(setGroups)
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [user, refresh])

  if (loading) return <div className="p-6 text-muted-foreground">Comparing vendor bids…</div>
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-10 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-muted grid place-items-center mb-3">
          <GitCompare className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-display text-lg font-semibold">No competing bids yet</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          As soon as two or more vendors bid on similar work, we&apos;ll automatically compare them side-by-side and highlight the biggest savings.
        </p>
      </div>
    )
  }

  const totalSavings = groups.reduce((s, g) => s + g.savings, 0)

  return (
    <div className="space-y-5">
      <div className="rounded-xl gold-gradient p-5 text-neutral-900">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold">Total Potential Savings</div>
            <div className="font-display text-3xl font-bold">{inr(totalSavings)}</div>
            <div className="text-xs mt-1">across {groups.length} comparison group{groups.length === 1 ? '' : 's'}</div>
          </div>
          <GitCompare className="h-12 w-12 opacity-80" />
        </div>
      </div>

      {groups.map(g => (
        <div key={g.key} className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <div className="p-5 border-b border-border/60 bg-muted/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="gold-gradient text-neutral-900 border-0">{g.label}</Badge>
                <h3 className="font-display text-lg font-semibold">{g.count} competing bid{g.count === 1 ? '' : 's'}</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Auto-grouped by shared keyword. Lowest bidder highlighted in gold.</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div><span className="text-muted-foreground text-xs uppercase tracking-wider">Low</span> <div className="font-semibold">{compact(g.lowestAmount)}</div></div>
              <div><span className="text-muted-foreground text-xs uppercase tracking-wider">Avg</span> <div className="font-semibold">{compact(g.avgAmount)}</div></div>
              <div><span className="text-muted-foreground text-xs uppercase tracking-wider">High</span> <div className="font-semibold">{compact(g.highestAmount)}</div></div>
              <div className="pl-4 border-l border-border">
                <span className="text-muted-foreground text-xs uppercase tracking-wider">Savings</span>
                <div className="font-display text-lg font-bold gold-text">{compact(g.savings)} · {g.savingsPct}%</div>
              </div>
            </div>
          </div>

          <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {g.items.map(it => {
              const isLowest = it.id === g.lowestId
              const diffFromLow = it.amount - g.lowestAmount
              const diffPct = g.lowestAmount > 0 ? (diffFromLow / g.lowestAmount) * 100 : 0
              return (
                <div key={it.id}
                  className={'relative rounded-xl border-2 p-4 transition ' +
                    (isLowest ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-500/5 shadow-lg' : 'border-border/60 bg-background')}>
                  {isLowest && (
                    <div className="absolute -top-3 left-4">
                      <Badge className="gold-gradient text-neutral-900 border-0 shadow-md">
                        <Trophy className="h-3 w-3 mr-1" /> Best Price
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{it.vendorName || 'Unknown vendor'}</div>
                      <div className="text-xs text-muted-foreground truncate">{it.title}</div>
                    </div>
                    <StatusPill status={it.status} />
                  </div>
                  <div className="mt-3 pt-3 border-t border-border/40 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">Bid</div>
                      <div className="font-display text-2xl font-bold">{inr(it.amount)}</div>
                    </div>
                    {!isLowest && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold">vs best</div>
                        <div className="text-sm font-semibold text-rose-600">+{compact(diffFromLow)}</div>
                        <div className="text-[10px] text-rose-600">+{diffPct.toFixed(1)}%</div>
                      </div>
                    )}
                    {isLowest && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">Save vs highest</div>
                        <div className="text-sm font-semibold text-emerald-600">−{compact(g.highestAmount - it.amount)}</div>
                        <div className="text-[10px] text-emerald-600">{g.savingsPct}% off</div>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{it.vendorEmail || '—'}</span>
                    <span>{(it.files?.length || 0)} file{(it.files?.length || 0) === 1 ? '' : 's'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const QuotationsView = ({ user, refresh, triggerRefresh }) => {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', vendorName: '', vendorEmail: '', vendorPhone: '', amount: '', notes: '' })
  const [pickedFiles, setPickedFiles] = useState([])
  const [copied, setCopied] = useState(false)
  const [viewFiles, setViewFiles] = useState(null)

  const load = () => api('/quotations', {}, user).then(setItems)
  useEffect(() => { load() }, [user, refresh])

  const vendorUrl = typeof window !== 'undefined' ? `${window.location.origin}/vendor` : '/vendor'
  const copyLink = () => {
    try {
      navigator.clipboard.writeText(vendorUrl)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
      toast.success('Vendor portal link copied')
    } catch { toast.error('Copy failed — select and copy manually') }
  }

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result.split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
  const onPickFiles = async (fl) => {
    const list = Array.from(fl || [])
    const next = [...pickedFiles]
    for (const f of list) {
      if (next.length >= 5) { toast.error('Max 5 files'); break }
      if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} exceeds 5MB`); continue }
      const data = await fileToBase64(f)
      next.push({ name: f.name, type: f.type, size: f.size, data })
    }
    setPickedFiles(next)
  }

  const submit = async () => {
    if (!form.title || !form.amount) return toast.error('Title and amount required')
    try {
      await api('/quotations', { method: 'POST', body: JSON.stringify({ ...form, files: pickedFiles, source: 'internal' }) }, user)
      toast.success('Quotation submitted')
      setOpen(false)
      setForm({ title: '', vendorName: '', vendorEmail: '', vendorPhone: '', amount: '', notes: '' })
      setPickedFiles([])
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) }
  }

  const downloadFile = async (q, fid, name) => {
    try {
      const f = await api(`/quotations/${q.id}/files/${fid}`, {}, user)
      const a = document.createElement('a')
      a.href = `data:${f.type};base64,${f.data}`
      a.download = f.name || name
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Quotations</h1>
          <p className="text-muted-foreground">Version-controlled, comparable, and fully auditable. Vendors can also submit via the public portal.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gold-gradient text-neutral-900 hover:opacity-90 font-semibold"><Plus className="h-4 w-4 mr-1" /> New Quotation</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Submit Quotation</DialogTitle></DialogHeader>
            <div className="space-y-3 max-h-[70vh] overflow-y-auto scrollbar-thin pr-2">
              <div><label className="text-xs text-muted-foreground">Title *</label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Vendor Name</label><Input value={form.vendorName} onChange={e => setForm({ ...form, vendorName: e.target.value })} /></div>
                <div><label className="text-xs text-muted-foreground">Amount *</label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Vendor Email</label><Input type="email" value={form.vendorEmail} onChange={e => setForm({ ...form, vendorEmail: e.target.value })} /></div>
                <div><label className="text-xs text-muted-foreground">Vendor Phone</label><Input value={form.vendorPhone} onChange={e => setForm({ ...form, vendorPhone: e.target.value })} /></div>
              </div>
              <div><label className="text-xs text-muted-foreground">Notes</label><Textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Supporting Documents (max 5 · 5MB each)</label>
                <label className="block cursor-pointer rounded-lg border-2 border-dashed border-border p-4 text-center hover:border-amber-400/60 transition">
                  <input type="file" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" className="hidden"
                    onChange={e => onPickFiles(e.target.files)} />
                  <Upload className="h-5 w-5 mx-auto text-amber-500 mb-1" />
                  <div className="text-xs font-medium">Click to attach files</div>
                </label>
                {pickedFiles.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {pickedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded bg-muted/50 text-xs">
                        <FileText className="h-3.5 w-3.5 text-amber-600" />
                        <span className="flex-1 truncate">{f.name}</span>
                        <span className="text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span>
                        <button onClick={() => setPickedFiles(pickedFiles.filter((_, x) => x !== i))} className="text-muted-foreground hover:text-rose-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} className="gold-gradient text-neutral-900 font-semibold">Submit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border border-amber-400/30 bg-gradient-to-r from-amber-50/60 to-white dark:from-amber-500/5 dark:to-transparent p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <ExternalLink className="h-4 w-4 text-amber-600" />
              <h3 className="font-display text-lg font-semibold">Public Vendor Portal</h3>
              <Badge className="gold-gradient text-neutral-900 border-0">Live</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">Share this link so any vendor can submit a quotation directly (no login required). Every submission lands here for review.</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={vendorUrl} className="font-mono text-xs" />
              <Button onClick={copyLink} variant="outline" className="border-amber-400/40">
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />} {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button asChild variant="outline">
                <a href={vendorUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open</a>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="all">
        <TabsList className="bg-muted">
          <TabsTrigger value="all">All Quotations <Badge className="ml-2" variant="secondary">{items.length}</Badge></TabsTrigger>
          <TabsTrigger value="compare"><GitCompare className="h-3.5 w-3.5 mr-1.5" /> Compare Vendors</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map(q => (
              <div key={q.id} className="rounded-xl border border-border/60 bg-card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-display text-lg font-semibold truncate">{q.title}</div>
                      {q.source === 'vendor_portal' && (
                        <Badge variant="outline" className="border-amber-400/40 text-amber-700 dark:text-amber-400">
                          <ExternalLink className="h-3 w-3 mr-1" /> Vendor Submitted
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Vendor: {q.vendorName || '—'} · v{q.versions}
                      {q.vendorEmail && ` · ${q.vendorEmail}`}
                    </div>
                  </div>
                  <StatusPill status={q.status} />
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <div className="text-2xl font-display font-bold">{inr(q.amount)}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    By {q.createdByName}<br />{timeAgo(q.createdAt)}
                  </div>
                </div>
                {q.files && q.files.length > 0 && (
                  <button onClick={() => setViewFiles(q)}
                    className="mt-4 w-full flex items-center gap-2 p-2.5 rounded-lg border border-border/60 hover:border-amber-400/60 hover:bg-amber-50/40 dark:hover:bg-amber-500/5 transition text-left">
                    <Paperclip className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium">{q.files.length} file{q.files.length === 1 ? '' : 's'} attached</span>
                    <span className="text-xs text-muted-foreground ml-auto">Click to view →</span>
                  </button>
                )}
                {q.approvalProgress?.required > 0 && (
                  <div className="mt-4 pt-3 border-t border-border/60">
                    <ConsensusBar progress={q.approvalProgress} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="compare" className="mt-4">
          <CompareQuotations user={user} refresh={refresh} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!viewFiles} onOpenChange={(o) => !o && setViewFiles(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Paperclip className="h-5 w-5" /> Attachments</DialogTitle>
            <DialogDescription>{viewFiles?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {viewFiles?.files?.map(f => (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/40">
                <FileText className="h-5 w-5 text-amber-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB · uploaded by {f.uploadedBy}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadFile(viewFiles, f.id, f.name)}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const BudgetsView = ({ user, refresh, triggerRefresh }) => {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'operational', amount: '', period: String(new Date().getFullYear()) })
  const load = () => api('/budgets', {}, user).then(setItems)
  useEffect(() => { load() }, [user, refresh])

  const submit = async () => {
    if (!form.name || !form.amount) return toast.error('Name and amount required')
    try {
      await api('/budgets', { method: 'POST', body: JSON.stringify(form) }, user)
      toast.success('Budget created')
      setOpen(false); setForm({ name: '', type: 'operational', amount: '', period: String(new Date().getFullYear()) })
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Budgets</h1>
          <p className="text-muted-foreground">Plan, approve, and monitor spend versus plan.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gold-gradient text-neutral-900 hover:opacity-90 font-semibold"><Plus className="h-4 w-4 mr-1" /> New Budget</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display">Create Budget</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><label className="text-xs text-muted-foreground">Name</label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="text-xs text-muted-foreground">Type</label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="operational">Operational</SelectItem>
                    <SelectItem value="capex">Capital Expenditure</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><label className="text-xs text-muted-foreground">Amount</label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><label className="text-xs text-muted-foreground">Period</label><Input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} className="gold-gradient text-neutral-900 font-semibold">Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {items.map(b => {
          const pct = Math.min(100, ((b.utilized||0) / (b.amount||1)) * 100)
          return (
            <div key={b.id} className="rounded-xl border border-border/60 bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-display text-lg font-semibold">{b.name}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">{b.type} · {b.period}</div>
                </div>
                <StatusPill status={b.status} />
              </div>
              <div className="mt-4 flex items-end justify-between text-sm">
                <div><div className="text-xs text-muted-foreground">Utilized</div><div className="font-semibold">{inr(b.utilized || 0)}</div></div>
                <div className="text-right"><div className="text-xs text-muted-foreground">Total</div><div className="font-semibold">{inr(b.amount)}</div></div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                <div className={'h-full ' + (pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'gold-gradient')} style={{ width: pct + '%' }} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{pct.toFixed(1)}% consumed · created by {b.createdByName}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const VendorsView = ({ user }) => {
  const [items, setItems] = useState([])
  useEffect(() => { api('/vendors', {}, user).then(setItems) }, [user])
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold">Vendors</h1>
        <p className="text-muted-foreground">Master data, ratings, and payment status at a glance.</p>
      </div>
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-3">Vendor</th>
              <th className="text-left p-3">Category</th>
              <th className="text-right p-3">Total Purchases</th>
              <th className="text-right p-3">Pending Payment</th>
              <th className="text-right p-3">Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map(v => (
              <tr key={v.id} className="hover:bg-muted/40">
                <td className="p-3 font-medium">{v.name}</td>
                <td className="p-3">{v.category}</td>
                <td className="p-3 text-right">{compact(v.totalPurchases)}</td>
                <td className="p-3 text-right">
                  {v.pendingPayment > 0
                    ? <span className="text-rose-600 font-medium">{compact(v.pendingPayment)}</span>
                    : <span className="text-emerald-600">Clear</span>}
                </td>
                <td className="p-3 text-right">
                  <span className="inline-flex items-center gap-1 text-amber-500">★ {v.rating}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

const LedgerView = ({ user }) => {
  const [data, setData] = useState(null)
  useEffect(() => { api('/ledger', {}, user).then(setData) }, [user])
  if (!data) return <div className="p-6 text-muted-foreground">Loading…</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold">Partner Ledger</h1>
        <p className="text-muted-foreground">Individual capital, share, and profit distribution.</p>
      </div>
      <div className="rounded-xl gold-gradient p-5 text-neutral-900">
        <div className="text-xs uppercase tracking-wider">Total Distributable Profit</div>
        <div className="font-display text-3xl font-bold">{inr(data.totalProfit)}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.partners.map(p => (
          <div key={p.id} className="rounded-xl border border-border/60 bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-lg font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground">{(p.role||'').replace('_', ' ')} · {p.email}</div>
              </div>
              <Badge variant="outline" className="border-amber-400/40">{p.share}% share</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Capital</div><div className="font-semibold">{inr(p.capital)}</div></div>
              <div><div className="text-xs text-muted-foreground">Add&apos;l Invest.</div><div className="font-semibold">{inr(p.additionalInvestment)}</div></div>
              <div><div className="text-xs text-muted-foreground">Profit Share</div><div className="font-semibold text-emerald-600">{inr(p.profitShare)}</div></div>
              <div><div className="text-xs text-muted-foreground">Withdrawals</div><div className="font-semibold">{inr(p.withdrawals)}</div></div>
            </div>
            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Outstanding Balance</span>
              <span className="font-display text-xl font-bold gold-text">{inr(p.outstandingBalance)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const AuditView = ({ user, refresh }) => {
  const [logs, setLogs] = useState([])
  useEffect(() => { api('/audit', {}, user).then(setLogs) }, [user, refresh])
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold">Audit Trail</h1>
        <p className="text-muted-foreground">Immutable record. Every action, every change — forever traceable.</p>
      </div>
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="divide-y divide-border/60">
          {logs.map(l => (
            <div key={l.id} className="p-4 flex items-start gap-4 hover:bg-muted/40">
              <div className="h-9 w-9 rounded-lg gold-gradient text-neutral-900 grid place-items-center flex-shrink-0">
                <ScrollText className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{l.action}</span>
                  <Badge variant="outline">{l.entity}</Badge>
                  <span className="text-xs text-muted-foreground">by {l.userName} ({(l.userRole||'').replace('_', ' ')})</span>
                </div>
                {l.reason && <div className="text-sm mt-1 text-muted-foreground">&quot;{l.reason}&quot;</div>}
                {(l.after?.amount || l.before?.amount) && (
                  <div className="text-xs mt-1">
                    {l.before?.amount != null && <span className="text-muted-foreground">Was: {inr(l.before.amount)} · </span>}
                    {l.after?.amount != null && <span className="text-foreground">Now: {inr(l.after.amount)}</span>}
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground text-right flex-shrink-0">
                <div>{new Date(l.createdAt).toLocaleString()}</div>
                <div>{timeAgo(l.createdAt)}</div>
              </div>
            </div>
          ))}
          {logs.length === 0 && <div className="p-8 text-center text-muted-foreground">No entries yet.</div>}
        </div>
      </div>
    </div>
  )
}

const ReportsView = ({ user }) => {
  const [period, setPeriod] = useState('month')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const d = await api(`/reports?period=${period}&date=${date}`, {}, user)
      setData(d)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [period, date])

  const downloadCsv = () => {
    const url = `/api/reports?period=${period}&date=${date}&format=csv`
    const a = document.createElement('a')
    a.href = url
    a.download = `PartnerSync_${period}_${date}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    toast.success('CSV download started')
  }

  const downloadPdf = async () => {
    if (!data) return
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      const W = doc.internal.pageSize.getWidth()

      // Header band
      doc.setFillColor(15, 15, 15)
      doc.rect(0, 0, W, 80, 'F')
      doc.setFillColor(212, 175, 55)
      doc.rect(0, 78, W, 3, 'F')

      doc.setTextColor(244, 217, 122)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
      doc.text('PartnerSync', 40, 35)
      doc.setTextColor(230, 230, 230)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      doc.text('Partner Transparency & Financial Management', 40, 52)
      doc.setTextColor(180, 180, 180)
      doc.setFontSize(8)
      doc.text('Generated: ' + new Date(data.meta.generatedAt).toLocaleString('en-IN'), W - 40, 35, { align: 'right' })
      doc.text('By: ' + data.meta.generatedBy + ' (' + data.meta.generatedByRole + ')', W - 40, 48, { align: 'right' })
      doc.text('Period: ' + data.meta.label, W - 40, 61, { align: 'right' })

      // Title
      let y = 110
      doc.setTextColor(15, 15, 15)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
      doc.text('Financial Report — ' + data.meta.label, 40, y)
      y += 10
      doc.setDrawColor(212, 175, 55); doc.setLineWidth(1.5)
      doc.line(40, y, 200, y)

      // Summary block
      y += 25
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 15, 15)
      doc.text('Summary', 40, y)
      y += 8

      const s = data.summary
      const summaryRows = [
        ['Income', inr(s.income)],
        ['Expenses', inr(s.expense)],
        ['Net Profit', inr(s.profit)],
        ['Investments', inr(s.investment)],
        ['Partner Contributions', inr(s.contributions)],
        ['GST Collected', inr(s.gstCollected)],
        ['GST Paid', inr(s.gstPaid)],
        ['Net GST', inr(s.netGst)],
        ['Transactions', `${s.transactionCount} (Approved: ${s.approvedCount}, Pending: ${s.pendingCount}, Rejected: ${s.rejectedCount})`],
      ]
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 6 },
        headStyles: { fillColor: [15, 15, 15], textColor: [244, 217, 122] },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180 }, 1: { halign: 'right' } },
        head: [['Metric', 'Value']],
        body: summaryRows,
      })
      y = doc.lastAutoTable.finalY + 20

      // Category breakdown
      if (data.byCategory.length > 0) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 15, 15)
        doc.text('Expenses by Category', 40, y); y += 6
        autoTable(doc, {
          startY: y, theme: 'striped',
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [212, 175, 55], textColor: [15, 15, 15] },
          columnStyles: { 1: { halign: 'right' } },
          head: [['Category', 'Amount']],
          body: data.byCategory.map(c => [c.name, inr(c.amount)]),
        })
        y = doc.lastAutoTable.finalY + 20
      }

      // Transactions
      if (data.transactions.length > 0) {
        if (y > 700) { doc.addPage(); y = 60 }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 15, 15)
        doc.text('Transactions', 40, y); y += 6
        autoTable(doc, {
          startY: y, theme: 'grid',
          styles: { fontSize: 7, cellPadding: 4, overflow: 'linebreak' },
          headStyles: { fillColor: [15, 15, 15], textColor: [244, 217, 122] },
          columnStyles: {
            0: { cellWidth: 60 }, 1: { cellWidth: 55 }, 2: { cellWidth: 60 },
            3: { cellWidth: 140 }, 4: { cellWidth: 55, halign: 'right' }, 5: { cellWidth: 45 }, 6: { cellWidth: 70 },
          },
          head: [['Date', 'Type', 'Category', 'Description', 'Amount', 'Status', 'Created By']],
          body: data.transactions.slice(0, 200).map(t => [
            new Date(t.createdAt).toLocaleDateString('en-IN'),
            t.type.replace('_', ' '), t.category,
            t.description, inr(t.amount), t.status, t.createdByName,
          ]),
        })
      }

      // Footer on every page
      const pages = doc.internal.getNumberOfPages()
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i)
        const H = doc.internal.pageSize.getHeight()
        doc.setFontSize(7); doc.setTextColor(120, 120, 120)
        doc.text('PartnerSync · Confidential · Immutable audit-logged document', 40, H - 20)
        doc.text(`Page ${i} of ${pages}`, W - 40, H - 20, { align: 'right' })
      }

      doc.save(`PartnerSync_${period}_${date}.pdf`)
      toast.success('PDF downloaded')
    } catch (e) { toast.error('PDF failed: ' + e.message) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Generate & download financial reports for any period — day, month, quarter, or year.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Period</label>
            <div className="mt-2 grid grid-cols-4 gap-1 p-1 rounded-lg bg-muted">
              {['day', 'month', 'quarter', 'year'].map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={'py-1.5 text-xs font-semibold rounded-md capitalize transition-all ' +
                    (period === p ? 'gold-gradient text-neutral-900 shadow' : 'text-muted-foreground hover:text-foreground')}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Anchor Date</label>
            <div className="mt-2 relative">
              <Calendar className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="date" className="pl-9" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div className="md:col-span-2 flex items-end justify-end gap-2">
            <Button onClick={downloadCsv} variant="outline" className="border-amber-400/40">
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> CSV
            </Button>
            <Button onClick={downloadPdf} className="gold-gradient text-neutral-900 hover:opacity-90 font-semibold">
              <FileText className="h-4 w-4 mr-1.5" /> Download PDF
            </Button>
          </div>
        </div>
      </div>

      {loading && <div className="p-6 text-muted-foreground">Generating report…</div>}

      {data && (
        <>
          <div className="rounded-xl border border-border/60 bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Report Period</div>
                <div className="font-display text-2xl font-bold">{data.meta.label}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(data.meta.startDate).toLocaleDateString('en-IN')} → {new Date(data.meta.endDate).toLocaleDateString('en-IN')}
                </div>
              </div>
              <Badge className="gold-gradient text-neutral-900 border-0">Generated {new Date(data.meta.generatedAt).toLocaleString('en-IN')}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="Income" value={compact(data.summary.income)} sub={`${data.summary.approvedCount} approved`} icon={ArrowUpRight} tone="gold" />
            <Kpi label="Expenses" value={compact(data.summary.expense)} sub="Incl. vendor payments" icon={ArrowDownRight} />
            <Kpi label="Net Profit" value={compact(data.summary.profit)} sub="Income − Expenses" icon={TrendingUp} tone="dark" />
            <Kpi label="Net GST" value={compact(data.summary.netGst)} sub={`Coll: ${compact(data.summary.gstCollected)} · Paid: ${compact(data.summary.gstPaid)}`} icon={Receipt} />
            <Kpi label="Investments" value={compact(data.summary.investment)} sub="Capex & assets" icon={CircleDollarSign} />
            <Kpi label="Partner Contributions" value={compact(data.summary.contributions)} sub="Capital infusion" icon={PiggyBank} />
            <Kpi label="Transactions" value={data.summary.transactionCount} sub={`${data.summary.approvedCount} approved · ${data.summary.pendingCount} pending`} icon={FileCheck2} />
            <Kpi label="Rejected" value={data.summary.rejectedCount} sub="Declined entries" icon={X} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <h3 className="font-display text-lg font-semibold mb-3">Expenses by Category</h3>
              {data.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No expenses in this period.</p>}
              <div className="space-y-2">
                {data.byCategory.map((c) => {
                  const max = Math.max(...data.byCategory.map(x => x.amount), 1)
                  const w = (c.amount / max) * 100
                  return (
                    <div key={c.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">{inr(c.amount)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full gold-gradient" style={{ width: w + '%' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-5">
              <h3 className="font-display text-lg font-semibold mb-3">Activity by Partner</h3>
              {data.byPartner.length === 0 && <p className="text-sm text-muted-foreground">No activity in this period.</p>}
              <div className="space-y-3">
                {data.byPartner.map(p => (
                  <div key={p.name} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                    <div className="h-9 w-9 rounded-full gold-gradient text-neutral-900 grid place-items-center text-xs font-bold">
                      {p.name.split(' ').map(x => x[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.count} transactions</div>
                    </div>
                    <div className="font-semibold">{compact(p.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <div className="p-5 border-b border-border/60 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">Detailed Transactions</h3>
                <p className="text-xs text-muted-foreground">{data.transactions.length} entries in {data.meta.label}</p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Description</th>
                    <th className="text-left p-3">Category</th>
                    <th className="text-right p-3">Amount</th>
                    <th className="text-right p-3">GST</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Created By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.transactions.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No transactions in this period.</td></tr>}
                  {data.transactions.map(t => (
                    <tr key={t.id} className="hover:bg-muted/40">
                      <td className="p-3 text-xs">{new Date(t.createdAt).toLocaleDateString('en-IN')}</td>
                      <td className="p-3"><TypeBadge type={t.type} /></td>
                      <td className="p-3 max-w-xs truncate">{t.description}</td>
                      <td className="p-3">{t.category}</td>
                      <td className="p-3 text-right font-semibold">{compact(t.amount)}</td>
                      <td className="p-3 text-right text-muted-foreground">{compact(t.gst)}</td>
                      <td className="p-3"><StatusPill status={t.status} /></td>
                      <td className="p-3 text-xs">{t.createdByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const EmailCenter = ({ user, refresh, triggerRefresh }) => {
  const [settings, setSettings] = useState(null)
  const [sent, setSent] = useState([])
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const [s, e] = await Promise.all([api('/email/settings', {}, user), api('/email/sent', {}, user)])
      setSettings(s); setSent(e)
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [user, refresh])

  const saveSettings = async (patch) => {
    setSaving(true)
    try {
      const s = await api('/email/settings', { method: 'PATCH', body: JSON.stringify(patch) }, user)
      setSettings(s)
      toast.success('Settings saved')
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const sendNow = async () => {
    setSending(true)
    try {
      const r = await api('/email/send-now', { method: 'POST', body: JSON.stringify({ period: settings?.period || 'day' }) }, user)
      if (r.failCount > 0) {
        toast.warning(`${r.okCount} of ${r.recipientCount} sent via ${r.provider}. ${r.failCount} failed — check inbox for details.`)
      } else {
        toast.success(`${r.okCount} report emails sent via ${r.provider}`)
      }
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) } finally { setSending(false) }
  }

  const openEmail = async (row) => {
    setSelected(row); setDetail(null)
    try {
      const d = await api(`/email/sent/${row.id}`, {}, user)
      setDetail(d)
    } catch (e) { toast.error(e.message) }
  }

  const grouped = useMemo(() => {
    const map = new Map()
    sent.forEach(s => {
      if (!map.has(s.batchId)) map.set(s.batchId, { batchId: s.batchId, sentAt: s.sentAt, label: s.reportLabel, period: s.period, triggeredBy: s.triggeredBy, provider: s.provider, items: [] })
      map.get(s.batchId).items.push(s)
    })
    return [...map.values()].sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
  }, [sent])

  if (!settings) return <div className="p-6 text-muted-foreground">Loading email center…</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg gold-gradient grid place-items-center text-neutral-900"><Send className="h-5 w-5" /></div>
        <div>
          <h1 className="font-display text-3xl font-bold">Email Center</h1>
          <p className="text-muted-foreground">Automated daily report delivery to every partner. Demo mode — swap in Resend/SendGrid to go live.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-lg font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" /> Daily Schedule</h3>
              <p className="text-xs text-muted-foreground">Reports go out automatically once per day at the configured time.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{settings.enabled ? 'Enabled' : 'Paused'}</span>
              <button onClick={() => saveSettings({ enabled: !settings.enabled })}
                className={'relative w-11 h-6 rounded-full transition ' + (settings.enabled ? 'gold-gradient' : 'bg-muted-foreground/40')}>
                <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (settings.enabled ? 'left-5' : 'left-0.5')} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Hour (24h)</label>
              <Input type="number" min={0} max={23} value={settings.hour}
                onChange={e => setSettings({ ...settings, hour: Number(e.target.value) })}
                onBlur={() => saveSettings({ hour: settings.hour })}
                className="mt-2" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Minute</label>
              <Input type="number" min={0} max={59} value={settings.minute}
                onChange={e => setSettings({ ...settings, minute: Number(e.target.value) })}
                onBlur={() => saveSettings({ minute: settings.minute })}
                className="mt-2" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Report Period</label>
              <Select value={settings.period} onValueChange={(v) => { setSettings({ ...settings, period: v }); saveSettings({ period: v }) }}>
                <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Previous Day</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="quarter">This Quarter</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Recipients</label>
              <Select value={settings.recipients} onValueChange={(v) => { setSettings({ ...settings, recipients: v }); saveSettings({ recipients: v }) }}>
                <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="partners">Partners only</SelectItem>
                  <SelectItem value="all_active">All active users</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-5 rounded-lg bg-muted/40 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-600" />
              <div>
                <div className="text-sm font-medium">
                  Next automatic send: {String(settings.hour).padStart(2,'0')}:{String(settings.minute).padStart(2,'0')} daily
                </div>
                <div className="text-xs text-muted-foreground">
                  {settings.lastSentAt
                    ? `Last sent: ${new Date(settings.lastSentAt).toLocaleString('en-IN')} · ${settings.lastRecipientCount || 0} recipients`
                    : 'No send has run yet.'}
                </div>
              </div>
            </div>
            <Button onClick={sendNow} disabled={sending} className="gold-gradient text-neutral-900 font-semibold">
              <Send className="h-4 w-4 mr-1.5" /> {sending ? 'Sending…' : 'Send Now'}
            </Button>
          </div>
        </div>

        <div className={'rounded-xl border p-5 ' + (settings.provider === 'resend'
          ? 'border-emerald-400/40 bg-emerald-50/40 dark:bg-emerald-500/5'
          : 'border-amber-400/30 bg-amber-50/50 dark:bg-amber-500/5')}>
          <div className="flex items-center gap-2 mb-3">
            <Badge className={settings.provider === 'resend'
              ? 'bg-emerald-600 text-white border-0'
              : 'gold-gradient text-neutral-900 border-0'}>
              {settings.provider === 'resend' ? '⚡ Resend · Live' : 'Demo Mode'}
            </Badge>
          </div>
          {settings.provider === 'resend' ? (
            <>
              <div className="text-sm font-medium mb-2">Real emails are being delivered through Resend.</div>
              <p className="text-xs text-muted-foreground mb-3">
                From: <b className="text-foreground">{settings.from}</b><br/>
                Every send records the provider ID and delivery status.
              </p>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>✓ Sandbox sender <b className="text-foreground">onboarding@resend.dev</b></div>
                <div>✓ Only delivers to the email you signed up to Resend with, or <span className="font-mono">delivered@resend.dev</span></div>
                <div>→ Verify your domain in Resend and update <b className="text-foreground">RESEND_FROM</b> to send to any address</div>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium mb-2">Emails are stored in the portal inbox instead of being sent to real inboxes.</div>
              <p className="text-xs text-muted-foreground mb-3">
                Click any sent email below to preview the exact HTML each partner would receive.
              </p>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>✓ Scheduler is <b className="text-foreground">live</b> — checks on every API request</div>
                <div>✓ Idempotent — only one batch per day</div>
                <div>✓ Every send is audit-logged</div>
                <div>→ Set <b className="text-foreground">RESEND_API_KEY</b> in .env to go live</div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="p-5 border-b border-border/60 flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold flex items-center gap-2"><Inbox className="h-4 w-4" /> Sent Emails</h3>
            <p className="text-xs text-muted-foreground">{sent.length} total across {grouped.length} batches. Click any row to preview the actual email.</p>
          </div>
        </div>
        {grouped.length === 0 && <div className="p-8 text-center text-muted-foreground">No emails sent yet. Click <b>Send Now</b> to trigger the first batch.</div>}
        <div className="divide-y divide-border/60 max-h-[600px] overflow-y-auto scrollbar-thin">
          {grouped.map(b => (
            <div key={b.batchId} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg gold-gradient text-neutral-900 grid place-items-center"><Send className="h-4 w-4" /></div>
                  <div>
                    <div className="font-medium">{b.label} · <span className="uppercase text-xs text-muted-foreground">{b.period}</span></div>
                    <div className="text-xs text-muted-foreground">Sent {new Date(b.sentAt).toLocaleString('en-IN')} · by {b.triggeredBy} · {b.items.length} recipient{b.items.length === 1 ? '' : 's'}</div>
                  </div>
                </div>
                <Badge variant="outline" className="capitalize">{b.provider}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {b.items.map(it => {
                  const isOk = it.status === 'accepted' || it.status === 'delivered'
                  const isFail = it.status === 'failed'
                  return (
                  <button key={it.id} onClick={() => openEmail(it)}
                    className="text-left p-3 rounded-lg border border-border/60 hover:border-amber-400/60 hover:bg-amber-50/30 dark:hover:bg-amber-500/5 transition">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-muted grid place-items-center text-[10px] font-bold">
                        {it.toName.split(' ').map(x => x[0]).join('').slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{it.toName}</div>
                        <div className="text-xs text-muted-foreground truncate">{it.to}</div>
                      </div>
                      <span className={'approval-pill text-[10px] ' + (isOk ? 'bg-emerald-100 text-emerald-800' : isFail ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}>
                        {isOk ? '✓ ' + it.status : isFail ? '✗ failed' : it.status}
                      </span>
                    </div>
                    <div className="mt-2 text-xs grid grid-cols-3 gap-1 text-muted-foreground">
                      <span>Inc: <b className="text-foreground">{compact(it.summary?.income || 0)}</b></span>
                      <span>Exp: <b className="text-foreground">{compact(it.summary?.expense || 0)}</b></span>
                      <span>Profit: <b className="text-foreground">{compact(it.summary?.profit || 0)}</b></span>
                    </div>
                    {it.resendId && (
                      <div className="mt-1 text-[10px] font-mono text-muted-foreground truncate">Resend: {it.resendId}</div>
                    )}
                    {it.error?.message && (
                      <div className="mt-1 text-[10px] text-rose-600 truncate">{it.error.message}</div>
                    )}
                  </button>
                )})}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setDetail(null) } }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Send className="h-5 w-5" /> Email Preview
            </DialogTitle>
            <DialogDescription>
              {selected && <>To: <b>{selected.toName}</b> &lt;{selected.to}&gt; · {new Date(selected.sentAt).toLocaleString('en-IN')}</>}
            </DialogDescription>
          </DialogHeader>
          {selected && detail ? (
            <div className="border border-border/60 rounded-lg overflow-hidden bg-white">
              <div className="border-b border-border/60 bg-muted/50 px-4 py-2 text-xs">
                <div><b>Subject:</b> {selected.subject}</div>
                <div><b>From:</b> PartnerSync &lt;reports@partnersync.io&gt;</div>
              </div>
              <iframe
                srcDoc={detail.htmlBody}
                title="Email preview"
                className="w-full bg-white"
                style={{ height: '520px', border: 0 }}
              />
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading email…</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

const AdminPanel = ({ user, refresh, triggerRefresh }) => {
  const [users, setUsers] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', role: 'partner', share: 0, capital: 0, active: true })
  const [saving, setSaving] = useState(false)
  const [resetInfo, setResetInfo] = useState(null)
  const [factoryOpen, setFactoryOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [factoryLoading, setFactoryLoading] = useState(false)
  const [approveTarget, setApproveTarget] = useState(null)
  const [approveForm, setApproveForm] = useState({ role: 'partner', share: 0, capital: 0 })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'partner', share: 0, capital: 0 })
  const [inviteResult, setInviteResult] = useState(null)
  const [inviteLoading, setInviteLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [d, p] = await Promise.all([
        api('/admin/users', {}, user),
        api('/admin/pending-signups', {}, user),
      ])
      setUsers(d); setPending(p)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [user, refresh])

  const openApprove = (p) => {
    setApproveTarget(p)
    setApproveForm({ role: 'partner', share: 0, capital: 0 })
  }

  const confirmApprove = async () => {
    if (!approveForm.role) return toast.error('Please choose a role')
    try {
      await api(`/admin/users/${approveTarget.id}/approve-signup`,
        { method: 'POST', body: JSON.stringify(approveForm) }, user)
      toast.success(`Approved as ${ROLES.find(r => r.id === approveForm.role)?.name || approveForm.role}`)
      setApproveTarget(null)
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) }
  }

  const rejectSignup = async (id) => {
    try {
      await api(`/admin/users/${id}/reject-signup`, { method: 'POST', body: JSON.stringify({}) }, user)
      toast.success('Signup rejected')
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) }
  }

  const sendInvite = async () => {
    if (!inviteForm.name || !inviteForm.email) return toast.error('Name and email required')
    setInviteLoading(true)
    try {
      const r = await api('/admin/invite', { method: 'POST', body: JSON.stringify(inviteForm) }, user)
      setInviteResult(r)
      if (r.emailStatus === 'sent') {
        toast.success(`Invitation sent to ${r.email}`)
      } else {
        toast.warning(`User created but email failed: ${r.emailError || 'unknown error'}. Share the temp password manually.`)
      }
      setInviteForm({ name: '', email: '', role: 'partner', share: 0, capital: 0 })
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) } finally { setInviteLoading(false) }
  }

  const openEdit = (u) => {
    setSelected(u)
    setEditForm({ name: u.name, role: u.role, share: u.share || 0, capital: u.capital || 0, active: u.active !== false })
    setResetInfo(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      await api(`/admin/users/${selected.id}`, { method: 'PATCH', body: JSON.stringify(editForm) }, user)
      toast.success('User updated')
      setSelected(null); load(); triggerRefresh()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const toggleActive = async (u) => {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !(u.active !== false) }) }, user)
      toast.success((u.active !== false) ? 'User deactivated' : 'User reactivated')
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) }
  }

  const resetPassword = async () => {
    try {
      const d = await api(`/admin/users/${selected.id}/reset-password`, { method: 'POST', body: JSON.stringify({}) }, user)
      setResetInfo(d)
      toast.success('Password reset. Share the new one securely.')
    } catch (e) { toast.error(e.message) }
  }

  const stats = useMemo(() => {
    const total = users.length
    const active = users.filter(u => u.active !== false).length
    const partners = users.filter(u => u.role === 'partner').length
    const totalShare = users.reduce((s, u) => s + (u.share || 0), 0)
    const totalCapital = users.reduce((s, u) => s + (u.capital || 0), 0)
    return { total, active, partners, totalShare, totalCapital }
  }, [users])

  const runFactoryReset = async () => {
    const typed = (confirmText || '').trim().toUpperCase()
    if (typed !== 'ERASE') return toast.error('Type ERASE to confirm')
    setFactoryLoading(true)
    try {
      const r = await api('/factory-reset', { method: 'POST', body: JSON.stringify({ confirm: 'ERASE' }) }, user)
      toast.success(r.message || 'All data erased')
      setFactoryOpen(false); setConfirmText('')
      load(); triggerRefresh()
    } catch (e) { toast.error(e.message) } finally { setFactoryLoading(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg gold-gradient grid place-items-center text-neutral-900"><Crown className="h-5 w-5" /></div>
          <div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-2">Super Admin Panel</h1>
            <p className="text-muted-foreground">Manage every user, role, share allocation, and access control.</p>
          </div>
        </div>
        <Button onClick={() => { setInviteOpen(true); setInviteResult(null) }} className="gold-gradient text-neutral-900 font-semibold">
          <Send className="h-4 w-4 mr-1.5" /> Invite Partner
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Total Users" value={stats.total} icon={Users} tone="gold" />
        <Kpi label="Active" value={stats.active} sub={`${stats.total - stats.active} inactive`} icon={UserCheck} />
        <Kpi label="Partners" value={stats.partners} icon={ShieldCheck} tone="dark" />
        <Kpi label="Total Share" value={stats.totalShare + '%'} sub="Allocated" icon={CircleDollarSign} />
        <Kpi label="Total Capital" value={compact(stats.totalCapital)} sub="Invested" icon={Landmark} />
      </div>

      {pending.length > 0 && (
        <div className="rounded-xl border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-500/10 overflow-hidden">
          <div className="p-4 border-b border-amber-400/40 bg-amber-400/20">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg gold-gradient grid place-items-center text-neutral-900">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold">Pending Signup Approvals</h3>
                <p className="text-xs text-muted-foreground">{pending.length} account{pending.length === 1 ? '' : 's'} awaiting your review. They cannot sign in until you approve.</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-amber-400/20">
            {pending.map(p => (
              <div key={p.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-white/80 grid place-items-center text-sm font-bold text-neutral-800">
                  {p.name.split(' ').map(x => x[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium">{p.name}</div>
                    <Badge className="bg-amber-500 text-neutral-900 border-0 text-[10px]">Awaiting role</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {p.email} · Signed up {timeAgo(p.createdAt)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => openApprove(p)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Check className="h-4 w-4 mr-1" /> Approve & Assign Role
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => rejectSignup(p.id)}>
                    <X className="h-4 w-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="p-5 border-b border-border/60 flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold">All Users</h3>
            <p className="text-xs text-muted-foreground">Full roster with activity stats. Click any row to edit.</p>
          </div>
        </div>
        {loading && <div className="p-6 text-muted-foreground">Loading users…</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">User</th>
                <th className="text-left p-3">Role</th>
                <th className="text-right p-3">Share</th>
                <th className="text-right p-3">Capital</th>
                <th className="text-right p-3">Tx Created</th>
                <th className="text-right p-3">Approved</th>
                <th className="text-right p-3">Volume</th>
                <th className="text-left p-3">Last Login</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-muted/40">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className={'h-8 w-8 rounded-full grid place-items-center text-xs font-bold ' +
                        (u.role === 'super_admin' ? 'gold-gradient text-neutral-900' : 'bg-muted text-foreground')}>
                        {u.name.split(' ').map(x => x[0]).join('').slice(0, 2)}
                      </div>
                    <div>
                      <div className="font-medium flex items-center gap-1.5">
                        {u.name}
                        {u.role === 'super_admin' && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                        {u.approvalStatus === 'pending' && <Badge className="bg-amber-500 text-neutral-900 border-0 text-[9px]">Pending</Badge>}
                        {u.approvalStatus === 'rejected' && <Badge variant="destructive" className="text-[9px]">Rejected</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    </div>
                  </td>
                  <td className="p-3"><Badge variant="outline" className="capitalize">{u.role ? u.role.replace('_', ' ') : 'Pending role'}</Badge></td>
                  <td className="p-3 text-right font-medium">{u.share || 0}%</td>
                  <td className="p-3 text-right">{compact(u.capital)}</td>
                  <td className="p-3 text-right">{u.stats?.transactionsCreated ?? 0}</td>
                  <td className="p-3 text-right">{u.stats?.transactionsApproved ?? 0}</td>
                  <td className="p-3 text-right font-semibold">{compact(u.stats?.totalVolume || 0)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="p-3">
                    {u.active !== false
                      ? <span className="approval-pill bg-emerald-100 text-emerald-800">Active</span>
                      : <span className="approval-pill bg-rose-100 text-rose-800">Inactive</span>}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(u)}><UserCog className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}
                        title={u.active !== false ? 'Deactivate' : 'Reactivate'}>
                        {u.active !== false ? <UserX className="h-4 w-4 text-rose-600" /> : <UserCheck className="h-4 w-4 text-emerald-600" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">No users yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-rose-400/40 bg-rose-50/40 dark:bg-rose-500/5 p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-lg bg-rose-500 grid place-items-center text-white">
                <UserX className="h-4 w-4" />
              </div>
              <h3 className="font-display text-lg font-semibold text-rose-900 dark:text-rose-300">Danger Zone · Factory Reset</h3>
            </div>
            <p className="text-sm text-rose-900/80 dark:text-rose-200/80">
              Erase every transaction, budget, quotation, file, audit log, email, and user account.
              Only <b>your Super Admin account</b> will be preserved so you can log back in.
              This action cannot be undone.
            </p>
          </div>
          <Button variant="destructive" onClick={() => { setFactoryOpen(true); setConfirmText('') }}>
            <UserX className="h-4 w-4 mr-1.5" /> Factory Reset
          </Button>
        </div>
      </div>

      <Dialog open={inviteOpen} onOpenChange={(o) => { if (!o) { setInviteOpen(false); setInviteResult(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Send className="h-5 w-5 text-amber-500" /> Invite Partner</DialogTitle>
            <DialogDescription>
              We&apos;ll create the account and email them a temporary password. They can sign in immediately — no approval step needed.
            </DialogDescription>
          </DialogHeader>
          {inviteResult ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-400/40 bg-emerald-50 p-4">
                <div className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                  <Check className="h-4 w-4" /> Invitation created
                </div>
                <div className="text-xs mt-2 text-emerald-900 space-y-1">
                  <div><b>{inviteResult.name}</b> · {inviteResult.email}</div>
                  <div>Role: {ROLES.find(r => r.id === inviteResult.role)?.name || inviteResult.role}</div>
                  <div>Email delivery: <b className={inviteResult.emailStatus === 'sent' ? 'text-emerald-800' : 'text-rose-700'}>{inviteResult.emailStatus}</b></div>
                </div>
              </div>
              <div className="rounded-lg border border-amber-400 bg-amber-50 p-3">
                <div className="text-xs text-amber-800 font-medium mb-1">Temporary password (also emailed):</div>
                <div className="font-mono text-lg font-bold text-amber-900">{inviteResult.tempPassword}</div>
                <div className="text-[10px] text-amber-700 mt-1">Share this manually if the email failed to deliver.</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Full name *</label>
                <Input value={inviteForm.name} onChange={e => setInviteForm({ ...inviteForm, name: e.target.value })} placeholder="Priya Sharma" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Email *</label>
                <Input type="email" value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="priya@company.com" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Role</label>
                <Select value={inviteForm.role} onValueChange={(v) => setInviteForm({ ...inviteForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {inviteForm.role === 'partner' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Share %</label>
                    <Input type="number" value={inviteForm.share} onChange={e => setInviteForm({ ...inviteForm, share: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Capital (₹)</label>
                    <Input type="number" value={inviteForm.capital} onChange={e => setInviteForm({ ...inviteForm, capital: Number(e.target.value) })} />
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {inviteResult ? (
              <Button onClick={() => { setInviteOpen(false); setInviteResult(null) }} className="gold-gradient text-neutral-900 font-semibold">Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={sendInvite} disabled={inviteLoading} className="gold-gradient text-neutral-900 font-semibold">
                  <Send className="h-4 w-4 mr-1" /> {inviteLoading ? 'Sending…' : 'Send invitation'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o) setApproveTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-emerald-600" /> Approve &amp; Assign Role
            </DialogTitle>
            <DialogDescription>
              {approveTarget && <>Assign a role for <b>{approveTarget.name}</b> &lt;{approveTarget.email}&gt;. Their access is granted immediately after saving.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Role *</label>
              <Select value={approveForm.role} onValueChange={(v) => setApproveForm({ ...approveForm, role: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {approveForm.role === 'partner' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Share %</label>
                  <Input type="number" min={0} max={100} value={approveForm.share}
                    onChange={e => setApproveForm({ ...approveForm, share: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Capital (₹)</label>
                  <Input type="number" min={0} value={approveForm.capital}
                    onChange={e => setApproveForm({ ...approveForm, capital: Number(e.target.value) })} />
                </div>
              </div>
            )}
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              This decision — including the role assigned — will be logged permanently in the audit trail.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button onClick={confirmApprove} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Check className="h-4 w-4 mr-1" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={factoryOpen} onOpenChange={(o) => { if (!o) { setFactoryOpen(false); setConfirmText('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-rose-700 flex items-center gap-2">
              <UserX className="h-5 w-5" /> Confirm Factory Reset
            </DialogTitle>
            <DialogDescription>
              This will delete all transactions, budgets, quotations, files, vendors, users (except you), audit logs, and emails.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-4">
            <div className="text-sm font-semibold text-rose-800 mb-2">Type <span className="font-mono">ERASE</span> to confirm</div>
            <Input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value.toUpperCase())}
              placeholder="ERASE"
              className="font-mono"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFactoryOpen(false); setConfirmText('') }}>Cancel</Button>
            <Button variant="destructive"
              disabled={confirmText.trim().toUpperCase() !== 'ERASE' || factoryLoading}
              onClick={runFactoryReset}>
              {factoryLoading ? 'Erasing…' : 'Yes, erase everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><UserCog className="h-5 w-5" /> Edit User</DialogTitle>
            <DialogDescription>Changes are audit-logged with your identity.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Full Name</label>
                <Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Role</label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Share %</label>
                  <Input type="number" value={editForm.share} onChange={e => setEditForm({ ...editForm, share: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Capital (₹)</label>
                  <Input type="number" value={editForm.capital} onChange={e => setEditForm({ ...editForm, capital: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div>
                  <div className="text-sm font-medium">Account Active</div>
                  <div className="text-xs text-muted-foreground">Inactive users cannot sign in.</div>
                </div>
                <button onClick={() => setEditForm({ ...editForm, active: !editForm.active })}
                  className={'relative w-11 h-6 rounded-full transition ' + (editForm.active ? 'gold-gradient' : 'bg-muted-foreground/40')}>
                  <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (editForm.active ? 'left-5' : 'left-0.5')} />
                </button>
              </div>

              <div className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Password</div>
                    <div className="text-xs text-muted-foreground">Generate a temporary password for this user.</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={resetPassword}>Reset</Button>
                </div>
                {resetInfo && (
                  <div className="mt-3 p-3 rounded bg-amber-100 border border-amber-400">
                    <div className="text-xs text-amber-900 font-medium">New temporary password (share securely):</div>
                    <div className="mt-1 font-mono text-lg font-bold text-amber-900">{resetInfo.resetPassword}</div>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="gold-gradient text-neutral-900 font-semibold">
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const App = () => {
  const [user, setUser] = useState(null)
  const [nav, setNav] = useState('dashboard')
  const [refresh, setRefresh] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = useState([])
  const [booted, setBooted] = useState(false)

  const triggerRefresh = () => setRefresh(x => x + 1)

  // Restore session from localStorage
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('partnersync_user') : null
      if (raw) setUser(JSON.parse(raw))
    } catch { /* ignore */ }
    setBooted(true)
  }, [])

  const handleLogin = (u, token) => {
    setUser(u)
    try {
      window.localStorage.setItem('partnersync_user', JSON.stringify(u))
      if (token) window.localStorage.setItem('partnersync_token', token)
    } catch { /* ignore */ }
  }

  const handleLogout = () => {
    try {
      window.localStorage.removeItem('partnersync_user')
      window.localStorage.removeItem('partnersync_token')
    } catch { /* ignore */ }
    setUser(null)
    setNav('dashboard')
  }

  useEffect(() => {
    if (!user) return
    api('/notifications', {}, user).then(setNotifs).catch(() => {})
  }, [user, refresh])

  // === Session timeout (30 min of inactivity) ===
  useEffect(() => {
    if (!user) return
    const IDLE_MS = 30 * 60 * 1000
    let lastActivity = Date.now()
    const bump = () => { lastActivity = Date.now() }
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, bump, { passive: true }))
    const interval = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_MS) {
        toast.warning('Signed out due to 30 minutes of inactivity.')
        handleLogout()
      }
    }, 30 * 1000)
    return () => {
      events.forEach(e => window.removeEventListener(e, bump))
      clearInterval(interval)
    }
  }, [user])

  const isSuperAdmin = user?.role === 'super_admin' || user?.isSuperAdmin
  const navItems = useMemo(() => {
    return isSuperAdmin
      ? [...NAV, { id: 'email', label: 'Email Center', icon: Send }, { id: 'admin', label: 'Super Admin', icon: Crown }]
      : NAV
  }, [isSuperAdmin])

  if (!booted) {
    return <div className="min-h-screen dark-panel text-neutral-100 grid place-items-center"><div className="text-amber-400">Loading…</div></div>
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  const initials = user.name.split(' ').map(s => s[0]).join('').slice(0, 2)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster position="top-right" richColors />
      <div className="flex">
        <aside className="hidden lg:flex flex-col w-64 min-h-screen dark-panel text-neutral-100 sticky top-0 border-r border-white/5">
          <div className="p-5 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg gold-gradient grid place-items-center text-neutral-900">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-lg font-bold leading-none">PartnerSync</div>
                <div className="text-[10px] text-neutral-400 uppercase tracking-wider">Transparency Portal</div>
              </div>
            </div>
          </div>
          <nav className="p-3 flex-1 space-y-0.5">
            {navItems.map(n => {
              const Icon = n.icon
              const active = nav === n.id
              return (
                <button key={n.id} onClick={() => setNav(n.id)}
                  className={'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ' +
                    (active
                      ? 'gold-gradient text-neutral-900 font-semibold shadow-lg'
                      : 'text-neutral-300 hover:bg-white/5 hover:text-white')}>
                  <Icon className="h-4 w-4" /> {n.label}
                </button>
              )
            })}
          </nav>
          <div className="p-3 border-t border-white/5">
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
              <div className="h-9 w-9 rounded-full gold-gradient grid place-items-center text-neutral-900 font-bold text-sm">{initials}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.name}</div>
                <div className="text-[11px] text-neutral-400 truncate">{ROLES.find(r => r.id === user.role)?.name}</div>
              </div>
              <Button variant="ghost" size="icon" className="text-neutral-400 hover:text-white hover:bg-white/10" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b border-border/60">
            <div className="flex items-center gap-3 px-4 md:px-8 h-16">
              <div className="lg:hidden flex items-center gap-2">
                <div className="h-8 w-8 rounded-md gold-gradient grid place-items-center text-neutral-900"><Shield className="h-4 w-4" /></div>
                <span className="font-display font-bold">PartnerSync</span>
              </div>
              <div className="hidden md:flex flex-1 max-w-md relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9 bg-muted border-0" placeholder="Global search (transactions, vendors, invoices…)" />
              </div>
              <div className="flex-1 lg:hidden" />
              <div className="flex items-center gap-1">
                <Dialog open={notifOpen} onOpenChange={setNotifOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                      <Bell className="h-5 w-5" />
                      {notifs.length > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle className="font-display">Notifications</DialogTitle></DialogHeader>
                    <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                      {notifs.length === 0 && <div className="text-sm text-muted-foreground p-4 text-center">No activity yet.</div>}
                      {notifs.map(n => (
                        <div key={n.id} className="p-3 rounded-lg border border-border/60 hover:bg-muted/40">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{n.icon}</Badge>
                            <span className="text-xs font-semibold">{n.title}</span>
                            <span className="text-[11px] text-muted-foreground ml-auto">{timeAgo(n.createdAt)}</span>
                          </div>
                          <div className="text-xs mt-1 text-muted-foreground">{n.message}</div>
                        </div>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
                <div className="ml-2 flex items-center gap-2 pl-3 border-l border-border/60">
                  <div className="text-right hidden md:block">
                    <div className="text-xs font-medium leading-tight">{user.name}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{ROLES.find(r => r.id === user.role)?.name}</div>
                  </div>
                  <div className="h-8 w-8 rounded-full gold-gradient grid place-items-center text-neutral-900 font-bold text-xs">{initials}</div>
                </div>
              </div>
            </div>
            <div className="lg:hidden flex gap-1 px-3 pb-3 overflow-x-auto no-scrollbar">
              {navItems.map(n => (
                <button key={n.id} onClick={() => setNav(n.id)}
                  className={'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border ' +
                    (nav === n.id ? 'gold-gradient text-neutral-900 border-transparent' : 'border-border/60 text-muted-foreground')}>
                  {n.label}
                </button>
              ))}
            </div>
          </header>

          <main className="p-4 md:p-8 max-w-[1400px] mx-auto">
            {nav === 'dashboard' && <Dashboard user={user} refresh={refresh} />}
            {nav === 'transactions' && <TransactionsView user={user} refresh={refresh} triggerRefresh={triggerRefresh} />}
            {nav === 'documents' && <DocumentsView user={user} refresh={refresh} triggerRefresh={triggerRefresh} />}
            {nav === 'approvals' && <ApprovalsView user={user} refresh={refresh} triggerRefresh={triggerRefresh} />}
            {nav === 'quotations' && <QuotationsView user={user} refresh={refresh} triggerRefresh={triggerRefresh} />}
            {nav === 'budgets' && <BudgetsView user={user} refresh={refresh} triggerRefresh={triggerRefresh} />}
            {nav === 'vendors' && <VendorsView user={user} />}
            {nav === 'ledger' && <LedgerView user={user} />}
            {nav === 'reports' && <ReportsView user={user} />}
            {nav === 'email' && isSuperAdmin && <EmailCenter user={user} refresh={refresh} triggerRefresh={triggerRefresh} />}
            {nav === 'admin' && isSuperAdmin && <AdminPanel user={user} refresh={refresh} triggerRefresh={triggerRefresh} />}
            {nav === 'audit' && <AuditView user={user} refresh={refresh} />}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
