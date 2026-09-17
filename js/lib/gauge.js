/**
 * Gauge circular em SVG (arco de ~240 graus). Sem dependencias externas.
 * Gauge(svgArcEl, trackEl, { max: 500 }).set(valor)
 * trackEl e opcional - se passado, recebe o dasharray completo do arco (trilho de fundo).
 */
window.Gauge = function (svgArcEl, trackEl, opts) {
    if (trackEl && !('nodeType' in trackEl)) { opts = trackEl; trackEl = null; }
    const RADIUS = 90;
    const ARC_DEGREES = 240;
    const FULL_CIRCLE = 2 * Math.PI * RADIUS;
    const ARC_LENGTH = FULL_CIRCLE * (ARC_DEGREES / 360);
    const GAP_LENGTH = FULL_CIRCLE - ARC_LENGTH;
    const max = (opts && opts.max) || 500;

    const dasharray = ARC_LENGTH.toFixed(2) + ' ' + GAP_LENGTH.toFixed(2);
    svgArcEl.style.strokeDasharray = dasharray;
    svgArcEl.style.strokeDashoffset = ARC_LENGTH;
    if (trackEl) {
        trackEl.style.strokeDasharray = dasharray;
        trackEl.style.strokeDashoffset = '0';
    }

    return {
        set(value) {
            const pct = Math.max(0, Math.min(1, value / max));
            svgArcEl.style.strokeDashoffset = ARC_LENGTH * (1 - pct);
        },
        reset() {
            svgArcEl.style.strokeDashoffset = ARC_LENGTH;
        }
    };
};
