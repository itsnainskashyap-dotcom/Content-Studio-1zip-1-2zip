import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/brand-logo";

/**
 * Inline Google "G" logo so we don't add a new dependency. Colour values
 * are the official Google brand palette.
 */
function GoogleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.3 29.1 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 16.1 19 13 24 13c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.8 29.1 5 24 5 16.3 5 9.7 9.4 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 43c5 0 9.5-1.7 13-4.6l-6-5c-2 1.4-4.5 2.1-7 2.1-5.3 0-9.7-3.1-11.3-7.5l-6.6 5.1C9.6 38.6 16.2 43 24 43z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.4l6 5C40 35 43.5 30 43.5 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { user, signInWithGoogle, firebaseConfigured } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate("/app");
  }, [user, navigate]);

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    const result = await signInWithGoogle();
    setLoading(false);
    if (!result.ok) setError(result.error ?? "Something went wrong.");
    else navigate("/app");
  };

  return (
    <div className="cs-auth">
      <div className="auth-bg" aria-hidden="true">
        <div className="auth-glow" />
        <div className="auth-grid" />
      </div>

      <div className="auth-shell">
        <Link href="/" className="auth-back" data-testid="auth-back">
          ← Back to home
        </Link>

        <div className="auth-card">
          <div className="auth-logo">
            <BrandLogo variant="auto" height={44} />
          </div>

          <h1 className="auth-h">Welcome to ContentStudio</h1>
          <p className="auth-sub">
            Sign in with Google to keep your projects synced across devices.
          </p>

          {!firebaseConfigured && (
            <div className="auth-error" data-testid="auth-not-configured">
              Google sign-in is not configured yet. Please add the Firebase
              secrets in Replit Secrets and reload the page.
            </div>
          )}

          {error && (
            <div className="auth-error" data-testid="auth-error">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading || !firebaseConfigured}
            className="btn btn-primary btn-lg w-full"
            data-testid="button-continue-google"
            style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Signing in…
              </>
            ) : (
              <>
                <GoogleGlyph size={18} /> Continue with Google
              </>
            )}
          </button>

          <div className="auth-disclaimer" style={{ marginTop: 16 }}>
            Your projects and generated content are saved to your account and
            sync across sessions. We only read your name, email, and profile
            photo from Google.
          </div>
        </div>
      </div>
    </div>
  );
}
