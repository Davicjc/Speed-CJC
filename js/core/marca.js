// Nome do site e da empresa, vindos do servidor (SITE_NAME e SERVER_NAME no
// .env): ele escreve os dois em <meta> no cabeçalho de cada página.
const meta = (nome) => (typeof document !== 'undefined' && document.querySelector(`meta[name="${nome}"]`)) || null;
export const MARCA = (meta('marca') && meta('marca').content) || 'Speed CJC';
export const EMPRESA = (meta('empresa') && meta('empresa').content) || MARCA;
