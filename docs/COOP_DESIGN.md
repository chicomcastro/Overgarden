# Co-op — Design (local 1–4 + gamepad, online depois)

> Status: **Fase 0+1+2 em implementação** (refactor de input + co-op local até 4 +
> gamepad). Online (Fase 3) é **projetado aqui, construído depois**.

## Ideia-âncora

**Toda fonte de input vira um `intent`; a simulação (autoritativa) só consome intents.**

```
teclado / gamepad / touch / rede  →  intent{ mx,my, run, interact, drop, navL, navR, confirm, pause }
                                  →  slot de jogador 0..3
                                  →  update(dt) determinístico (já existe)  →  render N players
```

Isso unifica **local e online**: a única diferença é de onde o intent vem. Já temos
`update(dt)` determinístico + RNG semeável — pré-requisitos de netcode.

## Estado (compartilhado vs por-jogador)

- **Compartilhado (time):** `score`, `orders`, `plots`, `time`, `combo`, `stats`, FX.
  É um objetivo de time (estilo Overcooked) — uma fazenda só, tela única, **sem split-screen**.
- **Por jogador:** posição, `facing`, `stamina`, `holding`/`heldSeed`/`heldPlant`,
  `anim`, `seedMenu{open,index}`, cor, device.

Aliases de retrocompat pro harness/bot: `game.player` → `players[0]`,
`game.seedMenu` → `players[0].seedMenu`. Assim o e2e segue verde sem mudança.

## Dificuldade ≠ nº de jogadores

Hoje os botões "dificuldade" eram, na real, `numberOfPlayers` (só multiplicador).
Separado em `game.difficulty` (1–4 → `DIFFICULTY_MULT`, `ORDER.diffSpawn/diffTime`)
e `game.playerCount` (1–4, jogadores de verdade).

## Mapeamento de controles

| Slot | Dispositivo | Mover | Correr | Interagir | Largar | Menu |
|---|---|---|---|---|---|---|
| 0 | Teclado A (+touch no mobile) | WASD | Shift/L-Shift | E | Q | A/D + E |
| 1 | Teclado B | Setas | R-Shift | `/` ou Enter | `.` | ←/→ + `/` |
| 2 | Gamepad 0 | stick/dpad | RB/RT | A | B | dpad + A |
| 3 | Gamepad 1 | stick/dpad | RB/RT | A | B | dpad + A |

Atribuição determinística: `[tecladoA, tecladoB, gamepad0, gamepad1, …]` → slots `0..count-1`.
Teclado satura em 2 → 3–4 jogadores exigem gamepad. Single-player: slot 0 aceita
WASD **e** setas (preserva o atual + harness).

Distinção visual: anel colorido + número por jogador (sem tint de sprite).
Stamina vira mini-barra sob cada personagem no co-op (barra grande só no solo).

## Menu de semente

De **fullscreen** (bloqueia) para **strip compacto por jogador** acima da cabeça
(navega ←/→, confirma; só aquele jogador fica parado, os outros seguem). Estado
`seedMenu{open,index}` por jogador — bot/harness continuam navegando o slot 0.

## Balanceamento co-op (1ª passada — afinar com harness multi-bot)

`COOP.spawnScale` (pedidos mais rápidos), `COOP.concurrentBonus` (mais pedidos
simultâneos), `COOP.starScale` (metas de estrela sobem com nº de jogadores).
Solo mantém os números atuais (fator 1). **TODO:** estender o bot/harness pra
dirigir N slots e gerar dados 2p/3p/4p (mesmo método do solo).

## Fase 3 — Online (projeto, construir depois)

- **WebRTC DataChannel P2P** (sem servidor de jogo; só *signaling* leve + **código de sala**),
  fallback WebSocket relay; TURN se NAT exigir.
- **Host-autoritativo:** host roda a sim; clientes mandam intents (~30Hz) e recebem
  snapshots (~15–20Hz) com interpolação. Robusto em rede móvel; não precisa rollback
  (jogo cooperativo, não competitivo frame-perfect).
- Remoto entra pelo **celular** (touch) na fazenda do host. Drop-in/out.
- A arquitetura de intents deixa isso plugável: um "remote input source" preenche
  um slot; o "remote renderer" desenha snapshots. Sem reescrever o core.
