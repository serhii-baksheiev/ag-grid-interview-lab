import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { gzipBytes, measureJavaScript, checkBudget } from './bundle-budget.mjs';

const CLI_PATH = fileURLToPath(new URL('./bundle-budget.mjs', import.meta.url));
const REPO_BUDGET_PATH = fileURLToPath(
  new URL('./bundle-budget.json', import.meta.url),
);

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-budget-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('gzipBytes', () => {
  it('matches the length zlib.gzipSync reports for a known buffer', () => {
    const buffer = Buffer.from('hello world '.repeat(250));
    assert.equal(gzipBytes(buffer), zlib.gzipSync(buffer).length);
  });
});

describe('measureJavaScript', () => {
  it('sums only top-level assets/*.js files, ignoring css, maps and nested directories, and reports per-file sizes', async () => {
    await withTempDir(async (dir) => {
      const assetsDir = join(dir, 'assets');
      await mkdir(join(assetsDir, 'chunks'), { recursive: true });

      const indexContent = Buffer.from('console.log("index");'.repeat(50));
      const vendorContent = Buffer.from('console.log("vendor");'.repeat(80));

      await writeFile(join(assetsDir, 'index-abc123.js'), indexContent);
      await writeFile(join(assetsDir, 'vendor-def456.js'), vendorContent);
      await writeFile(join(assetsDir, 'index-abc123.css'), 'body{color:red}');
      await writeFile(join(assetsDir, 'index-abc123.js.map'), '{"version":3}');
      await writeFile(
        join(assetsDir, 'chunks', 'nested.js'),
        'console.log("nested");',
      );

      const result = await measureJavaScript(dir);

      const names = result.files.map((file) => file.name).sort();
      assert.deepEqual(names, ['index-abc123.js', 'vendor-def456.js']);

      const indexFile = result.files.find(
        (file) => file.name === 'index-abc123.js',
      );
      assert.equal(indexFile.bytes, indexContent.length);
      assert.equal(indexFile.gzipBytes, zlib.gzipSync(indexContent).length);

      const vendorFile = result.files.find(
        (file) => file.name === 'vendor-def456.js',
      );
      assert.equal(vendorFile.bytes, vendorContent.length);
      assert.equal(vendorFile.gzipBytes, zlib.gzipSync(vendorContent).length);

      const expectedTotal = result.files.reduce(
        (sum, file) => sum + file.gzipBytes,
        0,
      );
      assert.equal(result.gzipBytes, expectedTotal);
    });
  });

  it('throws an error naming the missing assets directory and the build hint', async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(
        () => measureJavaScript(dir),
        (error) => {
          assert.match(error.message, /npm run build/);
          assert.ok(error.message.includes(join(dir, 'assets')));
          return true;
        },
      );
    });
  });

  it('throws an error naming the directory and the build hint when assets holds no .js file', async () => {
    await withTempDir(async (dir) => {
      const assetsDir = join(dir, 'assets');
      await mkdir(assetsDir, { recursive: true });
      await writeFile(join(assetsDir, 'style.css'), 'body{color:blue}');

      await assert.rejects(
        () => measureJavaScript(dir),
        (error) => {
          assert.match(error.message, /npm run build/);
          assert.ok(error.message.includes(assetsDir));
          return true;
        },
      );
    });
  });
});

describe('checkBudget', () => {
  it('is ok exactly at the limit', () => {
    const result = checkBudget({
      gzipBytes: 1050,
      baselineGzipBytes: 1000,
      tolerance: 0.05,
    });
    assert.equal(result.limitBytes, 1050);
    assert.equal(result.ok, true);
    assert.equal(result.growth, 0.05);
  });

  it('is not ok one byte above the limit', () => {
    const result = checkBudget({
      gzipBytes: 1051,
      baselineGzipBytes: 1000,
      tolerance: 0.05,
    });
    assert.equal(result.limitBytes, 1050);
    assert.equal(result.ok, false);
  });

  it('computes growth as a fraction of the baseline', () => {
    const result = checkBudget({
      gzipBytes: 1200,
      baselineGzipBytes: 1000,
      tolerance: 0.05,
    });
    assert.equal(result.growth, 0.2);
    assert.equal(result.ok, false);
  });

  it('floors a fractional limit down to whole bytes', () => {
    const result = checkBudget({
      gzipBytes: 103,
      baselineGzipBytes: 99,
      tolerance: 0.05,
    });
    assert.equal(result.limitBytes, Math.floor(99 * 1.05));
  });
});

