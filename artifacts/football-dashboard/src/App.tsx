import { type ComponentType, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleDot,
  Clock3,
  Download,
  Filter,
  Flame,
  LayoutDashboard,
  ListFilter,
  Mail,
  Menu,
  Radar,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  getGetDashboardOverviewQueryKey,
  getGetFixturesQueryKey,
  getGetLeadsQueryKey,
  getHealthCheckQueryKey,
  useGetDashboardOverview,
  useGetFixtures,
  useGetLeads,
  useHealthCheck,
} from '@workspace/api-client-react';
import type { Fixture, GetLeadsParams, Lead } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
const navItems: NavItem[] = [
  { href: '/', label: 'Operations overview', icon: LayoutDashboard },
  { href: '/leads', label: 'Lead workspace', icon: Target },
];

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date);
}

function formatRelative(value?: string | null) {
  if (!value) return 'No recent activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function StatusDot({ state, label }: { state: 'online' | 'degraded' | 'offline'; label?: string }) {
  const statusStyles = {
    online: 'bg-[#4bbb72] text-[#2b8150]',
    degraded: 'bg-[#f4aa42] text-[#9a5d09]',
    offline: 'bg-[#e6695d] text-[#a43c35]',
  };
  return (
    <span className="inline-flex items-center gap-2" data-testid={`status-worker-${state}`}>
      <span className={cn('h-2 w-2 rounded-full animate-pulse-dot', statusStyles[state].split(' ')[0])} />
      <span className={cn('text-[11px] font-bold uppercase tracking-[0.16em]', statusStyles[state].split(' ')[1])}>
        {label ?? state}
      </span>
    </span>
  );
}

