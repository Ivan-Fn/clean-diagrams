/**
 * browser.mjs — find a browser for the optional render-based checks and previews.
 *
 * Nothing in the skill needs one. Set CLEAN_DIAGRAMS_BROWSER to choose:
 *   none                 never use a browser (the default when Playwright is not installed)
 *   auto                 Playwright's own Chromium, then installed Chrome, then Edge (default)
 *   chromium|chrome|msedge   that one only
 *   http://host:port     a Chrome already running with --remote-debugging-port
 * Returns null when no browser is available, and the caller carries on without one.
 */
export async function openBrowser() {
  const want = (process.env.CLEAN_DIAGRAMS_BROWSER || 'auto').trim();
  if (want === 'none') return null;
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return null; }
  if (/^https?:\/\//.test(want)) {
    try { return { browser: await chromium.connectOverCDP(want), kind: `Chrome at ${want}` }; } catch (e) {
      console.error(`could not connect to ${want}: ${e.message.split('\n')[0]}`);
      return null;
    }
  }
  const tries = want === 'auto' ? ['chromium', 'chrome', 'msedge'] : [want];
  for (const t of tries) {
    try {
      const browser = await chromium.launch(t === 'chromium' ? {} : { channel: t });
      return { browser, kind: t };
    } catch { /* try the next */ }
  }
  return null;
}
