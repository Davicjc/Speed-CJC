// Gera a narração de cada cena (voz pf_dora, português do Brasil, Kokoro local)
// e iguala o volume de todas. Rode no seu PC: node vozes.mjs
// Precisa do Python com kokoro-onnx e soundfile (veja o README) e do ffmpeg.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { W } from './tut-lib.mjs';
const roteiro = JSON.parse(fs.readFileSync(new URL('./roteiro.json', import.meta.url)));
const bruto = `${W}/voz-cenas`, pronto = `${W}/voz-norm`;
fs.mkdirSync(bruto, { recursive: true }); fs.mkdirSync(pronto, { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const falas = roteiro.cenas.map((c) => [c.id, c.fala || c.legenda]);
const NUM = { usuario: 'um', tecnico: 'dois', admin: 'três' };
for (const [k, v] of Object.entries(roteiro.partes)) falas.push([`i-${k}`, `${v.titulo.replace(/^Parte \d+ · /, `Parte ${NUM[k]}: `)}. ${v.sub}.`]);
for (const [id, texto] of falas) {
  const arq = `${bruto}/${id}.wav`;
  if (!fs.existsSync(arq)) {
    const r = spawnSync(npx, ['-y', 'hyperframes@0.8.216', 'tts', texto, '--voice', 'pf_dora', '--lang', 'pt-br', '-o', arq], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('falhou:', id); process.exit(1); }
  }
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', arq, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '1', `${pronto}/${id}.wav`], { stdio: 'inherit' });
  console.log('ok', id);
}
