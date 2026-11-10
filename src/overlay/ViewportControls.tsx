import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { PRESETS, type PresetName, type ViewportPreset, type ViewportSpec } from '../types.js';
import { IconButton } from './IconButton.js';

const PRESET_BUTTONS: { name: PresetName; label: string; icon: typeof Monitor }[] = [
  { name: 'desktop', label: 'Desktop', icon: Monitor },
  { name: 'tablet', label: 'Tablet', icon: Tablet },
  { name: 'mobile', label: 'Mobile', icon: Smartphone },
];

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
      {PRESET_BUTTONS.map(({ name, label, icon: Icon }) => {
        const { width, height } = PRESETS[name];
        const active = viewport?.preset === name;
        return (
          <IconButton
            key={name}
            content={`${label} · ${width} × ${height}`}
            label={`${label} viewport, ${width} by ${height}`}
            variant={active ? 'default' : 'ghost'}
            disabled={busy}
            aria-pressed={active}
            onClick={() => onApply(name, width, height)}
          >
            <Icon aria-hidden="true" />
          </IconButton>
        );
      })}
    </div>
  );
}
