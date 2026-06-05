# Overgarden — Roadmap / Backlog

Visão (norte do produto): **"Overcooked na fazenda"** — rounds curtos e frenéticos
onde você atende pedidos (plantar → regar → colher → entregar) sob pressão de tempo,
sozinho ou em co-op, com caos crescente.

> Diagnóstico inicial: o jogo era "difícil e pouco divertido" porque faltava
> objetivo claro, pacing em rounds, feedback ("juice") e, mais à frente, co-op.
> A dificuldade vinha de punição sem recompensa nem direção.

---

## 🟢 Curto prazo (1–2 semanas) — tornar divertido o que já existe

**Produto**
- [x] Modo **Round** cronometrado + meta de pontos → estrelas (1–3) + tela de resultado.
- [ ] Endless/Treino como modo extra.

**Jogabilidade**
- [x] **Sistema de Pedidos** (tickets com timer; entregar = pontos + gorjeta por velocidade; expirar = penalidade).
- [x] **Rega rebalanceada**: estado "murchando" reversível antes de morrer; indicador de "precisa de água"; ramp de dificuldade no round.
- [x] **Combo/streak** por entregas rápidas (multiplicador).
- [x] **Juice**: partículas, "+pontos" flutuante, sons de entrega/erro, screenshake leve.

**Engenharia**
- [x] **Máquina de estados** (menu → jogando → resultado).
- [ ] Refatorar `game.js` monolítico em módulos (input/entities/systems/render/audio). *(adiado p/ manter o PR revisável)*
- [ ] Persistência local (high score, estrelas, settings).
- [x] Tabela de tuning central + hook de dev (`?debug`).

**Marketing**
- [ ] GIF/screenshots novos no README e itch.io; badge "▶ Play now".

---

## 🟡 Médio prazo (1–2 meses) — virar um Overcooked-like de verdade

**Produto**
- [ ] Progressão por **fases** com layouts distintos e metas de estrela; mapa de seleção.
- [ ] Tutorial guiado.
- [ ] Curva de dificuldade desenhada (cada fase introduz 1 mecânica).

**Jogabilidade**
- [x] **Co-op local** (até 4 jogadores: teclado dividido + gamepads, fazenda compartilhada) — feature definidora do gênero. *(online projetado em `docs/COOP_DESIGN.md`, a construir)*
- [x] **Suporte a gamepad** (Gamepad API).
- [ ] Cadeias de preparo mais ricas (colher → lavar/empacotar → entregar; logística de carregar 1 item).
- [ ] Hazards/eventos dinâmicos (corvos, pragas, seca, mudança de layout no meio do round).
- [ ] Variedade de pedidos (cestas com múltiplos itens, pedidos premium).

**Engenharia**
- [x] Níveis **data-driven** (`web/assets/levels.json`: canteiros, estações, pool de plantas, meta, tempo, dificuldade) + **campanha** de 6 fases com desbloqueio por estrelas e progresso salvo (localStorage). Online também usa a fase escolhida pelo host.
- [ ] **Colisão real** com estações/obstáculos.
- [x] Tick determinístico + separação de sistemas — núcleo puro `web/sim.js` (sim ≠ render/IO), compartilhado browser/servidor.
- [x] **CI no PR**: harness e2e (bot autoplayer headless) que gera evidência visual + dados de balanceamento por seed (`tests/e2e/`).
- [ ] Pipeline de assets (poço/água animados, decorações, tilemap da cena Unity).

**Marketing**
- [ ] Trailer curto + GIFs por mecânica; devlog recorrente; página de loja caprichada.

---

## 🔵 Longo prazo (3+ meses) — produto e alcance

**Produto**
- [ ] Modos: campanha + horda/endless + desafio diário/semanal com leaderboard.
- [ ] Meta-progressão (desbloqueios, cosméticos).
- [ ] Acessibilidade (remapeamento, daltonismo, modo assistido) + localização (PT/EN/ES).

**Jogabilidade**
- [x] **Co-op online** (netcode) — servidor WebSocket autoritativo + interpolação + drop-in/reconexão (`server/`, `web/net.js`; ver `docs/COOP_DESIGN.md`).
- [ ] Loja entre fases (upgrades de estação) e economia.
- [x] **Eventos/clima dinâmicos** durante a fase (chuva rega tudo, seca acelera murcha, "rush" de pedidos dourados com bônus) — opt-in por fase via `levels.json` (`events`), refletidos no servidor online. Faltam: chefes de fim de fase, fases temáticas por estação.

**Engenharia**
- [ ] **Decisão de engine**: Canvas puro vs. Phaser/Pixi vs. voltar ao Unity WebGL (reaproveitar assets/animações).
- [ ] Telemetria + funil (A/B de balanceamento); save na nuvem se houver contas.
- [ ] **PWA** (instalável/offline); otimização mobile; pipeline de release versionado.

**Marketing / distribuição**
- [ ] Portais HTML5 (Poki/CrazyGames) com rev-share; possivelmente Steam.
- [ ] Parcerias com streamers/creators; comunidade (Discord); monetização.

---

### 🎯 Milestone 1 (em andamento): "loop Overcooked mínimo"
Pedidos com timer + round + tela de estrelas + rega reversível + juice + máquina de estados.
É a fatia que mais muda a sensação do jogo e valida a direção antes de investir em co-op/fases.
