import { expect, type Page, type TestType } from '@playwright/test';

/**
 * Fail a test when the browser reports an uncaught exception, a console error,
 * or an AG Grid warning. Grid warnings are opted in deliberately: a restored
 * filter model the column cannot hold, an unregistered module or an invalid
 * option all surface as `console.warn("AG Grid: …")` and nothing else, so a
 * suite that ignores warnings passes with a mis-configured grid. Other
 * warnings (browser deprecations, third-party notices) stay out of scope.
 */
export function failOnBrowserErrors(
  test: Pick<TestType<{ page: Page }, object>, 'beforeEach' | 'afterEach'>,
) {
  const reports = new Map<object, string[]>();
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    reports.set(page, errors);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
      else if (message.type() === 'warning' && isGridWarning(message.text()))
        errors.push(message.text());
    });
  });
  test.afterEach(async ({ page }) => {
    expect(
      reports.get(page) ?? [],
      'Browser must not report uncaught exceptions, console errors or AG Grid warnings',
    ).toEqual([]);
    reports.delete(page);
  });
}

export function isGridWarning(text: string): boolean {
  return /^AG Grid:/.test(text);
}
