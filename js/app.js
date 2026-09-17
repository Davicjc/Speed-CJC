(function () {
    'use strict';

    const HISTORY_KEY = 'audicom_speedtest_historico';
    const PROFILE_KEY = 'audicom_profile';
    const ONBOARDING_KEY = 'audicom_onboarding_seen';
    let currentMode = 'comum';
    let ipInfoCache = null;
    let testRunning = false;

    function safe(fn, fallback) {
        try { return fn(); } catch (e) { return fallback; }
    }

    // ============================================
    // MODO (Comum / Avançado / Persistência)
    // ============================================
    const modeButtons = document.querySelectorAll('.mode-toggle button');
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (testRunning) return; // não troca de modo com teste em andamento
            currentMode = btn.dataset.mode;
            modeButtons.forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
            });
            document.body.classList.remove('mode-avancado', 'mode-persistencia');
            if (currentMode !== 'comum') document.body.classList.add('mode-' + currentMode);
            resetRing(currentMode);
        });
    });

    // ============================================
    // MODAIS
    // ============================================
    function openModal(name) {
        const el = document.getElementById('modal-' + name);
        if (el) el.classList.add('open');
    }
    function closeModal(el) {
        el.classList.remove('open');
        if (el.id === 'modal-onboarding') safe(() => localStorage.setItem(ONBOARDING_KEY, '1'));
    }

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
    // ONBOARDING (pergunta de identificação na 1ª visita)
    // ============================================
    (function initOnboarding() {
        let seen = null;
        try { seen = localStorage.getItem(ONBOARDING_KEY); } catch (e) { seen = 'unknown'; }
        if (seen) return; // já visto, ou localStorage indisponível (não insiste)
        setTimeout(() => openModal('onboarding'), 900);
    })();

    document.getElementById('onboardingYes').addEventListener('click', () => {
        safe(() => localStorage.setItem(ONBOARDING_KEY, '1'));
        closeModal(document.getElementById('modal-onboarding'));
        openModal('account');
    });
    document.getElementById('onboardingNo').addEventListener('click', () => {
        safe(() => localStorage.setItem(ONBOARDING_KEY, '1'));
        closeModal(document.getElementById('modal-onboarding'));
    });

    // ============================================
    // ANEL (download/upload) + STEP-ROW + CHIPS
    // ============================================
    const dlRing = RingProgress(document.getElementById('dlRing'), 120);
    const ulRing = RingProgress(document.getElementById('ulRing'), 108);

    const ringTest = document.getElementById('ringTest');
    const ringResult = document.getElementById('ringResult');
    const ringPhase = document.getElementById('ringPhase');
    const dlValue = document.getElementById('dlValue');
    const ulValue = document.getElementById('ulValue');
    const startBtn = document.getElementById('startBtn');
    const startBtnLabel = startBtn.querySelector('span');

    const ringMiniStats = document.getElementById('ringMiniStats');
    const stepRow = document.getElementById('stepRow');
    const MINI_LABELS = { ping: 'Ping', jitter: 'Jitter', bufferbloat: 'Buffer.', perda: 'Perda' };

    function fmt(v) { return v.toFixed(v < 10 ? 1 : 0); }

    function fmtMainHtml(v) {
        const [int, dec] = v.toFixed(1).split('.');
        return `${int}<small>.${dec}</small>`;
    }

    function miniEl(key, label) {
        let el = document.getElementById('mini-' + key);
        if (!el) {
            el = document.createElement('div');
            el.className = 'mini-stat';
            el.id = 'mini-' + key;
            el.innerHTML = `<span class="mini-label">${label || MINI_LABELS[key] || key}</span><span class="mini-value">–</span>`;
            ringMiniStats.appendChild(el);
        }
        return el.querySelector('.mini-value');
    }

    /** Chip "ao vivo" com estado (ok/warn/fail) — usado pelas checagens do modo avançado. */
    function liveChip(key, label, text, state) {
        let el = document.getElementById('chip-' + key);
        if (!el) {
            el = document.createElement('div');
            el.className = 'mini-stat live-chip';
            el.id = 'chip-' + key;
            el.innerHTML = `<span class="mini-label">${label}</span><span class="mini-value">–</span>`;
            ringMiniStats.appendChild(el);
        }
        const valueEl = el.querySelector('.mini-value');
        valueEl.textContent = text;
        valueEl.className = 'mini-value' + (state ? ' ' + state : '');
        return el;
    }

    function renderStepRow(phases) {
        stepRow.innerHTML = phases.map((p, i) => `<span class="step-dot" data-step="${i}"></span>`).join('');
    }

    function setStep(idx, state) {
        const dot = stepRow.querySelector(`[data-step="${idx}"]`);
        if (!dot) return;
        dot.classList.toggle('active', state === 'active');
        dot.classList.toggle('done', state === 'done');
    }

    function resetRing(mode) {
        dlRing.reset(); ulRing.reset();
        dlValue.innerHTML = '0<small>.0</small>';
        ulValue.innerHTML = '0<small>.0</small>';
        ringMiniStats.innerHTML = '';
        ringPhase.textContent = 'Pronto para testar';
        ringResult.classList.remove('visible');
        ringTest.classList.remove('hidden');
        startBtnLabel.textContent = mode === 'persistencia' ? 'Iniciar monitoramento' : 'Iniciar teste';
        if (mode !== 'persistencia') renderStepRow(buildPhases(mode || currentMode));
        else stepRow.innerHTML = '';
        stopPersistence(true);
    }

    // ============================================
    // TESTE (Comum / Avançado) — motor mock, fase por fase
    // ============================================
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
            const phases = buildPhases(mode);
            const results = {};
            let lastIdx = -1;

            MockEngine.run(phases, {
                onTick(key, value, idx, phase, t) {
                    if (idx !== lastIdx) {
                        if (lastIdx >= 0) setStep(lastIdx, 'done');
                        setStep(idx, 'active');
                        lastIdx = idx;
                    }
                    ringPhase.textContent = phase.label;
                    if (phase.ring) phase.ring.set(t);
                    if (phase.valueEl) phase.valueEl.innerHTML = fmtMainHtml(value);
                    else miniEl(key).textContent = fmt(value);
                },
                onPhaseEnd(key, value) {
                    results[key] = value;
                    setStep(lastIdx, 'done');
                },
                onDone() {
                    ringPhase.textContent = 'Concluído';
                    resolve(results);
                }
            });
        });
    }

    // ---- Checagens "ao vivo" do modo avançado (todas isoladas, nunca travam o teste) ----
    async function runAdvancedLiveChecks() {
        liveChip('ipstack', 'Protocolo', 'verificando…');
        LiveChecks.checkIPStack().then(r => {
            if (r.error) { liveChip('ipstack', 'Protocolo', r.error, 'fail'); return; }
            const parts = [r.v4 ? 'IPv4 ✓' : 'IPv4 ✗', r.v6 ? 'IPv6 ✓' : 'IPv6 ✗'];
            liveChip('ipstack', 'Protocolo', parts.join(' · '), (r.v4 || r.v6) ? 'ok' : 'fail');
        });

        liveChip('clock', 'Relógio', 'verificando…');
        LiveChecks.checkClockSkew().then(r => {
            if (r.error || r.skewSeconds === null) { liveChip('clock', 'Relógio', 'indisponível', 'warn'); return; }
            const abs = Math.abs(r.skewSeconds);
            if (abs < 5) liveChip('clock', 'Relógio', 'correto', 'ok');
            else liveChip('clock', 'Relógio', `${r.skewSeconds > 0 ? '+' : ''}${r.skewSeconds}s`, abs > 60 ? 'fail' : 'warn');
        });

        safe(() => {
            const conn = DeviceInfo.getConnection();
            if (!conn.supported) { liveChip('conn', 'Conexão', 'não exposta', 'warn'); return; }
            const label = [conn.type, conn.effectiveType].filter(Boolean).join(' · ') || 'desconhecida';
            liveChip('conn', 'Conexão', label + ' (estimado)', 'ok');
        });

        liveChip('geo', 'Localização', 'solicitando permissão…');
        LiveChecks.getGeolocation().then(async (r) => {
            if (!r.ok) { liveChip('geo', 'Localização', r.reason, 'warn'); return; }
            const place = await LiveChecks.reverseGeocode(r.lat, r.lon);
            if (place) liveChip('geo', 'Localização', place, 'ok');
            else liveChip('geo', 'Localização', `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`, 'ok');
        });

        runLatencyProbes();
    }

    async function showResult(results) {
        document.getElementById('resultDl').innerHTML = fmtMainHtml(results.download);
        document.getElementById('resultUl').innerHTML = fmtMainHtml(results.upload);
        document.getElementById('resultPing').textContent = fmt(results.ping);
        document.getElementById('resultJitter').textContent = fmt(results.jitter);

        if (!ipInfoCache) ipInfoCache = await DeviceInfo.fetchPublicIp();
        document.getElementById('resultIp').textContent = ipInfoCache.ip || 'indisponível';
        document.getElementById('resultIsp').textContent = ipInfoCache.isp || 'indisponível';

        ringTest.classList.add('hidden');
        ringResult.classList.add('visible');
    }

    async function runFullTest() {
        if (testRunning) return;
        if (!navigator.onLine) {
            ringPhase.textContent = 'Sem conexão com a internet';
            return;
        }
        if (currentMode === 'persistencia') { togglePersistence(); return; }

        testRunning = true;
        resetRing(currentMode);
        startBtn.disabled = true;
        startBtnLabel.textContent = 'Testando…';

        if (currentMode === 'avancado') runAdvancedLiveChecks();

        const results = await runCoreTest(currentMode);
        startBtn.disabled = false;
        startBtnLabel.textContent = 'Iniciar teste';
        testRunning = false;
        await showResult(results);
        saveToHistory({ date: Date.now(), mode: currentMode, ...results });
        renderHistory();
    }

    window.addEventListener('offline', () => {
        if (testRunning) ringPhase.textContent = 'Conexão perdida durante o teste';
    });

    startBtn.addEventListener('click', runFullTest);
    document.getElementById('retestBtn').addEventListener('click', () => {
        resetRing(currentMode);
        runFullTest();
    });
    document.getElementById('shareBtn').addEventListener('click', () => {
        alert('Compartilhamento de resultado será habilitado quando o backend estiver disponível.');
    });

    // ============================================
    // MODO PERSISTÊNCIA (monitoramento contínuo)
    // ============================================
    const persistCanvas = document.getElementById('persistCanvas');
    const persistCtx = persistCanvas.getContext('2d');
    const persistElapsedEl = document.getElementById('persistElapsed');
    const persistSamplesEl = document.getElementById('persistSamples');
    const persistPausedEl = document.getElementById('persistPaused');

    let persistState = null; // { samples:[], startedAt, sampleTimer, clockTimer, paused }

    function drawPersistGraph(samples) {
        const w = persistCanvas.width, h = persistCanvas.height;
        persistCtx.clearRect(0, 0, w, h);
        if (samples.length < 2) return;
        const pings = samples.map(s => s.ping);
        const max = Math.max(...pings, 20);
        const min = 0;
        persistCtx.beginPath();
        persistCtx.strokeStyle = '#F59E0B';
        persistCtx.lineWidth = 2;
        samples.forEach((s, i) => {
            const x = (i / (samples.length - 1)) * w;
            const y = h - ((s.ping - min) / (max - min)) * h;
            i === 0 ? persistCtx.moveTo(x, y) : persistCtx.lineTo(x, y);
        });
        persistCtx.stroke();
    }

    function sampleOnce() {
        const ping = MockEngine.randomInRange(8, 60);
        const download = MockEngine.randomInRange(60, 420);
        persistState.samples.push({ t: Date.now(), ping, download });
        if (persistState.samples.length > 200) persistState.samples.shift();
        drawPersistGraph(persistState.samples);
        persistSamplesEl.textContent = persistState.samples.length + ' amostras';
        miniEl('pping', 'Ping').textContent = fmt(ping);
        miniEl('pdown', 'Download').textContent = fmt(download);
        ringPhase.textContent = 'Monitorando…';
    }

    function tickElapsed() {
        const secs = Math.floor((Date.now() - persistState.startedAt) / 1000);
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        persistElapsedEl.textContent = `${m}:${s}`;
    }

    function togglePersistence() {
        if (persistState) { finishPersistence(); return; }

        persistState = { samples: [], startedAt: Date.now(), paused: false };
        testRunning = true;
        startBtnLabel.textContent = 'Parar monitoramento';
        ringPhase.textContent = 'Monitorando…';
        ringMiniStats.innerHTML = '';
        persistPausedEl.hidden = true;

        persistState.sampleTimer = setInterval(() => { if (!persistState.paused) sampleOnce(); }, 4000);
        persistState.clockTimer = setInterval(() => { if (!persistState.paused) tickElapsed(); }, 1000);
        sampleOnce();
    }

    function stopPersistence(silent) {
        if (!persistState) return;
        clearInterval(persistState.sampleTimer);
        clearInterval(persistState.clockTimer);
        persistState = null;
        testRunning = false;
        if (!silent) startBtnLabel.textContent = 'Iniciar monitoramento';
    }

    async function finishPersistence() {
        const samples = persistState.samples;
        const durationSec = Math.floor((Date.now() - persistState.startedAt) / 1000);
        stopPersistence();

        if (samples.length) {
            const pings = samples.map(s => s.ping);
            const downloads = samples.map(s => s.download);
            const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
            const results = {
                ping: avg(pings), jitter: Math.max(...pings) - Math.min(...pings),
                download: avg(downloads), upload: avg(downloads) * 0.35
            };
            await showResult(results);
            document.querySelector('#ringResult .ring-result-title').textContent =
                `✓ Monitoramento de ${Math.floor(durationSec / 60)}min concluído`;
            saveToHistory({ date: Date.now(), mode: 'persistencia', ...results, durationSec, samples: samples.length });
            renderHistory();
        } else {
            resetRing('persistencia');
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!persistState) return;
        persistState.paused = document.hidden;
        persistPausedEl.hidden = !document.hidden;
    });

    // ============================================
    // CPF / CNPJ + perfil local
    // ============================================
    const docInput = document.getElementById('docInput');
    const docFeedback = document.getElementById('docFeedback');
    const accountLabel = document.getElementById('accountLabel');

    function loadProfile() { return safe(() => JSON.parse(localStorage.getItem(PROFILE_KEY)), null); }
    function refreshAccountLabel() {
        const profile = loadProfile();
        accountLabel.textContent = (profile && profile.doc) ? 'Identificado' : 'Conta';
    }

    const savedProfile = loadProfile();
    if (savedProfile && savedProfile.doc) docInput.value = savedProfile.doc;
    refreshAccountLabel();

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
        if (valid) {
            safe(() => localStorage.setItem(PROFILE_KEY, JSON.stringify({ doc: docInput.value })));
            refreshAccountLabel();
        }
    });

    document.getElementById('forgetAccountBtn').addEventListener('click', () => {
        safe(() => { localStorage.removeItem(PROFILE_KEY); localStorage.removeItem('audicom_wifi_manual'); });
        docInput.value = '';
        docFeedback.textContent = '';
        wifiManualInput.value = '';
        refreshAccountLabel();
    });

    // ============================================
    // WI-FI MANUAL
    // ============================================
    const wifiManualInput = document.getElementById('wifiManualName');
    wifiManualInput.addEventListener('change', () => {
        safe(() => localStorage.setItem('audicom_wifi_manual', wifiManualInput.value.trim()));
    });
    safe(() => {
        const saved = localStorage.getItem('audicom_wifi_manual');
        if (saved) wifiManualInput.value = saved;
    });

    // ============================================
    // SERVIÇOS (latência real) — agora aparece ao vivo dentro do card
    // ============================================
    let servicesRunning = false;

    function runLatencyProbes() {
        if (servicesRunning) return;
        servicesRunning = true;
        LatencyProbe.TARGETS.forEach(t => liveChip('svc-' + t.key, t.label, '…'));
        LatencyProbe.probeAll(result => {
            const status = LatencyProbe.classify(result.ms);
            const state = status === 'otimo' ? 'ok' : status === 'bom' ? 'warn' : 'fail';
            liveChip('svc-' + result.key, result.label, result.ok ? result.ms + 'ms' : 'indisponível', state);
        }).finally(() => { servicesRunning = false; });
    }

    // ============================================
    // HISTÓRICO LOCAL
    // ============================================
    const historyList = document.getElementById('historyList');

    function loadHistory() { return safe(() => JSON.parse(localStorage.getItem(HISTORY_KEY)), []) || []; }

    function saveToHistory(entry) {
        const list = loadHistory();
        list.unshift(entry);
        safe(() => localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 15))));
    }

    function renderHistory() {
        const list = loadHistory();
        if (!list.length) {
            historyList.innerHTML = '<div class="history-empty">Nenhum teste salvo neste dispositivo ainda.</div>';
            return;
        }
        historyList.innerHTML = list.map(item => `
            <div class="history-item">
                <span class="h-date">${new Date(item.date).toLocaleString('pt-BR')}${item.mode === 'avancado' ? ' · avançado' : item.mode === 'persistencia' ? ' · persistência' : ''}</span>
                <span class="h-vals">
                    <span style="color:var(--cor-download)">↓${fmt(item.download)}</span>
                    <span style="color:var(--cor-upload)">↑${fmt(item.upload)}</span>
                    <span style="color:var(--cor-ping)">${fmt(item.ping)}ms</span>
                </span>
            </div>
        `).join('');
    }

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
        safe(() => localStorage.removeItem(HISTORY_KEY));
        renderHistory();
    });

    // ============================================
    // INIT
    // ============================================
    resetRing('comum');
    renderHistory();
    DeviceInfo.fetchPublicIp().then(info => { ipInfoCache = info; }).catch(() => {});
})();
