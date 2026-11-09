import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

export function Alert({ className, variant = 'default', ...props }: ComponentProps<'div'> & {
  variant?: 'default' | 'destructive' | 'warning';
}) {
  const variants = {
    default: 'border-border bg-background text-foreground',
    destructive: 'border-destructive/40 bg-destructive/5 text-destructive',
    warning: 'border-amber-300 bg-amber-50 text-amber-950',
  };
  return <div role="alert" data-slot="alert" className={cn('relative w-full rounded-lg border px-3 py-2 text-xs leading-snug', variants[variant], className)} {...props} />;
}
