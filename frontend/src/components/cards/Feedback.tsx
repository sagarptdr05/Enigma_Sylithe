import { AlertTriangle, RefreshCw } from "lucide-react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-border/60 ${className}`} />;
}

export function SkeletonList({ n = 4, h = "h-20" }: { n?: number; h?: string }) {
  return <div className="space-y-3">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className={h} />)}</div>;
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="card p-6 flex flex-col items-center text-center gap-3 border-danger/40">
      <AlertTriangle className="text-danger" />
      <div>
        <p className="font-medium">Could not load data</p>
        <p className="text-sm text-muted mt-1">{msg}. Is the backend running on port 8000?</p>
      </div>
      {onRetry && <button className="btn-ghost" onClick={onRetry}><RefreshCw size={14} /> Retry</button>}
    </div>
  );
}
