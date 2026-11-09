export const PRESETS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

export type PresetName = keyof typeof PRESETS;
export type ViewportPreset = PresetName | 'custom';

export type ViewportSpec = {
  preset: ViewportPreset;
  width: number;
  height: number;
};

export type SessionContext = {
  harness: string;
  chatTitle: string;
  sessionId: string;
  sessionRef: string;
};

export type SessionState = {
  session: SessionContext;
  viewport: ViewportSpec;
  presets: typeof PRESETS;
};
