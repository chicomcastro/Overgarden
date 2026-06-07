# Revisão de assets — coesão

Diagnóstico (jun/2026) e plano pra deixar a arte coesa em paleta, dimensão e
contraste.

## Diagnóstico
Três estilos de renderização conviviam:
- **Cultivos + tiles** (grama/terra/cerca): pixel art nítido, paleta limitada, ~32px. **É o estilo-alvo.**
- **Personagem**: sprite suave/anti-aliased (~57–97px), sombra em gradiente — destoa.
- **Itens** (pá/balde/saco/sementes): cartoon semi-realista, 64–82px — destoa; `item_bag` tinha fundo escuro "queimado" (não transparente).
- `ui_logo.png` era 3464×3464 (~500 KB).

Eixos do problema: **dimensão** (texel inconsistente por reescala em fatores
diferentes), **paleta** (sem rampa-mestra; cada asset de um pacote) e
**contraste** (verde-sobre-verde; fundo do saco).

## Pipeline de re-paleta (`tools/repalette.mjs`)
Usa o Chromium do playwright só como decodificador/codificador PNG (sem novas deps).
- Extrai uma **paleta compartilhada** (64 cores) de **todos** os sheets, então
  as cores próprias do personagem/itens (pele/cabelo/roupa) sobrevivem.
- Nos **outliers** (personagem + itens): snap pra paleta + **endurecimento de
  borda** (alpha threshold) → tira o anti-aliasing pintado, aproxima do pixel art.
- **Cultivos/tiles ficam intactos** (já são o alvo) e **dimensões/atlas não mudam**.
- Remove o **fundo do `item_bag`** (cor mais comum da borda externa → transparente).
- **Reduz o logo** pra ≤512px.

Rodar: `node tools/repalette.mjs` (ou `--dry` só pra ver a paleta). É idempotente
o suficiente; os originais ficam no histórico do git caso queira reverter.

## Pass de coesão no código (render)
Complementa o pipeline sem nova arte: sombra "grounded" sob cultivos/itens, chão
base menos saturado, âncora do personagem normalizada, uso do logo reduzido.

## Limite honesto
Isto **harmoniza** o que existe (paleta + bordas + contraste). A diferença de
**densidade de texel** (personagem nativo em resolução maior que os cultivos de
32px) só some de vez com arte redesenhada na mesma grade, ou adotando um pacote
único — anotado pra quando houver decisão de arte.
