# Organização — manual de desenvolvimento do PokéTactics (V20.7)

> **Leitura obrigatória para agentes e desenvolvedores.** Este manual descreve a arquitetura efetiva da V20.3. Leia também `AGENTS.md`. Antes de seguir um caminho mencionado aqui, confira se a implementação ainda existe: o código prevalece sobre descrições históricas.

## 1. Modelo do projeto

PokéTactics é um jogo de estratégia automática inspirado em batalhas táticas por rodadas: preparação, loja, evolução, itens, augments, sinergias, combates e observação de arenas. A simulação acontece **localmente** em um Web Worker, com tempo lógico fixo, enquanto o cliente desenha sprites PMD, interface, câmera e efeitos no navegador. A comunicação é feita por comandos e snapshots.

A divisão fundamental é:

- **`config/` — parâmetros e balanceamento:** dados editáveis em JSON: Pokémon, etapas, habilidades, alcances, loja, economia, itens, augments, sinergias, fases, animações, espólios e renderização. Ajustes numéricos já configuráveis devem ser feitos aqui. Nem todo algoritmo pertence ao JSON.
- **`server/` — simulação autoritativa local:** regras, decisões dos bots, combate, dano, cura, movimento, física, economia, fases, evolução, eventos e snapshots. **Não há backend online em operação.** O Worker executa hoje uma lógica projetada para futuramente ser reutilizável em um backend autoritativo. Não implementar comunicação multiplayer por antecipação.
- **`src/` — cliente e apresentação:** página Astro, inicialização, menus, HUD, arena, animações, interpolação, efeitos, configurador visual e CSS. Consome os estados do motor; não deve decidir dano, cura, aleatoriedade da batalha ou vitória.
- **`public/` — acervo de assets:** sprites, retratos, dados PMD e demais imagens com seus créditos. Nunca apagar ou baixar novamente o acervo só para fazer uma atualização de código.
- **`scripts/` — ferramentas de manutenção:** geração de manifesto PMD, migrações históricas e validação estática dos dados. Não é parte da simulação em tempo real.
- **`.github/workflows/` — integração e publicação:** a verificação de PR roda validação de JSON, TypeScript e build; a publicação gera o site estático. Não confundir GitHub Pages com backend de partidas.

## 2. Mapa operacional dos sistemas

