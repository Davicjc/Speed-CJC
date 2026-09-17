/**
 * MOCK do motor de teste — usado apenas nesta fase de FRONT-END.
 * Gera números plausíveis e anima fases, para validar a interface.
 * Será substituído pelo motor real (LibreSpeed estendido) na fase funcional.
 */
window.MockEngine = {
    /**
     * Executa uma sequência de fases.
     * phases: [{ key, label, duration, from, to, jitterPct }]
     * onTick(key, value, phaseIndex, phase, t) — t = progresso linear (0..1) da fase
     * onPhaseEnd(key, finalValue) / onDone(results)
     */
    run(phases, { onTick, onPhaseEnd, onDone, stepMs = 60 } = {}) {
        let phaseIndex = 0;
        const results = {};
        let cancelled = false;

        function runPhase() {
            if (cancelled) return;
            if (phaseIndex >= phases.length) {
                onDone && onDone(results);
                return;
            }
            const phase = phases[phaseIndex];
            const steps = Math.max(1, Math.round(phase.duration / stepMs));
            let step = 0;

            const tick = () => {
                if (cancelled) return;
                step++;
                const t = step / steps;
                const eased = 1 - Math.pow(1 - t, 3);
                let value = phase.from + (phase.to - phase.from) * eased;
                const jitter = (phase.jitterPct || 0) * phase.to * (Math.random() - 0.5);
                value = Math.max(0, value + jitter);
                onTick && onTick(phase.key, value, phaseIndex, phase, t);

                if (step < steps) {
                    setTimeout(tick, stepMs);
                } else {
                    const finalValue = phase.to;
                    results[phase.key] = finalValue;
                    onTick && onTick(phase.key, finalValue, phaseIndex, phase, 1);
                    onPhaseEnd && onPhaseEnd(phase.key, finalValue);
                    phaseIndex++;
                    setTimeout(runPhase, 220);
                }
            };
            tick();
        }

        runPhase();
        return { cancel() { cancelled = true; } };
    },

    /** Gera um resultado plausível dentro de uma faixa, com variação leve. */
    randomInRange(min, max) {
        return min + Math.random() * (max - min);
    }
};