function Sidebar() {
  const [location] = useLocation();
  return (
    <aside className="hidden min-h-[100dvh] w-[250px] shrink-0 flex-col border-r border-[#2f3a4c] bg-[#1b2639] text-[#dce2da] lg:flex">
      <div className="px-7 pb-8 pt-8">
        <Link href="/" className="group flex items-center gap-3" data-testid="link-brand">
          <span className="grid h-10 w-10 place-items-center rounded-[13px] bg-[#2fa66d] text-[#10231e] shadow-[0_10px_24px_rgba(47,166,109,.18)]">
            <Radar size={21} strokeWidth={2.4} />
          </span>
          <span>
            <span className="block font-display text-[15px] font-bold tracking-[-0.04em] text-[#f4f0e7]">PITCHLINE</span>
            <span className="block font-mono text-[8px] font-medium tracking-[0.2em] text-[#91a19b]">INTELLIGENCE OPS</span>
          </span>
        </Link>
      </div>
      <div className="px-4">
        <p className="mb-3 px-3 font-mono text-[9px] uppercase tracking-[0.2em] text-[#72827d]">Command center</p>
        <nav className="space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const active = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                href={item.href}
                key={item.href}
                data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}
                className={cn(
                  'group flex items-center justify-between rounded-xl px-3 py-3 text-[12px] font-semibold transition-all duration-200',
                  active ? 'bg-[#2d3b4f] text-[#f5f1e8] shadow-inner' : 'text-[#9daaa3] hover:bg-[#253247] hover:text-[#f5f1e8]',
                )}
              >
                <span className="flex items-center gap-3">
                  <Icon size={16} strokeWidth={active ? 2.4 : 1.8} className={active ? 'text-[#5ed38c]' : 'text-[#77877f]'} />
                  {item.label}
                </span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-[#f6ab4b]" />}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto px-4 pb-5">
        <div className="rounded-2xl border border-[#364354] bg-[#202f42] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#93a19c]">System posture</span>
            <ShieldCheck size={15} className="text-[#5ed38c]" />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="font-display text-[24px] font-bold tracking-[-0.06em] text-[#f2eee4]">98.6%</div>
              <div className="mt-1 text-[10px] text-[#95a59f]">collection reliability</div>
            </div>
            <div className="h-10 w-16">
              <svg viewBox="0 0 64 40" className="h-full w-full" aria-hidden="true">
                <path d="M1 31 10 28 18 30 27 18 36 22 44 10 53 14 63 4" fill="none" stroke="#58cb87" strokeWidth="2" />
                <path d="M1 31 10 28 18 30 27 18 36 22 44 10 53 14 63 4V40H1Z" fill="url(#area)" opacity=".25" />
                <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#58cb87" /><stop offset="1" stopColor="#58cb87" stopOpacity="0" /></linearGradient></defs>
              </svg>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between px-2 text-[10px] text-[#77877f]">
          <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#5ed38c]" /> All systems nominal</span>
          <Settings2 size={13} />
        </div>
      </div>
    </aside>
  );
}

function MobileHeader({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-[#dcd8cc] bg-[#1b2639] px-4 py-3 text-[#f4f0e7] lg:hidden">
      <button type="button" onClick={onMenu} className="rounded-lg p-2 hover:bg-[#2d3b4f]" data-testid="button-open-menu" aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <Link href="/" className="flex items-center gap-2" data-testid="link-mobile-brand">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2fa66d] text-[#10231e]"><Radar size={17} /></span>
        <span className="font-display text-sm font-bold tracking-[-0.04em]">PITCHLINE</span>
      </Link>
      <span className="h-2 w-2 rounded-full bg-[#5ed38c] animate-pulse-dot" />
    </header>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [location] = useLocation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button type="button" className="absolute inset-0 bg-[#101b2a]/60" onClick={onClose} aria-label="Close navigation" data-testid="button-close-menu-overlay" />
      <aside className="relative flex h-full w-[285px] flex-col bg-[#1b2639] px-4 py-5 text-[#dce2da] shadow-2xl">
        <div className="mb-10 flex items-center justify-between px-3">
          <span className="font-display text-sm font-bold tracking-[-0.04em]">PITCHLINE</span>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#aebbb4] hover:bg-[#2d3b4f]" aria-label="Close navigation" data-testid="button-close-menu"><X size={18} /></button>
        </div>
        <p className="mb-3 px-3 font-mono text-[9px] uppercase tracking-[0.2em] text-[#72827d]">Command center</p>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              href={item.href}
              key={item.href}
              onClick={onClose}
              className={cn('mb-1 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold', location === item.href ? 'bg-[#2d3b4f] text-[#f5f1e8]' : 'text-[#9daaa3]')}
              data-testid={`link-mobile-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}
            >
              <Icon size={17} /> {item.label}
            </Link>
          );
        })}
      </aside>
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="noise flex min-h-[100dvh] bg-[#f5f1e8]">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <MobileHeader onMenu={() => setMenuOpen(true)} />
        <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
        {children}
      </div>
    </div>
  );
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-[#2f8760]"><span className="h-1.5 w-1.5 rounded-full bg-[#f6ab4b]" /> {eyebrow}</p>
        <h1 className="font-display text-[clamp(30px,4vw,48px)] font-bold leading-[.98] tracking-[-0.07em] text-[#1b2639]">{title}</h1>
        <p className="mt-3 max-w-xl text-[13px] leading-6 text-[#6d756f]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function MetricCard({ label, value, caption, icon: Icon, tone = 'green', testId }: { label: string; value: string | number; caption: string; icon: typeof Activity; tone?: 'green' | 'orange' | 'navy' | 'red'; testId: string }) {
  const tones = {
    green: 'bg-[#e0f1e7] text-[#21734f]',
    orange: 'bg-[#fff0d8] text-[#a45d14]',
    navy: 'bg-[#e1e7ee] text-[#354c68]',
    red: 'bg-[#fae3df] text-[#b5493d]',
  };
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[#dedbd1] bg-[#fbf9f4] p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#bfc8be] hover:shadow-[0_10px_30px_rgba(30,48,62,.06)]" data-testid={testId}>
      <div className="mb-7 flex items-start justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#777e78]">{label}</span>
        <span className={cn('grid h-8 w-8 place-items-center rounded-lg', tones[tone])}><Icon size={15} /></span>
      </div>
      <div className="font-display text-[34px] font-bold leading-none tracking-[-0.08em] text-[#1b2639]">{value}</div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-[#7d837d]">{caption}</div>
      <div className={cn('absolute -bottom-6 -right-4 h-20 w-20 rounded-full opacity-40 blur-2xl', tone === 'green' ? 'bg-[#70cf96]' : tone === 'orange' ? 'bg-[#f6ab4b]' : tone === 'red' ? 'bg-[#ec9585]' : 'bg-[#8ca5bc')} />
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg', className)} />;
}

function LoadingPanel({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="loading-panel">
      {Array.from({ length: rows }).map((_, index) => <Skeleton className="h-14 w-full" key={index} />)}
    </div>
  );
}

function QueryError({ message = 'The signal feed did not respond.' }: { message?: string }) {
  return (
    <div className="flex min-h-[150px] flex-col items-center justify-center rounded-xl border border-dashed border-[#dfb1a8] bg-[#fff8f5] px-5 text-center" data-testid="status-query-error">
      <AlertTriangle size={20} className="mb-2 text-[#be594d]" />
      <p className="text-sm font-semibold text-[#803d35]">Unable to load this view</p>
      <p className="mt-1 text-xs text-[#9c6f68]">{message}</p>
    </div>
  );
}

function EmptyState({ title, detail, icon: Icon = InboxIcon }: { title: string; detail: string; icon?: ComponentType<{ size?: number }> }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d8d4c8] bg-[#faf8f2] px-6 text-center" data-testid="status-empty">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[#e9eee8] text-[#4c8c69]"><Icon size={18} /></span>
      <p className="text-sm font-semibold text-[#3a4642]">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-5 text-[#858b84]">{detail}</p>
    </div>
  );
}

function InboxIcon(props: { size?: number }) {
  return <ListFilter {...props} />;
}

function WorkerPanel({ overview }: { overview: { state: 'online' | 'degraded' | 'offline'; lastHeartbeat: string; activeWorkers: number; totalWorkers: number } }) {
  const stateCopy = overview.state === 'online' ? 'Collection network healthy' : overview.state === 'degraded' ? 'Some collectors need attention' : 'Collection network offline';
  const ratio = overview.totalWorkers ? Math.round((overview.activeWorkers / overview.totalWorkers) * 100) : 0;
  return (
    <div className="rounded-2xl bg-[#1b2639] p-6 text-[#f0eee5] shadow-[0_14px_34px_rgba(27,38,57,.12)]" data-testid="panel-worker-status">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.19em] text-[#8f9e98]">Live worker status</p>
          <div className="mt-3 flex items-center gap-3"><StatusDot state={overview.state} /><span className="text-sm font-semibold text-[#e9eee6]">{stateCopy}</span></div>
        </div>
        <Server size={20} className="text-[#5ed38c]" />
      </div>
      <div className="mb-3 flex items-end justify-between">
        <div><span className="font-display text-[42px] font-bold leading-none tracking-[-.08em]">{overview.activeWorkers}</span><span className="ml-2 font-mono text-xs text-[#8d9c95]">/ {overview.totalWorkers} active</span></div>
        <span className="font-mono text-[11px] text-[#8d9c95]">{ratio}% capacity</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#354457]"><div className="h-full rounded-full bg-[#50c982] transition-all duration-700" style={{ width: `${ratio}%` }} /></div>
      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[#354457] pt-4">
        <div><div className="mb-1 text-[10px] uppercase tracking-[.12em] text-[#778a82]">Last heartbeat</div><div className="font-mono text-xs text-[#d8e1d9]">{formatRelative(overview.lastHeartbeat)}</div></div>
        <div><div className="mb-1 text-[10px] uppercase tracking-[.12em] text-[#778a82]">Network mode</div><div className="font-mono text-xs text-[#d8e1d9]">Continuous</div></div>
      </div>
    </div>
  );
}

function HighIntentRail({ leads, isLoading, isError }: { leads: Lead[]; isLoading: boolean; isError: boolean }) {
  return (
    <section className="rounded-2xl border border-[#dedbd1] bg-[#fbf9f4]" data-testid="panel-high-intent-leads">
      <div className="flex items-center justify-between border-b border-[#e5e1d7] px-5 py-4">
        <div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-[#777e78]">Priority queue</p><h2 className="mt-1 font-display text-lg font-bold tracking-[-.05em] text-[#1b2639]">High-intent leads</h2></div>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#fff0d8] text-[#a45d14]"><Flame size={15} /></span>
      </div>
      <div className="p-3">
        {isLoading ? <LoadingPanel rows={3} /> : isError ? <QueryError message="Priority signals are temporarily unavailable." /> : leads.length === 0 ? <EmptyState title="Queue is clear" detail="No high-intent signals need action right now." icon={Flame} /> : (
          <div className="space-y-1">
            {leads.slice(0, 5).map((lead) => (
              <div className="group flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[#f2efe6]" key={lead.id} data-testid={`row-high-intent-${lead.id}`}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#dbece1] font-mono text-[10px] font-medium text-[#2b8056]">{initials(lead.name)}</div>
                <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-bold text-[#28372f]">{lead.name}</div><div className="mt-0.5 truncate text-[10px] text-[#89908a]">{lead.company} · {lead.signal}</div></div>
                <div className="text-right"><div className="font-display text-[17px] font-bold tracking-[-.05em] text-[#21734f]">{lead.score}</div><div className="font-mono text-[8px] uppercase tracking-[.12em] text-[#a2a79f]">score</div></div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Link href="/leads?intent=HIGH" className="flex items-center justify-between border-t border-[#e5e1d7] px-5 py-3 text-[11px] font-bold text-[#2f8760] transition-colors hover:bg-[#f2efe6]" data-testid="link-view-priority-leads">Open priority workspace <ArrowUpRight size={14} /></Link>
    </section>
  );
}

function FixtureList({ fixtures, isLoading, isError }: { fixtures: Fixture[]; isLoading: boolean; isError: boolean }) {
  return (
    <section className="rounded-2xl border border-[#dedbd1] bg-[#fbf9f4]" data-testid="panel-fixtures">
      <div className="flex items-center justify-between border-b border-[#e5e1d7] px-5 py-4">
        <div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-[#777e78]">Match intelligence</p><h2 className="mt-1 font-display text-lg font-bold tracking-[-.05em] text-[#1b2639]">Fixture watchlist</h2></div>
        <CalendarDays size={17} className="text-[#597a73]" />
      </div>
      <div className="p-3">
        {isLoading ? <LoadingPanel rows={3} /> : isError ? <QueryError message="Fixture data is temporarily unavailable." /> : fixtures.length === 0 ? <EmptyState title="No fixtures in range" detail="The fixture watchlist will populate when matches arrive." icon={CalendarDays} /> : (
          <div className="space-y-1">
            {fixtures.slice(0, 5).map((fixture) => (
              <div className="rounded-xl px-2 py-3 transition-colors hover:bg-[#f2efe6]" key={fixture.id} data-testid={`row-fixture-${fixture.id}`}>
                <div className="mb-2 flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-[.1em] text-[#8a918b]">{fixture.competition}</span><span className={cn('rounded-full px-2 py-0.5 font-mono text-[8px] font-medium uppercase tracking-[.12em]', fixture.status === 'live' ? 'bg-[#fae3df] text-[#b5493d]' : 'bg-[#e8eee8] text-[#3c7b5a]')}>{fixture.status}</span></div>
                <div className="flex items-center justify-between gap-3"><div className="text-[12px] font-bold text-[#2b3733]"><span>{fixture.homeTeam}</span><span className="mx-2 font-mono text-[9px] text-[#a2a79f]">VS</span><span>{fixture.awayTeam}</span></div><div className="shrink-0 text-right"><div className="font-mono text-[10px] text-[#5f6a64]">{formatDate(fixture.kickoffAt)}</div><div className="mt-1 text-[9px] text-[#9aa09a]">{fixture.confidence}% confidence</div></div></div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-[#e5e1d7] px-5 py-3 text-[10px] text-[#8a918b]"><span className="flex items-center gap-2"><CircleDot size={13} className="text-[#f0a44b]" /> Signals mapped to upcoming match windows</span></div>
    </section>
  );
}

function OverviewPage() {
  const overviewQuery = useGetDashboardOverview({ query: { queryKey: getGetDashboardOverviewQueryKey(), refetchInterval: 30000, refetchOnWindowFocus: true } });
  const healthQuery = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 15000, refetchOnWindowFocus: true } });
  const fixturesQuery = useGetFixtures({ query: { queryKey: getGetFixturesQueryKey(), refetchInterval: 60000, refetchOnWindowFocus: true } });
  const highIntentParams = useMemo<GetLeadsParams>(() => ({ intent: 'HIGH', sort: 'score', order: 'desc' }), []);
  const highIntentQuery = useGetLeads(highIntentParams, { query: { queryKey: getGetLeadsQueryKey(highIntentParams), refetchInterval: 30000, refetchOnWindowFocus: true } });
  const overview = overviewQuery.data;
  const fixtures = fixturesQuery.data ?? [];
  const highIntentLeads = highIntentQuery.data ?? [];

  return (
    <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 sm:py-10 xl:px-12">
      <PageHeader
        eyebrow="Tuesday · 08 October 2024 · London"
        title="Good morning, operators."
        subtitle="A focused read on your collection network, today’s signal flow, and the leads ready for a human touch."
        action={<div className="flex items-center gap-3"><span className="hidden items-center gap-2 rounded-full border border-[#dcd9cf] bg-[#faf8f2] px-3 py-2 font-mono text-[9px] uppercase tracking-[.13em] text-[#7c847d] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#4bbb72] animate-pulse-dot" /> Live data</span><button type="button" onClick={() => { void Promise.all([overviewQuery.refetch(), healthQuery.refetch(), fixturesQuery.refetch(), highIntentQuery.refetch()]); }} className="flex items-center gap-2 rounded-xl bg-[#1b2639] px-4 py-2.5 text-[11px] font-bold text-[#f4f0e7] transition-all hover:bg-[#2b3b52] active:scale-[.98]" data-testid="button-refresh-overview"><RefreshCw size={14} className={overviewQuery.isFetching ? 'animate-spin' : ''} /> Refresh</button></div>}
      />
      {overviewQuery.isLoading ? (
        <div className="space-y-6" data-testid="loading-overview"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton className="h-[160px]" key={index} />)}</div><div className="grid gap-5 xl:grid-cols-[1.02fr_.98fr]"><Skeleton className="h-[280px]" /><Skeleton className="h-[280px]" /></div></div>
      ) : overviewQuery.isError || !overview ? <QueryError message="The operations overview is temporarily unavailable. Try refreshing the feed." /> : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Signals collected" value={overview.signalsCollected.toLocaleString()} caption="Since midnight UTC" icon={Radar} tone="green" testId="metric-signals-collected" />
            <MetricCard label="Qualified leads" value={overview.qualifiedLeads.toLocaleString()} caption="Across active pipeline" icon={Target} tone="orange" testId="metric-qualified-leads" />
            <MetricCard label="High-intent leads" value={overview.highIntentLeads.toLocaleString()} caption="Need a human touch" icon={Flame} tone="navy" testId="metric-high-intent-leads" />
            <MetricCard label="Fixture matches" value={overview.fixtureMatches.toLocaleString()} caption="Signals mapped today" icon={CalendarDays} tone="green" testId="metric-fixture-matches" />
          </div>
          <div className="mb-5 grid gap-5 xl:grid-cols-[1.02fr_.98fr]">
            <WorkerPanel overview={overview.worker} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-3">
              <MetricCard label="Jobs running" value={overview.jobsRunning} caption="Live right now" icon={Activity} tone="green" testId="metric-jobs-running" />
              <MetricCard label="Failed jobs" value={overview.failedJobs} caption="Need investigation" icon={AlertTriangle} tone={overview.failedJobs > 0 ? 'red' : 'navy'} testId="metric-failed-jobs" />
              <div className="col-span-2 rounded-2xl border border-[#dedbd1] bg-[#e9efe9] p-5 sm:col-span-1"><div className="mb-4 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.15em] text-[#687870]">Last collection</span><Clock3 size={16} className="text-[#4a7e68]" /></div><div className="font-display text-[23px] font-bold tracking-[-.06em] text-[#234238]">{formatRelative(overview.lastSuccessfulCollection)}</div><div className="mt-2 text-[11px] leading-5 text-[#71857c]">{formatDate(overview.lastSuccessfulCollection)} · collection window stable</div></div>
            </div>
          </div>
          <div className="mb-5 grid gap-5 xl:grid-cols-[1.02fr_.98fr]">
            <HighIntentRail leads={highIntentLeads} isLoading={highIntentQuery.isLoading} isError={highIntentQuery.isError} />
            <FixtureList fixtures={fixtures} isLoading={fixturesQuery.isLoading} isError={fixturesQuery.isError} />
          </div>
          <div className="flex flex-col justify-between gap-3 border-t border-[#ddd9ce] pt-5 text-[10px] text-[#8a918b] sm:flex-row sm:items-center"><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#4bbb72]" /> API health: <strong className="font-mono font-medium text-[#47745e]">{healthQuery.data?.status ?? (healthQuery.isError ? 'unreachable' : 'checking')}</strong></span><span className="font-mono uppercase tracking-[.12em]">Auto-refresh · overview 30s · health 15s · fixtures 60s</span></div>
        </>
      )}
    </main>
  );
}

function IntentBadge({ intent }: { intent: Lead['intent'] }) {
  const styles = { HIGH: 'bg-[#fae3df] text-[#b5493d]', MEDIUM: 'bg-[#fff0d8] text-[#a45d14]', LOW: 'bg-[#e7ece9] text-[#587267]' };
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9px] font-medium uppercase tracking-[.12em]', styles[intent])}><span className="h-1.5 w-1.5 rounded-full bg-current" /> {intent}</span>;
}

function StatusBadge({ status }: { status: Lead['status'] }) {
  const styles = { new: 'bg-[#e1e9f0] text-[#48657f]', contacted: 'bg-[#eee7d9] text-[#83704c]', qualified: 'bg-[#e0f1e7] text-[#387657]', archived: 'bg-[#e8e7e3] text-[#777972]' };
  return <span className={cn('rounded-full px-2.5 py-1 font-mono text-[9px] font-medium uppercase tracking-[.1em]', styles[status])}>{status}</span>;
}

function LeadRow({ lead }: { lead: Lead }) {
  return (
    <div className="grid min-w-[850px] grid-cols-[minmax(220px,1.5fr)_minmax(150px,1fr)_110px_90px_110px_110px] items-center gap-4 border-b border-[#ebe7dc] px-5 py-4 transition-colors last:border-b-0 hover:bg-[#f7f4ec]" data-testid={`row-lead-${lead.id}`}>
      <div className="flex min-w-0 items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e1eee5] font-mono text-[10px] font-medium text-[#367856]">{initials(lead.name)}</div><div className="min-w-0"><div className="truncate text-[12px] font-bold text-[#27372f]">{lead.name}</div><div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-[#8a918b]"><Mail size={11} /> {lead.email}</div></div></div>
      <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#4a5650]">{lead.company}</div><div className="mt-1 flex items-center gap-1 text-[10px] text-[#9aa09a]"><Sparkles size={10} /> {lead.source}</div></div>
      <div><div className="font-display text-[21px] font-bold tracking-[-.06em] text-[#1b2639]">{lead.score}</div><div className="font-mono text-[8px] uppercase tracking-[.1em] text-[#9aa09a]">score</div></div>
      <IntentBadge intent={lead.intent} />
      <StatusBadge status={lead.status} />
      <div className="text-right"><div className="text-[11px] font-semibold text-[#5d6961]">{formatRelative(lead.lastActivity)}</div><div className="mt-1 text-[9px] text-[#9ca19b]">{formatDate(lead.createdAt)}</div></div>
    </div>
  );
}

function LeadsPage() {
  const [search, setSearch] = useState('');
  const [intentFilter, setIntentFilter] = useState<'all' | 'HIGH' | 'MEDIUM' | 'LOW'>(() => {
    const intent = new URLSearchParams(window.location.search).get('intent');
    return intent === 'HIGH' || intent === 'MEDIUM' || intent === 'LOW' ? intent : 'all';
  });
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'contacted' | 'qualified' | 'archived'>('all');
  const [sortKey, setSortKey] = useState<'score' | 'createdAt' | 'name'>('score');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [filterOpen, setFilterOpen] = useState(false);
  const leadParams = useMemo<GetLeadsParams>(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(intentFilter !== 'all' ? { intent: intentFilter } : {}),
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    sort: sortKey,
    order,
  }), [search, intentFilter, statusFilter, sortKey, order]);
  const query = useGetLeads(leadParams, { query: { queryKey: getGetLeadsQueryKey(leadParams), refetchOnWindowFocus: true } });
  const leads = query.data ?? [];

  const handleSort = (nextSort: 'score' | 'createdAt' | 'name') => {
    if (sortKey === nextSort) setOrder((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortKey(nextSort); setOrder(nextSort === 'name' ? 'asc' : 'desc'); }
  };
  const exportLeads = () => {
    const header = 'Name,Company,Email,Score,Intent,Status,Signal,Created,Last activity';
    const rows = leads.map((lead) => [lead.name, lead.company, lead.email, lead.score, lead.intent, lead.status, lead.signal, lead.createdAt, lead.lastActivity].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pitchline-leads.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 sm:py-10 xl:px-12">
      <PageHeader eyebrow="Signal workspace" title="Lead intelligence." subtitle="Search the full signal graph, surface buying intent, and move the right conversations forward." action={<div className="flex items-center gap-3"><button type="button" onClick={exportLeads} disabled={leads.length === 0} className="flex items-center gap-2 rounded-xl border border-[#d4d1c6] bg-[#fbf9f4] px-4 py-2.5 text-[11px] font-bold text-[#3c4b43] transition-all hover:border-[#a9b7ac] hover:bg-[#f5f1e8] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-export-leads"><Download size={14} /> Export view</button><button type="button" onClick={() => void query.refetch()} className="grid h-10 w-10 place-items-center rounded-xl bg-[#1b2639] text-[#f4f0e7] transition-all hover:bg-[#2b3b52]" data-testid="button-refresh-leads" aria-label="Refresh leads"><RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} /></button></div>} />
      <div className="mb-5 rounded-2xl border border-[#dedbd1] bg-[#fbf9f4] p-3 sm:p-4" data-testid="panel-lead-filters">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1"><Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ba19a]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, email, or signal..." className="h-11 w-full rounded-xl border border-[#ddd9cf] bg-[#f7f4ec] pl-10 pr-4 text-[12px] text-[#29382f] outline-none transition-colors placeholder:text-[#a5aaa4] focus:border-[#4d9a70] focus:ring-2 focus:ring-[#4d9a70]/15" data-testid="input-lead-search" /></div>
          <button type="button" onClick={() => setFilterOpen((open) => !open)} className={cn('flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-[11px] font-bold transition-colors lg:hidden', filterOpen ? 'border-[#4d9a70] bg-[#e8f2eb] text-[#347653]' : 'border-[#ddd9cf] bg-[#f7f4ec] text-[#59635c]')} data-testid="button-toggle-filters"><SlidersHorizontal size={14} /> Filters <ChevronDown size={14} className={filterOpen ? 'rotate-180' : ''} /></button>
          <div className={cn('grid gap-3 sm:grid-cols-2 lg:flex', filterOpen ? 'grid' : 'hidden lg:flex')}>
            <label className="relative"><span className="sr-only">Filter by intent</span><select value={intentFilter} onChange={(event) => setIntentFilter(event.target.value as typeof intentFilter)} className="h-11 w-full appearance-none rounded-xl border border-[#ddd9cf] bg-[#f7f4ec] px-3 pr-9 text-[11px] font-semibold text-[#59635c] outline-none focus:border-[#4d9a70]" data-testid="select-lead-intent"><option value="all">All intent levels</option><option value="HIGH">High intent</option><option value="MEDIUM">Medium intent</option><option value="LOW">Low intent</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8c958d]" /></label>
            <label className="relative"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="h-11 w-full appearance-none rounded-xl border border-[#ddd9cf] bg-[#f7f4ec] px-3 pr-9 text-[11px] font-semibold text-[#59635c] outline-none focus:border-[#4d9a70]" data-testid="select-lead-status"><option value="all">All statuses</option><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="archived">Archived</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8c958d]" /></label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#ebe7dc] pt-3"><div className="flex items-center gap-2 text-[10px] text-[#858c85]"><Filter size={13} /> {query.isFetching ? 'Updating signal graph...' : `${leads.length} lead${leads.length === 1 ? '' : 's'} in view`} {search && <span className="rounded-md bg-[#e8f2eb] px-2 py-1 font-semibold text-[#3e795a]">“{search}”</span>}</div><button type="button" onClick={() => { setSearch(''); setIntentFilter('all'); setStatusFilter('all'); setSortKey('score'); setOrder('desc'); }} className="text-[10px] font-bold text-[#4b8967] hover:text-[#286b4a]" data-testid="button-clear-lead-filters">Clear filters</button></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#dedbd1] bg-[#fbf9f4]" data-testid="panel-lead-table">
        <div className="hidden min-w-[850px] grid-cols-[minmax(220px,1.5fr)_minmax(150px,1fr)_110px_90px_110px_110px] items-center gap-4 border-b border-[#dedbd1] bg-[#f0eee6] px-5 py-3 text-[9px] font-mono font-medium uppercase tracking-[.16em] text-[#7b827c] md:grid">
          <span>Lead</span><span>Origin</span>
          <button type="button" onClick={() => handleSort('score')} className="flex items-center gap-1 text-left hover:text-[#317652]" data-testid="button-sort-score">Score {sortKey === 'score' && (order === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button>
          <span>Intent</span><span>Status</span>
          <button type="button" onClick={() => handleSort('createdAt')} className="flex items-center justify-end gap-1 text-right hover:text-[#317652]" data-testid="button-sort-created">Activity {sortKey === 'createdAt' && (order === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button>
        </div>
        {query.isLoading ? <div className="p-4"><LoadingPanel rows={6} /></div> : query.isError ? <div className="p-4"><QueryError message="Lead records are temporarily unavailable. Refresh to try again." /></div> : leads.length === 0 ? <div className="p-4"><EmptyState title="No leads match this view" detail="Try a broader search or clear one of the active filters." icon={Users} /></div> : <div className="overflow-x-auto">{leads.map((lead) => <LeadRow key={lead.id} lead={lead} />)}</div>}
      </div>
      <div className="mt-5 flex flex-col gap-2 text-[10px] text-[#8a918b] sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-2"><Zap size={13} className="text-[#d98a25]" /> Sort and filter parameters are sent directly to the collection API.</span><span className="font-mono uppercase tracking-[.12em]">Live workspace · focus on next action</span></div>
    </main>
  );
}

function Router() {
  return (
    <AppShell>
      <ErrorBoundary>
        <Switch>
          <Route path="/" component={OverviewPage} />
          <Route path="/leads" component={LeadsPage} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;