// Service worker mínimo: só existe para o navegador oferecer "Instalar app".
// De propósito NÃO tem evento "fetch": nenhuma requisição passa por aqui, então
// o teste de velocidade mede a rede direto, sem desvio nem cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
