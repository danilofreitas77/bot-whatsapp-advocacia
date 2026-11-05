// Validação e máscara de CPF/CNPJ.
// Antes de consultar qualquer dado de crédito, o documento precisa ser válido:
// isso corta digitação errada e tentativa de chute aleatório.

function soDigitos(texto) {
  return String(texto || '').replace(/\D/g, '');
}

function cpfValido(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const dv = (soma * 10) % 11 % 10;
    if (dv !== Number(cpf[tamanho])) return false;
  }
  return true;
}

function cnpjValido(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const tamanho of [12, 13]) {
    let soma = 0;
    const p = pesos.slice(13 - tamanho);
    for (let i = 0; i < tamanho; i++) soma += Number(cnpj[i]) * p[i];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(cnpj[tamanho])) return false;
  }
  return true;
}

function documentoValido(texto) {
  const d = soDigitos(texto);
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
}

function mascararDocumento(texto) {
  const d = soDigitos(texto);
  if (d.length === 11) return `***.${d.slice(3, 6)}.***-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.***/****-**`;
  return '***';
}

// <exports>
if (typeof module !== 'undefined') {
  module.exports = { soDigitos, cpfValido, cnpjValido, documentoValido, mascararDocumento };
}
// </exports>
