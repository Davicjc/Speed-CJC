/**
 * Máscara e validação de CPF/CNPJ (algoritmo oficial de dígitos verificadores).
 * Uso: DocUtils.mask(valor, 'cpf'|'cnpj'), DocUtils.validate(valor, 'cpf'|'cnpj')
 */
window.DocUtils = (function () {
    function onlyDigits(v) { return (v || '').replace(/\D/g, ''); }

    function maskCPF(v) {
        v = onlyDigits(v).slice(0, 11);
        return v
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }

    function maskCNPJ(v) {
        v = onlyDigits(v).slice(0, 14);
        return v
            .replace(/(\d{2})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1/$2')
            .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    }

    function validateCPF(v) {
        const cpf = onlyDigits(v);
        if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
        let d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
        if (d1 !== parseInt(cpf[9], 10)) return false;
        sum = 0;
        for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
        let d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
        return d2 === parseInt(cpf[10], 10);
    }

    function validateCNPJ(v) {
        const cnpj = onlyDigits(v);
        if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
        const calc = (base) => {
            const weights = base.length === 12
                ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
                : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
            let sum = 0;
            for (let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * weights[i];
            const r = sum % 11;
            return r < 2 ? 0 : 11 - r;
        };
        const d1 = calc(cnpj.slice(0, 12));
        if (d1 !== parseInt(cnpj[12], 10)) return false;
        const d2 = calc(cnpj.slice(0, 13));
        return d2 === parseInt(cnpj[13], 10);
    }

    return {
        onlyDigits,
        mask(v, type) { return type === 'cnpj' ? maskCNPJ(v) : maskCPF(v); },
        validate(v, type) { return type === 'cnpj' ? validateCNPJ(v) : validateCPF(v); },
        detectType(v) { return onlyDigits(v).length > 11 ? 'cnpj' : 'cpf'; }
    };
})();
