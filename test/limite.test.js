import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarLimitador, faxinarLimites, zerarLimites } from '../backend/limite.js';

test('consumir aceita até o máximo e depois recusa', () => {
  const limite = criarLimitador({ janelaMs: 1000, maximo: 2 });
  assert.equal(limite.consumir('a'), true);
  assert.equal(limite.consumir('a'), true);
  assert.equal(limite.consumir('a'), false);
  assert.equal(limite.esgotado('a'), true);
  assert.equal(limite.esgotado('b'), false);
});

test('a janela termina, conta o tempo restante e libera a chave', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 10_000 });
  const limite = criarLimitador({ janelaMs: 60_000, maximo: 1 });
  limite.consumir('a');
  t.mock.timers.tick(15_500);
  assert.equal(limite.segundosRestantes('a'), 45);
  assert.equal(limite.esgotado('a'), true);
  t.mock.timers.tick(44_500);
  assert.equal(limite.esgotado('a'), false);
  assert.equal(limite.segundosRestantes('a'), 0);
});

test('limpar zera só a chave pedida', () => {
  const limite = criarLimitador({ janelaMs: 1000, maximo: 1 });
  limite.consumir('a');
  limite.consumir('b');
  limite.limpar('a');
  assert.equal(limite.esgotado('a'), false);
  assert.equal(limite.esgotado('b'), true);
});

test('limitadores diferentes não dividem a contagem', () => {
  const um = criarLimitador({ janelaMs: 1000, maximo: 1 });
  const outro = criarLimitador({ janelaMs: 1000, maximo: 1 });
  um.consumir('a');
  assert.equal(outro.esgotado('a'), false);
});

test('a faxina só tira o que venceu e zerarLimites tira tudo', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const curto = criarLimitador({ janelaMs: 1000, maximo: 1 });
  const longo = criarLimitador({ janelaMs: 5000, maximo: 1 });
  curto.consumir('a');
  longo.consumir('a');
  t.mock.timers.tick(2000);
  faxinarLimites();
  assert.equal(curto.esgotado('a'), false);
  assert.equal(longo.esgotado('a'), true);
  zerarLimites();
  assert.equal(longo.esgotado('a'), false);
});
