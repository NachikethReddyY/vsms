import type { Page, Route } from '@playwright/test';

export interface MockContext {
  method: string;
  path: string;
  url: URL;
}

export type ApiHandler = (route: Route, context: MockContext) => void | Promise<void>;

export function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Intercepts every `/api/v1/**` request and dispatches it to a handler keyed
 * by `${METHOD} ${path}` (query strings are ignored). Any endpoint without a
 * handler fails loudly with 404 so specs never silently depend on the real
 * backend.
 */
export function installApiMocks(page: Page, handlers: Record<string, ApiHandler>) {
  return page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '') || '/';
    const method = request.method().toUpperCase();
    const key = `${method} ${path}`;
    const handler = handlers[key];
    if (!handler) {
      return fulfillJson(route, { error: `Unmocked API call: ${key}` }, 404);
    }
    return handler(route, { method, path, url });
  });
}
