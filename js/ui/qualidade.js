// Leitura dos números em linguagem simples: o que a conexão aguenta.
// Faixas baseadas nas recomendações públicas dos serviços (Netflix 4K: 15–25
// Mbps; chamadas HD: ~3 Mbps de envio; jogos: ping < 50 ms e jitter baixo).
//
// Dois tons para o mesmo resultado (os números nunca mudam):
//  - 'tecnico' (o /tecnico e a administração): direto, com Regular, Ruim e alertas;
//  - 'cliente' (página do teste, painel e link público): honesto e sem alarme.
//    Nada de "ruim", "lenta" ou "não atende": cada medida ganha um nome que
//    descreve o valor ("Básico", "Alto", "Oscilando") e o resumo fala do que
//    funciona agora e de como melhorar o resultado.

const NIVEIS = {
    otimo: { nivel: 'ok', rotulo: 'Ótimo' },
    bom: { nivel: 'ok', rotulo: 'Bom' },
    regular: { nivel: 'atencao', rotulo: 'Regular' },
    ruim: { nivel: 'ruim', rotulo: 'Ruim' },
};

// tom do cliente: rótulos que descrevem o valor, em cor neutra quando não é bom
const NIVEIS_CLIENTE = {
    download: { regular: 'Moderado', ruim: 'Básico' },
    upload: { regular: 'Moderado', ruim: 'Básico' },
    ping: { regular: 'Moderado', ruim: 'Alto' },
    jitter: { otimo: 'Estável', bom: 'Estável', regular: 'Oscilando', ruim: 'Oscilando' },
    perda: { otimo: 'Mínima', bom: 'Pequena', regular: 'Moderada', ruim: 'Acima do comum' },
    bufferbloat: { regular: 'Moderado', ruim: 'Alto' },
};

const FAIXAS = {
    download: (v) => (v >= 100 ? 'otimo' : v >= 25 ? 'bom' : v >= 10 ? 'regular' : 'ruim'),
    upload: (v) => (v >= 50 ? 'otimo' : v >= 10 ? 'bom' : v >= 3 ? 'regular' : 'ruim'),
    ping: (v) => (v <= 20 ? 'otimo' : v <= 50 ? 'bom' : v <= 100 ? 'regular' : 'ruim'),
    jitter: (v) => (v <= 5 ? 'otimo' : v <= 15 ? 'bom' : v <= 30 ? 'regular' : 'ruim'),
    perda: (v) => (v < 0.5 ? 'otimo' : v <= 1 ? 'bom' : v <= 2.5 ? 'regular' : 'ruim'),
    bufferbloat: (v) => (v <= 30 ? 'otimo' : v <= 60 ? 'bom' : v <= 200 ? 'regular' : 'ruim'),
};

export function classificar(tipo, v, { tom = 'cliente' } = {}) {
    if (v == null || !Number.isFinite(v) || !FAIXAS[tipo]) return null;
    const faixa = FAIXAS[tipo](v);
    if (tom === 'tecnico') return NIVEIS[faixa];
    if (tipo === 'perda' && v === 0) return { nivel: 'ok', rotulo: 'Sem perdas' };
    const rotulo = (NIVEIS_CLIENTE[tipo] || {})[faixa] || NIVEIS[faixa].rotulo;
    // bom e ótimo em verde; o resto em cor neutra (informa, não assusta)
    return { nivel: faixa === 'otimo' || faixa === 'bom' ? 'ok' : faixa === 'regular' ? 'azul' : '', rotulo };
}

const ok = (cond, quase) => (cond ? 'ok' : quase ? 'atencao' : 'ruim');

/**
 * Usos do dia a dia, cada um com o que precisa e se a medição atende.
 * No tom do cliente, o que não atende vira "neutro": aparece como algo que
 * pode oscilar agora, com o que o uso pede, sem marcar como falha.
 */
