import { build } from 'esbuild';
import { mkdir, copyFile, cp, access } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, sourcemap: true, outdir: 'dist', target: ['es2022'], legalComments: 'eof', metafile: false });
await copyFile('index.html', 'dist/index.html');
await copyFile('LICENSE', 'dist/LICENSE.txt');
await copyFile('THIRD_PARTY_NOTICES.txt', 'dist/THIRD_PARTY_NOTICES.txt');
try { await access('public'); await cp('public', 'dist', { recursive: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
console.log('Built static app in dist/');
