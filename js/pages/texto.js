// Páginas de leitura: só a moldura comum (topo, rodapé, fundo) e ícones.
import { ICON } from '../core/icons.js';
import { iniciarPagina } from '../core/shell.js';

document.querySelectorAll('[data-i]').forEach((s) => { s.innerHTML = ICON[s.dataset.i] || ''; });
await iniciarPagina({ pagina: document.body.dataset.pagina || 'texto' });
