import { SelectHTMLAttributes, forwardRef, useMemo } from "react";
import { selectOptionsWithCurrentValue } from "../../lib/lookupOptions";
import { cn } from "./utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, error, options, id, value, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");
    const resolvedOptions = useMemo(
      () => selectOptionsWithCurrentValue(options, String(value ?? "")),
      [options, value]
    );

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
            {props.required && <span className="text-destructive ml-1">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          value={value}
          className={cn(
            "w-full rounded-lg border bg-input-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
            error ? "border-destructive" : "border-border",
            className
          )}
          {...props}
        >
          {resolvedOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
