# Poké Tactics — Astro v6 (integração com assets existentes)

## IMPORTANTE: pacote de código SEM sprites PMD e portraits

Este ZIP foi preparado para **atualizar o projeto existente no GitHub**,
[Leonn190/PokeTactics](https://github.com/Leonn190/PokeTactics).
**Não substitua nem apague as pastas de assets do repositório**. Elas já existem
e são referenciadas diretamente pelo código:

- `public/sprite/0001/Idle-Anim.png` e demais `public/sprite/<DEX>/...`
- `public/portrait/0001/Normal.png` e demais `public/portrait/<DEX>/Normal.png`
- `public/tipos/grass.svg`, `fire.svg`, `water.svg`, `electric.svg` etc.
- `public/sprites/` para os lendários com miniaturas estáticas.

O pacote contém apenas o manifesto de metadados de animação
`src/client/pmd-manifest.json`. Não baixa nem distribui spritesheets, portraits
ou SVGs. Extraia o ZIP e copie **o conteúdo da pasta `poke-tft/` para a raiz
do checkout do GitHub**, mesclando os arquivos de código, sem usar opções de
espelhamento que excluam pastas ausentes do ZIP.
Caso teste o ZIP isoladamente, os assets visuais ficarão ausentes até que ele
seja combinado com a árvore `public/` original.

## Mudanças v6

- Pokémon das famílias Bulbasaur, Charmander, Squirtle e Pikachu (11 espécies) usam `Idle`, `Rotate`, `Walk`, `Sleep`, `Hurt`, `Attack`, `Shoot`, `Charge`, `Strike` ou `Withdraw` conforme ação e disponibilidade no XML do PMD; os frames, durações e direções são lidos do manifesto.
- O **Giro Aquático** do Squirtle, Wartortle e Blastoise usa `Withdraw` enquanto gira entre as oito direções, aplica dano por segundo e uma mitigação temporária fixa; não ataca nem se desloca durante a canalização.
- Bulbasaur é ranged, com **Morteiro de Pólen** em área e cura para aliados. Charmander é melee, com **Golpe Flamejante** físico em alvo único. Pikachu é melee, com **Choque do Trovão** e encadeamento por evolução. As fórmulas estão em `config/ataques.json`.
- **Nenhuma sinergia de combate está ativa**: tipos não concedem regeneração, bônus de ataque, resistência, velocidade ou veneno. Contagem dos tipos é apenas informativa. A influência intencional na probabilidade da loja permanece.
- Os sprites ficam ancorados no **último pixel opaco inferior**, com sombra no chão e nível/vida/energia posicionados em relação ao topo visível; sem nomes embaixo das unidades.
- Banco gramado integrado, com **mesma largura do tabuleiro**. Combate de 3–4 jogadores vira dois tabuleiros `7×8` unidos lateralmente, formando `14×8`.
- Classificação mostra somente `⚔` nos adversários possíveis, sem painel extra de probabilidades.
- Loja com chances à esquerda e barra de tipagem à direita **na mesma altura**. Portraits PMD nos cards, inspetor, painel de combate e ao arrastar. Ícones SVG redondos nos tipos da loja, barra e painel lateral.

As spritesheets originais e suas condições de uso/créditos pertencem ao
[PMD Sprite Repository](https://github.com/PMDCollab/SpriteCollab).

Auto battler Pokémon de oito participantes (um jogador e sete CPUs), executado em Astro. O motor da partida roda em Web Worker no navegador. Não há multiplayer via rede nesta versão.

## Editando as configurações

Os **quatro JSONs na raiz `config/` são importados pelo motor no build** (não são exemplos):

| Arquivo | Responsabilidade |
| --- | --- |
| `config/pokemons.json` | Pokémon presentes no jogo, nomes por evolução, Pokédex/sprites, status, elementos, alcance, energia, habilidade, raridade e disponibilidade na loja. |
| `config/ataques.json` | Ataque físico básico; fórmulas e efeitos de habilidades (drenar, queimar, reduzir velocidade, atingir segundo alvo, dano direto). |
| `config/fases.json` | Sequência das dez etapas de cada capítulo, escalonamento dos bot PvE e IV/nível dos chefes lendários. |
| `config/regras_gerais.json` | Ouro, juros, streak, dano, bônus, temporizadores, limites, chances da loja, progressão de nível e fórmula de status. |

`server/data.ts` normaliza esses dados para motor e HUD. `server/engine.ts` administra progressão, compra e economia; `server/systems/combat.ts` simula as batalhas 1×1, PvE e múltiplas. `src/client/arena.ts` desenha o campo físico e `src/client/hud.ts` desenha os painéis.

## Novas regras de nível, loja e tipagem (v4)

- O jogador inicia no nível 1 e sobe automaticamente para **2 na etapa 1-3**, **3 na 1-7**, **4 na 2-2**, **5 na 2-6** e **6 na 3-1**. Para capítulos posteriores permanece no 6 até serem definidos novos marcos. As rodadas absolutas são `[1,3,7,12,16,21]` em `levelMilestones`.
- Todos os Pokémon começam no nível 1: quem estava em campo ao término do combate recebe **+2 níveis**, quem estava no banco recebe **+1 nível** (respeitando `maxPokemonLevel`). Cada nível *acima do primeiro* acrescenta **4%** aos status, preservando os fatores independentes de IV e evolução.
- Probabilidades da loja por nível (comum / incomum / raro / épico / lendário): `38/33/29/0/0`, `36/33/30/1/0`, `32/34/31/3/0`, `29/31/32/7/1`, `26/29/34/10/2`, `25/27/31/15/3`. Os valores fornecidos nos níveis 5 e 6 totalizam **101** devido a arredondamento; os percentuais exibidos reproduzem a configuração, e o sorteio usa esses números como pesos **normalizados**. O nível 6 vale para níveis posteriores até existir outra tabela.
- A raridade é sorteada primeiro e o tipo altera os **pesos relativos das espécies dentro da raridade**, sem alterar o preço/raridade. Como ainda não há espécies épicas na loja e os 11 lendários são chefes PvE, pesos de raridades indisponíveis são redistribuídos proporcionalmente entre as raridades com espécies lançadas. Quando você cadastrar um novo Pokémon com `shop:true`, a raridade começa a funcionar automaticamente.
- Influência de tipagem: cada tipo de um Pokémon **ativo vale 2 pontos** e cada tipo do **banco vale 1**. A barra apresenta as cinco maiores participações. O bônus individual do tipo é `participação × 0,5`; Pokémon de dois tipos usam **maior bônus + metade do bônus menor**. Assim, uma influência de 50% Água (+25%) e 30% Planta (+15%) rende **+32,5%** de peso relativo para um Pokémon Água/Planta. Esses multiplicadores estão em `typeShopBias`.
- Confrontos PvP: o motor prepara **três calendários completos**, penalizando duelos repetidos, e sorteia um deles com **1/3 de chance** quando começa a luta. A classificação mostra as três possibilidades; sua arena não apresenta antecipadamente nenhuma formação inimiga. Quando só restam dois jogadores, os três calendários necessariamente representam o mesmo adversário; em batalhas a três/quatro, cada opção contém um *grupo* de possíveis adversários. PvE não usa sorteio de adversário.

As imagens PNG e as spritesheets estão no repositório original e **não são redistribuídas neste ZIP**. As quatro famílias da loja usam animações PMD no campo e portraits PMD nos painéis. Os lendários mantêm imagens estáticas até receberem animações próprias. Apenas as quatro famílias originais aparecem na loja; Articuno, Zapdos, Moltres, Mewtwo, Mew, Raikou, Entei, Suicune, Lugia, Ho-Oh e Celebi são os onze chefes possíveis.

## Rodadas

Cada capítulo tem exatamente dez etapas:

| Etapa | Tipo | Regra especial |
| --- | --- | --- |
| 1 | Batalha | Combate normal. |
| 2 | Ouro | Cada nocaute gera uma moeda de ouro para o lado que realizou o nocaute; vencedor recebe mais 4 ouro. |
| 3 | Batalha | Combate normal. |
| 4 | Quádrupla | Quatro jogadores na arena compartilhada. |
| 5 | Bot PvE | Enfrenta uma equipe de Pokémon controlada pelo jogo. |
| 6 | Batalha | Combate normal. |
| 7 | Ouro | Mesmo sistema da etapa 2. |
| 8 | Batalha | Combate normal. |
| 9 | Dano em dobro | Multiplica por dois o dano de derrota da rodada. |
| 10 | Chefe PvE | Um dos 11 lendários/míticos das gerações 1 e 2. |

- Preparação: 40 s. Combate: até 30 s normalmente, acelerando 3× depois para resolver lutas prolongadas. Resultados: 3,2 s.
- Dano normal ao perdedor: **capítulo + 1 + número de Pokémon sobreviventes do vencedor**. Ex.: no capítulo 1, 2 + sobreviventes. Na etapa 9, todo esse dano dobra.
- Quádrupla: primeiro não recebe dano; segundo recebe `capítulo + 1 + 1`; terceiro recebe `capítulo + 1 + 4`; quarto recebe `capítulo + 1 + 7`. **Não há dano adicional por sobreviventes** nessa etapa. Primeiro conta vitória; quarto conta derrota; segundo e terceiro **preservam** o streak atual e não recebem o bônus de vitória.
- PvE: cada jogador tem seu próprio confronto com bot. Na etapa 10 o chefe tem nível 100 e IV 50 em cada status no capítulo 1, nível 200/IV 75 no capítulo 2 e nível `100 × capítulo`/IV 100 a partir do capítulo 3. Os chefes continuam escalando além do nível 100.
- Quando restam três jogadores, ocorre uma batalha a três para evitar uma folga injusta. Nas etapas quádruplas com menos de quatro sobreviventes são formados os grupos possíveis; um duelo a dois usa o dano normal.
- Se várias eliminações zerarem todos os jogadores numa mesma rodada, o jogador de maior HP antes do dano é preservado com 1 HP para haver um campeão. Empates de confronto no limite de tempo são resolvidos pela vida restante.

## Economia

Cada nova rodada (a partir da segunda) concede:

`5 de base + min(5, floor(ouro_atual / 10)) de juros + (1 se venceu a rodada anterior) + bônus de streak`.

O streak conta tanto vitórias quanto derrotas consecutivas: 2→+1 ouro, 3→+2, 4→+3, 5 ou mais→+4. Renda é calculada com o ouro **antes** de receber a renda da rodada; os bônus de 4 ouro e moedas da rodada de ouro chegam após a batalha. Ouro inicial: 9. Reroll da loja: 2 ouro.

Na rodada de ouro, cada nocaute cria uma moeda **na posição onde o Pokémon caiu**. O lado que causou o KO pode recolhê-la. **Clique nas moedas amarelas na arena durante a batalha ou na tela de resultado para coletar.** Moedas de CPUs são coletadas automaticamente, e moedas não coletadas somem na próxima rodada.

## Interface e controles

- A arena é gramada e **as casas hexagonais aparecem somente enquanto você segura um Pokémon** para posicioná-lo. Há um banco físico de pedra de 10 posições no campo; durante duelos também aparece o banco adversário na parte superior.
- O painel flutuante superior tem dez pontos por capítulo: **azul = vitória, vermelho = derrota, amarelo = etapa atual, cinza = colocação neutra ou etapa futura**. Ele também exibe etapa (`4-3`), modo, fase, segundos restantes e uma barra de tempo na parte inferior.
- Arraste Pokémon para reposicionar entre campo e banco. Soltar sobre a loja vende; dois cliques num Pokémon no banco tentam colocá-lo em campo. Compras, venda, reroll e rearranjo do banco são permitidos durante combate (sem mover Pokémon já em campo).
- Clique direito move seu treinador; scroll aplica zoom. Tecla `D` roleta loja; `E` vende o selecionado; `Esc` volta a observar seu campo.
- A aba **COMBATE** permite comparar vida restante, dano físico/especial, dano mitigado pela defesa e cura por Pokémon. Os números de dano sobem acima do Pokémon atingido: **laranja para físico, azul para especial**, com tamanho proporcional ao dano. A **CLASSIFICAÇÃO** permite assistir aos combates das CPUs e marca possíveis adversários somente com o ícone ⚔.
- Durante combates quádruplos, **duas arenas 7×8 lado a lado** formam um campo retangular 14×8, com duas equipes em cada arena (uma metade superior, uma inferior). Confrontos com três participantes também usam este espaço estendido. Os confrontos 1×1 mantêm uma arena 7×8.
- Passe o mouse ou dê foco por teclado à **RENDA** para consultar base, juros, streak, bônus de vitória e o total previsto.

## Executar e publicar

```bash
npm ci
npm run check
npm test
npm run build
npm run dev
```

O workflow GitHub Actions existente publica uma build estática no GitHub Pages. O base path é calculado pelo `astro.config.mjs` conforme `GITHUB_REPOSITORY` (ou definido manualmente com `PUBLIC_BASE_PATH`). Os JSONs são empacotados no código durante o build: **editar um JSON requer recompilar/publicar** para aplicar as alterações.
