// Gera /vendor (Leaflet, o mapa) a partir do npm, para o site não depender
// de CDN de terceiros. Rodar depois de atualizar a versão:
//   cd server && npm install && npm run build:vendor
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', '..', 'vendor');
fs.mkdirSync(out, { recursive: true });

await build({
    stdin: { contents: "export * from 'leaflet/dist/leaflet-src.esm.js';", resolveDir: path.join(here, '..'), loader: 'js' },
    bundle: true, format: 'esm', platform: 'browser', target: ['es2020'], minify: true,
    legalComments: 'eof', outfile: path.join(out, 'leaflet.js'),
});
fs.copyFileSync(path.join(here, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.css'), path.join(out, 'leaflet.css'));

const ver = (p) => JSON.parse(fs.readFileSync(path.join(here, '..', 'node_modules', p, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(out, 'VERSOES.txt'), `leaflet ${ver('leaflet')}\ngerado em ${new Date().toISOString()}\n`);
console.log('vendor gerado em', out);
