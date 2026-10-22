import ndc from 'node-datachannel';

// Perda de pacotes de verdade precisa de UDP — HTTP e WebSocket rodam sobre
// TCP, que retransmite tudo e esconde a perda (ela vira atraso). O navegador
// só fala UDP via WebRTC: o cliente abre um DataChannel "não confiável"
// (ordered:false, maxRetransmits:0 — pacote perdido fica perdido), manda uma
// rajada numerada e este servidor devolve cada pacote que chegar. O que não
// volta é perda de ida-e-volta real.
//
// Todas as conexões dividem UMA porta UDP (ICE UDP mux), pra bastar liberar
// uma porta no firewall/roteador em vez de uma faixa inteira.

const PEER_LIFETIME_MS = 30_000;

export function createRtcResponder({ udpPort, publicIPv4, maxPeers, log = console }) {
    let open = 0;
    // pode mudar com o site rodando (IP público tirado do DNS do domínio, ver server.js)
    const setPublicIPv4 = (ip) => { publicIPv4 = ip; };

    function addPublicCandidate(sdp) {
        if (!publicIPv4 || sdp.includes(` ${publicIPv4} `)) return sdp;
        const lines = sdp.split('\r\n');
        let lastCand = -1;
        lines.forEach((l, i) => { if (l.startsWith('a=candidate:')) lastCand = i; });
        if (lastCand < 0) return sdp;
        // mesma porta do mux: basta o roteador encaminhar UDP_PORT pra esta máquina
        lines.splice(lastCand + 1, 0, `a=candidate:99 1 UDP 1677729535 ${publicIPv4} ${udpPort} typ host`);
        return lines.join('\r\n');
    }

    function answer(offerSdp) {
        return new Promise((resolve, reject) => {
            if (open >= maxPeers) return reject(Object.assign(new Error('servidor ocupado'), { status: 503 }));
            open++;
            let settled = false;
            let closed = false;
            const pc = new ndc.PeerConnection(`loss-${Date.now()}`, {
                iceServers: [],
                enableIceUdpMux: true,
                portRangeBegin: udpPort,
                portRangeEnd: udpPort,
                maxMessageSize: 4096,
            });

            const close = () => {
                if (closed) return;
                closed = true;
                open--;
                clearTimeout(lifetime);
                try { pc.close(); } catch { /* já fechado */ }
            };
            const lifetime = setTimeout(close, PEER_LIFETIME_MS);

            pc.onStateChange((state) => {
                if (state === 'closed' || state === 'failed' || state === 'disconnected') close();
            });
            pc.onDataChannel((dc) => {
                dc.onMessage((msg) => {
                    try {
                        if (typeof msg === 'string') dc.sendMessage(msg);
                        else dc.sendMessageBinary(msg);
                    } catch { /* canal fechando */ }
                });
                dc.onClosed(close);
            });
            pc.onGatheringStateChange((state) => {
                if (state !== 'complete' || settled) return;
                settled = true;
                const desc = pc.localDescription();
                resolve({ type: desc.type, sdp: addPublicCandidate(desc.sdp) });
            });
            setTimeout(() => {
                if (settled) return;
                settled = true;
                close();
                reject(new Error('não foi possível preparar a conexão UDP'));
            }, 4000);

            try {
                pc.setRemoteDescription(offerSdp, 'offer');
            } catch (e) {
                settled = true;
                close();
                reject(Object.assign(new Error('oferta WebRTC inválida'), { status: 400 }));
            }
        });
    }

    return {
        answer,
        setPublicIPv4,
        get open() { return open; },
        shutdown() { try { ndc.cleanup(); } catch { /* ok */ } },
    };
}
