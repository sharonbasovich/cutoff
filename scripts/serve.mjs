import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json' };
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const decoded = decodeURIComponent(url.pathname);
    let path = resolve(root, '.' + decoded);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Invalid path');
    if ((await stat(path)).isDirectory()) path = resolve(path,'index.html');
    const body = await readFile(path);
    res.writeHead(200, {'Content-Type':types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
    res.end(body);
  } catch { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); }
});
server.listen(port,'127.0.0.1',()=>console.log(`Cutoff local preview: http://127.0.0.1:${port}`));
