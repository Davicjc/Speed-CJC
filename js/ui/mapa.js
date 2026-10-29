// Mapa (Leaflet servido localmente + mapa base configurável no servidor).
import * as L from '/vendor/leaflet.js';

const CENTRO = [-14.235, -51.925]; // centro do Brasil, até os testes aparecerem

export function criarMapa(el, cfg, { zoom = 11, rolagem = false } = {}) {
    const m = (cfg && cfg.map) || {};
    if (m.escuro !== false) el.classList.add('mapa-escuro');
    const mapa = L.map(el, { zoomControl: true, scrollWheelZoom: rolagem, worldCopyJump: true, attributionControl: true }).setView(CENTRO, 4);
    mapa.attributionControl.setPrefix('');
    L.tileLayer(m.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        subdomains: m.subdomains || 'abc',
        attribution: m.attribution || '&copy; OpenStreetMap',
        maxZoom: 19,
        detectRetina: false, // pede 4x mais imagens ao servidor de mapas; não vale o custo
    }).addTo(mapa);
    const camada = L.layerGroup().addTo(mapa);
    // mapa criado escondido (aba fechada) nasce com tamanho zero: recalcula ao aparecer
    const ro = new ResizeObserver(() => mapa.invalidateSize());
    ro.observe(el);

    return {
        mapa,
        /** pontos: [{ lat, lng, ... }]; popup(p) devolve HTML já escapado. */
        pontos(lista, { popup, cor = () => '#46E08C', raio = () => 7, aoClicar } = {}) {
            camada.clearLayers();
            const limites = [];
            for (const p of lista) {
                if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
                const mk = L.circleMarker([p.lat, p.lng], { radius: raio(p), color: '#090C10', weight: 2, fillColor: cor(p), fillOpacity: 0.95 });
                if (popup) mk.bindPopup(popup(p), { maxWidth: 260 });
                if (aoClicar) mk.on('click', () => aoClicar(p));
                mk.addTo(camada);
                limites.push([p.lat, p.lng]);
            }
            if (limites.length === 1) mapa.setView(limites[0], 15);
            else if (limites.length > 1) mapa.fitBounds(limites, { padding: [36, 36], maxZoom: 15 });
            return limites.length;
        },
        circulo(lat, lng, metros) {
            if (Number.isFinite(metros) && metros > 0) L.circle([lat, lng], { radius: metros, color: '#46E08C', weight: 1, fillOpacity: 0.08 }).addTo(camada);
        },
        destruir() { ro.disconnect(); mapa.remove(); },
    };
}
