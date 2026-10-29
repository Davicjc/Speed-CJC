#!/usr/bin/env python3
"""Monta os três projetos HyperFrames do tutorial a partir das gravações, vozes e roteiro."""
import json, os, re, shutil, subprocess, html

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(AQUI, '..', '..'))
RAIZ = os.path.join(REPO, 'video-tutorial')          # os projetos saem em video-tutorial/usuario, tecnico, admin
W = os.environ.get('TUT_DIR', os.path.join(RAIZ, 'trabalho'))
DOMINIO = os.environ.get('TUT_DOMINIO', 'teste.minhaempresa.com.br')
roteiro = json.load(open(f'{W}/roteiro.json'))
PARTES = ['usuario', 'tecnico', 'admin']
COR = {'usuario': '#46E08C', 'tecnico': '#F2B23F', 'admin': '#7AA2F7'}
ROTULO = {'usuario': 'Parte 1 · Cliente', 'tecnico': 'Parte 2 · Técnico', 'admin': 'Parte 3 · Administração'}
NUM = {'usuario': 'um', 'tecnico': 'dois', 'admin': 'três'}

# aproximação (zoom) nas cenas em que a gaveta da direita é pequena: (segundo, escala, origem x%, origem y%)
FOCO = {
    'u19': [(0, 1, 50, 50), (4.6, 1.55, 100, 40)],
    't08': [(0, 1, 50, 50), (1.6, 1.6, 100, 45)],
    't09': [(0, 1.6, 100, 45)], 't10': [(0, 1.6, 100, 45)], 't11': [(0, 1.6, 100, 55)],
    't12': [(0, 1.6, 100, 70), (3.0, 1.3, 50, 50)],
    't13': [(0, 1.3, 50, 50), (6.2, 1, 50, 50)],
    'a06': [(0, 1, 50, 50), (1.4, 1.6, 100, 50)],
    'a07': [(0, 1, 50, 50), (4.4, 1.6, 100, 45)],
    'a08': [(0, 1.6, 100, 55)],
}

def dur(arq):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arq]).decode().strip())

def esc(s):
    return html.escape(s, quote=True)

FONTES = """@font-face { font-family: 'Archivo'; src: url('assets/fonts/archivo-latin.woff2') format('woff2'); font-weight: 400 800; }"""

def fundo(parte):
    c = COR[parte]
    return f"""background: radial-gradient(1200px 700px at 78% 0%, {c}22, transparent 60%), radial-gradient(900px 600px at 0% 100%, #1E7B4822, transparent 60%), linear-gradient(180deg, #0F1318, #090C10);"""

def cabeca(parte, sid, n, titulo):
    return f"""<div id="{sid}-topo" class="topo">
      <div id="{sid}-passo" class="passo"><span class="num">{n}</span><span class="tit">{esc(titulo)}</span></div>
      <div class="marca"><img src="assets/logo.webp" alt="" /><span>{esc(ROTULO[parte])}</span></div>
    </div>"""

