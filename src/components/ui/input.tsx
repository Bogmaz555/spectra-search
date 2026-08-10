import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-2 text-base text-fg placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150",
        "focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-signal/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
