import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorCardProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorCard({ message, onRetry, className }: ErrorCardProps) {
  return (
    <div
      className={`border border-[#FF4444]/60 bg-[#FF4444]/10 text-[#FFC9C9] p-4 rounded-md flex items-start gap-3 ${className ?? ""}`}
      data-testid="error-card"
    >
      <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-[#FF4444]" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono uppercase tracking-widest text-[#FF4444] mb-1">
          Error
        </div>
        <div className="text-sm font-sans text-[#FFC9C9] break-words">
          {message}
        </div>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="border-[#FF4444]/60 hover:bg-[#FF4444]/20 hover:text-white text-[#FFC9C9] rounded-md"
          data-testid="button-retry"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Retry
        </Button>
      )}
    </div>
  );
}
