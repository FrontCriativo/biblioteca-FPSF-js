// Cancela as pré-reservas vencidas. O servidor já faz isso a cada requisição: este script
// serve para uma rotina agendada, ou para quando o site ficou um tempo sem acesso.

import { expirarReservasVencidas } from '../repositorio.js';

const canceladas = expirarReservasVencidas();
console.log(`${canceladas} pré-reserva(s) vencida(s) cancelada(s).`);
