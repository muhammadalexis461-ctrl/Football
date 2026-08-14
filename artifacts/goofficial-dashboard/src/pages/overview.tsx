import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Database, Gauge, Loader2, RefreshCw, Server, TriangleAlert } from 'lucide-react';
import { useGetDashboardSummary, useHealthCheck, useWorkerHealthCheck, getGetDashboardSummaryQueryKey, getHealthCheckQueryKey, getWorkerHealthCheckQueryKey, useListDashboardLeads, getListDashboardLeadsQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Shell, ExternalLink } from '@/components/shell';

function formatAgo(value: string | null | undefined) {
  if (!value) return 'Not reported';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function number(value: number | undefined) { return typeof value === 'number' ? value.toLocaleString('en-GB') : '—'; }

function SkeletonOverview() {
  return <div className="space-y-6" data-testid="loading-overview"><div className="skeleton h-28 rounded-3xl" /><div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map(i => <div className="skeleton h-32 rounded-2xl" key={i} />)}</div><div className="skeleton h-80 rounded-2xl" /></div>;
}

export default function Overview() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const worker = useWorkerHealthCheck({ query: { queryKey: getWorkerHealthCheckQueryKey(), refetchInterval: 15000 } });
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 30000 } });
  const topLeads = useListDashboardLeads({ minIntentScore: 70, sortBy: 'intentScore', sortOrder: 'desc', limit: 5, offset: 0 }, { query: { queryKey: getListDashboardLeadsQueryKey({ minIntentScore: 70, sortBy: 'intentScore', sortOrder: 'desc', limit: 5, offset: 0 }), refetchInterval: 30000 } });
  const loading = summary.isLoading || worker.isLoading;
  const refresh = () => { void summary.refetch(); void worker.refetch(); void health.refetch(); void topLeads.refetch(); };
  if (loading) return <Shell><SkeletonOverview /></Shell>;

  const data = summary.data;
  const workerData = worker.data ?? data?.worker;
  const partial = !data || !workerData;
  return <Shell>
    <div className="rise-in flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-primary"><span className="size-1.5 rounded-full bg-primary" /> Operations overview</div><h1 className="text-3xl font-extrabold tracking-[-.05em] text-foreground md:text-[42px]">Intent, in motion.</h1><p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">A live read on the collection engine and the opportunities it is surfacing for your team.</p></div>
      <button onClick={refresh} data-testid="button-refresh-overview" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-[12px] font-bold text-foreground shadow-sm transition hover:border-primary hover:text-primary"><RefreshCw className={`size-3.5 ${summary.isFetching ? 'animate-spin' : ''}`} /> Refresh view</button>
    </div>
    {partial && <div className="mt-6 flex items-center gap-3 rounded-2xl border border-[hsl(30_72%_54%/.3)] bg-[hsl(30_72%_54%/.08)] p-4 text-[12px] text-foreground" data-testid="status-partial-overview"><TriangleAlert className="size-4 text-[hsl(var(--chart-4))]" /><span>Some operational signals are unavailable. Showing the latest data we can trust.</span></div>}
    {summary.isError && <div className="mt-6 flex items-center gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-[12px]" data-testid="status-error-summary"><AlertTriangle className="size-4 text-destructive" /> Summary service did not respond. <button onClick={() => void summary.refetch()} className="font-bold text-destructive underline">Retry</button></div>}
    <div className="mt-7 grid gap-4 md:grid-cols-4">
      <Metric label="Signals collected" value={number(data?.signalsCollected)} detail="across monitored sources" icon={Database} tint="teal" testId="metric-signals" />
      <Metric label="Qualified leads" value={number(data?.qualifiedLeads)} detail={`${number(data?.highIntentLeads)} high-intent`} icon={Gauge} tint="lime" testId="metric-qualified" />
      <Metric label="Fixture matches" value={number(data?.fixtureMatches)} detail="matched to live fixtures" icon={CheckCircle2} tint="coral" testId="metric-fixtures" />
      <Metric label="Jobs running" value={number(data?.jobsRunning ?? workerData?.runningJobs)} detail={`${number(data?.failedJobs ?? workerData?.failedJobs)} failed`} icon={Loader2} tint="ink" testId="metric-jobs" />
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-sm)] rise-in delay-1">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-[14px] font-extrabold tracking-[-.02em]">Priority queue</h2><p className="mt-1 text-[11px] text-muted-foreground">Highest intent signals needing a human look</p></div><Link href="/leads" data-testid="link-view-all-leads" className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">View all <ArrowRight className="size-3" /></Link></div>
        {topLeads.isError ? <div className="p-8 text-center text-[12px] text-muted-foreground" data-testid="status-error-priority">Priority queue unavailable. <button onClick={() => void topLeads.refetch()} className="font-bold text-primary underline">Retry</button></div> : topLeads.data?.items?.length ? <div className="divide-y divide-border">{topLeads.data.items.map((lead, i) => <div className="group flex items-center gap-3 px-5 py-4 transition hover:bg-muted/40" key={lead.id} data-testid={`row-priority-lead-${lead.id}`}><div className="font-mono text-[10px] text-muted-foreground">0{i + 1}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-[12px] font-bold">{lead.team || 'Unassigned team'}</span><span className="rounded-md bg-[hsl(var(--accent)/.3)] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase text-foreground">{lead.ticketIntent}</span>{lead.groupCorporateIntent && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-primary">group</span>}</div><div className="mt-1 truncate text-[11px] text-muted-foreground">{lead.fixture || 'Fixture not matched'} · {lead.reason}</div></div><div className="text-right"><div className="font-mono text-[17px] font-medium text-primary">{lead.intentScore}</div><div className="text-[9px] uppercase tracking-wide text-muted-foreground">score</div></div><ExternalLink href={lead.sourceUrl} /></div>)}</div> : <Empty text="No high-intent leads in the current window." testId="empty-priority" />}
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] rise-in delay-2">
        <div className="flex items-start justify-between"><div><h2 className="text-[14px] font-extrabold tracking-[-.02em]">Collection health</h2><p className="mt-1 text-[11px] text-muted-foreground">The system behind this queue</p></div><Server className="size-4 text-primary" /></div>
        <div className="mt-5 rounded-xl bg-muted/55 p-4"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[12px] font-bold">{workerData?.active ? <span className="size-2 rounded-full bg-primary" /> : <span className="size-2 rounded-full bg-destructive" />} Worker {workerData?.active ? 'active' : 'inactive'}</span><span className="font-mono text-[10px] text-muted-foreground">{workerData?.ownerId || 'No owner'}</span></div><div className="mt-4 grid grid-cols-3 gap-2"><HealthCell label="Queued" value={number(workerData?.queuedJobs)} /><HealthCell label="Running" value={number(workerData?.runningJobs)} /><HealthCell label="Failed" value={number(workerData?.failedJobs)} danger={Boolean(workerData?.failedJobs)} /></div></div>
         <div className="mt-5 space-y-3"><HealthLine icon={Clock3} label="Last heartbeat" value={formatAgo(workerData?.heartbeatAt)} testId="health-heartbeat" /><HealthLine icon={RefreshCw} label="Last collection" value={dateTime(data?.lastSuccessfulCollection)} testId="health-collection" /><HealthLine icon={Server} label="API status" value={health.isError ? 'Unavailable' : health.data?.status || 'Checking'} testId="health-api" /></div>
      </section>
    </div>
  </Shell>;
}
function Metric({ label, value, detail, icon: Icon, tint, testId }: { label: string; value: string; detail: string; icon: typeof Database; tint: string; testId: string }) { return <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] rise-in" data-testid={testId}><div className={`mb-5 grid size-8 place-items-center rounded-lg ${tint === 'lime' ? 'bg-accent/55 text-foreground' : tint === 'coral' ? 'bg-destructive/10 text-destructive' : tint === 'ink' ? 'bg-foreground/8 text-foreground' : 'bg-primary/10 text-primary'}`}><Icon className="size-4" /></div><div className="font-mono text-[28px] font-medium tracking-[-.07em] text-foreground">{value}</div><div className="mt-1 text-[12px] font-bold">{label}</div><div className="mt-1 text-[10px] text-muted-foreground">{detail}</div></div>; }
function HealthCell({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div><div className={`font-mono text-[18px] ${danger ? 'text-destructive' : 'text-foreground'}`}>{value}</div><div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div></div>; }
function HealthLine({ icon: Icon, label, value, testId }: { icon: typeof Clock3; label: string; value: string; testId: string }) { return <div className="flex items-center justify-between text-[11px]" data-testid={testId}><span className="flex items-center gap-2 text-muted-foreground"><Icon className="size-3.5 text-primary" />{label}</span><span className="font-mono text-[10px] font-medium">{value}</span></div>; }
function Empty({ text, testId }: { text: string; testId: string }) { return <div className="flex min-h-40 flex-col items-center justify-center px-5 text-center" data-testid={testId}><div className="mb-3 grid size-9 place-items-center rounded-xl bg-muted"><Database className="size-4 text-muted-foreground" /></div><p className="text-[12px] text-muted-foreground">{text}</p></div>; }