import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { GenerationProvider } from "@/lib/generation-context";
import { GlobalGenerationPill } from "@/components/global-generation-pill";

import { AuthProvider, useAuth } from "@/lib/auth";
import {
  hydrateProjects,
  clearProjectsCache,
  invalidateHydration,
} from "@/lib/storage";
import { migrateLegacyLocalProjects } from "@/lib/migrate-local-projects";
import Dashboard from "@/pages/dashboard";
import StoryBuilder from "@/pages/story";
import PromptsGenerator from "@/pages/prompts";
import MusicGenerator from "@/pages/music";
import VoiceoverGenerator from "@/pages/voiceover";
import History from "@/pages/history";
import Settings from "@/pages/settings";
import CinemaImageStudio from "@/pages/cinema";
import VideoStudio from "@/pages/video-studio";
import Landing from "@/pages/landing";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import type { ComponentType, ReactElement } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const basePrefix = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
setBaseUrl(basePrefix || null);

/**
 * Drives the project-cache lifecycle off the auth state:
 *
 *   - When auth resolves with a logged-in user, run the one-shot
 *     legacy → server migration (idempotent), then hydrate the cache
 *     from /api/projects.
 *   - When auth resolves with no user (sign-out, never-signed-in), drop
 *     the in-memory cache so the next signin doesn't briefly show the
 *     previous user's projects.
 *
 * `hydratedForUserRef` guards against double-hydrating across re-renders
 * for the same user id.
 */
function ProjectsLifecycle() {
  const { user, loading } = useAuth();
  const hydratedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Logged out: discard the cache + the per-session sentinel so the
      // next signed-in user re-hydrates from scratch.
      clearProjectsCache();
      invalidateHydration();
      hydratedForUserRef.current = null;
      return;
    }
    if (hydratedForUserRef.current === user.id) return;
    hydratedForUserRef.current = user.id;
    let cancelled = false;
    void (async () => {
      try {
        // Migration first so any rewritten projects show up in the
        // hydrate response. The migration helper is idempotent and
        // bails out fast on subsequent calls via its sentinel key.
        await migrateLegacyLocalProjects();
      } catch {
        // Non-fatal — server hydrate below still proceeds; user just
        // won't see any legacy projects until next signin retry.
      }
      if (cancelled) return;
      try {
        await hydrateProjects({ authed: true });
        // Notify any open page (dashboard, history, story restore) that
        // the project list just changed shape.
        window.dispatchEvent(new Event("cs:projects-changed"));
      } catch {
        // Cache stays as-is (likely localStorage fallback). Pages can
        // still render — they just won't see the freshest server data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return null;
}

function Private({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  return <Layout>{children}</Layout>;
}

function withPrivate(Page: ComponentType) {
  return () => (
    <Private>
      <Page />
    </Private>
  );
}

function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Landing />;
  return (
    <Layout>
      <Dashboard />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/login" component={LoginPage} />
      <Route path="/app" component={withPrivate(Dashboard)} />
      <Route path="/story" component={withPrivate(StoryBuilder)} />
      <Route path="/generate" component={withPrivate(PromptsGenerator)} />
      <Route path="/music" component={withPrivate(MusicGenerator)} />
      <Route path="/voiceover" component={withPrivate(VoiceoverGenerator)} />
      <Route path="/cinema" component={withPrivate(CinemaImageStudio)} />
      <Route path="/video-studio" component={withPrivate(VideoStudio)} />
      <Route path="/history" component={withPrivate(History)} />
      <Route path="/settings" component={withPrivate(Settings)} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ProjectsLifecycle />
          <GenerationProvider>
            <WouterRouter base={basePrefix}>
              <Router />
            </WouterRouter>
            <GlobalGenerationPill />
            <Toaster
              theme="dark"
              toastOptions={{
                className:
                  "border-border bg-card text-foreground font-mono text-xs",
              }}
            />
          </GenerationProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
