// Leitura dos números em linguagem simples: o que a conexão aguenta.
// Faixas baseadas nas recomendações públicas dos serviços (Netflix 4K: 15–25
// Mbps; chamadas HD: ~3 Mbps de envio; jogos: ping < 50 ms e jitter baixo).

const NIVEIS = {
    otimo: { nivel: 'ok', rotulo: 'Ótimo' },
    bom: { nivel: 'ok', rotulo: 'Bom' },
    regular: { nivel: 'atencao', rotulo: 'Regular' },
    ruim: { nivel: 'ruim', rotulo: 'Ruim' },
};

const FAIXAS = {
    download: (v) => (v >= 100 ? 'otimo' : v >= 25 ? 'bom' : v >= 10 ? 'regular' : 'ruim'),
    upload: (v) => (v >= 50 ? 'otimo' : v >= 10 ? 'bom' : v >= 3 ? 'regular' : 'ruim'),
    ping: (v) => (v <= 20 ? 'otimo' : v <= 50 ? 'bom' : v <= 100 ? 'regular' : 'ruim'),
    jitter: (v) => (v <= 5 ? 'otimo' : v <= 15 ? 'bom' : v <= 30 ? 'regular' : 'ruim'),
    perda: (v) => (v < 0.5 ? 'otimo' : v <= 1 ? 'bom' : v <= 2.5 ? 'regular' : 'ruim'),
    bufferbloat: (v) => (v <= 30 ? 'otimo' : v <= 60 ? 'bom' : v <= 200 ? 'regular' : 'ruim'),
};

export function classificar(tipo, v) {
    if (v == null || !Number.isFinite(v) || !FAIXAS[tipo]) return null;
    return NIVEIS[FAIXAS[tipo](v)];
}

const ok = (cond, quase) => (cond ? 'ok' : quase ? 'atencao' : 'ruim');

/** Usos do dia a dia, cada um com o que precisa e se a medição atende. */
export function usos(r) {
    const dl = r.download ?? 0, ul = r.upload ?? 0;
    const ping = r.ping ?? 999, jit = r.jitter ?? 999, perda = r.loss ?? 0;
    return [
        {
            id: 'video', titulo: 'Vídeos em 4K',
            estado: ok(dl >= 25 && perda <= 2, dl >= 15),
            detalhe: 'Pede uns 25 Mbps de download por tela.',
        },
        {
            id: 'jogos', titulo: 'Jogos online',
            estado: ok(ping <= 50 && jit <= 15 && perda <= 1, ping <= 90 && jit <= 30 && perda <= 2.5),
            detalhe: 'Pede ping abaixo de 50 ms, pouca variação e nenhuma perda.',
        },
        {
            id: 'chamadas', titulo: 'Chamadas de vídeo',
            estado: ok(ul >= 3 && dl >= 5 && jit <= 30 && perda <= 2, ul >= 1.5 && dl >= 3),
            detalhe: 'Pede uns 3 Mbps de upload e conexão estável.',
        },
        {
            id: 'trabalho', titulo: 'Home office e VPN',
            estado: ok(ul >= 10 && ping <= 60 && perda <= 1, ul >= 5 && ping <= 100),
            detalhe: 'Pede upload de 10 Mbps para enviar arquivos sem travar a chamada.',
        },
        {
            id: 'casa', titulo: 'Vários aparelhos juntos',
            estado: ok(dl >= 100, dl >= 50),
            detalhe: 'Para 4 a 6 pessoas usando ao mesmo tempo, 100 Mbps ou mais.',
        },
    ];
}

/** Frase-resumo do teste. */
export function veredito(r) {
    const u = usos(r);
    const ruins = u.filter((x) => x.estado === 'ruim').length;
    const atencao = u.filter((x) => x.estado === 'atencao').length;
    const instavel = (r.jitter ?? 0) > 30 || (r.loss ?? 0) > 2.5 || (r.bufferbloat ?? 0) > 200;
    if (instavel) {
        return {
            nivel: 'atencao',
            titulo: 'Conexão instável',
            texto: (r.loss ?? 0) > 2.5
                ? 'Alguns pacotes se perderam no caminho. Isso causa travadas em chamadas e jogos, mesmo com boa velocidade.'
                : 'O tempo de resposta varia muito, principalmente com a linha cheia. Chamadas e jogos sentem isso primeiro.',
        };
    }
    if (!ruins && !atencao) {
        return { nivel: 'ok', titulo: 'Conexão excelente', texto: 'Dá para assistir em 4K, jogar, trabalhar e fazer chamadas ao mesmo tempo, em vários aparelhos.' };
    }
    if (ruins === 0) {
        return { nivel: 'ok', titulo: 'Conexão boa', texto: 'Atende bem o dia a dia. Alguns usos mais pesados podem ficar no limite.' };
    }
    if ((r.download ?? 0) < 10) {
        return { nivel: 'ruim', titulo: 'Conexão lenta', texto: 'A velocidade está abaixo do necessário para vídeos e chamadas com qualidade.' };
    }
    return { nivel: 'atencao', titulo: 'Conexão com limitações', texto: 'Funciona para o básico, mas alguns usos vão sofrer. Veja abaixo o que atende e o que não.' };
}

/** Dicas práticas a partir do resultado e do tipo de conexão do aparelho. */
export function dicas(r, { tipoConexao, planoMbps } = {}) {
    const out = [];
    if (planoMbps && r.download != null && r.download < planoMbps * 0.6) {
        out.push(tipoConexao === 'wifi' || tipoConexao == null
            ? 'Pelo Wi-Fi a velocidade costuma ficar bem abaixo do plano. Para medir o plano inteiro, teste com o computador ligado no cabo de rede.'
            : 'O resultado ficou abaixo de 60% do seu plano. Se continuar assim em outros horários, fale com o suporte da Audicom.');
    } else if (tipoConexao === 'wifi' && r.download != null) {
        out.push('Você está no Wi-Fi: paredes, distância e outros aparelhos reduzem a velocidade. Perto do roteador o número sobe.');
    }
    if ((r.bufferbloat ?? 0) > 60) out.push('O ping sobe bastante quando a linha está cheia (bufferbloat). Roteadores com QoS ou SQM resolvem isso na maioria dos casos.');
    if ((r.loss ?? 0) > 1) out.push('Houve perda de pacotes. Se estiver no Wi-Fi, teste no cabo; se repetir no cabo, vale chamar o suporte.');
    return out;
}
