import { build } from 'esbuild';
import { resolve } from 'node:path';

/**
 * Bundles a TypeScript server module with esbuild, replacing the given import
 * specifiers (exact match) with in-memory mock sources, and imports it.
 * Everything else (zod, local helpers) is bundled for real.
 */
export async function loadWithMocks(entry, mocks) {
  const specifiers = Object.keys(mocks).map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  const filter = new RegExp(`^(?:${specifiers.join('|')})$`);
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'mock-boundary',
        setup(plugin) {
          plugin.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'mock' }));
          plugin.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'js' }));
        },
      },
    ],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
