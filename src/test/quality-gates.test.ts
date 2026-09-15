// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function extractJobs(ciYaml: string): Record<string, string> {
  const jobsSectionMatch = ciYaml.match(/^jobs:\n([\s\S]*)$/m);
  const jobsSection = jobsSectionMatch ? jobsSectionMatch[1] : '';
  const jobStarts = [...jobsSection.matchAll(/^ {2}([a-zA-Z0-9_-]+):\n/gm)];

  const jobs: Record<string, string> = {};
  jobStarts.forEach((match, index) => {
    const start = match.index ?? 0;
    const end =
      index + 1 < jobStarts.length
        ? (jobStarts[index + 1].index ?? jobsSection.length)
        : jobsSection.length;
    jobs[match[1]] = jobsSection.slice(start, end);
  });
  return jobs;
}

function findJobByName(
  jobs: Record<string, string>,
  name: string,
): string | undefined {
  return Object.values(jobs).find((block) =>
    new RegExp(`name:\\s*${name}\\s*\\n`).test(block),
  );
}

describe('package.json scripts', () => {
  const pkg = JSON.parse(readRepoFile('package.json')) as {
    scripts: Record<string, string>;
  };

  it('adds a check:bundle script that runs the bundle budget script', () => {
    expect(pkg.scripts['check:bundle']).toBe('node scripts/bundle-budget.mjs');
  });

  it('runs every script test from test:benchmark, including the new bundle-budget test', () => {
    const command = pkg.scripts['test:benchmark'];
    const runsGlob = /node --test scripts\/\*\.test\.mjs/.test(command);
    const runsExplicitList =
      command.includes('require-abort.test.mjs') &&
      command.includes('bundle-budget.test.mjs');

    expect(runsGlob || runsExplicitList).toBe(true);
  });

  it('keeps test:e2e:ci running playwright without rebuilding', () => {
    expect(pkg.scripts['test:e2e:ci']).toBe('playwright test');
  });
});

describe('playwright.config.ts', () => {
  it('defines exactly the chromium and firefox projects, keeps retries at 0, and keeps the web server strict', async () => {
    const configModule = await import('../../playwright.config');
    const config = configModule.default;

    expect(config.projects).toBeDefined();
    expect(config.projects).toHaveLength(2);

    const names = (config.projects ?? []).map((project) => project.name).sort();
    expect(names).toEqual(['chromium', 'firefox']);

    const chromiumProject = (config.projects ?? []).find(
      (project) => project.name === 'chromium',
    );
    const firefoxProject = (config.projects ?? []).find(
      (project) => project.name === 'firefox',
    );

    expect(chromiumProject?.use).toEqual(devices['Desktop Chrome']);
    expect(firefoxProject?.use).toEqual(devices['Desktop Firefox']);

    expect(config.retries).toBe(0);

    const webServer = Array.isArray(config.webServer)
      ? config.webServer[0]
      : config.webServer;
    expect(webServer?.reuseExistingServer).toBe(false);
    expect(webServer?.command).toMatch(/--strictPort\b/);
    expect(webServer?.command).toMatch(/--port \d+/);
  });
});

describe('.github/workflows/ci.yml', () => {
  const ciYaml = readRepoFile('.github/workflows/ci.yml');
  const jobs = extractJobs(ciYaml);

  it('runs the bundle budget check after the build in the Quality job', () => {
    const qualityJob = findJobByName(jobs, 'Quality');
    expect(qualityJob).toBeDefined();

    const buildIndex = qualityJob!.indexOf('npm run build');
    const budgetIndex = qualityJob!.indexOf('npm run check:bundle');

    expect(buildIndex).toBeGreaterThan(-1);
    expect(budgetIndex).toBeGreaterThan(-1);
    expect(budgetIndex).toBeGreaterThan(buildIndex);
  });

  it('installs only chromium and scopes the E2E run to the chromium project in the E2E Chromium job', () => {
    const chromiumJob = findJobByName(jobs, 'E2E Chromium');
    expect(chromiumJob).toBeDefined();

    expect(chromiumJob).toMatch(/playwright install --with-deps chromium\b/);
    expect(chromiumJob).not.toMatch(
      /playwright install --with-deps[^\n]*firefox/,
    );
    expect(chromiumJob).toMatch(/test:e2e:ci[^\n]*--project=chromium/);
  });

  it('adds an E2E Firefox job that installs only firefox, builds once, scopes the run to firefox, and uploads a distinctly-named failure artifact', () => {
    const firefoxJob = findJobByName(jobs, 'E2E Firefox');
    expect(firefoxJob).toBeDefined();

    expect(firefoxJob).toMatch(/playwright install --with-deps firefox\b/);
    expect(firefoxJob).not.toMatch(
      /playwright install --with-deps[^\n]*chromium/,
    );

    const buildMatches = firefoxJob!.match(/npm run build/g) ?? [];
    expect(buildMatches).toHaveLength(1);

    expect(firefoxJob).toMatch(/test:e2e:ci[^\n]*--project=firefox/);

    const artifactMatch = firefoxJob!.match(
      /name:\s*([^\n]+)\n\s*path:\s*test-results\//,
    );
    expect(artifactMatch).not.toBeNull();
    expect(artifactMatch?.[1].trim()).not.toBe('playwright-failure');
  });

  it('runs the bundle budget as an active step that cannot be skipped or allowed to fail', () => {
    const qualityJob = findJobByName(jobs, 'Quality');
    // A real step line, not a comment mentioning the command.
    expect(qualityJob).toMatch(/^\s+- run: npm run check:bundle\s*$/m);
    expect(ciYaml).not.toMatch(/continue-on-error/);
    // The only condition in the workflow uploads artifacts after a failure.
    const conditions = ciYaml.match(/^\s+if:.*$/gm) ?? [];
    expect(conditions.map((line) => line.trim())).toEqual(
      conditions.map(() => 'if: failure()'),
    );
  });

  it('builds before running the Firefox suite', () => {
    const firefoxJob = findJobByName(jobs, 'E2E Firefox')!;
    const buildIndex = firefoxJob.indexOf('npm run build');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(firefoxJob.indexOf('--project=firefox'));
  });

  it('never raises a timeout, sets chunkSizeWarningLimit, or passes --retries anywhere in the workflow', () => {
    expect(ciYaml).not.toMatch(/chunkSizeWarningLimit/);
    expect(ciYaml).not.toMatch(/--retries/);
    expect(ciYaml).not.toMatch(/--timeout/);
  });
});

describe('E2E suite', () => {
  it('records main-thread timing without gating on it, because wall-clock depends on the runner', () => {
    const spec = readRepoFile('e2e/remediation.spec.ts');
    expect(spec).not.toMatch(
      /expect\(\s*sample\.(longestTaskMs|maxTimerDriftMs)/,
    );
    expect(spec).toMatch(/annotations\.push\(/);
  });
});

describe('vite.config.ts', () => {
  it('does not set chunkSizeWarningLimit, keeping the bundle-size warning visible', () => {
    const viteConfigSource = readRepoFile('vite.config.ts');
    expect(viteConfigSource).not.toMatch(/chunkSizeWarningLimit/);
  });
});
