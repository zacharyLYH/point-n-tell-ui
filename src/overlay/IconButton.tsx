import type { ComponentProps } from 'react';
import { Button } from '../components/ui/button.js';
import { Tooltip } from '../components/ui/tooltip.js';

export function IconButton({
  label,
  content,
  ...props
}: ComponentProps<typeof Button> & { label: string; content?: string }) {
  return (
    <Tooltip content={content ?? label}>
      <Button type="button" size="icon" aria-label={label} {...props} />
    </Tooltip>
  );
}
