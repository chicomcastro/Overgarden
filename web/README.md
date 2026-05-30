# Overgarden — versão web

Reimplementação em **HTML5 Canvas + JavaScript puro** (sem dependências, sem build)
do loop de gameplay do Overgarden, originalmente feito em Unity para a Ludum Dare 46.
Usa os **sprites e áudios originais** do projeto Unity.

O projeto Unity original gera a versão web via build WebGL (disponível no
[itch.io](https://chicomcastro.itch.io/overgarden)). Esta pasta é uma porta
leve e autocontida que roda direto no navegador a partir de arquivos estáticos.

## Jogar online

Deploy automático no GitHub Pages a cada push na `master`:
**https://chicomcastro.github.io/Overgarden/**

## Como rodar

É só abrir `index.html` no navegador. Para evitar restrições de `file://`,
o ideal é servir a pasta:

```bash
cd web
python3 -m http.server 8000
# abra http://localhost:8000
```

Qualquer servidor estático funciona (`npx serve`, etc.). Não há etapa de build.

## Controles

| Ação | Tecla |
|------|-------|
| Mover | `W` `A` `S` `D` (ou setas) |
| Correr | segurar `SHIFT` (consome stamina) |
| Interagir | `E` |
| Largar item | `Q` |
| Pausar | `P` |

No menu de sementes: `A`/`D` navega, `E` escolhe.

## Como jogar

Loop infinito de fazenda — some pontos:

1. **Ferramentas** 🛠️ → pegue a enxada e prepare a terra (`E` num canteiro virgem).
2. **Sementes** 🌱 → escolha uma semente (raridades diferentes crescem em ritmos diferentes).
3. Plante na terra preparada.
4. **Poço** 🪣 → pegue água e **regue** os canteiros antes que a vida zere (a planta morre 🥀).
5. Quando a planta fica pronta (anel dourado), **colha** com as mãos vazias.
6. **Vendas** 📦 → deposite a colheita: **+20** na hora e **+100** a cada venda automática (1 a cada 5s).

A dificuldade (Fácil → Insano) controla o multiplicador de tempo de crescimento e
de decaimento de vida, espelhando o sistema de "número de players" do jogo original.

## Mecânicas portadas

Reproduzidas a partir dos scripts C# originais:

- Movimento + stamina/corrida — `Player.cs`, `StaminaBar.cs`
- Estágios de crescimento e barra de vida dos canteiros — `StageScript.cs`, `LifeBar.cs`
- Itens na mão (`NOTHING`/`SEED`/`WATER`/`TOOL`/`PLANT`) — `EventsManager.cs`
- Seleção de sementes ordenada por raridade — `SeedStallManager.cs`
- Caixa de vendas que vende ao longo do tempo — `SalesManager.cs`
- Dados das plantas (nome/raridade) — `Assets/Plants/*.asset`

## Assets

Os PNGs em `assets/img/` e os áudios em `assets/audio/` são extraídos do projeto
Unity. As spritesheets (personagem, plantas) são recortadas em runtime usando os
retângulos definidos em `assets/atlas.json`, gerado por
[`extract_web_assets.py`](../extract_web_assets.py) (na raiz do repositório):

```bash
python3 extract_web_assets.py   # lê Overgarden/Assets/*, escreve web/assets/*
```

O script lê as dimensões dos PNGs direto do header IHDR e os rects de sprite dos
arquivos `.meta` do Unity (origem bottom-left convertida para top-left), sem
dependências externas. O áudio de ambiente do rio (`rio.wav`, 16 MB sem compressão)
foi omitido de propósito por ser pesado demais para a web.
