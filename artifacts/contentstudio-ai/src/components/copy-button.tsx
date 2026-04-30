import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  variant?: "default" | "outline" | "accent";
  className?: string;
  testId?: string;
}

async function copyText(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to textarea fallback
    }
  }
  // Textarea fallback (works on older browsers and non-secure contexts)
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = "Copy",
  variant = "outline",
  className,
  testId,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    }
  };

  const baseClasses =
    "rounded-md font-mono text-xs uppercase tracking-widest transition-colors";
  const variantClasses =
    variant === "accent"
      ? "bg-primary text-black hover:bg-[#D4EB3A]"
      : variant === "default"
        ? "bg-secondary hover:bg-secondary/80"
        : "border-border hover:border-primary hover:text-primary";

  return (
    <Button
      type="button"
      variant={variant === "outline" ? "outline" : undefined}
      onClick={handleCopy}
      className={cn(
        baseClasses,
        variantClasses,
        copied && "!bg-[#4ADE80] !text-black border-transparent",
        failed && "!border-[#FF4444] !text-[#FF4444]",
        className,
      )}
      data-testid={testId}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 mr-1.5" /> Copied
        </>
      ) : failed ? (
        <>Copy failed</>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 mr-1.5" /> {label}
        </>
      )}
    </Button>
  );
}