ESTILO_BASE = """
    #root { position: absolute; inset: 0; overflow: hidden; font-family: Inter, sans-serif; color: #F4F6F9; }
    .fundo { position: absolute; inset: 0; }
    .grade { position: absolute; inset: 0; opacity: .5; background-image: linear-gradient(rgba(244,246,249,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(244,246,249,.035) 1px, transparent 1px); background-size: 60px 60px; }
    .topo { position: absolute; left: 300px; right: 300px; top: 30px; height: 60px; display: flex; align-items: center; justify-content: space-between; }
    .passo { display: flex; align-items: center; gap: 16px; }
    .passo .num { min-width: 46px; height: 46px; padding: 0 12px; border-radius: 12px; background: var(--cor); color: #090C10; font: 700 26px/46px 'Archivo', sans-serif; text-align: center; }
    .passo .tit { font: 600 34px/1.1 'Archivo', sans-serif; letter-spacing: -0.01em; color: #F4F6F9; white-space: nowrap; }
    .marca { display: flex; align-items: center; gap: 14px; font: 500 18px/1 Inter, sans-serif; color: #A9B3C4; }
    .marca img { height: 28px; width: auto; }
    .janela { position: absolute; left: 300px; top: 112px; width: 1320px; height: 779px; border-radius: 14px; overflow: hidden; background: #0B0F14; border: 1px solid rgba(244,246,249,.14); box-shadow: 0 30px 80px -20px rgba(0,0,0,.75), 0 0 0 1px rgba(0,0,0,.4); }
    .barra { position: absolute; left: 0; right: 0; top: 0; height: 36px; background: #151A21; border-bottom: 1px solid rgba(244,246,249,.08); display: flex; align-items: center; gap: 8px; padding-left: 16px; }
    .barra i { width: 12px; height: 12px; border-radius: 50%; background: #313B47; display: block; }
    .barra .url { margin-left: 18px; height: 24px; padding: 0 16px; border-radius: 12px; background: #0B0F14; font: 500 14px/24px Inter, sans-serif; color: #8F99A8; }
    .barra .url b { color: #C9D2E3; font-weight: 500; }
    .tela { position: absolute; left: 0; top: 36px; width: 1320px; height: 743px; overflow: hidden; }
    .zoom { position: absolute; inset: 0; }
    .zoom video { position: absolute; left: 0; top: 0; width: 1320px; height: 743px; object-fit: cover; }
"""

