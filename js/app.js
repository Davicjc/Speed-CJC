(function () {
    'use strict';

    const HISTORY_KEY = 'audicom_speedtest_historico';
    let currentMode = 'comum';
    let ipInfoCache = null;

    // ============================================
    // MODO (Comum / Avançado)
    // ============================================
    const modeButtons = document.querySelectorAll('.mode-toggle button');
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            currentMode = btn.dataset.mode;
            modeButtons.forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
            });
            document.body.classList.toggle('mode-avancado', currentMode === 'avancado');
        });
    });

    // ============================================
    // MODAIS
    // ============================================
    function openModal(name) {
        const el = document.getElementById('modal-' + name);
        if (el) el.classList.add('open');
        if (name === 'services') runLatencyProbes();
        if (name === 'device') renderDeviceInfo();
    }
    function closeModal(el) { el.classList.remove('open'); }

    document.querySelectorAll('[data-modal]').forEach(btn => {
        btn.addEventListener('click', () => openModal(btn.dataset.modal));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
        overlay.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(overlay)));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(closeModal);
    });
    window.openHelpModal = () => openModal('help');

    // ============================================
    // ANEL (download/upload) + MINI-STATS
    // ============================================
    const dlRing = RingProgress(document.getElementById('dlRing'), 120);
    const ulRing = RingProgress(document.getElementById('ulRing'), 108);

    const ringTest = document.getElementById('ringTest');
    const ringResult = document.getElementById('ringResult');
    const ringPhase = document.getElementById('ringPhase');
    const dlValue = document.getElementById('dlValue');
    const ulValue = document.getElementById('ulValue');
    const startBtn = document.getElementById('startBtn');

    const mini = {
        ping: document.getElementById('pingValue'),
        jitter: document.getElementById('jitterValue'),
        bufferbloat: document.getElementById('bufferbloatValue'),
        perda: document.getElementById('perdaValue')
    };

    function fmt(v) { return v.toFixed(v < 10 ? 1 : 0); }

    function resetRing() {
        dlRing.reset(); ulRing.reset();
        dlValue.textContent = '0.0'; ulValue.textContent = '0.0';
        Object.values(mini).forEach(el => el.textContent = '–');
        ringPhase.textContent = 'Pronto para testar';
        ringResult.classList.remove('visible');
        ringTest.classList.remove('hidden');
    }

    function buildPhases(mode) {
        const ping = MockEngine.randomInRange(8, 35);
        const jitter = MockEngine.randomInRange(1, 8);
        const download = MockEngine.randomInRange(80, 420);
        const upload = MockEngine.randomInRange(30, 180);
        const bufferbloat = MockEngine.randomInRange(5, 90);
        const perda = MockEngine.randomInRange(0, 2.5);

        const phases = [
            { key: 'ping', label: 'Medindo ping…', duration: 700, from: 0, to: ping, jitterPct: 0.15 },
            { key: 'jitter', label: 'Medindo jitter…', duration: 500, from: 0, to: jitter, jitterPct: 0.2 },
            { key: 'download', label: 'Testando download…', duration: 3000, from: 0, to: download, jitterPct: 0.08, ring: dlRing, valueEl: dlValue },
            { key: 'upload', label: 'Testando upload…', duration: 2200, from: 0, to: upload, jitterPct: 0.1, ring: ulRing, valueEl: ulValue }
        ];
        if (mode === 'avancado') {
            phases.push({ key: 'bufferbloat', label: 'Testando estabilidade…', duration: 1500, from: 0, to: bufferbloat, jitterPct: 0.1 });
            phases.push({ key: 'perda', label: 'Estimando perda de pacotes…', duration: 800, from: 0, to: perda, jitterPct: 0.3 });
        }
        return phases;
    }

    function runCoreTest(mode) {
        return new Promise((resolve) => {
            resetRing();
            const phases = buildPhases(mode);
            const results = {};

            MockEngine.run(phases, {
                onTick(key, value, idx, phase, t) {
                    ringPhase.textContent = phase.label;
                    if (phase.ring) phase.ring.set(t);
                    if (phase.valueEl) phase.valueEl.textContent = fmt(value);
                    if (mini[key]) mini[key].textContent = fmt(value);
                },
                onPhaseEnd(key, value) {
                    results[key] = value;
                },
                onDone() {
                    ringPhase.textContent = 'Concluído';
                    resolve(results);
                }
            });
        });
    }

    async function showResult(results) {
        document.getElementById('resultDl').textContent = fmt(results.download);
        document.getElementById('resultUl').textContent = fmt(results.upload);
        document.getElementById('resultPing').textContent = fmt(results.ping);
        document.getElementById('resultJitter').textContent = fmt(results.jitter);

        if (!ipInfoCache) ipInfoCache = await DeviceInfo.fetchPublicIp();
        document.getElementById('resultIp').textContent = ipInfoCache.ip || 'indisponível';
        document.getElementById('resultIsp').textContent = ipInfoCache.isp || 'indisponível';

        ringTest.classList.add('hidden');
        ringResult.classList.add('visible');
    }

    async function runFullTest() {
        startBtn.disabled = true;
        startBtn.textContent = '...';
        const results = await runCoreTest(currentMode);
        startBtn.disabled = false;
        startBtn.textContent = 'Iniciar teste';
        await showResult(results);
        saveToHistory({ date: Date.now(), ...results });
        renderHistory();
        if (currentMode === 'avancado') runLatencyProbes();
    }

    startBtn.addEventListener('click', runFullTest);
    document.getElementById('retestBtn').addEventListener('click', () => {
        resetRing();
        runFullTest();
    });
    document.getElementById('shareBtn').addEventListener('click', () => {
        alert('Compartilhamento de resultado será habilitado quando o backend estiver disponível.');
    });

    // ============================================
    // CPF / CNPJ
    // ============================================
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

    // ============================================
    // WI-FI MANUAL
    // ============================================
    const wifiManualInput = document.getElementById('wifiManualName');
    wifiManualInput.addEventListener('change', () => {
        try { localStorage.setItem('audicom_wifi_manual', wifiManualInput.value.trim()); } catch (e) {}
    });
    try {
        const saved = localStorage.getItem('audicom_wifi_manual');
        if (saved) wifiManualInput.value = saved;
    } catch (e) {}

    // ============================================
    // SERVIÇOS (latência real)
    // ============================================
    const servicesGrid = document.getElementById('servicesGrid');
    let servicesRunning = false;

    function renderServiceCards() {
        servicesGrid.innerHTML = LatencyProbe.TARGETS.map(t => `
            <div class="service-card" id="svc-${t.key}">
                <span class="service-icon">${t.icon}</span>
                <div>
                    <span class="service-name">${t.label}</span>
                    <span class="service-value"><span class="status-dot"></span> ...</span>
                </div>
            </div>
        `).join('');
    }

    function updateServiceCard(result) {
        const el = document.getElementById('svc-' + result.key);
        if (!el) return;
        const status = LatencyProbe.classify(result.ms);
        el.querySelector('.service-value').innerHTML =
            `<span class="status-dot status-${status}"></span> ${result.ok ? result.ms + ' ms' : 'indisponível'}`;
    }

    function runLatencyProbes() {
        if (servicesRunning) return;
        servicesRunning = true;
        renderServiceCards();
        LatencyProbe.probeAll(updateServiceCard).finally(() => { servicesRunning = false; });
    }

    // ============================================
    // DISPOSITIVO (dados reais)
    // ============================================
    const infoGrid = document.getElementById('infoGrid');
    let deviceRendered = false;

    function infoCard(label, value) {
        return `<div class="info-card"><div class="info-label">${label}</div><div class="info-value">${value}</div></div>`;
    }

    async function renderDeviceInfo() {
        if (deviceRendered) return;
        deviceRendered = true;
        const d = DeviceInfo.collectSync();
        if (!ipInfoCache) ipInfoCache = await DeviceInfo.fetchPublicIp();

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
            infoCard('Tipo de conexão', conn),
            infoCard('IP público', ipInfoCache.ip || 'indisponível'),
            infoCard('Provedor (ISP)', ipInfoCache.isp || 'indisponível'),
            infoCard('Localização aprox.', [ipInfoCache.city, ipInfoCache.region].filter(Boolean).join(', ') || 'indisponível'),
            infoCard('IPv6', ipInfoCache.isIPv6 === null ? 'indisponível' : (ipInfoCache.isIPv6 ? 'Sim' : 'Não detectado nesta rede'))
        ].join('');
    }

    // ============================================
    // HISTÓRICO LOCAL
    // ============================================
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
            historyList.innerHTML = '<div class="history-empty">Nenhum teste salvo neste dispositivo ainda.</div>';
            return;
        }
        historyList.innerHTML = list.map(item => `
            <div class="history-item">
                <span class="h-date">${new Date(item.date).toLocaleString('pt-BR')}</span>
                <span class="h-vals">
                    <span style="color:var(--cor-download)">↓${fmt(item.download)}</span>
                    <span style="color:var(--cor-upload)">↑${fmt(item.upload)}</span>
                    <span style="color:var(--cor-ping)">${fmt(item.ping)}ms</span>
                </span>
            </div>
        `).join('');
    }

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
        try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
        renderHistory();
    });

    // ============================================
    // INIT
    // ============================================
    resetRing();
    renderHistory();
    DeviceInfo.fetchPublicIp().then(info => { ipInfoCache = info; });
})();
