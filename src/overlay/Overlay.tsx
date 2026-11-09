import { useEffect, useState } from 'react';
import {
  PRESETS,
  type PresetName,
  type SessionState,
  type ViewportPreset,
} from '../types.js';

const PRESET_ORDER: PresetName[] = ['desktop', 'tablet', 'mobile'];
const LABELS: Record<PresetName, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};

export function Overlay({ apiUrl }: { apiUrl: string }) {
  const [state, setState] = useState<SessionState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [actual, setActual] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    let alive = true;
    fetch(`${apiUrl}/state`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Session unavailable (${response.status})`);
        }
        return (await response.json()) as SessionState;
      })
      .then((next) => {
        if (alive) {
          setState(next);
        }
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      alive = false;
    };
  }, [apiUrl]);

  useEffect(() => {
    const check = () =>
      setActual({ width: window.innerWidth, height: window.innerHeight });
    check();
    window.addEventListener('resize', check);
    const timer = window.setInterval(check, 1000);
    return () => {
      window.removeEventListener('resize', check);
      window.clearInterval(timer);
    };
  }, []);

  async function apply(preset: ViewportPreset, width: number, height: number) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${apiUrl}/viewport`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preset, width, height }),
      });
      const body = (await response.json()) as SessionState | { error?: string };
      if (!response.ok) {
        throw new Error('error' in body ? body.error : `Request failed (${response.status})`);
      }
      setState(body as SessionState);
      setActual({ width: window.innerWidth, height: window.innerHeight });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="pointer-events-auto fixed right-3 top-3 z-[2147483647] flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 font-sans text-xs font-semibold text-slate-900 shadow-lg backdrop-blur"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Point and Tell
      </button>
    );
  }

  const viewport = state?.viewport;
  const mismatched =
    viewport &&
    (actual.width !== viewport.width || actual.height !== viewport.height);

  return (
    <section
      aria-label="Point and Tell"
      className="pointer-events-auto fixed right-3 top-3 z-[2147483647] w-[19rem] rounded-xl border border-slate-200 bg-white/95 font-sans text-slate-900 shadow-xl backdrop-blur"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <h2 className="text-sm font-semibold">Point and Tell</h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse Point and Tell"
          className="rounded-md px-2 py-0.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          −
        </button>
      </header>

      <div className="space-y-3 p-3">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Viewport</span>
            <span className="text-[11px] font-medium text-slate-700">
              {viewport
                ? `${viewport.preset} ${viewport.width} × ${viewport.height}`
                : 'loading...'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESET_ORDER.map((name) => {
              const item = PRESETS[name];
              const active = viewport?.preset === name;
              return (
                <button
                  key={name}
                  type="button"
                  disabled={busy}
                  onClick={() => void apply(name, item.width, item.height)}
                  className={`rounded-md border px-1.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="block">{LABELS[name]}</span>
                  <span className="block text-[10px] font-normal opacity-70">
                    {item.width}×{item.height}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <form
          className="flex items-end gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const width = Number(data.get('width'));
            const height = Number(data.get('height'));
            if (
              !Number.isInteger(width) ||
              !Number.isInteger(height) ||
              width <= 0 ||
              height <= 0
            ) {
              setError('Custom width and height must be positive integers');
              return;
            }
            void apply('custom', width, height);
          }}
        >
          <label className="flex-1 text-[11px] font-medium text-slate-500">
            Width
            <input
              name="width"
              aria-label="Custom width"
              type="number"
              min="1"
              step="1"
              placeholder="1440"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <span className="pb-1.5 text-xs text-slate-400">×</span>
          <label className="flex-1 text-[11px] font-medium text-slate-500">
            Height
            <input
              name="height"
              aria-label="Custom height"
              type="number"
              min="1"
              step="1"
              placeholder="900"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Apply
          </button>
        </form>

        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Session
          </div>
          <div className="break-all font-mono text-[11px] text-slate-700">
            {state?.session.sessionRef ?? '...'}
          </div>
        </div>

        {mismatched && viewport && (
          <div
            role="status"
            className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900"
          >
            <strong className="font-semibold">Viewport mismatch.</strong> Page
            reports {actual.width} × {actual.height}, selected {viewport.width} ×{' '}
            {viewport.height}. Docked DevTools may be overriding it. You can keep
            working.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-900"
          >
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
