/**
 * Anel de progresso circular (360°), baseado em TEMPO decorrido da fase —
 * mesmo princípio visual do speedtest antigo (o anel enche conforme o
 * teste avança, não conforme a velocidade medida).
 */
window.RingProgress = function (circleEl, radius) {
    const circumference = 2 * Math.PI * radius;
    circleEl.style.strokeDasharray = circumference;
    circleEl.style.strokeDashoffset = circumference;

    return {
        set(pct) {
            const clamped = Math.max(0, Math.min(1, pct));
            circleEl.style.strokeDashoffset = circumference * (1 - clamped);
        },
        reset() {
            circleEl.style.strokeDashoffset = circumference;
        }
    };
};
