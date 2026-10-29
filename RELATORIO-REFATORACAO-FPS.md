# PokéTactics — melhorias de FPS e animação

Esta branch é uma etapa implementada da refatoração, **não** uma reescrita integral de `server/systems/combat.ts`.

## Alterações concluídas

- `frame-scheduler.ts`: sincronização visual com `requestAnimationFrame`; configuração `maxFrameRate: 0` segue o refresh do monitor. Valores maiores que zero limitam frames opcionalmente.
- `snapshot-clock.ts`: descarta snapshots fora de ordem e calcula tempo visual entre recebimentos, com extrapolação limitada.
- `effect-timeline.ts`: evolução monotônica do tempo visual por ID, sem alterar o tempo nem o dano da simulação.
- `sprite-manager.ts`: cache LRU de folhas PMD com limite de 192 entradas; tentativas de decodificação assíncronas.
- `vfx/travel-effects.ts` e `vfx/impact-effects.ts`: renderização de projéteis, impactos e números de dano separada do renderizador genérico.
- `profiler.ts`: painel F3 com FPS médio, frame time, p95, custo de desenho, contagens de unidades/efeitos, taxa de snapshots e resolução.
- `server/sim.worker.ts`: passos lógicos fixos de `simulationTickMs` com catch-up limitado após pausas.
- `config/renderizacao.json`: `maxFrameRate=0` como padrão, preservando os demais ajustes.
- `tests/performance.test.ts`: regressões de scheduler, snapshots e tempo visual.

## Instalação

Na execução de GitHub Actions deste PR, baixe o artefato **PokeTactics-Refatoracao-FPS**. Dentro dele haverá o arquivo `PokeTactics-Refatoracao-FPS.zip` contendo apenas os caminhos de arquivos criados/alterados. Extraia o ZIP na raiz do repositório para substituir os arquivos. **Não apague a pasta `public/`**, mantenha os sprites e os assets.

Alternativa: utilize a própria branch do PR e faça merge depois de revisar o resultado.

## Verificação

No GitHub Actions, o fluxo `Verificar refatoração` executa `npm ci`, `npm run check`, `npm test` e `npm run build`.

Os testes exercitam funcionalidade e sintaxe, mas não medem FPS real. Faça testes visuais em 60/120/144 Hz, combate com 16 e 32 Pokémon, projéteis simultâneos, quadro de planejamento e evolução, bem como coleta de moedas. Compare métricas com F3 antes/depois.

## Escopo ainda não concluído

- A divisão integral de `server/systems/combat.ts`, preservando todos os cálculos.
- Uma reestruturação completa de `arena.ts` em cena/câmera/unidades/treinadores.
- Cache avançado de HUD e pré-carregamento contextual de todas as habilidades.
- Benchmark real de browser com FPS e latência medidos em vários equipamentos.

Não afirme ganhos percentuais antes de medir com o painel F3 e testes de estresse.
