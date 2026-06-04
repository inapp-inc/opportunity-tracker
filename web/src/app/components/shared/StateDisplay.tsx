import type { LucideIcon } from "lucide-react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { cn } from "../ui/utils";

type StateDisplayProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function EmptyDisplay({
  title,
  description,
  icon: Icon = AlertCircle,
  actionLabel,
  onAction,
  className,
}: StateDisplayProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center", className)}>
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/70">
        <Icon className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {actionLabel && onAction ? (
        <Button className="mt-6" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ErrorDisplay({
  title = "Something went wrong",
  description = "The data could not be loaded.",
  onAction,
  actionLabel = "Try again",
  className,
}: Partial<StateDisplayProps>) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-14 text-center", className)}>
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
        <AlertCircle className="h-7 w-7 text-red-500" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {onAction ? (
        <Button className="mt-6" variant="outline" size="sm" onClick={onAction}>
          <RefreshCw className="h-4 w-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingDisplay({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-border bg-card/60 px-6 py-14 text-center">
      <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
    </div>
  );
}