export function usos(r, { tom = 'cliente' } = {}) {
    const dl = r.download ?? 0, ul = r.upload ?? 0;
    const ping = r.ping ?? 999, jit = r.jitter ?? 999, perda = r.loss ?? 0;
    const lista = [
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
    if (tom === 'tecnico') return lista;
    return lista.map((u) => (u.estado === 'ok' ? u : { ...u, estado: 'neutro' }));
}

/** Frase-resumo do teste. */
export function veredito(r, { tom = 'cliente' } = {}) {
    const u = usos(r, { tom: 'tecnico' });
    const ruins = u.filter((x) => x.estado === 'ruim').length;
    const atencao = u.filter((x) => x.estado === 'atencao').length;
    const perdaAlta = (r.loss ?? 0) > 2.5;
    const instavel = (r.jitter ?? 0) > 30 || perdaAlta || (r.bufferbloat ?? 0) > 200;
    const cliente = tom !== 'tecnico';

    if (!ruins && !atencao && !instavel) {
        return { nivel: 'ok', titulo: 'Conexão excelente', texto: 'Dá para assistir em 4K, jogar, trabalhar e fazer chamadas ao mesmo tempo, em vários aparelhos.' };
    }
    if (cliente) {
        // honesto e sem alarme: o que funciona agora e como tirar mais da conexão
        const funciona = u.filter((x) => x.estado === 'ok').map((x) => x.titulo.toLowerCase());
        if (instavel) {
            return {
                nivel: 'neutro', titulo: 'Conexão oscilando neste momento',
                texto: 'Durante o teste, o tempo de resposta variou mais que o normal. Isso pode vir do Wi-Fi ou de outros aparelhos usando a internet. Teste de novo daqui a pouco, de preferência perto do roteador.',
            };
        }
        if (ruins === 0) return { nivel: 'ok', titulo: 'Conexão boa', texto: 'Atende bem o dia a dia. Os usos mais pesados podem variar conforme o horário e o aparelho.' };
        if (funciona.length) {
            return {
                nivel: 'neutro', titulo: 'Conexão funcionando',
                texto: `Neste momento ela atende bem: ${funciona.join(', ')}. Veja abaixo o que cada uso pede e como aproveitar melhor.`,
            };
        }
        return {
            nivel: 'neutro', titulo: 'Teste concluído',
            texto: 'Neste momento a conexão está mais adequada para navegar, trocar mensagens e assistir vídeos em qualidade padrão. As dicas abaixo ajudam a tirar mais dela.',
        };
    }

    if (instavel) {
        return {
            nivel: 'atencao',
            titulo: 'Conexão instável',
            texto: perdaAlta
                ? 'Alguns pacotes se perderam no caminho. Isso causa travadas em chamadas e jogos, mesmo com boa velocidade.'
                : 'O tempo de resposta varia muito, principalmente com a linha cheia. Chamadas e jogos sentem isso primeiro.',
        };
    }
    if (ruins === 0) {
        return { nivel: 'ok', titulo: 'Conexão boa', texto: 'Atende bem o dia a dia. Alguns usos mais pesados podem ficar no limite.' };
    }
    if ((r.download ?? 0) < 10) {
        return { nivel: 'ruim', titulo: 'Conexão lenta', texto: 'A velocidade está abaixo do necessário para vídeos e chamadas com qualidade.' };
    }
    return { nivel: 'atencao', titulo: 'Conexão com limitações', texto: 'Funciona para o básico, mas alguns usos vão sofrer. Veja abaixo o que atende e o que não.' };
}

/** Percentual do plano que vale mostrar ao cliente: só quando chega perto do contratado. */
export function planoParaCliente(download, plano) {
    if (!plano || download == null) return null;
    const pct = Math.round((download / plano) * 100);
    return pct >= 80 ? pct : null;
}

/** Dicas práticas a partir do resultado e do tipo de conexão do aparelho. */
export function dicas(r, { tipoConexao, planoMbps, tom = 'cliente' } = {}) {
    const out = [];
    const wifi = tipoConexao === 'wifi' || tipoConexao == null;
    if (tom !== 'tecnico') {
        // só o que a própria pessoa pode fazer, sem apontar culpados
        if (planoMbps && r.download != null && r.download < planoMbps * 0.8) {
            out.push('Para medir o plano completo, teste com o computador ligado no cabo de rede e com os outros aparelhos parados.');
        } else if (tipoConexao === 'wifi' && r.download != null) {
            out.push('Você está no Wi-Fi: paredes, distância e outros aparelhos reduzem a velocidade. Perto do roteador o número sobe.');
        }
        if ((r.loss ?? 0) > 1 || (r.jitter ?? 0) > 30) {
            out.push(wifi ? 'Para chamadas e jogos mais estáveis, chegue perto do roteador ou use o cabo de rede.' : 'Para chamadas e jogos mais estáveis, evite downloads grandes em outros aparelhos ao mesmo tempo.');
        }
        if ((r.bufferbloat ?? 0) > 60) out.push('Downloads e envios grandes em outros aparelhos ocupam a conexão de todos. Vale pausar durante chamadas e jogos.');
        if (veredito(r, { tom: 'tecnico' }).nivel !== 'ok') out.push('A internet varia ao longo do dia. Se algo parecer diferente do normal, teste de novo em alguns minutos.');
        return out;
    }
    if (planoMbps && r.download != null && r.download < planoMbps * 0.6) {
        out.push(wifi
            ? 'Pelo Wi-Fi a velocidade costuma ficar bem abaixo do plano. Para medir o plano inteiro, teste com o computador ligado no cabo de rede.'
            : `O resultado ficou em ${Math.round((r.download / planoMbps) * 100)}% do plano de ${planoMbps} Mbps, no cabo. Vale repetir e, se continuar, investigar a rota e o equipamento.`);
    } else if (tipoConexao === 'wifi' && r.download != null) {
        out.push('Teste feito no Wi-Fi: paredes, distância e outros aparelhos reduzem a velocidade.');
    }
    if ((r.bufferbloat ?? 0) > 60) out.push('Bufferbloat: o ping sobe muito com a linha cheia. QoS ou SQM no roteador resolvem na maioria dos casos.');
    if ((r.loss ?? 0) > 1) out.push('Houve perda de pacotes. Se foi no Wi-Fi, repita no cabo; se repetir no cabo, confira a rota abaixo.');
    return out;
}
