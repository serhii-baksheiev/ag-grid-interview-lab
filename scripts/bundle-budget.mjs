// Production JavaScript gzip budget. Fails when the built JavaScript's gzip size
// exceeds the baseline recorded in scripts/bundle-budget.json by more than its
// tolerance. Deterministic for a given build output; no wall-clock measurement.
//
//   node scripts/bundle-budget.mjs [--dist <dir>] [--budget <file>]
//
// To move the baseline, rebuild and record the new figure together with what it
// was measured from; never raise the tolerance to make a regression pass.
import { gzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function gzipBytes(buffer) {
  return gzipSync(buffer).length;
}

/** Gzip size of every JavaScript file directly in `${distDir}/assets`. */
export async function measureJavaScript(distDir) {
  const assets = join(distDir, 'assets');
  const hint = `No built JavaScript in ${assets}; run \`npm run build\` first.`;
  let entries;
  try {
    entries = await readdir(assets, { withFileTypes: true });
  } catch {
    throw new Error(hint);
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const buffer = await readFile(join(assets, entry.name));
    files.push({
      name: entry.name,
      bytes: buffer.length,
      gzipBytes: gzipBytes(buffer),
    });
  }
  if (!files.length) throw new Error(hint);
  return {
    files,
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
  };
}

export function checkBudget({ gzipBytes, baselineGzipBytes, tolerance }) {
  const limitBytes = Math.floor(baselineGzipBytes * (1 + tolerance));
  return {
    ok: gzipBytes <= limitBytes,
    limitBytes,
    // A difference first keeps whole-byte growth exact (50 / 1000 is 0.05).
    growth: (gzipBytes - baselineGzipBytes) / baselineGzipBytes,
  };
}

async function main(args) {
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : args[at + 1];
  };
  const distDir = resolve(option('--dist', 'dist'));
  const budgetPath = resolve(option('--budget', 'scripts/bundle-budget.json'));
  const budget = JSON.parse(await readFile(budgetPath, 'utf8'));
  if (
    !Number.isInteger(budget.baselineGzipBytes) ||
    budget.baselineGzipBytes <= 0 ||
    typeof budget.tolerance !== 'number' ||
    budget.tolerance < 0
  )
    throw new Error(`Invalid budget file ${budgetPath}`);
  const measured = await measureJavaScript(distDir);
  const result = checkBudget({
    gzipBytes: measured.gzipBytes,
    baselineGzipBytes: budget.baselineGzipBytes,
    tolerance: budget.tolerance,
  });
  for (const file of measured.files)
    console.log(`${file.name}: ${file.bytes} bytes, ${file.gzipBytes} gzip`);
  console.log(
    `JavaScript gzip ${measured.gzipBytes} bytes; baseline ${budget.baselineGzipBytes} bytes (${budget.recordedFrom}); ` +
      `limit ${result.limitBytes} bytes (+${(budget.tolerance * 100).toFixed(1)}%); ` +
      `growth ${(result.growth * 100).toFixed(2)}%`,
  );
  if (!result.ok) {
    console.error(
      `Bundle budget exceeded by ${measured.gzipBytes - result.limitBytes} gzip bytes.`,
    );
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
