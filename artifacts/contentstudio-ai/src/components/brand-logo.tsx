interface Props {
  variant?: "wide" | "icon" | "auto";
  className?: string;
  height?: number;
}

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/";

export function BrandLogo({ variant = "auto", className, height }: Props) {
  if (variant === "wide") {
    return (
      <img
        src={`${BASE}logo-wide.png`}
        alt="ContentStudio AI"
        className={className}
        style={height ? { height, width: "auto" } : undefined}
        data-testid="brand-logo-wide"
      />
    );
  }
  if (variant === "icon") {
    return (
      <img
        src={`${BASE}logo-icon.png`}
        alt="ContentStudio AI"
        className={className}
        style={height ? { height, width: "auto" } : undefined}
        data-testid="brand-logo-icon"
      />
    );
  }
  return (
    <>
      <img
        src={`${BASE}logo-wide.png`}
        alt="ContentStudio AI"
        className={`hidden md:block ${className ?? ""}`.trim()}
        style={height ? { height, width: "auto" } : undefined}
        data-testid="brand-logo-wide"
      />
      <img
        src={`${BASE}logo-icon.png`}
        alt="ContentStudio AI"
        className={`md:hidden ${className ?? ""}`.trim()}
        style={height ? { height, width: "auto" } : undefined}
        data-testid="brand-logo-icon"
      />
    </>
  );
}
