# PokéTactics — V22.5 (Interface, evoluções e Abra)

PokéTactics é um jogo de estratégia com combates automáticos, Pokémon, loja, evoluções, itens, espólios, augments e sinergias. Ele usa **Astro + TypeScript**, Canvas e sprites/animações PMD. As partidas atuais são **simuladas localmente**, com adversários controlados por bots; ainda não existe multiplayer real nem backend de partidas online.

## V22.5 — principais mudanças

- **HUD e loja:** compras, rerolls, Pokémon, itens e etapas são propagados na primeira resposta do Worker. Ofertas têm IDs, evitando compras em cartões antigos.
- **Evoluções ramificadas:** Eevee, Scyther e Tyrogue evoluem automaticamente pela participação de tipos da barra TIPOS da loja. Primeiro o tipo principal, depois o secundário; empate integral é sorteado no motor. Não há janela de escolha.
- **Bandeja física:** terreno com ícones menores, mais abaixo; acompanha câmera/zoom. O estrategista não invade a plataforma.
- **Família Abra (incomum):** Abra/Kadabra/Alakazam são de alcance longo. Teleportam para outra casa distante na mesma fileira, ou para uma região segura quando ameaçados de perto. Kadabra dispara três tiros psíquicos angulados; Alakazam, cinco. Ataques regulares calculam 70% de ATK e 30% de SpA.
- **Inspetor:** não exibe mais o texto explicativo sobre bebês; as regras do motor permanecem.

## Executar o projeto

Requisitos: Node.js 22 e npm, em um checkout completo com a pasta `public/` original.

```bash
npm ci
npm run dev
```

Abra o endereço local indicado pelo Astro. O comando `predev` gera o manifesto PMD com os recursos que já estão no repositório.

Verificações oficiais antes de enviar uma PR:

```bash
npm run validate:config
npm run check
npm run build
```

A validação lê os JSONs sem modificá-los; `check` verifica o TypeScript; `build` gera a distribuição estática em `dist/`. A PR também passa pelo fluxo `.github/workflows/verify-pr.yml`. Não há suíte de testes automatizados incluída nesta versão.

## Organização principal

| Pasta | Responsabilidade |
| --- | --- |
| `config/` | JSONs de Pokémon, ataques, raridade/loja, itens, augments, sinergias, fases e parâmetros visuais |
| `server/` | Motor autoritativo **local**, regras, simulação, bots e Worker; futuro candidato a backend |
| `src/` | Interface Astro, menus, HUD, renderização Canvas, sprites, efeitos e configurador V20 |
| `public/` | Acervo de sprites, portraits e recursos PMD; preserve os arquivos e créditos |
| `scripts/` | Geração do manifesto PMD, ferramentas de migração e validação dos dados |
| `.github/workflows/` | Verificação de PR e publicação estática |

O motor roda em `server/sim.worker.ts` e é coordenado por `server/engine.ts`; o combate está em `server/systems/combat.ts` e módulos `server/combat/`, incluindo `basic-range.ts` para alcance autoritativo regular. A arena é desenhada em `src/client/arena.ts` com módulos de animação, cena, renderização e VFX. Passos lógicos do combate são independentes do FPS do navegador.

## Configurações do jogador e Editor de Balanceamento

Na tela inicial, **Configurações do Jogador** abre um painel compacto com duas barras. Ele também pode ser aberto durante a partida pelo botão de configurações na arena:

- **Volume:** 0% a 100%, com efeitos originais leves via Web Audio liberados por interação do jogador; 0% desativa som.
- **FPS:** de 30 a 120, padrão **75 FPS**, persistido no navegador e limitado à capacidade de atualização efetiva do dispositivo. Esse ajuste afeta **somente a renderização**, nunca simulação, bots ou cronômetros.

As preferências ficam em `localStorage` e não modificam `config/*.json`. A opção independente **Editor de Balanceamento** continua carregada apenas quando solicitada. Nele você pode editar valores de Pokémon, habilidades, loja, itens, augments, sinergias e outros JSONs disponíveis, pré-visualizar tamanho físico dos Pokémon e exportar **um ZIP com os arquivos `config/`**. Arquivos não modificados mantêm seu conteúdo original. O código/senha de acesso do próprio cliente é somente uma barreira visual, não autenticação segura.

