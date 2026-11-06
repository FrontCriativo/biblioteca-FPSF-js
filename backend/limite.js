// Limites de uso em memória: reiniciar o servidor zera os contadores.

const limitadores = new Set();

/**
 * Contador por chave numa janela fixa, que começa no primeiro registro da chave.
 * Cada limitador tem as próprias chaves: um não interfere na contagem do outro.
 */
export function criarLimitador({ janelaMs, maximo }) {
  const registros = new Map(); // chave → { contagem, inicio }

  function vigente(chave, agora = Date.now()) {
    const registro = registros.get(chave);
    if (registro && agora - registro.inicio >= janelaMs) {
      registros.delete(chave);
      return null;
    }
    return registro ?? null;
  }

  const limitador = {
    /** true se a chave já chegou ao máximo na janela atual. */
    esgotado: (chave) => (vigente(chave)?.contagem ?? 0) >= maximo,

    registrar(chave) {
      const agora = Date.now();
      const registro = vigente(chave, agora);
      if (registro) registro.contagem++;
      else registros.set(chave, { contagem: 1, inicio: agora });
    },

    /** Conta um uso, se ainda houver saldo. Devolve false quando o limite já foi atingido. */
    consumir(chave) {
      if (limitador.esgotado(chave)) return false;
      limitador.registrar(chave);
      return true;
    },

    /** Quanto falta para a janela da chave terminar (o valor do cabeçalho Retry-After). */
    segundosRestantes(chave) {
      const agora = Date.now();
      const registro = vigente(chave, agora);
      return registro ? Math.ceil((registro.inicio + janelaMs - agora) / 1000) : 0;
    },

    limpar: (chave) => registros.delete(chave),

    faxinar() {
      const agora = Date.now();
      for (const chave of registros.keys()) vigente(chave, agora);
    },

    zerar: () => registros.clear(),
  };

  limitadores.add(limitador);
  return limitador;
}

/** Tira dos Maps os registros cuja janela já passou, para eles não crescerem sem limite. */
export function faxinarLimites() {
  for (const limitador of limitadores) limitador.faxinar();
}

/** Só para os testes: cada caso começa sem nenhuma contagem acumulada. */
export function zerarLimites() {
  for (const limitador of limitadores) limitador.zerar();
}
