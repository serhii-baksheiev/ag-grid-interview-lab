import type { Page } from '@playwright/test';

export interface ResponsivenessSample {
  /** Longest `longtask` entry observed, in ms (0 when none). */
  longestTaskMs: number;
  /** Largest lateness of a 16 ms timer, in ms: how long the main thread was busy. */
  maxTimerDriftMs: number;
  longTaskCount: number;
}
interface Probe {
  stop: () => ResponsivenessSample;
}
type ProbeWindow = Window & { __responsiveness?: Probe };

/**
 * Measure main-thread availability while the page does work: long tasks from
 * the browser's own observer plus the drift of a 16 ms timer. Both are
 * browser-level signals, not micro-benchmarks, and bounded in the test with a
 * budget generous enough for CI noise while far below an unyielding scan.
 */
export async function startResponsivenessProbe(page: Page) {
  await page.evaluate(() => {
    const tasks: number[] = [];
    let maxDrift = 0;
    let expected = performance.now() + 16;
    const timer = setInterval(() => {
      const now = performance.now();
      maxDrift = Math.max(maxDrift, now - expected);
      expected = now + 16;
    }, 16);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    (window as ProbeWindow).__responsiveness = {
      stop: () => {
        clearInterval(timer);
        for (const entry of observer.takeRecords()) tasks.push(entry.duration);
        observer.disconnect();
        return {
          longestTaskMs: tasks.length ? Math.max(...tasks) : 0,
          maxTimerDriftMs: maxDrift,
          longTaskCount: tasks.length,
        };
      },
    };
  });
}

export function stopResponsivenessProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).__responsiveness;
    if (!probe) throw new Error('Responsiveness probe was not started');
    return probe.stop();
  });
}