| Sistema | Implementação principal | Responsabilidade e fronteira |
| --- | --- | --- |
| Orquestração da partida | `server/engine.ts`, `server/chapter-timers.ts` | Jogadores, preparação, capítulos, comando, compra, evolução, resultado |
| Worker e relógio | `server/sim.worker.ts`, `server/types.ts` | Passos lógicos fixos e contratos `ClientToServer`/`ServerToClient`; não depende do desenho |
| Criação e execução do combate | `server/systems/combat.ts` | Estado da batalha, habilidades complexas legadas e sequência de execução; reduzir gradualmente a centralização |
| Chamas orbitais | `server/combat/flame-orbits.ts` | Contato contínuo, cargas e reaplicação; reutiliza dano e atributos do motor por callbacks sem duplicá-los |
| Seleção e ranking de alvos | `server/combat/targeting.ts` | Prioridades determinísticas, agrupamentos, curas e contagem de ameaças |
| Efeitos e cura reutilizáveis | `server/combat/effects.ts`, `server/combat/healing.ts` | Eventos visuais originados pela simulação e aplicação de cura |
| Física | `server/systems/physical-collision.ts` | Colisão entre corpos com tamanhos definidos no JSON |
| Fórmulas de atributos e dano | `server/formulas.ts`, `server/systems/effectiveness.ts`, `server/systems/combat.ts` | Cálculos e efetividade; não criar versões paralelas no cliente |
| Configuração normalizada | `server/data.ts`, `config/*.json` | Leitura, valores efetivos e cache de etapas; alterações de balanceamento pertencem aos JSONs |
| Loja | `server/shop.ts`, `server/engine.ts` | Sorteio, raridades e economia, conforme `regras_gerais.json` |
| Itens e espólios | `server/systems/items.ts`, `inventory.ts`, `loot.ts` | Composição, efeitos, inventário e recompensas |
| Augments | `server/systems/augments.ts`, `src/client/augments.ts` | Efeitos na simulação e escolha/apresentação no cliente |
| Sinergias | `server/systems/synergies/registry.ts`, `counting.ts`, `stats.ts`, `periodic.ts`, `combat-events.ts`, `positioning.ts` | Contagem, bônus, habilidades, posicionamento e execução periódica |
| Visualização da arena | `src/client/arena.ts`, `src/client/scene/`, `src/client/render/` | Câmera, cenário, elementos físicos, sombras, projéteis e desenho |
| Sprites e animações | `src/client/animation/`, `src/client/pmd-manifest.json` | Sprites PMD, interpolação, perfis e eventos; manifesto gerado via script |
| Efeitos e números flutuantes | `src/client/vfx/`, `src/client/damage-labels.ts` | Representação visual de eventos do motor |
| Interface e menus | `src/client/main.ts`, `hud.ts`, `menus.ts`, `src/styles/global.css` | Entrada, HUD, seleção de arena e menus |
| Configurador V20 | `src/client/configurator/editor.ts`, `state.ts`, `preview.ts`, `descriptions.ts`, `zip.ts`, `editor.css` | Edição local, prévia animada, validação, preservação e exportação de JSONs em ZIP |
| Profiler F3 | `src/client/performance/profiler.ts`, `frame-scheduler.ts` | Métricas leves de renderização e diagnóstico de desempenho |
| Validar configurações | `scripts/validate-config.mjs` | Validação estática de referências e invariantes, sem escrita e sem testes de regressão |

**Dependência desejada:** `src/client` interpreta snapshots e os dados de `server/data.ts` para apresentação; `server/engine.ts` orquestra módulos `server/systems` e `server/combat`. Os contratos de dados ficam em `server/types.ts`. Bibliotecas de desenho não devem entrar no motor.

## 3. Como adicionar um Pokémon

1. Verifique se a família e as formas já existem em `config/pokemons.json`; não crie duplicata com nome diferente.
2. Configure `names`, `pokedexIds`, `rarity`, `shop`, `elements`, `stageBases`, `stages`, `physicalSizes` e `evolutionCopies` conforme a estrutura real. A raridade determina as regras atuais da loja; `shop` diz se o Pokémon é sorteável diretamente.
3. Confira o golpe apontado por `attack`, `stages[].move` e eventual `bossMove` em `config/ataques.json`. Reutilize efeitos existentes antes de implementar outro.
4. Para uma habilidade nova, procure primeiro efeitos genéricos em `server/combat/`, `server/systems/combat.ts`, e handlers de augments ou sinergias que já executem o comportamento.
5. Verifique `config/animacoes.json`, `src/client/animation/visual-profiles.ts` e as animações reais do manifesto `src/client/pmd-manifest.json`. Uma animação inexistente não deve ser inventada.
6. Verifique sprites e portraits dentro de `public/`. `scripts/generate-pmd-manifest.mjs` lê os metadados existentes; ele não baixa assets.
7. Rode `npm run validate:config`, `npm run check` e `npm run build`; inspecione loja, evolução, alcance, PMD e animações.

**Não crie um arquivo por Pokémon automaticamente.** Separe lógica por mecânica compartilhada ou comportamento realmente grande e exclusivo. A família é identificada por configuração, não por dezenas de dependências de arquivo.

## 4. Habilidades e combate

