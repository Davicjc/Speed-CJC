// Player do vídeo tutorial: capítulos (as três partes), link direto para uma
// parte (#parte2) e recarga do vídeo quando o link do GitHub expira.
(() => {
    const video = document.getElementById('video');
    const partes = [...document.querySelectorAll('.parte')];
    if (!video || !partes.length) return;
    const fonte = video.currentSrc || video.src;

    function ir(t, tocar) {
        const aplicar = () => { video.currentTime = t; if (tocar) video.play().catch(() => {}); };
        if (video.readyState >= 1) aplicar(); else video.addEventListener('loadedmetadata', aplicar, { once: true });
    }

    function marcarAtual() {
        let atual = partes[0];
        for (const p of partes) if (video.currentTime + 0.25 >= Number(p.dataset.t)) atual = p;
        for (const p of partes) p.setAttribute('aria-current', String(p === atual));
    }

    for (const p of partes) {
        p.addEventListener('click', () => {
            ir(Number(p.dataset.t), true);
            history.replaceState(null, '', '#' + p.dataset.parte);
            video.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        });
    }
    video.addEventListener('timeupdate', marcarAtual);
    video.addEventListener('seeked', marcarAtual);
    marcarAtual();

    const inicial = partes.find((p) => '#' + p.dataset.parte === location.hash);
    if (inicial && inicial.dataset.t !== '0') ir(Number(inicial.dataset.t), false);

    // o GitHub entrega o arquivo por um link que vale cerca de 30 minutos:
    // se ele expirar com o vídeo pausado, carrega de novo e volta ao mesmo ponto
    let tentativas = 0;
    video.addEventListener('error', () => {
        if (tentativas++ >= 3) return;
        const t = video.currentTime, tocava = !video.paused;
        video.src = fonte;
        video.load();
        ir(t, tocava);
    });
    video.addEventListener('playing', () => { tentativas = 0; });
})();
