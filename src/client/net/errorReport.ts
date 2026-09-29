import { PROTOCOL_VERSION } from '../../shared/protocol';

/**
 * Sends the first few distinct script errors on this page to the server log, so problems players
 * hit show up there. Errors from browser extensions and other sites' scripts are ignored.
 */
export function installErrorReports(): void {
  const seen = new Set<string>();
  const report = (message: string, stack: string | undefined) => {
    if (seen.size >= 5 || seen.has(message)) return;
    seen.add(message);
    const body = JSON.stringify({
      message: message.slice(0, 300),
      stack: stack?.slice(0, 1500),
      page: location.pathname.slice(0, 60),
      ua: `${navigator.userAgent.slice(0, 140)} v${PROTOCOL_VERSION}`,
    });
    fetch('/api/clientlog', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  };
  window.addEventListener('error', (e) => {
    if (e.filename && !e.filename.startsWith(location.origin)) return;
    report(e.message || 'Unknown error', (e.error as Error | undefined)?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    const stack = r?.stack ?? '';
    if (stack && !stack.includes(location.origin) && /extension:\/\//.test(stack)) return;
    report(String(r?.message ?? e.reason ?? 'Unhandled rejection'), stack || undefined);
  });
}