- **Primeiro:** encontre a definição e parâmetros em `config/ataques.json` e a execução em `server/systems/combat.ts` ou seus auxiliares. Confirme o `effect` já cadastrado e os campos consumidos por `server/data.ts`.
- **Depois:** reutilize cálculo, dano/mitigação, cura, barreira, seleção de alvos, movimento, projéteis e eventos. Regras que podem ser representadas por parâmetros não devem ser reimplementadas em `if` exclusivos.
- **Só então:** extraia uma mecânica complexa para `server/combat/` ou uma subpasta coerente caso a separação realmente reduza dependências. Não crie registry paralelo ao despacho já existente.
- Preserve ordem de ticks, critérios de desempate, consumos de RNG, interrupções, prioridades, identificadores e condições de morte. Otimizações não podem alterar o resultado nem a duração dos efeitos.
- **Atenção:** `server/systems/combat.ts` ainda contém habilidades especializadas. Refatore-o gradualmente, com inspeção de cada contrato; não mova centenas de linhas sem conseguir comprovar estabilidade.

## 5. Balanceamento e fonte de verdade

Edite números preferencialmente nos JSONs de `config/` ou no configurador visual V20. **Confira que o motor lê o campo** antes de prometer um efeito. `server/data.ts` normaliza e deriva dados: por exemplo, `rangeClass` define o alcance efetivo por `getStageData`; dados legados de `range` podem continuar existindo por compatibilidade. A classificação/range e a aparência/projétil não devem ser misturados.

O configurador de `src/client/configurator/` preserva conteúdo não modificado e exporta os caminhos `config/*.json` dentro de um ZIP; não invente outro formato. O código de acesso visual presente no cliente **não é autenticação segura**. A validação do editor está em `state.ts`; a validação estática do checkout está em `scripts/validate-config.mjs`. Nenhuma delas pode alterar arquivos silenciosamente.

## 6. Visual e arena

- `src/client/arena.ts` coordena a cena; reutilize `src/client/scene/`, `src/client/render/`, `src/client/vfx/` e `src/client/animation/` antes de criar camadas.
- O mundo físico acompanha a câmera/zoom. **A área de itens é física na arena, não um componente fixo do HUD.**
- Sombras respeitam `visual-profiles.ts` e o PMD. Diglett/Dugtrio não devem receber sombras ou buracos adicionais incoerentes.
- Mantenha sprites animados, orientação/Rotate quando aplicável, interpolação, reações a golpes, efeitos de cura e barra de vida. Não substitua animações por PNGs estáticos.
- Antes de adicionar CSS, procure a declaração já existente em `src/styles/global.css`, `src/client/configurator/editor.css`, `src/client/augments.css` ou `src/client/synergies/synergies.css`. Evite seletores conflitantes e arquivos minúsculos.
- Confira a aparência em preparação, combate, observação de outra arena e lutas com múltiplos jogadores.

## 7. Regras contra arquivos e lógica desnecessários

Antes de criar arquivo, pasta, classe, helper ou registry: procure o sistema proprietário. Não duplique fórmulas de dano, alvo, condições de vitória, CSS, schemas de snapshot ou chaves de JSON. Não crie uma abstração genérica para uma única chamada trivial. Prefira alterações mínimas e nomes de responsabilidade clara.

**Quando dividir:** funções com estado próprio, responsabilidades independentes ou muitas dependências em sentidos contrários justificam um módulo; quantidade de linhas isoladamente não. Uma função orquestradora deve delegar comportamento real, não criar wrappers vazios. Refatoração estrutural não é licença para mudar mecânicas, configurações ou o visual.

## 8. Desempenho, caches e snapshots

