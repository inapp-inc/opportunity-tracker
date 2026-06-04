import { HTMLAttributes } from "react";
import { cn } from "./utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

export function Badge({ className = "", variant = "default", children, ...props }: BadgeProps) {
  const variants = {
    default: "bg-secondary text-secondary-foreground border-secondary",
    success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300",
    warning: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300",
    danger: "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300",
    info: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