Para manter o jogo equilibrado, altere valores nos JSONs e confirme que a simulação utiliza o campo editado. Evite codificar valores equivalentes em mais de um lugar.

## Regras para contribuir

A documentação principal do repositório é **[Organização.md](Organização.md)**. Agentes Codex devem ler também **[AGENTS.md](AGENTS.md)**. Eles explicam o mapa atualizado de sistemas, como adicionar Pokémon, onde implementar habilidades, como evitar duplicações, o fluxo de verificações e as responsabilidades de cliente/motor/configuração.

Mantenha a aparência e as mecânicas existentes durante refatorações. A área de itens pertence ao mundo físico, seguindo o zoom e a câmera — não é HUD fixo. Não apague assets PMD nem acrescente suítes de testes ao repositório.

## Publicação e assets

A build continua gerando site estático compatível com GitHub Pages. `scripts/generate-pmd-manifest.mjs` utiliza os arquivos PMD presentes, sem baixá-los novamente. Pastas de sprites e portraits são parte do repositório de publicação; não devem ser substituídas por um pacote de atualização somente com código. Direitos e créditos de terceiros permanecem com seus respectivos autores.

Para detalhes de mudanças antigas, consulte o histórico de commits. Este README descreve **o funcionamento atual** e não deve ser usado para restabelecer mecânicas de versões anteriores.

## V20.7: desenvolvimento sustentável

O agendador `src/client/performance/frame-scheduler.ts` controla somente RAF. O módulo `src/client/audio.ts` concentra os efeitos sonoros; `src/client/player-settings.ts` cuida das preferências. A arena reaproveita buffers visuais em `src/client/arena.ts`; o Worker já efetua a clonagem estrutural ao transmitir snapshots.

Siga `Organização.md` e `AGENTS.md` para localizar cada mecânica e preservar o isolamento `config` / `server` / `src`. Não existem suites de testes neste repositório.

## V22.5 — correção de loja, itens e evoluções

Cada compra confirma o identificador da oferta efetivamente exibida, evitando comprar outra espécie quando a loja muda antes da confirmação. Ofertas mudadas são redesenhadas assim que chegam no snapshot, sem esperar o intervalo regular do HUD. Itens e Pokébolas podem ser arrastados e soltos; a soltura inválida apenas devolve o item à mochila. As pendências de escolha de evolução de Scyther/Eevee também foram corrigidas.

### V23.6 — movimentação e alcance

A movimentação normal de combate passou a planejar trajetos pelos hexágonos, desviando de unidades e obstáculos enquanto mantém o movimento visual suave. O alcance 1 agora permite ataques quando os corpos estão realmente próximos, sem voltar à distância fixa antiga; a escolha do alvo é persistente e reavaliada em caso de fuga, morte ou bloqueio. Valores de alcance vêm de config/alcances.json. Habilidades de deslocamento especial mantêm suas próprias regras.

## V24.5 — Vileplume e melhorias visuais

- A família **Oddish → Gloom → Vileplume** entra na loja como comum e herda o Morteiro de Pólen (dano em área e cura de aliados).
- **Bulbasaur → Ivysaur → Venusaur** agora usam **Raio Solar**, um disparo perfurante de grama com alcance evolutivo 2/3/4 e parâmetros de dano em `config/ataques.json`.
- Loja remodelada: seis cartas com portraits PMD quadrados preservados, faixa inferior preta exclusiva para nome/tipos/preço e realce por raridade; chances continuam acessíveis.
- Influência de tipos exibida em gráfico circular no canto direito superior da loja; apresenta no máximo quatro tipos e informa os percentuais reais no detalhe.
- Ficha com seis atributos, poder total, crítico, dano crítico, vampirismo e atributos secundários; bônus externos a nível/IV ficam laranja, penalidades vermelhas.
- Até **três equipamentos por Pokémon**, inclusive nas regras, na ficha e nos ícones em arena.
- Itens e componentes mostram descrições detalhadas em tooltips por mouse/foco, incluindo efeitos de receitas. Habilidade continua um botão textual com explicação ao passar o mouse ou clicar.

A simulação segue no Worker local. O manifesto PMD é regenerado pelos scripts `predev`/`prebuild` a partir dos assets locais; nenhuma arte de terceiros é substituída.
