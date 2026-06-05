# Overgarden — Backlog de execução

Plano de trabalho desta leva (lobby polish · áudio/FX · fases temáticas · novos
upgrades). Cada item vira um PR coeso; o e2e por-PR e o teste de rede devem
ficar verdes, e o nível default (usado pelo harness) tem que continuar idêntico.

Legenda: ✅ feito · 🚧 em andamento · ⬜ a fazer.

## PR A — Lobby polish ✅
Resolver as arestas da UI online sem mexer no sim.
- ✅ Seletor de nº de jogadores na própria tela Online (sincronizado com o menu).
- ✅ Botão **Copiar código** (clipboard + fallback `navigator.share`).
- ✅ Lista de slots no lobby ("P1 (você) / P2 / vazio") com cores.
- ✅ Mensagem de erro de conexão ("não foi possível conectar ao servidor").

## PR B — Áudio + FX ✅
Client-side (render/áudio); sim só ganhou rótulos de cue (gameplay-neutro).
- ✅ Slider de volume + persistência (localStorage), além do mudo.
- ✅ Jingles de evento (chuva/seca/rush) e fanfarra de chefe (WebAudio).
- ✅ Cliques de UI nos botões de menu.
- ✅ FX por evento: chuva caindo + faíscas douradas no rush; tint pulsante por clima.
- ✅ Animação de revelação de estrelas no resultado (CSS).

## PR C — Fases temáticas ⬜
- ⬜ Campo `theme` por fase em `levels.json` (tint de fundo + rótulo); render aplica.
- ⬜ `theme` no estado + snapshot (online mostra igual).
- ⬜ 1–2 fases novas autoradas; recalibrar metas se mudarem throughput.
- ⬜ (Opcional) mecânica temática leve (ex.: feira = mais pedidos).

## PR D — Novos upgrades + UX ⬜
- ⬜ Upgrades novos com hook no sim: Regador Duplo (rega canteiro vizinho),
  Viveiro (começa com canteiros tratados), Comerciante (combo dura mais).
- ⬜ Glifos de controle nas dicas de interação.
- ⬜ Recalibrar metas das fases afetadas.

## Princípios
- Nível **default** sem features opt-in → harness/e2e por-PR inalterado (90/84).
- **Online vanilla**: upgrades/temas cosméticos não dão vantagem competitiva no servidor.
- Cada PR: validar `node tests/e2e/run.mjs` (default), `node tests/net/online.mjs`
  e, quando mexer em fases, `node tests/e2e/levels.mjs`.

## Fora do escopo desta leva (próximas)
- Deploy do servidor (online "de verdade" fora da rede local).
- Acessibilidade (daltonismo, remapear teclas, tamanho de texto).
- Multiplayer local no celular; chat/emotes no lobby; host kick/migration.
