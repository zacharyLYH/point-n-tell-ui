import type { Page, Request, Response } from 'playwright';
import type {
  ConsoleEntry,
  DiagnosticEntry,
  NetworkEntry,
  SessionSnapshot,
  ViewportSpec,
} from './types.js';

const MAX_EVENTS = 200;
const MAX_BODY = 4000;
const SENSITIVE = /authorization|cookie|token|secret|password|passwd|api[-_]?key|session[-_]?id|auth/i;

function pushCapped<T>(items: T[], item: T): void {
  if (items.length >= MAX_EVENTS) {
    items.shift();
  }
  items.push(item);
}

function isAppApi(request: Request, overlayApiUrl?: string): boolean {
  if (overlayApiUrl && request.url().startsWith(overlayApiUrl)) {
    return false;
  }
  return request.resourceType() === 'xhr' || request.resourceType() === 'fetch';
}

function redactRecord(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, SENSITIVE.test(name) ? '[REDACTED]' : value]),
  );
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    let changed = false;
    for (const name of url.searchParams.keys()) {
      if (SENSITIVE.test(name)) {
        url.searchParams.set(name, '[REDACTED]');
        changed = true;
      }
    }
    return changed ? url.href : value;
  } catch {
    return value;
  }
}

export function watchPage(page: Page, appUrl: string, overlayApiUrl?: string) {
  const consoleEntries: ConsoleEntry[] = [];
  const networkEntries: NetworkEntry[] = [];
  const diagnostics: DiagnosticEntry[] = [];

  page.on('console', (message) => {
    const level = message.type();
    if (level !== 'error' && level !== 'warning') {
      return;
    }
    const text = message.text();
    if (text.includes('aria-hidden') && text.includes('not contained inside')) {
      return;
    }
    const location = message.location();
    pushCapped(consoleEntries, {
      level,
      text,
      timestamp: new Date().toISOString(),
      url: location.url || undefined,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber,
    });
  });

  page.on('pageerror', (error) => {
    pushCapped(consoleEntries, {
      level: 'error',
      text: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  page.on('requestfailed', (request) => {
    if (isAppApi(request, overlayApiUrl)) {
      pushCapped(diagnostics, {
        message: `Request failed: ${request.method()} ${request.failure()?.errorText ?? ''}`.trim(),
        url: request.url(),
        timestamp: new Date().toISOString(),
      });
    }
  });

  page.on('response', recordResponse);

  async function recordResponse(response: Response): Promise<void> {
    const request = response.request();
    if (!isAppApi(request, overlayApiUrl)) {
      return;
    }
    try {
      const [requestHeaders, responseHeaders] = await Promise.all([
        request.allHeaders(),
        response.allHeaders(),
      ]);
      const contentType = responseHeaders['content-type'] ?? '';
      const responseBody = /json|text|javascript|xml/i.test(contentType)
        ? (await response.text()).slice(0, MAX_BODY)
        : undefined;
      pushCapped(networkEntries, {
        method: request.method(),
        url: response.url(),
        resourceType: request.resourceType(),
        status: response.status(),
        requestHeaders,
        responseHeaders,
        requestBody: request.postData()?.slice(0, MAX_BODY),
        responseBody,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      pushCapped(diagnostics, {
        message: error instanceof Error ? error.message : String(error),
        url: response.url(),
        timestamp: new Date().toISOString(),
      });
    }
  }

  async function capture(options: {
    redactCredentials: boolean;
    viewport: ViewportSpec;
    accessibility?: string;
  }): Promise<SessionSnapshot> {
    const accessibility =
      options.accessibility ?? (await page.ariaSnapshot().catch(() => null));
    const [pageInfo, cookies] = await Promise.all([
      page.evaluate(async () => {
        const read = (store: Storage): Record<string, string> => {
          const values: Record<string, string> = {};
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index);
            if (key !== null) {
              values[key] = store.getItem(key) ?? '';
            }
          }
          return values;
        };
        const databases =
          typeof indexedDB.databases === 'function'
            ? (await indexedDB.databases()).map((database) => database.name ?? '').filter(Boolean)
            : [];
        return {
          pageUrl: location.href,
          userAgent: navigator.userAgent,
          localStorage: read(localStorage),
          sessionStorage: read(sessionStorage),
          indexedDb: databases,
        };
      }),
      page.context().cookies(),
    ]);

    const redact = options.redactCredentials;
    const scrub = <T extends { url?: string }>(entry: T): T =>
      redact && entry.url ? { ...entry, url: redactUrl(entry.url) } : entry;
    const headers = (values: Record<string, string>) =>
      redact ? redactRecord(values) : { ...values };

    return {
      capturedAt: new Date().toISOString(),
      appUrl,
      pageUrl: pageInfo.pageUrl,
      viewport: { ...options.viewport },
      userAgent: pageInfo.userAgent,
      console: consoleEntries.map(scrub),
      network: networkEntries.map((entry) => ({
        ...scrub(entry),
        requestHeaders: headers(entry.requestHeaders),
        responseHeaders: headers(entry.responseHeaders),
      })),
      accessibility,
      storage: {
        localStorage: headers(pageInfo.localStorage),
        sessionStorage: headers(pageInfo.sessionStorage),
        cookies: cookies.map(({ name, value, domain, path, httpOnly, secure }) => ({
          name,
          value: redact ? '[REDACTED]' : value,
          domain,
          path,
          httpOnly,
          secure,
        })),
        indexedDb: [...pageInfo.indexedDb],
      },
      diagnostics: diagnostics.map(scrub),
      redactCredentials: redact,
    };
  }

  return capture;
}
