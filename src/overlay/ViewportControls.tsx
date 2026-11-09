import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { PRESETS, type PresetName, type ViewportPreset, type ViewportSpec } from '../types.js';
import { Button } from '../components/ui/button.js';
import { Tooltip } from '../components/ui/tooltip.js';

const PRESET_ORDER: PresetName[] = ['desktop', 'tablet', 'mobile'];
const LABELS: Record<PresetName, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};
const ICONS = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };

export function ViewportControls({
  viewport,
  busy,
  onApply,
}: {
  viewport?: ViewportSpec;
  busy: boolean;
  onApply: (preset: ViewportPreset, width: number, height: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md bg-muted p-1" role="group" aria-label="Capture viewport">
      {PRESET_ORDER.map((name) => {
        const item = PRESETS[name];
        const active = viewport?.preset === name;
        const Icon = ICONS[name];
          return (
            <Tooltip key={name} content={`${LABELS[name]} · ${item.width} × ${item.height}`}>
          <Button
            type="button"
            size="icon"
            variant={active ? 'default' : 'ghost'}
            disabled={busy}
            aria-label={`${LABELS[name]} viewport, ${item.width} by ${item.height}`}
            aria-pressed={active}
            onClick={() => onApply(name, item.width, item.height)}
          >
            <Icon aria-hidden="true" />
          </Button>
            </Tooltip>
        );
      })}
    </div>
  );
}