def cena_html(parte, c, n, d, rate, meta):
    sid = c['id']
    url_path = (meta.get('url') or '/').split('#')[0]
    foco = FOCO.get(sid, [(0, 1, 50, 50)])
    js = []
    s0, ox0, oy0 = foco[0][1], foco[0][2], foco[0][3]
    js.append(f"gsap.set('#{sid}-zoom', {{ scale: {s0}, transformOrigin: '{ox0}% {oy0}%' }});")
    for (t, s, ox, oy) in foco[1:]:
        js.append(f"tl.to('#{sid}-zoom', {{ scale: {s}, transformOrigin: '{ox}% {oy}%', duration: 0.9, ease: 'power3.inOut' }}, {t});")
    taxa = f' data-playback-rate="{rate:.3f}"' if abs(rate - 1) > 0.01 else ''
    return f"""<template>
  <style>
    {FONTES}
    {ESTILO_BASE}
    #root {{ --cor: {COR[parte]}; }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080">
    <div class="fundo" style="{fundo(parte)}"></div><div class="grade"></div>
    {cabeca(parte, sid, n, c['titulo'])}
    <div id="{sid}-janela" class="janela">
      <div class="barra"><i></i><i></i><i></i><span class="url"><b>{DOMINIO}</b>{esc(url_path if url_path != '/' else '')}</span></div>
      <div class="tela"><div id="{sid}-zoom" class="zoom">
        <video id="{sid}-video" class="clip" data-start="0" data-duration="{d:.3f}"{taxa} muted playsinline src="assets/rec/{sid}.mp4"></video>
      </div></div>
    </div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    tl.fromTo('#{sid}-passo', {{ opacity: 0, x: -24 }}, {{ opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' }}, 0.05);
    {chr(10).join('    ' + x for x in js)}
    tl.to({{}}, {{ duration: {d - 0.05:.3f} }}, 0);
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""

def terminal_html(parte, c, n, d):
    sid = c['id']
    linhas = [
        ('c', '# no servidor, pelo terminal'),
        ('p', '$ cd /opt/speed-cjc/server'),
        ('p', '$ npm run admin -- dono voce@minhaempresa.com.br "Seu Nome"'),
        ('o', '  ✓ Dono criado. Abra o link mostrado para escolher a senha.'),
        ('p', '$ nano .env'),
        ('o', '  SITE_NAME=Speed CJC      SERVER_NAME=Minha Empresa'),
        ('p', '$ systemctl restart speed-cjc'),
        ('o', '  ✓ serviço no ar'),
    ]
    passo = (d - 1.6) / len(linhas)
    divs, js = [], []
    for i, (tipo, txt) in enumerate(linhas):
        lid = f'{sid}-l{i}'
        divs.append(f'<div id="{lid}" class="linha {tipo}">{esc(txt)}</div>')
        t = 0.5 + i * passo
        if tipo == 'p':
            js.append(f"tl.fromTo('#{lid}', {{ clipPath: 'inset(0 100% 0 0)' }}, {{ clipPath: 'inset(0 0% 0 0)', duration: {min(1.1, passo * 0.8):.2f}, ease: 'steps({max(8, len(txt) // 2)})' }}, {t:.2f});")
        else:
            js.append(f"tl.fromTo('#{lid}', {{ opacity: 0 }}, {{ opacity: 1, duration: 0.25 }}, {t:.2f});")
    return f"""<template>
  <style>
    {FONTES}
    {ESTILO_BASE}
    #root {{ --cor: {COR[parte]}; }}
    .term {{ position: absolute; left: 0; top: 36px; width: 1320px; height: 743px; background: #060a14; padding: 56px 64px; font: 500 30px/1.75 'JetBrains Mono', monospace; }}
    .linha {{ white-space: pre; color: #E6EDF7; clip-path: inset(0 0 0 0); }}
    .linha.c {{ color: #5f6b85; }}
    .linha.o {{ color: #3DD68C; }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080">
    <div class="fundo" style="{fundo(parte)}"></div><div class="grade"></div>
    {cabeca(parte, sid, n, c['titulo'])}
    <div id="{sid}-janela" class="janela">
      <div class="barra"><i></i><i></i><i></i><span class="url"><b>root@servidor</b> — terminal</span></div>
      <div class="term">{''.join(divs)}</div>
    </div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    tl.fromTo('#{sid}-passo', {{ opacity: 0, x: -24 }}, {{ opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' }}, 0.05);
    {chr(10).join('    ' + x for x in js)}
    tl.to({{}}, {{ duration: {d - 0.05:.3f} }}, 0);
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""

def abertura_html(parte, d):
    info = roteiro['partes'][parte]
    sid = f'abertura'
    return f"""<template>
  <style>
    {FONTES}
    {ESTILO_BASE}
    #root {{ --cor: {COR[parte]}; }}
    .bloco {{ position: absolute; left: 300px; right: 300px; top: 330px; }}
    .bloco img {{ height: 52px; width: auto; }}
    .sobre {{ margin-top: 56px; font: 600 24px/1 Inter, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--cor); }}
    .titulo {{ margin-top: 22px; font: 700 96px/1.02 'Archivo', sans-serif; letter-spacing: -0.035em; color: #F4F6F9; }}
    .sub {{ margin-top: 26px; font: 400 34px/1.35 Inter, sans-serif; color: #A9B3C4; max-width: 1200px; }}
    .risco {{ margin-top: 40px; width: 180px; height: 6px; border-radius: 3px; background: var(--cor); transform-origin: 0 50%; }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080">
    <div class="fundo" style="{fundo(parte)}"></div><div class="grade"></div>
    <div class="bloco">
      <img id="ab-logo" src="assets/logo.webp" alt="Speed CJC" />
      <div id="ab-sobre" class="sobre">Tutorial do teste de velocidade</div>
      <div id="ab-titulo" class="titulo">{esc(info['titulo'])}</div>
      <div id="ab-sub" class="sub">{esc(info['sub'])}</div>
      <div id="ab-risco" class="risco"></div>
    </div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    tl.fromTo('#ab-logo', {{ opacity: 0, y: 16 }}, {{ opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }}, 0.15);
    tl.fromTo('#ab-sobre', {{ opacity: 0, y: 16 }}, {{ opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }}, 0.35);
    tl.fromTo('#ab-titulo', {{ opacity: 0, y: 30 }}, {{ opacity: 1, y: 0, duration: 0.7, ease: 'power4.out' }}, 0.5);
    tl.fromTo('#ab-sub', {{ opacity: 0, y: 20 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }}, 0.9);
    tl.fromTo('#ab-risco', {{ scaleX: 0 }}, {{ scaleX: 1, duration: 0.8, ease: 'power3.inOut' }}, 1.1);
    tl.to({{}}, {{ duration: {d - 0.05:.3f} }}, 0);
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""

def grupos_legenda(texto):
    """Corta nas pontuações (frase, dois-pontos, vírgula longa) e divide cada trecho em grupos equilibrados de até 6 palavras."""
    import math
    trechos, atual = [], []
    for w in texto.split():
        atual.append(w)
        if re.search(r'[.!?:;]$', w) or (w.endswith(',') and len(atual) >= 3):
            trechos.append(atual); atual = []
    if atual: trechos.append(atual)
    grupos = []
    for t in trechos:
        n = max(1, math.ceil(len(t) / 6))
        tam = math.ceil(len(t) / n)
        for i in range(0, len(t), tam):
            grupos.append(t[i:i + tam])
    # trecho de uma palavra só junta com o vizinho, se couber numa linha
    saida = []
    for g in grupos:
        if saida and (len(g) == 1 or len(saida[-1]) == 1) and len(' '.join(saida[-1] + g)) <= 48:
            saida[-1] = saida[-1] + g
        else:
            saida.append(g)
    return [' '.join(g) for g in saida]

def legendas_html(itens, total):
    divs, js = [], []
    for i, (ini, fim, txt) in enumerate(itens):
        gid = f'lg{i}'
        divs.append(f'<div id="{gid}" class="clip grupo" data-start="{ini:.3f}" data-duration="{fim - ini:.3f}"><span>{esc(txt)}</span></div>')
        js.append(f"tl.fromTo('#{gid} span', {{ opacity: 0, y: 8 }}, {{ opacity: 1, y: 0, duration: 0.18, ease: 'power2.out' }}, {ini:.3f});")
        js.append(f"tl.to('#{gid} span', {{ opacity: 0, duration: 0.12, ease: 'power2.in' }}, {fim - 0.12:.3f});")
        js.append(f"tl.set('#{gid} span', {{ opacity: 0 }}, {fim:.3f});")
    return f"""<template>
  <style>
    #root {{ position: absolute; inset: 0; pointer-events: none; }}
    .grupo {{ position: absolute; left: 0; right: 0; top: 906px; text-align: center; overflow: visible; }}
    .grupo span {{ display: inline-block; padding: 8px 22px 10px; border-radius: 12px; background: rgba(9, 12, 16, .88); border: 1px solid rgba(244,246,249,.1); font: 600 36px/1.25 Inter, sans-serif; color: #FFFFFF; letter-spacing: -0.005em; }}
  </style>
  <div id="root" data-composition-id="legendas" data-width="1920" data-height="1080">
    {chr(10).join('    ' + x for x in divs)}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    {chr(10).join('    ' + x for x in js)}
    tl.to({{}}, {{ duration: {total - 0.05:.3f} }}, 0);
    window.__timelines["legendas"] = tl;
  </script>
</template>
"""

def montar(parte):
    proj = f'{RAIZ}/{parte}'
    os.makedirs(f'{proj}/compositions', exist_ok=True)
    for sub in ('assets/rec', 'assets/voz', 'assets/fonts'):
        os.makedirs(f'{proj}/{sub}', exist_ok=True)
    shutil.copy(os.path.join(REPO, 'assets/logotipo.webp'), f'{proj}/assets/logo.webp')
    shutil.copy(os.path.join(REPO, 'assets/fonts/archivo-latin.woff2'), f'{proj}/assets/fonts/archivo-latin.woff2')
    cenas = [c for c in roteiro['cenas'] if c['parte'] == parte]
    hosts, audios, legs = [], [], []
    t = 0.0
    # abertura
    fala_ab = dur(f'{W}/voz-norm/i-{parte}.wav')
    d_ab = round(fala_ab + 1.2, 3)
    shutil.copy(f'{W}/voz-norm/i-{parte}.wav', f'{proj}/assets/voz/i-{parte}.wav')
    open(f'{proj}/compositions/abertura.html', 'w').write(abertura_html(parte, d_ab))
    hosts.append(f'<div id="abertura" data-composition-id="abertura" data-composition-src="compositions/abertura.html" data-start="0" data-duration="{d_ab:.3f}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
    audios.append(f'<audio id="voz-abertura" class="clip" data-start="0.6" data-duration="{fala_ab:.3f}" data-track-index="3" data-volume="1" src="assets/voz/i-{parte}.wav"></audio>')
    t = d_ab
    for n, c in enumerate(cenas, 1):
        sid = c['id']
        fala = dur(f'{W}/voz-norm/{sid}.wav')
        shutil.copy(f'{W}/voz-norm/{sid}.wav', f'{proj}/assets/voz/{sid}.wav')
        rec_arq = f'{W}/gravacoes/{sid}.mp4'
        if os.path.exists(rec_arq):
            meta = json.load(open(f'{W}/gravacoes/{sid}.json'))
            rec = dur(rec_arq)
            rate = 1.0
            if rec > fala + 2.2:
                rate = min(1.5, rec / (fala + 1.0))
            d = rec / rate - 0.05
            d = max(d, fala + 0.45)
            shutil.copy(rec_arq, f'{proj}/assets/rec/{sid}.mp4')
            open(f'{proj}/compositions/{sid}.html', 'w').write(cena_html(parte, c, n, d, rate, meta))
        else:
            d = fala + 1.4
            open(f'{proj}/compositions/{sid}.html', 'w').write(terminal_html(parte, c, n, d))
        d = round(d, 3)
        hosts.append(f'<div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{t:.3f}" data-duration="{d:.3f}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
        v0 = t + 0.15
        audios.append(f'<audio id="voz-{sid}" class="clip" data-start="{v0:.3f}" data-duration="{fala:.3f}" data-track-index="3" data-volume="1" src="assets/voz/{sid}.wav"></audio>')
        # legendas: proporcionais ao tamanho de cada grupo, dentro da fala
        grupos = grupos_legenda(c['legenda'])
        a, b = v0 + 0.08, v0 + fala - 0.22
        pesos = [len(g) + 4 for g in grupos]
        tot = sum(pesos)
        x = a
        for g, p in zip(grupos, pesos):
            y = x + (b - a) * p / tot
            legs.append([x, y, g])
            x = y
        t += d
    total = round(t + 0.6, 3)
    # cada legenda vai até a próxima (sem buraco curto) e no máximo 0.5 s depois do fim
    for i in range(len(legs)):
        prox = legs[i + 1][0] if i + 1 < len(legs) else total
        legs[i][1] = min(prox - 0.02, legs[i][1] + 0.5) if prox - legs[i][1] < 0.6 else legs[i][1] + 0.25
        legs[i][0] = max(0.1, legs[i][0] - 0.05)
    open(f'{proj}/compositions/legendas.html', 'w').write(legendas_html(legs, total))
    hosts.append(f'<div id="legendas" data-composition-id="legendas" data-composition-src="compositions/legendas.html" data-start="0" data-duration="{total:.3f}" data-track-index="2" data-track-kind="captions" data-width="1920" data-height="1080"></div>')
    index = f"""<!doctype html>
<html lang="pt-BR" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #090C10; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{total:.3f}" data-width="1920" data-height="1080">
      {chr(10).join('      ' + h for h in hosts)}
      {chr(10).join('      ' + a for a in audios)}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"""
    open(f'{proj}/index.html', 'w').write(index)
    print(f'{parte}: {len(cenas)} cenas, {total:.1f} s ({total / 60:.1f} min), {len(legs)} legendas')

for parte in PARTES:
    montar(parte)
