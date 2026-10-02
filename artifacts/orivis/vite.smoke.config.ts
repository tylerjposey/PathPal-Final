import path from 'node:path';
import { defineConfig } from 'vite';
import appConfig from './vite.config';

const appDirectory = import.meta.dirname;

export default defineConfig(async (env) => {
  const config =
    typeof appConfig === 'function' ? await appConfig(env) : appConfig;
  const configuredAliases = config.resolve?.alias;
  const aliases = Array.isArray(configuredAliases)
    ? configuredAliases
    : Object.entries(configuredAliases ?? {}).map(([find, replacement]) => ({
        find,
        replacement,
      }));

  return {
    ...config,
    resolve: {
      ...config.resolve,
      alias: [
        {
          find: /^@clerk\/react$/,
          replacement: path.resolve(
            appDirectory,
            'tests/fixtures/clerk-react.tsx',
          ),
        },
        {
          find: /^@clerk\/react\/internal$/,
          replacement: path.resolve(
            appDirectory,
            'tests/fixtures/clerk-internal.ts',
          ),
        },
        ...aliases,
      ],
    },
    build: {
      ...config.build,
      outDir: path.resolve(appDirectory, 'dist/smoke'),
      emptyOutDir: true,
    },
  };
});