- Em loops de combate, evite `filter` + `sort` dentro de comparadores, cálculos repetidos do mesmo raio e reconstrução de arrays sem necessidade.
- Preserve desempates estáveis, a ordem original das unidades e o RNG; a otimização dos alvos em `server/combat/targeting.ts` calcula rankings apenas uma vez por consulta. A contagem de ameaças é calculada no estado atual do tick para respeitar mortes anteriores.
- Em `server/combat/flame-orbits.ts`, candidatos, áreas de colisão e conjuntos temporários são reutilizados por atualização mantendo as verificações de contato contínuo e morte. Em `physical-collision.ts`, raios podem ser reutilizados em uma mesma resolução porque o tamanho não muda durante essa chamada. Não cache distâncias ou atributos entre ticks sem invalidação por posição, buff, morte, equipamento etc.
- `server/sim.worker.ts` acumula tempo e avança a simulação em passos fixos. **Nunca** vincular ataques ao FPS nem diminuir a frequência de snapshots arbitrariamente.
- `server/engine.ts#snapshot` envia uma vista completa. Eventual protocolo delta exige reconstrução confiável ao trocar de arena, fase ou reconectar; não foi adotado nesta revisão devido ao risco.
- O editor só carrega sob demanda por `src/client/menus.ts`. Diferenças de configuração são memorizadas por revisão; a prévia suspende desenho em abas ocultas. O profiler F3 deve ser leve e não virar gargalo.
- Evite remover o acervo de `public/` para reduzir publicação. Qualquer filtragem de assets precisa de uma análise verificável de todas as referências, incluindo chefes, evolução, elenco e fallback PMD.

## 9. Preparação para backend futuro

O nome `server/` significa **motor de regras**, não um servidor HTTP ativo. O Worker é o executor local atual. Quando existir backend online, ele deverá hospedar a simulação autoritativa e receber comandos através de transporte próprio; a UI continuará consumindo snapshots/eventos. Não adicione endpoints, contas, autenticação, WebSockets ou cópia da lógica de combate no cliente por conta própria. O trabalho de preparação deve focar em contratos estáveis e ausência de dependência DOM/Canvas no motor.

## 10. Fluxo oficial para toda atualização

1. Leia `AGENTS.md` e **este documento**; consulte o histórico da branch e confirme os arquivos existentes.
2. Identifique módulos proprietários e relações entre `config/`, `server/` e `src/`.
3. Leia a implementação e procure funções reutilizáveis antes de escrever outras.
4. Faça mudanças pequenas, sem alterar mecanicamente o balanceamento ou o comportamento não solicitado.
5. Preserve os snapshots, os assets e a exportação ZIP; evite mudanças simultâneas de lógica e visual difíceis de atribuir.
6. Execute `npm ci` quando preparar um ambiente novo; rode `npm run validate:config`, `npm run check` e `npm run build`.
7. Faça revisão funcional das áreas afetadas: loja, evolução, combate, itens, augments, sinergias, cenas e ZIP V20. Se não puder conferir visualmente, registre a limitação.
8. Atualize este manual quando responsabilidades ou caminhos mudarem.
9. Abra uma PR com escopo, mapa antes/depois, riscos, verificações **reais** e limitações. Não faça merge automaticamente.

**Proteções especiais:** sem alteração arbitrária de `config/*.json` durante refatorações; sem redesenho da UI; sem retirar sprites, portraits ou créditos; sem quebrar `server/types.ts`, `server/sim.worker.ts`, `server/engine.ts#snapshot`, o exportador V20 ou o esquema de eventos. **Não adicionar pasta de testes nem suites automatizadas ao repositório.** Verificar TypeScript, build, invariantes de configuração e código manualmente continua obrigatório.

## 11. Critérios mínimos de aceitação

Uma atualização está pronta quando suas responsabilidades ficam claras, não há duplicação intencional, os dados continuam íntegros, as regras e visuais não solicitados permanecem equivalentes, `npm run validate:config`, `npm run check` e `npm run build` passam e a documentação aponta para o código efetivo. Não atribuir percentuais de melhora de FPS/CPU sem benchmarks equivalentes antes e depois; alterações técnicas relevantes devem indicar onde economizam trabalho e como são invalidadas.

## V20.5 preservada na V20.7: contratos de compatibilidade

