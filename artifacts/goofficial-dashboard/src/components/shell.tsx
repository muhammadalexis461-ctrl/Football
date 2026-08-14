import { Activity, ArrowUpRight, BarChart3, CircleHelp, ListFilter, Radio, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import type { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const nav = [
    { href: '/', label: 'Operations', icon: Activity },
    { href: '/leads', label: 'Qualified leads', icon: ListFilter },
  ];
  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[246px] flex-col bg-[hsl(var(--sidebar))] px-4 py-5 text-[hsl(var(--sidebar-foreground))] md:flex">
        <div className="flex items-center gap-3 px-3 pb-10">
          <div className="grid size-9 place-items-center rounded-xl bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))] shadow-sm">
            <Radio className="size-5" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[14px] font-extrabold tracking-[-.03em]">GOOFFICIAL</div>
            <div className="font-mono text-[9px] uppercase tracking-[.18em] text-white/45">intent console</div>
          </div>
        </div>
        <div className="px-3 pb-3 font-mono text-[9px] uppercase tracking-[.18em] text-white/35">Workspace</div>
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors ${active ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-white/55 hover:bg-white/5 hover:text-white'}`}>
              <Icon className={`size-[17px] ${active ? 'text-[hsl(var(--sidebar-primary))]' : 'text-white/40 group-hover:text-white/70'}`} />
              {label}
              {active && <span className="ml-auto size-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />}
            </Link>;
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-white/80"><ShieldCheck className="size-3.5 text-[hsl(var(--sidebar-primary))]" /> Live collection</div>
            <p className="text-[11px] leading-relaxed text-white/40">Signals are scored continuously as fixtures and sources change.</p>
          </div>
          <div className="flex items-center justify-between px-3 text-[10px] text-white/35">
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" /> system online</span>
            <CircleHelp className="size-3.5" />
          </div>
        </div>
      </aside>
      <div className="md:pl-[246px]">
        <header className="sticky top-0 z-10 flex h-[65px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md md:px-9">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground md:hidden"><span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground"><Radio className="size-4" /></span> GoOfficial</div>
          <div className="hidden items-center gap-2 text-[11px] text-muted-foreground md:flex"><BarChart3 className="size-4 text-primary" /><span className="font-mono">COLLECTION / LIVE VIEW</span></div>
          <div className="flex items-center gap-4">
            <span className="hidden text-[11px] font-semibold text-muted-foreground sm:inline">London · UTC</span>
            <span className="flex items-center gap-2 text-[11px] font-bold text-primary"><span className="size-2 animate-pulse rounded-full bg-primary" /> Live</span>
            <div className="grid size-8 place-items-center rounded-full border border-border bg-card text-[11px] font-extrabold text-primary">GO</div>
          </div>
        </header>
        <main className="mx-auto max-w-[1480px] px-5 py-7 md:px-9 md:py-9">{children}</main>
      </div>
    </div>
  );
}

export function ExternalLink({ href }: { href: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ArrowUpRight className="size-3" /></a>;
}