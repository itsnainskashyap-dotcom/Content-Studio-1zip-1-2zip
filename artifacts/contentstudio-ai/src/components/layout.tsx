import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  BookOpen,
  Video,
  Music,
  Mic,
  Camera,
  Film,
  History as HistoryIcon,
  Settings as SettingsIcon,
  LogOut,
  Plus,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { storage, type Project } from "@/lib/storage";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/brand-logo";

interface LayoutProps {
  children: ReactNode;
}

function useAuthSafe() {
  try {
    return useAuth();
  } catch {
    return null;
  }
}

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/story": "Story Builder",
  "/generate": "Video Prompts",
  "/music": "Music Brief",
  "/voiceover": "Voiceover",
  "/cinema": "Cinema Image Studio",
  "/video-studio": "AI Video Studio",
  "/history": "History",
  "/settings": "Settings",
};

function Topbar({ location }: { location: string }) {
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const proj = storage.getCurrentProject();
      setCurrentTitle(proj ? proj.title : null);
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("cs:projects-changed", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(
        "cs:projects-changed",
        refresh as EventListener,
      );
    };
  }, [location]);

  const routeLabel =
    ROUTE_LABELS[location] ??
    Object.entries(ROUTE_LABELS).find(
      ([k]) => k !== "/" && location.startsWith(k),
    )?.[1] ??
    "Page";

  return (
    <div className="hidden md:flex sticky top-0 z-20 h-12 items-center px-6 border-b border-border bg-background/95 backdrop-blur-sm">
      <nav
        className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link href="/" className="hover:text-foreground" data-testid="bc-home">
          ContentStudio
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-foreground" data-testid="bc-section">
          {routeLabel}
        </span>
        {currentTitle && (
          <>
            <span className="text-muted-foreground/40">/</span>
            <span
              className="text-primary normal-case tracking-normal font-sans truncate max-w-[280px]"
              data-testid="bc-project"
            >
              {currentTitle}
            </span>
          </>
        )}
      </nav>
    </div>
  );
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/story", label: "Story Builder", icon: BookOpen },
  { href: "/generate", label: "Video Prompts", icon: Video },
  { href: "/video-studio", label: "AI Video Studio", icon: Film },
  { href: "/cinema", label: "Cinema Studio", icon: Camera },
  { href: "/music", label: "Music Brief", icon: Music },
  { href: "/voiceover", label: "Voiceover", icon: Mic },
  { href: "/history", label: "History", icon: HistoryIcon },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [recents, setRecents] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const auth = useAuthSafe();
  const [, navigate] = useLocation();
  const user = auth?.user ?? null;
  const signOut = () => {
    auth?.signOut();
    navigate("/");
  };

  useEffect(() => {
    const refresh = () => {
      const all = storage.getProjects();
      setRecents(
        [...all]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 5),
      );
      setCurrentProject(storage.getCurrentProject());
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("cs:projects-changed", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(
        "cs:projects-changed",
        refresh as EventListener,
      );
    };
  }, [location]);

  const subNav = currentProject
    ? [
        { href: "/story", label: "Story", icon: BookOpen },
        { href: "/generate", label: "Video Prompts", icon: Video },
        { href: "/video-studio", label: "Video Studio", icon: Film },
        { href: "/music", label: "Music", icon: Music },
        { href: "/voiceover", label: "Voiceover", icon: Mic },
      ]
    : [];

  const sidebar = (
    <>
      <div className="h-16 flex items-center px-5 border-b border-border">
        <Link
          href="/"
          className="flex items-center"
          data-testid="link-home"
        >
          <BrandLogo variant="wide" height={32} className="max-w-full" />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? location === "/"
                : location === item.href ||
                  location.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-3 pl-4 pr-3 py-2 text-sm font-medium transition-colors rounded-md",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  )}
                  data-testid={`nav-${item.href.replace("/", "") || "dashboard"}`}
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                      style={{ background: "#E8FF47" }}
                    />
                  )}
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {currentProject && (
          <>
            <div
              className="mt-6 px-6 text-[11px] uppercase tracking-widest text-muted-foreground/70 font-mono"
              data-testid="sidebar-current-project-label"
            >
              Current Project
            </div>
            <div
              className="px-6 mt-1 text-xs text-primary font-sans truncate"
              data-testid="sidebar-current-project-title"
            >
              {currentProject.title}
            </div>
            <ul className="mt-2 space-y-1 px-3" data-testid="sidebar-subnav">
              {subNav.map((item) => {
                const isActive = location === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "relative flex items-center gap-3 pl-7 pr-3 py-1.5 text-xs transition-colors rounded-md",
                        isActive
                          ? "bg-secondary/70 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                      )}
                      data-testid={`subnav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <span className="absolute left-3 text-muted-foreground/50">
                        ├
                      </span>
                      <Icon className="w-3.5 h-3.5" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="mt-6 px-6 text-[11px] uppercase tracking-widest text-muted-foreground/70 font-mono flex items-center justify-between">
          <span>Recent Projects</span>
          <Link
            href="/story"
            onClick={() => storage.setCurrentProjectId(null)}
            className="text-primary hover:opacity-80"
            data-testid="link-new-project"
          >
            <Plus className="w-3.5 h-3.5" />
          </Link>
        </div>
        <ul className="mt-2 px-3 space-y-1">
          {recents.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-muted-foreground/60 font-mono">
              No projects yet
            </li>
          )}
          {recents.map((p) => (
            <li key={p.id}>
              <Link
                href={`/history?id=${p.id}`}
                className="block px-3 py-1.5 rounded-md hover:bg-secondary/50 group"
                data-testid={`recent-${p.id}`}
              >
                <div className="text-xs text-foreground truncate group-hover:text-primary">
                  {p.title}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider truncate">
                  {p.style ?? "no style"} · {p.parts.length} part
                  {p.parts.length === 1 ? "" : "s"}
                </div>
                <div className="text-[10px] text-muted-foreground/60 font-mono uppercase tracking-wider">
                  {new Date(p.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-border p-3 space-y-1">
        {user && (
          <div
            className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/80 truncate"
            data-testid="sidebar-user-email"
          >
            {user.name || user.email}
          </div>
        )}
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
            location === "/settings"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
          )}
          data-testid="nav-settings"
        >
          <SettingsIcon className="w-4 h-4" />
          Settings
        </Link>
        {user && (
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-muted-foreground hover:text-red-400 hover:bg-secondary/50 transition-colors"
            data-testid="nav-signout"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-background text-foreground overflow-hidden">
      <aside className="hidden md:flex w-64 border-r border-border bg-card flex-col shrink-0">
        {sidebar}
      </aside>

      <main className="flex-1 overflow-y-auto bg-background pb-20 md:pb-0">
        <Topbar location={location} />
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border flex items-stretch">
        {[
          { href: "/", label: "Home", icon: LayoutDashboard },
          { href: "/story", label: "Story", icon: BookOpen },
          { href: "/generate", label: "Shots", icon: Video },
          { href: "/voiceover", label: "VO", icon: Mic },
          { href: "/history", label: "History", icon: HistoryIcon },
        ].map((item) => {
          const isActive =
            item.href === "/"
              ? location === "/"
              : location.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-mono uppercase tracking-wider",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
              data-testid={`mnav-${item.href.replace("/", "") || "dashboard"}`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
