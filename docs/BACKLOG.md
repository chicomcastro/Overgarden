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

## PR C — Fases temáticas ✅
- ✅ `theme` por fase (spring/summer/autumn/night): cor de chão + overlay de mood; "default" = visual original (e2e intacto).
- ✅ `theme` no estado + snapshot (online mostra o mesmo clima).
- ✅ Fase nova: **Pomar Noturno** (night, 7 canteiros, diff 3, rain+rush, chefe).
- ✅ Mercado: estações normalizadas (cantos extremos quebravam bot e fluidez); Estufa: só rush (seca+chefe junto craterava).
- ✅ Metas em **curva monotônica à mão** (bot subrepresenta fases de muitos canteiros; ★1 verificado alcançável pelo bot como piso de "campanha completável").

## PR D — Novos upgrades + UX ✅
- ✅ Upgrades novos com hook no sim: **Regador Duplo** (rega o vizinho mais carente),
  **Viveiro** (começa com N canteiros tratados), **Comerciante** (combo dura +2.5s/nível).
- ✅ Glifos de controle nas dicas de interação (E · / · ↵ · Ⓐ conforme o dispositivo).
- ✅ Sem recalibração: upgrades só valem no offline com o item comprado (headless = identidade).

---
**Backlog desta leva concluído.** Próximas frentes (fora do escopo): deploy do
servidor, acessibilidade, multiplayer local no celular, host kick/migration.

## Princípios
- Nível **default** sem features opt-in → harness/e2e por-PR inalterado (90/84).
- **Online vanilla**: upgrades/temas cosméticos não dão vantagem competitiva no servidor.
- Cada PR: validar `node tests/e2e/run.mjs` (default), `node tests/net/online.mjs`
  e, quando mexer em fases, `node tests/e2e/levels.mjs`.

## Fora do escopo desta leva (próximas)
- Deploy do servidor (online "de verdade" fora da rede local).
- Acessibilidade (daltonismo, remapear teclas, tamanho de texto).
- Multiplayer local no celular; chat/emotes no lobby; host kick/migration.
