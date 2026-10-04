"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  CalendarDays,
  ClipboardList,
  Trophy,
  FileSpreadsheet,
  ScrollText,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { AdminDataProvider, useAdminData } from "@/context/AdminDataContext";
import { useConnection } from "@/hooks/useConnection";
import { Alert, Button, Card, FullPageSpinner, cn } from "@/components/ui";
import { ConnectionBadge, OfflineBanner } from "@/components/shared";
import { initializeEvent } from "@/lib/actions";
import { dayLabel } from "@/lib/keys";
import { errorMessage } from "@/lib/firebase";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/evaluators", label: "Evaluators", icon: UserCheck },
  { href: "/admin/days", label: "Day Management", icon: CalendarDays },
  { href: "/admin/evaluations", label: "Evaluations", icon: ClipboardList },
  { href: "/admin/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/admin/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/admin/audit", label: "Audit Logs", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "loading" && state.status !== "checking" && state.status !== "admin") {
      router.replace(state.status === "evaluator" ? "/evaluator" : "/");
    }
  }, [state.status, router]);
  if (state.status !== "admin") return <FullPageSpinner label="Checking admin access…" />;
  return (
    <AdminDataProvider admin={{ uid: state.user.uid, email: (state.user.email ?? "").toLowerCase() }}>
      <AdminShell>{children}</AdminShell>
    </AdminDataProvider>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { event, activeDay } = useAdminData();
  const status = event?.days?.[activeDay]?.status;
  return (
    <nav className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-300">Main Admin</p>
        <p className="mt-1 text-lg font-extrabold tracking-tight text-white">{event?.name ?? "Freshers 2026"}</p>
        {event && (
          <p className="mt-1 text-xs text-brand-200">
            {dayLabel(activeDay)} ·{" "}
            <span className={status === "open" ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>{status === "open" ? "OPEN" : "LOCKED"}</span>
          </p>
        )}
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="size-4.5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const { state, signOut } = useAuth();
  const { loading, error, event, admin } = useAdminData();
  const connection = useConnection();
  const [menuOpen, setMenuOpen] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const email = state.status === "admin" ? state.user.email : "";

  let content: React.ReactNode = children;
  if (error) {
    content = (
      <Alert tone="red" title="Could not load data">
        {error}
      </Alert>
    );
  } else if (loading) {
    content = <FullPageSpinner label={connection === "offline" ? "Waiting for connection…" : "Loading live data…"} />;
  } else if (!event) {
    content = (
      <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Sparkles className="size-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold">Set up Freshers 2026</h1>
        <p className="mt-2 text-sm text-slate-600">
          Creates the event with 3 days (all locked) and the default criteria: Makeup, Presentation, Styling and Dress-up — 10 marks each.
        </p>
        {initError && (
          <Alert tone="red" className="mt-4 text-left">
            {initError}
          </Alert>
        )}
        <Button
          size="lg"
          className="mt-6 w-full"
          loading={initBusy}
          onClick={async () => {
            setInitBusy(true);
            setInitError(null);
            try {
              await initializeEvent(admin);
            } catch (e) {
              setInitError(errorMessage(e));
            } finally {
              setInitBusy(false);
            }
          }}
        >
          Initialise event
        </Button>
      </Card>
    );
  }

  return (
    <div className="min-h-dvh">
      <OfflineBanner state={connection} />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-gradient-to-b from-brand-800 to-brand-900 lg:block">
        <Sidebar />
      </aside>
      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-gradient-to-b from-brand-800 to-brand-900 shadow-xl">
            <button className="absolute right-3 top-4 rounded-lg p-1.5 text-brand-200 hover:bg-white/10" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-2">
            <button className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <span className="font-semibold text-slate-800 lg:hidden">Freshers Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionBadge state={connection} />
            <span className="hidden text-sm text-slate-500 md:inline">{email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto min-w-0 max-w-7xl px-4 py-6 lg:px-8">{content}</main>
      </div>
    </div>
  );
}
