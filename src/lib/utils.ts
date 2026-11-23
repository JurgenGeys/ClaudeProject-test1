import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names and resolves conflicting Tailwind classes,
 * so the last one wins (e.g. `cn("p-2", "p-4")` returns `"p-4"`).
 * Used by shadcn/ui components.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