- **Ataque regular:** `server/data.ts#getStageData` define `atk`/`physical`; `server/systems/combat.ts` consome ATK. Tipo visual de projétil não é dano especial.
- **Alcances:** `server/combat/basic-range.ts` agora concentra `basicInRange`, `basicApproachDistance` e cálculo de alcance efetivo, respeitando a escala do mundo. Tamanhos visuais e colisões não ampliam alcance.
- **Lapras:** `lapras-surf` continua no loop lógico `server/systems/combat.ts`; reutiliza colisão física, `deal`, `shieldMultiplier` e `server/combat/effects.ts`. `src/client/render/effects.ts` só desenha a onda. Estado `surf` está em `server/types.ts`.
- **Ditto:** estado de cópia por `CombatUnit`, atributos por `calculateStats` e itens do próprio Ditto; transformações não modificam elenco persistente.
- **Editor técnico:** `src/client/configurator/editor.ts`, `state.ts`, `preview.ts` e `zip.ts` preservam senha, exportação ZIP, preview e parâmetros originais. Não recriar aba de animações; `config/animacoes.json` continua presente.
- **Performance herdada:** preservar `server/combat/flame-orbits.ts`, `server/combat/targeting.ts`, caches e o carregamento tardio do editor.
- **Assets:** o ZIP V20.5 fornecido contém `config/`, `server/` e `src/`, mas não contém `public/`; nunca substituir nem remover assets do repositório com base no ZIP.

## V20.7: novas responsabilidades e como atualizar

| Funcionalidade | Arquivo proprietário | Regras de evolução |
| --- | --- | --- |
| Preferências pessoais | `src/client/player-settings.ts` | Volume 0–100, FPS 30–120 (padrão 75); armazenamento local `poketactics.player-settings.v1`; **não** incluir em `config/` nem no ZIP do editor |
| Áudio | `src/client/audio.ts` | Web Audio com sintetização original após gesto do usuário. Não instanciar outros AudioContexts em cada tela |
| Limite de desenho | `src/client/performance/frame-scheduler.ts`, `src/client/arena.ts#setFrameRate` | Ajuste instantâneo; só RAF/renderização; nunca vincular combate, bots, cooldowns ou ticks a FPS |
| Acesso às telas | `src/client/menus.ts`, `src/client/main.ts`, `src/pages/index.astro` | Preferências abrem do menu e da arena; editor técnico é opção separada e lazy-loaded |
| Alcance de ataques regulares | `server/combat/basic-range.ts` | Reutilize `basicInRange` e `basicApproachDistance`; não duplique métricas nem altere limites sem solicitação de balanceamento |
| Arena e renderização | `src/client/arena.ts` | Reutilize `orientationIds`, `enemyIntroOrder` e `renderMarkers` sem alterar/ordenar buffers cacheados de preparação |
| Snapshots | `server/engine.ts#snapshot`, `server/sim.worker.ts` | A vista retornada compartilha referências temporárias com o motor até o `postMessage` fazer structured clone. **Nunca reter ou modificar o retorno antes de enviar.** Outro consumidor que precisar reter a vista deverá clonar explicitamente |

### Invariantes de desempenho e extensibilidade

1. Antes de extrair função de `combat.ts`, identifique estado, efeitos colaterais, consumo de aleatoriedade, critério de desempate e ordem de execução. Extraia por **mecânica compartilhável**, nunca um arquivo por Pokémon.
2. Caches entre frames podem reter buffers visuais; caches entre ticks de combate exigem invalidação sempre que posição, equipamento, buffs ou estado de morte mudarem.
3. O cliente não implementa dano; o Worker não conhece DOM ou Canvas. As preferências pessoais são exclusivamente locais e não alteram JSONs globais.
4. Evite `filter`+`sort`+`map` em caminhos desenhados a cada quadro quando puder reaproveitar buffers sem alterar semântica; preserve visuais PMD, sombras e efeitos.
5. O CSS usa cascata histórica: **não** eliminar regras semelhantes sem verificar precedência e aparência em todas as telas.
6. Não crie infraestrutura, pastas ou arquivos de testes. Execute `npm run validate:config`, `npm run check` e `npm run build`, faça verificações manuais e relate limitações/medições reais (F3) sem inventar percentuais.
7. Ao adicionar Pokémon ou habilidade, parta de `config/pokemons.json`, `config/ataques.json`, `server/data.ts` e o despachante existente. Para PMD, use `src/client/animation/` e manifesto; nunca apague `public/`.

