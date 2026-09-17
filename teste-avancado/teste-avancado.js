(function () {
    'use strict';

    const HISTORY_KEY = 'audicom_speedtest_historico';

    const gaugeArc = document.getElementById('gaugeArc');
    const gaugeTrack = document.getElementById('gaugeTrack');
    const gauge = Gauge(gaugeArc, gaugeTrack, { max: 500 });
    const gaugeNumber = document.getElementById('gaugeNumber');
    const gaugeUnitEl = document.querySelector('.gauge-unit');
    const gaugePhase = document.getElementById('gaugePhase');
    const startBtn = document.getElementById('startBtn');
    const resultActions = document.getElementById('resultActions');

    const els = {
        ping: document.getElementById('valPing'),
        jitter: document.getElementById('valJitter'),
        download: document.getElementById('valDownload'),
        upload: document.getElementById('valUpload'),
        bufferbloat: document.getElementById('valBufferbloat'),
        perda: document.getElementById('valPerda')
    };

    function resetGaugeUI() {
        gauge.reset();
        gaugeNumber.textContent = '0';
        gaugeUnitEl.textContent = 'Mbps';
        gaugePhase.textContent = ' ';
        Object.values(els).forEach(el => el.textContent = '–');
        resultActions.classList.remove('visible');
    }

    function buildPhases() {
        const ping = MockEngine.randomInRange(8, 35);
        const jitter = MockEngine.randomInRange(1, 8);
        const download = MockEngine.randomInRange(80, 420);
        const upload = MockEngine.randomInRange(30, 180);
        const bufferbloat = MockEngine.randomInRange(5, 90);
        const perda = MockEngine.randomInRange(0, 2.5);

        return [
            { key: 'ping', label: 'Medindo ping…', duration: 800, from: 0, to: ping, jitterPct: 0.15, unit: 'ms', gaugeMax: 60 },
            { key: 'jitter', label: 'Medindo jitter…', duration: 600, from: 0, to: jitter, jitterPct: 0.2, unit: 'ms', gaugeMax: 20 },
            { key: 'download', label: 'Testando download…', duration: 2800, from: 0, to: download, jitterPct: 0.08, unit: 'Mbps', gaugeMax: 500 },
            { key: 'upload', label: 'Testando upload…', duration: 2200, from: 0, to: upload, jitterPct: 0.1, unit: 'Mbps', gaugeMax: 300 },
            { key: 'bufferbloat', label: 'Testando estabilidade sob carga…', duration: 1800, from: 0, to: bufferbloat, jitterPct: 0.1, unit: 'ms extra', gaugeMax: 200 },
            { key: 'perda', label: 'Estimando perda de pacotes…', duration: 900, from: 0, to: perda, jitterPct: 0.3, unit: '%', gaugeMax: 5 }
        ];
    }

    function formatVal(v) { return v.toFixed(v < 10 ? 1 : 0); }

    function runCoreTest() {
        return new Promise((resolve) => {
            resetGaugeUI();
            const phases = buildPhases();
            const results = {};

            MockEngine.run(phases, {
                onTick(key, value, idx, phase) {
                    gaugeUnitEl.textContent = phase.unit.replace(' extra', '');
                    gauge.set((value / phase.gaugeMax) * (phase.unit === 'Mbps' ? 500 : 60));
                    gaugeNumber.textContent = formatVal(value);
                    gaugePhase.textContent = phase.label;
                    els[key].textContent = formatVal(value);
                },
                onPhaseEnd(key, value) {
                    results[key] = value;
                    els[key].textContent = formatVal(value);
                },
                onDone() {
                    gaugePhase.textContent = 'Teste concluído';
                    gaugeUnitEl.textContent = 'Mbps';
                    resolve(results);
                }
            });
        });
    }

    // ---- Latência para serviços (REAL) ----
    const servicesGrid = document.getElementById('servicesGrid');

    function renderServiceCards() {
        servicesGrid.innerHTML = LatencyProbe.TARGETS.map(t => `
            <div class="service-card pending" id="svc-${t.key}">
                <span class="service-icon">${t.icon}</span>
                <span class="service-name">${t.label}</span>
                <span class="service-value"><span class="status-dot"></span> ...</span>
            </div>
        `).join('');
    }

    function updateServiceCard(result) {
        const el = document.getElementById('svc-' + result.key);
        if (!el) return;
        el.classList.remove('pending');
        const status = LatencyProbe.classify(result.ms);
        el.querySelector('.service-value').innerHTML =
            `<span class="status-dot status-${status}"></span> ${result.ok ? result.ms + ' ms' : 'indisponível'}`;
    }

    async function runLatencyProbes() {
        renderServiceCards();
        return LatencyProbe.probeAll(updateServiceCard);
    }

    // ---- Dispositivo & rede (REAL) ----
    const infoGrid = document.getElementById('infoGrid');

    function infoCard(label, value) {
        return `<div class="info-card"><div class="info-label">${label}</div><div class="info-value">${value}</div></div>`;
    }

    async function renderDeviceInfo() {
        const d = DeviceInfo.collectSync();
        const ipInfo = await DeviceInfo.fetchPublicIp();

        const conn = d.connection.supported
            ? [d.connection.type, d.connection.effectiveType].filter(Boolean).join(' · ') +
              (d.connection.downlink ? ` (${d.connection.downlink} Mbps est., ${d.connection.rtt}ms rtt)` : '')
            : 'Não exposto por este navegador';

        infoGrid.innerHTML = [
            infoCard('Navegador', d.browser),
            infoCard('Sistema', d.os),
            infoCard('Dispositivo', d.deviceType),
            infoCard('Tela', d.screen),
            infoCard('Núcleos de CPU', d.cpuCores || 'não exposto'),
            infoCard('Memória RAM', d.ramGB ? d.ramGB + ' GB (aprox.)' : 'não exposto'),
            infoCard('GPU', d.gpu),
            infoCard('Tipo de conexão', conn),
            infoCard('IP público', ipInfo.ip || 'indisponível'),
            infoCard('Provedor (ISP)', ipInfo.isp || 'indisponível'),
            infoCard('Localização aprox.', [ipInfo.city, ipInfo.region].filter(Boolean).join(', ') || 'indisponível'),
            infoCard('IPv6', ipInfo.isIPv6 === null ? 'indisponível' : (ipInfo.isIPv6 ? 'Sim' : 'Não detectado nesta rede'))
        ].join('');

        const wifiLine = document.getElementById('wifiDetectedLine');
        if (d.connection.supported && d.connection.type) {
            wifiLine.innerHTML = `📡 Seu navegador informou o tipo de conexão: <b>${d.connection.type}</b>. O nome da rede (SSID) continua bloqueado por privacidade em todos os navegadores. <a href="../como-funciona/index.html#limitacoes">Entenda por quê</a>.`;
        }

        return { device: d, ip: ipInfo };
    }

    // ---- Wi-Fi manual ----
    const wifiManualInput = document.getElementById('wifiManualName');
    wifiManualInput.addEventListener('change', () => {
        try { localStorage.setItem('audicom_wifi_manual', wifiManualInput.value.trim()); } catch (e) {}
    });
    try {
        const saved = localStorage.getItem('audicom_wifi_manual');
        if (saved) wifiManualInput.value = saved;
    } catch (e) {}

    // ---- Identificação CPF/CNPJ ----
    const identifyToggle = document.getElementById('identifyToggle');
    const identifyBody = document.getElementById('identifyBody');
    identifyToggle.addEventListener('click', () => {
        const open = identifyBody.classList.toggle('open');
        identifyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    const docInput = document.getElementById('docInput');
    const docFeedback = document.getElementById('docFeedback');
    docInput.addEventListener('input', () => {
        const type = DocUtils.detectType(docInput.value);
        docInput.placeholder = type === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00';
        docInput.value = DocUtils.mask(docInput.value, type);

        const digits = DocUtils.onlyDigits(docInput.value);
        if (digits.length < 11) {
            docInput.classList.remove('invalid');
            docFeedback.textContent = '';
            docFeedback.className = 'doc-feedback';
            return;
        }
        const valid = DocUtils.validate(docInput.value, type);
        docInput.classList.toggle('invalid', !valid);
        docFeedback.textContent = valid
            ? (type === 'cnpj' ? 'CNPJ válido' : 'CPF válido')
            : (type === 'cnpj' ? 'CNPJ inválido' : 'CPF inválido');
        docFeedback.className = 'doc-feedback ' + (valid ? 'success' : 'error');
    });

    // ---- Histórico local ----
    const historyList = document.getElementById('historyList');

    function loadHistory() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
        catch (e) { return []; }
    }

    function saveToHistory(entry) {
        const list = loadHistory();
        list.unshift(entry);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) {}
    }

    function renderHistory() {
        const list = loadHistory();
        if (!list.length) {
            historyList.innerHTML = '<div class="history-empty">Nenhum teste salvo neste dispositivo ainda. Faça seu primeiro teste avançado acima.</div>';
            return;
        }
        historyList.innerHTML = list.map(item => `
            <div class="history-item">
                <span class="h-date">${new Date(item.date).toLocaleString('pt-BR')}</span>
                <span class="h-metric">↓<b>${formatVal(item.download)}</b></span>
                <span class="h-metric">↑<b>${formatVal(item.upload)}</b></span>
                <span class="h-metric">Ping<b>${formatVal(item.ping)}</b></span>
                <span class="h-metric">Jitter<b>${formatVal(item.jitter)}</b></span>
            </div>
        `).join('');
    }

    // ---- Orquestração ----
    async function runFullTest() {
        startBtn.textContent = '...';
        startBtn.classList.add('running');

        const [coreResults] = await Promise.all([
            runCoreTest(),
            runLatencyProbes()
        ]);

        startBtn.textContent = 'Refazer';
        startBtn.classList.remove('running');
        resultActions.classList.add('visible');

        saveToHistory({ date: Date.now(), ...coreResults });
        renderHistory();
    }

    startBtn.addEventListener('click', runFullTest);
    document.getElementById('retestBtn').addEventListener('click', runFullTest);
    document.getElementById('shareBtn').addEventListener('click', () => {
        alert('Compartilhamento de resultado será habilitado quando o backend estiver disponível.');
    });

    // ---- Inicialização ----
    resetGaugeUI();
    renderServiceCards();
    renderDeviceInfo();
    renderHistory();
})();
