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

export type Point = { x: number; y: number };
export type Coordinates = [Point, Point, Point, Point];

export type Selection = {
  selectionId: string;
  comment: string;
  coordinates: Coordinates;
  viewport: ViewportSpec;
  scroll: { x: number; y: number };
  page: { url: string };
  createdAt: string;
  imagePath: string;
};

export type SessionState = {
  session: SessionContext;
  viewport: ViewportSpec;
  selections: Selection[];
};

export type ReviewContext = {
  url: string;
  scroll: { x: number; y: number };
  accessibility?: string;
};

export type MachineInfo = {
  hostname: string;
  platform: string;
  arch: string;
  node: string;
};

export type ConsoleEntry = {
  level: 'error' | 'warning';
  text: string;
  timestamp: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};

export type NetworkEntry = {
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  timestamp: string;
};

export type CookieEntry = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
};

export type DiagnosticEntry = {
  message: string;
  timestamp: string;
  url?: string;
};

export type SessionSnapshot = {
  capturedAt: string;
  appUrl: string;
  pageUrl: string;
  viewport: ViewportSpec;
  userAgent: string;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  accessibility: string | null;
  storage: {
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
    cookies: CookieEntry[];
    indexedDb: string[];
  };
  diagnostics: DiagnosticEntry[];
  redactCredentials: boolean;
};

export type FrameIndexEntry = {
  frameId: string;
  number: number;
  timestamp: string;
  imagePath: string;
  diffScore: number;
  tags: string[];
};

export type ContextArtifacts = {
  console: string;
  network: string;
  localStorage: string;
};

export type SubmissionResult = {
  session: SessionContext;
  machine: MachineInfo;
  submittedAt: string;
  appUrl: string;
  selectionIds: string[];
  selectionCount: number;
  imagePaths: string[];
  frameIndex: FrameIndexEntry[];
  selections: Selection[];
  context: SessionSnapshot;
  artifactsDir: string;
  contextArtifacts: ContextArtifacts;
  retrieval: {
    artifacts: string;
  };
};
