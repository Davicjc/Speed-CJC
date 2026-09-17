(function () {
    'use strict';

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
        upload: document.getElementById('valUpload')
    };

    function resetUI() {
        gauge.reset();
        gaugeNumber.textContent = '0';
        gaugeUnitEl.textContent = 'Mbps';
        gaugePhase.textContent = ' ';
        Object.values(els).forEach(el => el.textContent = '–');
        resultActions.classList.remove('visible');
    }

    function buildPhases() {
        const pingTarget = MockEngine.randomInRange(8, 35);
        const jitterTarget = MockEngine.randomInRange(1, 8);
        const downloadTarget = MockEngine.randomInRange(80, 420);
        const uploadTarget = MockEngine.randomInRange(30, 180);

        return [
            { key: 'ping', label: 'Medindo ping…', duration: 900, from: 0, to: pingTarget, jitterPct: 0.15, unit: 'ms', gaugeMax: 60 },
            { key: 'jitter', label: 'Medindo jitter…', duration: 700, from: 0, to: jitterTarget, jitterPct: 0.2, unit: 'ms', gaugeMax: 20 },
            { key: 'download', label: 'Testando download…', duration: 3200, from: 0, to: downloadTarget, jitterPct: 0.08, unit: 'Mbps', gaugeMax: 500 },
            { key: 'upload', label: 'Testando upload…', duration: 2400, from: 0, to: uploadTarget, jitterPct: 0.1, unit: 'Mbps', gaugeMax: 300 }
        ];
    }

    function runTest() {
        resetUI();
        startBtn.textContent = '...';
        startBtn.classList.add('running');

        const phases = buildPhases();

        MockEngine.run(phases, {
            onTick(key, value, idx, phase) {
                gaugeUnitEl.textContent = phase.unit;
                gauge.set((value / phase.gaugeMax) * (phase.unit === 'Mbps' ? 500 : 60));
                gaugeNumber.textContent = value.toFixed(value < 10 ? 1 : 0);
                gaugePhase.textContent = phase.label;
                els[key].textContent = value.toFixed(value < 10 ? 1 : 0);
            },
            onPhaseEnd(key, value) {
                els[key].textContent = value.toFixed(value < 10 ? 1 : 0);
            },
            onDone() {
                gaugePhase.textContent = 'Teste concluído';
                gaugeUnitEl.textContent = 'Mbps';
                startBtn.textContent = 'Refazer';
                startBtn.classList.remove('running');
                resultActions.classList.add('visible');
            }
        });
    }

    startBtn.addEventListener('click', runTest);
    document.getElementById('retestBtn').addEventListener('click', runTest);
    document.getElementById('shareBtn').addEventListener('click', () => {
        alert('Compartilhamento de resultado será habilitado quando o backend estiver disponível.');
    });

    // ---- IP / ISP (dado real, via API pública — não depende de backend nosso) ----
    fetch('https://ipapi.co/json/')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
            document.getElementById('infoIp').textContent = data.ip || 'indisponível';
            document.getElementById('infoIsp').textContent = data.org || data.asn || 'indisponível';
        })
        .catch(() => {
            document.getElementById('infoIp').textContent = 'indisponível';
            document.getElementById('infoIsp').textContent = 'indisponível';
        });

    // ---- Identificação opcional (CPF/CNPJ) ----
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

    resetUI();
})();
