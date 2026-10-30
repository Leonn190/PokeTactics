# PokéTactics — V20.3 (organização)

PokéTactics é um jogo de estratégia com combates automáticos, Pokémon, loja, evoluções, itens, espólios, augments e sinergias. Ele usa **Astro + TypeScript**, Canvas e sprites/animações PMD. As partidas atuais são **simuladas localmente**, com adversários controlados por bots; ainda não existe multiplayer real nem backend de partidas online.

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

O motor roda em `server/sim.worker.ts` e é coordenado por `server/engine.ts`; o combate está em `server/systems/combat.ts` e módulos `server/combat/`. A arena é desenhada em `src/client/arena.ts` com módulos de animação, cena, renderização e VFX. Passos lógicos do combate são independentes do FPS do navegador.

## Menu e configurador V20

Na tela inicial, o botão **Configurações** abre o configurador visual V20, carregado apenas quando solicitado. Nele você pode editar valores de Pokémon, habilidades, loja, itens, augments, sinergias e outros JSONs disponíveis, pré-visualizar tamanho físico dos Pokémon e exportar **um ZIP com os arquivos `config/`**. Arquivos não modificados mantêm seu conteúdo original. O código/senha de acesso do próprio cliente é somente uma barreira visual, não autenticação segura.

Para manter o jogo equilibrado, altere valores nos JSONs e confirme que a simulação utiliza o campo editado. Evite codificar valores equivalentes em mais de um lugar.

## Regras para contribuir

A documentação principal do repositório é **[Organização.md](Organização.md)**. Agentes Codex devem ler também **[AGENTS.md](AGENTS.md)**. Eles explicam o mapa atualizado de sistemas, como adicionar Pokémon, onde implementar habilidades, como evitar duplicações, o fluxo de verificações e as responsabilidades de cliente/motor/configuração.

Mantenha a aparência e as mecânicas existentes durante refatorações. A área de itens pertence ao mundo físico, seguindo o zoom e a câmera — não é HUD fixo. Não apague assets PMD nem acrescente suítes de testes ao repositório.

## Publicação e assets

A build continua gerando site estático compatível com GitHub Pages. `scripts/generate-pmd-manifest.mjs` utiliza os arquivos PMD presentes, sem baixá-los novamente. Pastas de sprites e portraits são parte do repositório de publicação; não devem ser substituídas por um pacote de atualização somente com código. Direitos e créditos de terceiros permanecem com seus respectivos autores.

Para detalhes de mudanças antigas, consulte o histórico de commits. Este README descreve **o funcionamento atual** e não deve ser usado para restabelecer mecânicas de versões anteriores.
