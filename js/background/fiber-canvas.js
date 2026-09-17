/**
 * AUDICOM TELECOM - Fiber Canvas Animation
 * Fiber Optic Flow Animation
 * Inspired by connectivity, data flow, and modern tech aesthetics
 */

(function() {
    'use strict';

    // Verifica se o fiberCanvas está ativado no SiteConfig
    if (typeof SiteConfig !== 'undefined' && !SiteConfig.fiberCanvas) {
        return; // Não inicializa se estiver desativado
    }

    // Color palette from brand guidelines
    const COLORS = {
        azulConexao: '#00249C',
        azulEstrutura: '#081535',
        cinzaOperacional: '#8F99A8',
        grafiteInfra: '#2A2F36',
        brancoTecnico: '#F4F6F9'
    };

    // Canvas setup
    const canvas = document.getElementById('fiber-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];
    let connections = [];
    let animationId;
    let lastTime = 0;
    
    // Lê configurações do SiteConfig ou usa valores padrão
    const SC = typeof SiteConfig !== 'undefined' ? SiteConfig : {};
    const isMobile = window.innerWidth <= 768;
    const SETTINGS = {
        particleCount: isMobile 
            ? (SC.fiberCanvasParticleCountMobile || 30) 
            : (SC.fiberCanvasParticleCount || 80),
        connectionDistance: SC.fiberCanvasConnectionDistance || 150,
        particleSpeed: SC.fiberCanvasParticleSpeed || 0.3,
        flowSpeed: SC.fiberCanvasFlowSpeed || 0.002,
        glowIntensity: SC.fiberCanvasGlowIntensity || 0.8,
        // Configurações do Scan Line
        scanLine: SC.fiberCanvasScanLine !== false,  // Ativado por padrão
        scanLineSpeed: SC.fiberCanvasScanLineSpeed || 0.0005,
        scanLineWidth: SC.fiberCanvasScanLineWidth || 100,
        scanLineOpacity: SC.fiberCanvasScanLineOpacity || 0.05
    };

    /**
     * Resize canvas to match window dimensions
     */
    function resizeCanvas() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        initParticles();
    }

    /**
     * Particle class representing a node in the fiber network
     */
    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.size = Math.random() * 2 + 1;
            this.speedX = (Math.random() - 0.5) * SETTINGS.particleSpeed;
            this.speedY = (Math.random() - 0.5) * SETTINGS.particleSpeed;
            this.opacity = Math.random() * 1 + 1;
            this.pulsePhase = Math.random() * Math.PI * 2;
            this.pulseSpeed = Math.random() * 0.02 + 0.01;
        }

        update(time) {
            // Movement
            this.x += this.speedX;
            this.y += this.speedY;

            // Wrap around edges
            if (this.x < 0) this.x = width;
            if (this.x > width) this.x = 0;
            if (this.y < 0) this.y = height;
            if (this.y > height) this.y = 0;

            // Pulsing opacity
            this.pulsePhase += this.pulseSpeed;
            this.currentOpacity = this.opacity + Math.sin(this.pulsePhase) * 0.2;
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(244, 246, 249, ${this.currentOpacity})`;
            ctx.fill();

            // Glow effect for some particles
            if (this.size > 1.5) {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 36, 156, ${this.currentOpacity * 0.3})`;
                ctx.fill();
            }
        }
    }

    /**
     * Initialize particles
     */
    function initParticles() {
        particles = [];
        for (let i = 0; i < SETTINGS.particleCount; i++) {
            particles.push(new Particle());
        }
    }

    /**
     * Draw connections between nearby particles
     * Creates the fiber optic network effect
     */
    function drawConnections() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < SETTINGS.connectionDistance) {
                    const opacity = (1 - distance / SETTINGS.connectionDistance) * 1.0;
                    
                    // Create gradient for fiber effect
                    const gradient = ctx.createLinearGradient(
                        particles[i].x, particles[i].y,
                        particles[j].x, particles[j].y
                    );
                    
                    gradient.addColorStop(0, `rgba(0, 36, 156, ${opacity})`);
                    gradient.addColorStop(0.5, `rgba(143, 153, 168, ${opacity * 0.5})`);
                    gradient.addColorStop(1, `rgba(0, 36, 156, ${opacity})`);

                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = gradient;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }
    }

    /**
     * Draw flowing data packets along connections
     */
    function drawDataFlow(time) {
        const flowProgress = (time * SETTINGS.flowSpeed) % 1;

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < SETTINGS.connectionDistance * 0.7) {
                    // Calculate position along the line
                    const progress = (flowProgress + (i + j) * 0.1) % 1;
                    const flowX = particles[i].x + (particles[j].x - particles[i].x) * progress;
                    const flowY = particles[i].y + (particles[j].y - particles[i].y) * progress;

                    // Draw data packet
                    const packetOpacity = (1 - distance / SETTINGS.connectionDistance) * 0.8;
                    const packetSize = 1.5;

                    ctx.beginPath();
                    ctx.arc(flowX, flowY, packetSize, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(0, 36, 156, ${packetOpacity})`;
                    ctx.fill();

                    // Glow
                    ctx.beginPath();
                    ctx.arc(flowX, flowY, packetSize * 3, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(0, 36, 156, ${packetOpacity * 0.2})`;
                    ctx.fill();
                }
            }
        }
    }

    /**
     * Draw scanning line effect
     */
    function drawScanLine(time) {
        // Verifica se o scanLine está ativado
        if (!SETTINGS.scanLine) return;
        
        const scanY = (Math.sin(time * SETTINGS.scanLineSpeed) + 1) * 0.5 * height;
        const scanWidth = SETTINGS.scanLineWidth;

        const gradient = ctx.createLinearGradient(0, scanY - scanWidth, 0, scanY + scanWidth);
        gradient.addColorStop(0, 'rgba(0, 36, 156, 0)');
        gradient.addColorStop(0.5, `rgba(0, 36, 156, ${SETTINGS.scanLineOpacity})`);
        gradient.addColorStop(1, 'rgba(0, 36, 156, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, scanY - scanWidth, width, scanWidth * 2);
    }

    /**
     * Main animation loop
     */
    function animate(timestamp) {
        const deltaTime = timestamp - lastTime;
        lastTime = timestamp;

        // Clear canvas completely (removes ghosting/trails)
        ctx.fillStyle = COLORS.azulEstrutura;
        ctx.fillRect(0, 0, width, height);

        // Draw scan line
        drawScanLine(timestamp);

        // Update and draw particles
        particles.forEach(particle => {
            particle.update(timestamp);
        });

        // Draw connections first (behind particles)
        drawConnections();

        // Draw data flow
        drawDataFlow(timestamp);

        // Draw particles on top
        particles.forEach(particle => {
            particle.draw();
        });

        animationId = requestAnimationFrame(animate);
    }

    /**
     * Initialize animation
     */
    function init() {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        
        // Clear canvas initially
        ctx.fillStyle = COLORS.azulEstrutura;
        ctx.fillRect(0, 0, width, height);
        
        // Start animation
        requestAnimationFrame(animate);
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (animationId) {
            cancelAnimationFrame(animationId);
        }
    });

})();