## V22.5: HUD, evolução automática, terreno de itens e família Abra

- **Sincronização HUD (`src/client/main.ts` e `hud.ts`):** relógio a cada snapshot; `hudRevision` compara campos estruturais da loja, inventário, elencos, equipamento, augments, fase, seleção e resultado. Mudanças ignoram imediatamente o limite de atualização; indicadores variáveis de combate continuam limitados por `hudRefreshMs`. Não usar HTML como estado autoritativo.
- **Ofertas (`server/engine.ts` e `src/client/main.ts`):** `buy.offerId` deve corresponder ao ID da oferta do Worker. A passagem de etapa renova a loja somente se não estiver travada.
- **Inventário (`src/client/main.ts`):** o contêiner captura o ponteiro, soltura inválida não consome item, teclado continua acessível e os cancelamentos limpam o fantasma.
- **Evolução (`server/shop.ts#evolutionByInfluence`, `server/engine.ts#merge`):** Eevee, Scyther e Tyrogue evoluem sem escolha, inclusive nos bots. A fonte é `typeInfluence(player).shares`, a mesma barra de tipos da loja. Compara peso do tipo primário da forma, depois do secundário; usa RNG somente após empate integral. Calcula antes de consumir as cópias. Outras evoluções mantêm suas regras.
- **Plataforma física (`server/data.ts#ITEM_RACK_WORLD`, `src/client/arena.ts#placeWorldRack`, `server/engine.ts#tickTrainer`):** posição e limites em coordenadas do mundo, respeitando zoom, câmera e colisão com o estrategista. Aspecto, superfície e miniaturas em `src/styles/global.css`.
- **Abra (`config/pokemons.json`, `config/ataques.json`, `server/systems/combat.ts`):** família incomum (raridade 2), três estágios longos. `psychic-teleport` escolhe uma casa não adjacente na mesma fileira; se ameaçado de perto, vai para a região mais segura. Abra apenas teleporta; Kadabra e Alakazam originam respectivamente 3 e 5 disparos simétricos de SpA. `psychic-shot` usa colisão do motor e VFX em `src/client/vfx/travel-effects.ts`. Ataque regular conserva a categoria física com 70% de ATK e 30% de SpA. Prévia e texto em `server/damage-preview.ts` e `src/client/menus.ts`.
- **Assets:** a família nova usa dex 63/64/65. Quando não há metadados PMD locais, o renderizador existente usa PNG canônico como fallback. Preservar `public/`.

**Revisão funcional indicada:** reroll/compra imediata, loja travada, itens e Pokébolas, drop inválido, múltiplas fusões, empates de influência, teleporte e tiros angulados. Não adicionar suites nem pastas de testes.

## V23.6 — combate com navegação tática

- **Alcance numérico:** o valor efetivo é lido de config/alcances.json por server/data.ts#effectiveRange. O valor exibido continua sendo o nível inteiro. server/combat/basic-range.ts acrescenta somente a folga necessária para os corpos se tocarem (soma dos raios físicos e tolerância pequena), sem reabrir a antiga distância corpo a corpo fixa de 1.055.
- **Foco de alvo:** server/combat/targeting.ts#selectCombatTarget conserva o alvo entre ticks; quando ele sai do alcance, prioriza outro já atacável e limita a perseguição antes de reavaliar. Unidades que ficam sem progresso podem trocar o alvo. Preferências específicas de habilidade (Meowth/Diglett) continuam no combate.
- **Caminho:** server/combat/obstacles.ts#routeAround reutiliza a malha 7×8 (e a conexão das duas arenas na luta quádrupla), busca do caminho de menor custo por Dijkstra, obstáculos e ocupação temporária das unidades. Ele não tenta caminhar até o centro ocupado do alvo. A rota é invalidada por geometria alterada, deslocamento do alvo, passagem de tempo ou ocupação do próximo ponto.
- **Deslocamento:** server/systems/combat.ts#walkStep interpola a posição física pelos waypoints de hexágonos e, ao alcançar o último hex, termina a aproximação até a distância de contato. clearStep e resolveBodies ainda impedem sobreposições; a seleção de caminho não modifica cooldown, dano, snapshots ou tempo lógico.
- **Exceções:** Surf, investida, salto, teleporte, voo, medo, fuga baby, perseguição específica de Persian e outras habilidades com locomoção própria permanecem nos handlers existentes. Novas regras de movimentação regular não devem substituir esses estados.
- **Validação esperada:** conferir duelos alcance 1 (pequeno/pequeno e grande/grande), ranged 2+, obstáculos de Mr. Mime, aglomeração, arena quádrupla e troca de alvo por morte/fora de alcance. Rodar npm run validate:config, npm run check e npm run build; nenhum arquivo de testes é adicionado.

