import { HTMLAttributes } from "react";

export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className={`w-full ${className}`} {...props} />
    </div>
  );
}

export function TableHeader({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-muted ${className}`} {...props} />;
}

export function TableBody({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-b border-border last:border-0 hover:bg-accent/50 transition-colors ${className}`} {...props} />;
}

export function TableHead({ className = "", ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <th className={`px-4 py-3 text-left text-sm text-muted-foreground ${className}`} {...props} />;
}

export function TableCell({ className = "", ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-3 ${className}`} {...props} />;
}
