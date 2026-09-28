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

try {
  const buildResult = await build({
    entryPoints: [path.join(artifactDir, "tests", "reports.authorization.test.ts")],
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
  const testOutput = Object.entries(buildResult.metafile.outputs)
    .find(([, output]) => output.entryPoint?.endsWith("reports.authorization.test.ts"))?.[0];
  if (!testOutput) throw new Error("Could not locate the bundled authorization test entry point.");
  const testOutputPath = path.isAbsolute(testOutput) ? testOutput : path.resolve(process.cwd(), testOutput);
  const spawnResult = spawnSync(process.execPath, ["--test", testOutputPath], {
    cwd: artifactDir,
    env: { ...process.env, NODE_ENV: "production", LOG_LEVEL: "fatal" },
    stdio: "inherit",
  });
  if (spawnResult.error) throw spawnResult.error;
  if (spawnResult.status !== 0) process.exitCode = spawnResult.status ?? 1;
} finally {
  await rm(outputDir, { recursive: true, force: true });
}