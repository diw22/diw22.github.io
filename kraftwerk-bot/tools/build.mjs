// Builds app.js from src/. Run with `npm run build` in kraftwerk-bot/.
// three.js stays external: the page's import map points it at the site's vendored copy. react-three-fiber's own
// imports of 'three' go to src/three-for-fiber.js instead (see that file for why).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// ESBUILD and NODE_PATH let the build run against packages installed somewhere other than ./node_modules.
const esbuild = await import(process.env.ESBUILD || 'esbuild');
const build = esbuild.build || esbuild.default.build;

const threeForFiber = {
  name: 'three-for-fiber',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, (args) => (/[\\/]@react-three[\\/]fiber[\\/]/.test(args.importer)
      ? { path: path.join(root, 'src', 'three-for-fiber.js') }
      : { path: 'three', external: true }));
  }
};

const result = await build({
  entryPoints: [path.join(root, 'src', 'main.jsx')],
  outfile: path.join(root, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  legalComments: 'linked',
  external: ['three/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [],
  plugins: [threeForFiber],
  logLevel: 'warning',
  metafile: true
});
const bytes = Object.values(result.metafile.outputs).find((o) => o.entryPoint)?.bytes;
console.log(`built app.js (${bytes} bytes)`);
