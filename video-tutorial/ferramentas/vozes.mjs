// Gera a narração de cada cena (voz neural pt-BR-ThalitaMultilingualNeural, pelo
// edge-tts) e iguala o volume de todas. Rode no seu PC: node vozes.mjs
// Precisa do Python com edge-tts (pip install edge-tts), de internet e do ffmpeg.
// Outra voz: TUT_VOZ=pt-BR-FranciscaNeural node vozes.mjs (apague trabalho/voz-cenas antes).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { W } from './tut-lib.mjs';
const roteiro = JSON.parse(fs.readFileSync(new URL('./roteiro.json', import.meta.url)));
const bruto = `${W}/voz-cenas`, pronto = `${W}/voz-norm`;
fs.mkdirSync(bruto, { recursive: true }); fs.mkdirSync(pronto, { recursive: true });
const python = process.env.TUT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const voz = process.env.TUT_VOZ || 'pt-BR-ThalitaMultilingualNeural';
const falas = roteiro.cenas.map((c) => [c.id, c.fala || c.legenda]);
const NUM = { usuario: 'um', tecnico: 'dois', admin: 'três' };
for (const [k, v] of Object.entries(roteiro.partes)) falas.push([`i-${k}`, `${v.titulo.replace(/^Parte \d+ · /, `Parte ${NUM[k]}: `)}. ${v.sub}.`]);
for (const [id, texto] of falas) {
  const arq = `${bruto}/${id}.wav`;
  if (!fs.existsSync(arq)) {
    const mp3 = `${bruto}/${id}.mp3`;
    let r;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      r = spawnSync(python, ['-m', 'edge_tts', '--voice', voz, '--text', texto, '--write-media', mp3], { stdio: 'inherit', timeout: 60000 });
      if (r.status === 0 && fs.existsSync(mp3) && fs.statSync(mp3).size > 0) break;
    }
    if (r.status !== 0) { console.error('falhou:', id); process.exit(1); }
    // tira o silêncio das pontas e deixa 0,15 s de respiro antes e depois
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', mp3, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,adelay=150,apad=pad_dur=0.15', '-ar', '48000', '-ac', '1', arq], { stdio: 'inherit' });
    fs.rmSync(mp3, { force: true });
  }
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', arq, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '1', `${pronto}/${id}.wav`], { stdio: 'inherit' });
  console.log('ok', id);
}
