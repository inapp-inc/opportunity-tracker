import type { ReactNode } from "react";
import { cn } from "../ui/utils";

export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm lg:flex-row lg:items-center",
        className
      )}
    >
      {children}
    </div>
  );
}