## V24.5 — Oddish, Raio Solar, loja e ficha

- **Fonte dos novos Pokémon:** `config/pokemons.json` adiciona `oddish` (Gloom/Vileplume, raridade comum, habilidade `pollen-mortar`) e passa a família `bulbasaur` para `solar-beam`. O alcance de Bulbasaur/Ivysaur/Venusaur é 2/3/4; `config/ataques.json` define comprimento, raio, duração e dano do feixe. Os assets `public/portrait/0043..0045` e `public/sprite/0043..0045` já são locais; `prebuild` regenera o manifesto.
- **Execução do feixe:** `server/systems/combat.ts#piercingFire` reaproveita a colisão varrida perfurante, com alcance máximo opcional, e emite VFX `solar-beam` desenhado em `src/client/vfx/travel-effects.ts`. Não há cálculos de dano no cliente.
- **Loja:** `src/client/hud.ts#renderShopInfo` usa `typeInfluence` do motor sem alterar sua probabilidade. A pizza normaliza visualmente os até quatro maiores tipos, enquanto a legenda mostra os percentuais absolutos da equipe. As cartas mantêm retratos PMD em uma área isolada de sua faixa inferior opaca; o estilo está agrupado na seção V24.5 de `src/styles/global.css`.
- **Ficha e itens:** `ITEMS.maxSlots=3` em `config/itens.json` segue como fonte de verdade para equipamento, fusão e espaços visuais; `src/client/arena.ts` agora mostra os três ícones. A ficha compara estatísticas já calculadas pelo motor com `calculateStats` de nível/IV para laranja/vermelho, e compara percentuais com as bases do arquivo de itens. Tooltips textuais reutilizam `server/systems/items.ts#itemTooltip` na arena de itens e nos slots equipados; `src/client/main.ts` os projeta para fora dos painéis sem alterá-los.
- **Observação:** o painel de habilidades conserva o popover já existente. A área física de itens permanece ancorada na arena e acompanha câmera/zoom, não migra para o HUD.
- **Validação:** `npm run validate:config`, `npm run check`, `npm run build`; revisar manualmente preparação, compra/reroll/trava, leitura da pizza, três slots, combate e alcance 2/3/4, tooltips e scouting. Se não houver checkout local, a execução deve ser registrada como pendente, nunca presumida.


## V25.1 — ficha compacta e barras de unidade

- Ficha (src/client/hud.ts, src/styles/global.css): nome, portrait, tipos e nível destacado; vida/energia e valores; três slots de itens e IV médio/poder total empilhados. ATK, DEF, SPA, SPD e VEL na primeira fileira, cada qual com IV; crítico, dano crítico, vampirismo, durabilidade e amplificação na segunda. Dez pictogramas SVG inline, preservando as cores de modificadores.
- Habilidade: tooltip flutuante existente permanece, com caixa de alcance numérico ao lado do botão. Removidos o card de dano do ataque regular e os textos explicativos de remoção/venda. Atalhos e lógica de equipamento/venda não mudam.
- Posicionamento: ficha ao lado do painel de jogadores/combate, inclusive quando a extensão de comparação com adversário está aberta, com rolagem própria em altura reduzida.
- Arena (src/client/arena.ts): vida sobre energia, equipamentos abaixo das barras, círculo preto lateral com nível branco. Largura mínima comporta três ícones. Durante preparação, as barras usam os valores visuais já disponíveis nos marcadores, sem simular atributos do motor.
- Revisão: planejamento, combate 1v1 e quádruplo, observação, tooltips, equipamento e larguras/alturas diferentes. Verificar npm run validate:config, npm run check e npm run build.