describe('CLI', () => {
  it('exits 0 and prints the measured, baseline, limit and growth numbers when within budget', async () => {
    await withTempDir(async (dir) => {
      const assetsDir = join(dir, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const content = Buffer.from('console.log("hi");'.repeat(20));
      await writeFile(join(assetsDir, 'index-abc.js'), content);
      const expectedGzip = zlib.gzipSync(content).length;

      const budgetPath = join(dir, 'budget.json');
      const baselineGzipBytes = expectedGzip;
      await writeFile(
        budgetPath,
        JSON.stringify({
          baselineGzipBytes,
          tolerance: 0.05,
          recordedFrom: 'fixture build',
        }),
      );

      const result = spawnSync(
        process.execPath,
        [CLI_PATH, '--dist', dir, '--budget', budgetPath],
        { encoding: 'utf8' },
      );

      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, new RegExp(String(expectedGzip)));
      assert.match(result.stdout, new RegExp(String(baselineGzipBytes)));
      assert.match(
        result.stdout,
        new RegExp(String(Math.floor(baselineGzipBytes * 1.05))),
      );
      assert.match(result.stdout, /%/);
    });
  });

  it('exits 1 when the measured gzip size exceeds the budget', async () => {
    await withTempDir(async (dir) => {
      const assetsDir = join(dir, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const content = Buffer.from('console.log("hi");'.repeat(2000));
      await writeFile(join(assetsDir, 'index-abc.js'), content);

      const budgetPath = join(dir, 'budget.json');
      await writeFile(
        budgetPath,
        JSON.stringify({
          baselineGzipBytes: 10,
          tolerance: 0.05,
          recordedFrom: 'fixture build',
        }),
      );

      const result = spawnSync(
        process.execPath,
        [CLI_PATH, '--dist', dir, '--budget', budgetPath],
        { encoding: 'utf8' },
      );

      assert.equal(result.status, 1);
    });
  });

  it('exits 1 with the build hint when dist is missing', async () => {
    await withTempDir(async (dir) => {
      const missingDist = join(dir, 'does-not-exist');
      const budgetPath = join(dir, 'budget.json');
      await writeFile(
        budgetPath,
        JSON.stringify({
          baselineGzipBytes: 1000,
          tolerance: 0.05,
          recordedFrom: 'fixture build',
        }),
      );

      const result = spawnSync(
        process.execPath,
        [CLI_PATH, '--dist', missingDist, '--budget', budgetPath],
        { encoding: 'utf8' },
      );

      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /npm run build/);
    });
  });

  it('defaults --dist to dist and --budget to scripts/bundle-budget.json relative to the working directory', async () => {
    await withTempDir(async (dir) => {
      const assetsDir = join(dir, 'dist', 'assets');
      await mkdir(assetsDir, { recursive: true });
      const content = Buffer.from('console.log("default");'.repeat(20));
      await writeFile(join(assetsDir, 'index-abc.js'), content);
      const expectedGzip = zlib.gzipSync(content).length;

      await mkdir(join(dir, 'scripts'), { recursive: true });
      await writeFile(
        join(dir, 'scripts', 'bundle-budget.json'),
        JSON.stringify({
          baselineGzipBytes: expectedGzip,
          tolerance: 0.05,
          recordedFrom: 'fixture build',
        }),
      );

      const result = spawnSync(process.execPath, [CLI_PATH], {
        encoding: 'utf8',
        cwd: dir,
      });

      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, new RegExp(String(expectedGzip)));
    });
  });
});

describe('scripts/bundle-budget.json', () => {
  it('records a positive integer baseline, tolerance 0.05 and a non-empty description', () => {
    const raw = readFileSync(REPO_BUDGET_PATH, 'utf8');
    const budget = JSON.parse(raw);

    assert.equal(Number.isInteger(budget.baselineGzipBytes), true);
    assert.ok(budget.baselineGzipBytes > 0);
    assert.equal(budget.tolerance, 0.05);
    assert.equal(typeof budget.recordedFrom, 'string');
    assert.ok(budget.recordedFrom.length > 0);
  });
});
