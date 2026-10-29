# PokéTactics — refatoração de desempenho e animação

## Instalação
Substitua **somente** as pastas `config/`, `src/` e `server/` da raiz do repositório pelas três pastas deste ZIP. Preserve `public/` (sprites, retratos e outros assets), `package.json`, `scripts/`, `tests/` e demais arquivos existentes. As importações dos novos arquivos são relativas à estrutura original.

## Separação de responsabilidades
- **config**: `pokemons.json`, `ataques.json` e `regras_gerais.json` continuam definindo o jogo. `animacoes.json` contém os perfis compartilhados dos ataques básicos por tipo e os parâmetros de animação. `renderizacao.json` define taxa de snapshots, renderização, pré-carregamento e resolução adaptativa.
- **server**: `engine.ts` mantém regras e partidas; `systems/combat.ts` mantém combate autoritativo; `damage-preview.ts` calcula os valores exibidos nas habilidades; `formulas.ts` reúne fórmulas compartilhadas; `sim.worker.ts` executa a simulação local isoladamente da UI.
- **src/client**: `arena.ts` coordena a cena; `render/effects.ts` desenha os efeitos das habilidades; `render/projectiles.ts` reutiliza projéteis básicos por tipo; `render/shadows.ts` mantém sombras em cache; `render/sprite-bounds.ts` calcula os limites de sprite fora do render de cada frame. `hud.ts` mostra ficha, barras e danos e `damage-labels.ts` formata números com as cores física/especial.

## Comportamento dos ataques básicos
O alcance de cada estágio vem de `pokemons.json` (`range` ou override em `stages`). Estágios com alcance **até 1,5** têm ataque corpo a corpo `Attack`, sem projétil viajando. Acima disso utilizam `Shoot`, com fallback visual para `Attack` se o sprite não tiver `Shoot`, e um projétil do tipo primário (`projectilesByType`). O atributo `atk`/`spa` e a categoria física/especial existentes continuam determinando dano e mitigação. A habilidade carregada usa `move` e `chargedAnimation` do estágio; suas animações especiais continuam específicas quando necessário.

## Dano informado ao jogador
Os valores de dano da ficha consideram nível, IV, forma, atributos e a fórmula do ataque. Laranja = físico; azul = especial; verde = cura. Efeitos contínuos indicam **dano por segundo**; golpes múltiplos indicam **dano por golpe**. O número é **bruto antes de defesa/SpD, resistências de tipo, efeitos de proteção e escudos do alvo** (sem alvo selecionado não existe dano líquido único).

## Desempenho
- Render do campo suspenso no menu principal e com aba em segundo plano.
- Limite visual de 60 FPS (sem mudar a velocidade da simulação).
- Resolução de backing adaptativa apenas após persistência de frames lentos; máximo inicial preserva DPR até 1,5.
- Sombras previamente renderizadas em cache e limites dos sprites processados em tarefas ociosas.
- Menos animações pré-carregadas por Pokémon; sprites de habilidades raras são carregados quando utilizados.
- HUD completo atualizado menos vezes; timer faz atualização leve; progresso usa `transform`.
- Snapshots do worker têm intervalo de 85 ms; o motor continua simulando em ticks de 50 ms.
- Configuração de forma/fase Pokémon memoizada e opções de confronto cacheadas por rodada.

## Testes executados nesta entrega
- `tsc --noEmit` com TypeScript 5.x em todas as fontes `.ts` das três pastas: **sem erros** (declaração local mínima de `import.meta.env`).
- Simulação independente do DOM, 34 famílias/54 formas e validação de corpo a corpo vs longo alcance: **passou**.
- Simulação de combate de 32 unidades durante 500 ticks com efeitos e projéteis: **passou**.
- Prévia local de CSS/HTML das fichas e ranking em 1920×1080, 1440×900 e 1366×768: **sem sobreposição observada**. O teste de prévia não carregou os assets gráficos da pasta `public/`.

**Limite de verificação:** o site GitHub Pages não pôde ser aberto diretamente neste ambiente e não havia dependências do Astro ou `public/` completo no ZIP. Portanto não foi possível executar `npm run build`, `npm test` do repositório inteiro, medir o FPS real no navegador publicado ou garantir ausência de regressões em todas as fases. Após integrar os arquivos, execute `npm ci`, `npm run check`, `npm test` e `npm run build` na raiz do repositório, depois teste visualmente batalhas normais, PvE, quádruplas, evolução, moedas, loja e mudança de observador.

## Arquitetura de servidor futuro
O worker continua sendo somente um adaptador de transporte para a simulação local. Ao implementar o multiplayer, execute o `GameEngine` no servidor autoritativo e substitua o `Worker.postMessage` por mensagens de rede equivalentes aos tipos em `server/types.ts`; **não** confie em comandos nem cálculos de dano enviados pelo navegador. Snapshot/perspectiva devem ser validados no servidor para impedir vazamento de informações de adversários.
