// O que o SERVIDOR viu de cada conexão de teste — pra conferir o resultado que
// o navegador manda no fim. Sem isso, qualquer um poderia gravar "900 Mbps"
// com um POST, sem ter testado nada, e o suporte veria como se fosse real.
//
// Por conexão (WebSocket do teste): uploads medidos aqui (a fonte da verdade
// do upload) e bytes de download efetivamente entregues. O registro sobrevive
// alguns minutos ao fechamento da conexão, tempo de o resultado chegar.

const KEEP_MS = 15 * 60_000;
const MAX = 20_000;

export function createMeasurementLog() {
    const recs = new Map(); // connId -> { ip, uploads: [], dlServed, closedAt }

    const sweeper = setInterval(() => {
        const cutoff = Date.now() - KEEP_MS;
        for (const [id, r] of recs) if (r.closedAt && r.closedAt < cutoff) recs.delete(id);
    }, 60_000);
    sweeper.unref();

    return {
        open(connId, ip) {
            if (recs.size >= MAX) recs.delete(recs.keys().next().value);
            recs.set(connId, { ip, uploads: [], dlServed: 0, closedAt: null });
        },
        close(connId) { const r = recs.get(connId); if (r) r.closedAt = Date.now(); },
        addUpload(connId, result) { const r = recs.get(connId); if (r && result && result.mbps != null) r.uploads.push(result); },
        addDownloadBytes(connId, n) { const r = recs.get(connId); if (r) r.dlServed += n; },

        /** Devolve o que foi medido desde o último resultado e zera (o próximo teste começa limpo). */
        take(connId, ip) {
            const r = recs.get(connId);
            if (!r || r.ip !== ip) return null;
            const snap = { uploads: r.uploads, dlServed: r.dlServed };
            r.uploads = [];
            r.dlServed = 0;
            return snap;
        },
    };
}
