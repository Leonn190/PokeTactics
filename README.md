# Poké Tactics — Astro v5 (PMD Animado)

## Animações e habilidades implementadas na v5

- As **11 espécies das famílias Bulbasaur, Charmander, Squirtle e Pikachu** usam spritesheets do PMD Sprite Repository, com proporções, 8 direções e durações de quadros lidas de `AnimData.xml`. Não existem mais fichas geométricas sobrepostas aos Pokémon.
- Na **preparação**, a animação `Idle` olha para frente; ao começar o combate, `Rotate` precede a orientação para o inimigo. Caminhada usa `Walk`; todo Pokémon no banco usa `Sleep`; golpes que retiram **mais de 20% da vida máxima num único impacto** ativam `Hurt`.
- **Bulbasaur / Ivysaur / Venusaur (ranged):** ataque básico `Shoot`. O **Morteiro de Pólen** usa `Charge` → `Shoot`, procura a concentração máxima de inimigos num raio de 1,65 casas, causa dano especial **40/60/90 + 0,70×SpA** a cada inimigo da área e cura todos os aliados vivos (incluindo o usuário) em **25/40/60 + 0,30×SpA** por aliado.
- **Squirtle / Wartortle / Blastoise (melee):** básico `Attack`. **Giro Aquático** usa `Withdraw` durante **2 s + 0,25 s para cada bloco completo de 80 SpA**; enquanto gira, causa **20/40/65 + 0,30×SpA** de dano especial por segundo aos inimigos em um raio de 1,7 casas, e recebe **20/24/30% menos dano**. Não caminha nem dá básicos durante o giro.
- **Charmander / Charmeleon / Charizard (melee):** básico `Attack`, carregado `Strike`. **Golpe Flamejante** dá um único impacto **físico** de **150/155/165% do Atk** ao alvo (mesma mecânica e animação nas três evoluções).
- **Pikachu / Raichu (melee):** básico `Attack`. **Choque do Trovão** dá dano especial de **120/130% do SpA** no alvo e encadeia **60/65% do SpA** a até **1/2 alvos adicionais** dentro de duas casas do alvo principal, sem repetir alvos.
- Os efeitos de projéteis, nuvem de pólen, espirais d'água, chamas e relâmpagos são desenhados no canvas. Chefes não incluídos nas quatro famílias continuam com sprite PNG estático até receberem spritesheets próprias.

Os valores intermediários de escala de SpA e os raios das áreas foram escolhidos nesta implementação porque não foram especificados numericamente. Podem ser balanceados em `config/ataques.json`. Arquivos e condições de uso: [ASSET_CREDITS.md](ASSET_CREDITS.md).

Para atualizar sprites de fonte oficial use `python3 scripts/fetch_pmd.py`; os quadros/direções importados ficam em `src/client/pmd-manifest.json` e os PNGs em `public/pmd/`.

Auto battler Pokémon de oito participantes (um jogador e sete CPUs), executado em Astro. O motor da partida roda em Web Worker no navegador. Não há multiplayer via rede nesta versão.

## Editando as configurações

Os **quatro JSONs na raiz `config/` são importados pelo motor no build** (não são exemplos):

| Arquivo | Responsabilidade |
| --- | --- |
| `config/pokemons.json` | Pokémon presentes no jogo, nomes por evolução, Pokédex/sprites, status, elementos, alcance, energia, habilidade, raridade e disponibilidade na loja. |
| `config/ataques.json` | Ataque físico básico e fórmulas/configurações dos golpes: alvos adicionais, área, cura, dano por segundo, duração e redução de dano. |
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

As quatro famílias iniciais usam sheets animadas em `public/pmd/` com metadados por espécie. `public/sprites/` mantém imagens PNG estáticas vindas do PokeAPI para as miniaturas da interface e para os chefes ainda sem spritesheets. Não há mais formas coloridas como fichas de batalha. Apenas as quatro famílias originais aparecem na loja; Articuno, Zapdos, Moltres, Mewtwo, Mew, Raikou, Entei, Suicune, Lugia, Ho-Oh e Celebi são os onze chefes possíveis. O jogo já conhece todos seus status e ataques.

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
- A aba **COMBATE** permite comparar vida restante, dano físico/especial, dano mitigado pela defesa e cura por Pokémon. Os números de dano sobem acima do Pokémon atingido: **laranja para físico, azul para especial**, com tamanho proporcional ao dano. A **CLASSIFICAÇÃO** permite assistir aos combates das CPUs e visualizar três opções de duelo nas preparações PvP. Seu treinador aparece como visitante ao observar outro campo.
- Durante combates quádruplos, as quatro formações ocupam **quadrantes lado a lado (2×2)** dentro de um único retângulo compartilhado. Não há um campo extra no centro. Os confrontos 1×1 mostram oponente e jogador em metades separadas.
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
