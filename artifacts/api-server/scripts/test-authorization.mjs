import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

const require = createRequire(import.meta.url);
globalThis.require = require;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(scriptDir, "..");
const outputDir = path.join(artifactDir, ".authorization-test-build");
const testFiles = [
  "pathpal-auth.test.ts",
  "pathpal-demo-auth.test.ts",
  "family-journeys.routes.test.ts",
  "journey-routes.test.ts",
];
const testEntryPoints = testFiles.map((file) => path.join(artifactDir, "tests", file));

try {
  const buildResult = await build({
    entryPoints: testEntryPoints,
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: outputDir,
    entryNames: "[name]-[hash]",
    sourcemap: "inline",
    logLevel: "info",
    metafile: true,
    external: [
      "*.node",
      "@google-cloud/*",
      "pg-native",
      "dtrace-provider",
      "cpu-features",
      "ssh2",
      "bufferutil",
      "utf-8-validate",
      "fsevents",
    ],
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
globalThis.require = __bannerCrReq(import.meta.url);`,
    },
  });
  const testOutputs = Object.entries(buildResult.metafile.outputs)
    .filter(([, output]) => testFiles.some((file) => output.entryPoint?.endsWith(file)))
    .map(([outputPath]) =>
      path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath),
    );
  if (testOutputs.length !== testEntryPoints.length) {
    throw new Error("Could not locate all bundled test entry points.");
  }
  const spawnResult = spawnSync(process.execPath, ["--test", ...testOutputs], {
    cwd: artifactDir,
    env: { ...process.env, NODE_ENV: "production", LOG_LEVEL: "fatal" },
    stdio: "inherit",
  });
  if (spawnResult.error) throw spawnResult.error;
  if (spawnResult.status !== 0) process.exitCode = spawnResult.status ?? 1;
} finally {
  await rm(outputDir, { recursive: true, force: true });
}