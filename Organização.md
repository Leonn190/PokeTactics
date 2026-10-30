# Organização — manual de desenvolvimento do PokéTactics (v20.3)

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
- Em `physical-collision.ts`, raios podem ser reutilizados em uma mesma resolução porque o tamanho não muda durante essa chamada. Não cache distâncias ou atributos entre ticks sem invalidação por posição, buff, morte, equipamento etc.
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
