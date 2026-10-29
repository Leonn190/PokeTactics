# PokéTactics v16 — implementação

## Instalação

Copie as pastas `config/`, `server/` e `src/` deste ZIP para a raiz do projeto Astro existente, mantendo as demais pastas do repositório (`public/`, `package.json`, testes existentes e scripts). Não substitua a pasta `public/`: ela não acompanha esta distribuição parcial.

## Conteúdo

- **Dratini → Dragonair → Dragonite**, raridade 3: alcances 4/2/1, ataques básicos especiais nos dois primeiros e físico no último. Habilidades Sopro Dracônico, Ciclone Dracônico (área/slow) e Tempestade Dracônica (3 ondas e levantamento com reação de Cubone/Marowak).
- **Diglett → Dugtrio**, raridade 1: Escavação Surpresa com escolha determinística do inimigo mais distante, busca por destino livre, posição alterada de fato, dano somente ao emergir, ocultação durante trajeto e rastro/projeção de terra desenhados proceduralmente conforme o relógio da simulação.
- **Mew**, raridade 5, comprável por 5 de ouro, alcance 5: Bênção Primordial seleciona o aliado com menor porcentagem de HP, aplica cura, barreira e buff especial de 3 segundos. O bônus é calculado com o SpA de Mew na aplicação, tem duração de simulação, renova sem empilhar e só ocorre no impacto de ataques básicos válidos. Mew chefe PvE mantém uma configuração própria (base, ataque, energia e alcance) e continua na lista de chefes.
- **Ranking**, estados individuais e autoritativos `Batalhando...`, `Vitorioso`, `Derrotado`; sem rótulos durante preparação. Pontinhos animados em CSS, com suporte a movimento reduzido e atualizações das linhas sem reiniciar a animação a cada snapshot.
- **Versão 16** exibida no menu inicial.

## Arquivos principais alterados

- `config/pokemons.json`, `config/ataques.json`, `config/animacoes.json`.
- `server/types.ts`, `server/data.ts`, `server/systems/combat.ts`, `server/systems/effectiveness.ts`, `server/engine.ts`, `server/damage-preview.ts`, `server/combat/effects.ts`.
- `src/client/arena.ts`, `src/client/hud.ts`, `src/client/menus.ts`, `src/client/render/effects.ts`, `src/styles/global.css`, `src/pages/index.astro`.
- Novos módulos: `src/client/render/burrow.ts`, `src/client/vfx/v16-effects.ts`.
- Testes de regressão: `tests/v16.test.cjs`, `tests/tsconfig.full.json`, `tests/tsconfig.server.json`, `tests/import-meta-env.d.ts`.

## Testes realizados

No ambiente de criação, com `tsc` global e Node 22:

```bash
tsc -p tests/tsconfig.full.json --pretty false
tsc -p tests/tsconfig.server.json --pretty false
node --test tests/v16.test.cjs
```

Resultado: verificação TypeScript sem erros; **10/10 testes de simulação aprovados** (cadastro/raridades/loja, chefe Mew, dig/emersão, Dragonite/Marowak, Mew buff físico e especial, ranking, evolução/fusão, Dragonair e alvo morto durante escavação).

### Limites da entrega

O ZIP de entrada inclui apenas `config/`, `server/`, `src/` e não inclui `package.json`, dependências Astro ou `public/` com os sprites e sheets PMD. No manifesto PMD recebido, os IDs **0050, 0051, 0147, 0148, 0149 e 0151 não constam**. O renderer usa imagens estáticas locais quando disponíveis, com fallback remoto à imagem oficial de sprites da PokeAPI caso a imagem local falhe. Não foram inventados sprites PMD. O rastro subterrâneo, ondas dracônicas e aura de Mew são procedurais e não dependem de novas sheets. O comportamento PMD completo dos seis Pokémon dependerá da adição dos assets/manifests corretos em `public/` no repositório principal.

Por ausência da árvore Astro completa, **não foi possível executar `npm run build`, `npm run check` ou validar FPS e animação final no navegador**. Depois de copiar as três pastas no projeto integral, execute `npm ci`, `npm run check`, `npm test` e `npm run build` (conforme os scripts disponíveis no projeto), e teste as habilidades visualmente.

As chances gerais da loja, fórmulas de atributos, economia e temporizadores de partida foram preservados.
