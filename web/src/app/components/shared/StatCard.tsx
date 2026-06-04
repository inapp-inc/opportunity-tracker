import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "../ui/Card";
import { cn } from "../ui/utils";

type StatCardProps = {
  label: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  accentClassName?: string;
  className?: string;
};

export function StatCard({
  label,
  value,
  description,
  icon: Icon,
  iconClassName = "text-primary",
  accentClassName = "bg-primary",
  className,
}: StatCardProps) {
  return (
    <Card className={cn("group relative overflow-hidden hover:shadow-md", className)}>
      <div className={cn("absolute inset-x-0 top-0 h-0.5", accentClassName)} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
            <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-foreground">
              {value}
            </p>
            {description ? (
              <p className="mt-2 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {Icon ? (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/70 transition-transform group-hover:scale-105">
              <Icon className={cn("h-5 w-5", iconClassName)} />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
