# Instruções para agentes — PokéTactics

**Leia [Organização.md](Organização.md) por inteiro antes de alterar o repositório.** Ele é o manual arquitetural oficial. Investigue o código existente, não assuma que históricos antigos ainda descrevem as regras em vigor.

- `config/`: parâmetros e balanceamento em JSON; `src/`: interface, renderização, sprites, animações e configurador; `server/`: motor de regras e simulação local no Web Worker, **não** backend multiplayer já ativo.
- Encontre a implementação existente antes de criar pasta, arquivo, handler, registry, cálculo ou estilo. Reutilize `server/combat/`, `server/systems/`, `src/client/animation/`, `render/`, `scene/` e `vfx/`. Não crie sistemas paralelos nem um arquivo por Pokémon sem motivo.
- Refatorações devem preservar balanceamento, ordem de execução, aleatoriedade, dano, cura, habilidades, UX, visuais e contratos de snapshots. Não ajuste regras por conta própria.
- Não invente sprites PMD nem animações indisponíveis no manifesto; preserve créditos e assets em `public/`. O configurador V20 deve continuar exportando os arquivos originais `config/*.json` em ZIP.
- Não transfira decisões autoritativas de combate ao cliente. Não implemente backend online ou multiplayer até receber esse escopo explicitamente.
- **Área de itens faz parte do mundo físico da arena e acompanha câmera/zoom; nunca movê-la para o HUD fixo.**
- Configurações são fonte de verdade para valores editáveis; não crie constantes TypeScript duplicadas. Verifique onde a configuração é realmente consumida.
- Não adicione **arquivos de testes, pastas `tests/` ou suites automatizadas**. A validação estática `npm run validate:config` é permitida e obrigatória quando mudar dados.
- Execute `npm run validate:config`, `npm run check` e `npm run build`; faça revisão funcional manual quando possível. Documente qualquer verificação não executada, sem afirmar sucesso indevido.
- Atualize `Organização.md` quando a arquitetura ou caminhos mudarem. Entregue por PR em branch separada, nunca modifique `main` diretamente nem faça merge automático.

Se houver conflito entre uma proposta estrutural e a estabilidade do jogo, prefira a menor mudança justificável, verificável e reversível.

## V20.7: mapa essencial

- Preferências do usuário: `src/client/player-settings.ts` (localStorage, volume, FPS) e `src/client/audio.ts` (Web Audio após gesto do usuário). Não adicionar esses valores aos arquivos `config/*.json` nem à exportação ZIP.
- `src/client/performance/frame-scheduler.ts` limita apenas desenhos Canvas e é configurado via `src/client/arena.ts#setFrameRate`. Ticks, cronômetros, IA e cooldowns permanecem exclusivos do Worker.
- Menus: `src/client/menus.ts` mantém **Editor de Balanceamento** separado de **Configurações do Jogador**. Editor deve continuar lazy-loaded com senha e exportação inalteradas.
- Alcance regular pertence a `server/combat/basic-range.ts`. Antes de modificar `server/systems/combat.ts`, verifique utilitários reutilizáveis em `server/combat/` e invariantes de RNG, ordem e balanceamento.
- `server/engine.ts#snapshot` retorna uma vista temporária compartilhando referências locais antes do `postMessage`. Não mutar, armazenar, emitir em vários turnos ou exportar o objeto antes do structured clone.
- Arena reaproveita buffers por frame/snapshot. Não ordenar arrays cacheados de preparação; só ordenar buffers visuais próprios.
- Documente mudanças em `Organização.md` e `README.md`, mantenha `public/` intacto, não crie testes e nunca faça merge automaticamente.