## V25.2 — painéis de jogadores, combate e loja

- **Jogadores:** `src/client/hud.ts#renderRanking` exibe sequência de vitórias ou derrotas ao lado dos nomes; o cache da região inclui `streak`. O painel direito ficou ligeiramente mais largo e alto, com rolagem onde necessária.
- **Combate:** `renderCombat` mostra um único ranking de até 15 Pokémon, ordenado pelo indicador selecionado e com cores distintas para a equipe observada (azul) e os demais participantes (vermelho). Inclui batalhas com participantes múltiplos e bots; cada entrada permite consultar dano físico/especial, defesa física/especial, cura e barreira em foco ou hover. A extensão adversária foi removida, sem alterar as métricas do motor.
- **Loja:** `src/pages/index.astro` posiciona ouro e renda acima de dois botões com espaço equivalente (XP e rolagem). O botão de XP contém nível, XP atual, barra e custo; a renda mantém seu popover. A bússola segue `typeInfluence`, agora com ícones no centro das fatias e centro visual menor, sem texto. Raridades mais compactas.
- **Responsividade:** os ajustes estão no bloco V25.2 de `src/styles/global.css`; preservar a posição da ficha ao lado do painel e o inventário físico sobre a arena.
- **Validação:** executar `npm run validate:config`, `npm run check` e `npm run build`, conferindo visualmente combate normal/quádruplo, scouting, compras de XP, renda e tela reduzida. As regras e a configuração não foram alteradas.

## V25.3 — caminhos físicos, escolha de alvo e modo espectador

- **Decisão de alvo:** `server/combat/targeting.ts#selectCombatTarget` prioriza inimigos já atacáveis, observa obstáculos reais e não alterna entre alvos bloqueados sem uma alternativa melhor. O alvo continua persistente durante uma perseguição bem-sucedida.
- **Rotas:** `server/combat/obstacles.ts#routeAround` começa da posição física, não de uma casa presumida, e só percorre arestas livres para o raio de colisão. O cache é invalidado quando a próxima aresta deixa de ser transitável. Lutadores corpo a corpo podem terminar a rota em pontos de contato entre os centros dos hexágonos.
- **Execução:** `server/systems/combat.ts` usa `walkStep` direto primeiro e recorre ao planejamento quando encontra uma colisão ou barreira; `navLastDistance` permite distinguir progresso de paradas prolongadas. A orientação do Pokémon segue o vetor real da caminhada, não um alvo lateral distante. Dashes, teletransportes e movimentos especiais permanecem independentes.
- **Eliminação:** `server/engine.ts` preserva a partida dos sobreviventes e permite apenas `move-trainer` para o jogador eliminado. Movimentação do treinador não concede ouro nem saque, inclusive em partida finalizada. O Worker mantém o fluxo de snapshots e o comando `watch` existente.
- **Cliente:** `src/client/main.ts` exibe a escolha de sair ou assistir e conserva a opção de visitar arenas. `src/client/hud.ts` esconde loja/inventário e a ficha final antiga após a eliminação. `src/client/arena.ts` não desenha a própria formação, banco, itens ou tabuleiro no modo espectador; as equipes vivas continuam visíveis ao selecionar outro jogador. A animação CSS está em `src/styles/global.css`.
- **Validação:** executar `npm run validate:config`, `npm run check` e `npm run build`. Testar 1v1/4v4 com bloqueio por unidades e pilares, alcances curtos, alvos que morrem/fogem, ausência de caminhadas laterais, eliminação intermediária, observação e movimento após o fim, e proibição de economia/saque. Não foram adicionados testes, dependências ou mudanças nos parâmetros de balanceamento.
