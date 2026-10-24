# Poké Tactics — esqueleto inicial

Auto battler Pokémon em **Astro**, com **oito jogadores** (você + sete CPUs). O site abre diretamente na partida. Não usa imagens, sprites, itens, augments, login ou backend contratado.

## Estrutura

```text
src/
  pages/index.astro      interface única
  styles/global.css      HUD responsivo
  client/arena.ts        tabuleiro hexagonal, desenho e câmera
  client/hud.ts          loja, banco, ranking, sinergias e estatísticas
  client/main.ts         entradas do usuário / ponte com o servidor
server/
  data.ts                Pokémon, bases, tipos, IV, nível, alcance
  types.ts               protocolo de mensagens e tipos de domínio
  engine.ts              estado autoritativo, economia, CPU, evolução, rounds
  systems/combat.ts      combate automático e habilidades
  sim.worker.ts          servidor isolado em Web Worker
public/                  vazio até a chegada dos sprites
tests/                   testes de regras
.github/workflows/       deploy estático por GitHub Actions
```

**GitHub Pages é estático.** Portanto `server/sim.worker.ts` roda como servidor simulado em um Web Worker local, separado da thread da interface. Toda compra, posicionamento e economia é validada pela classe `GameEngine`, não pelo HUD. No multiplayer, será possível reutilizar o motor e o protocolo (`ClientToServer`/`ServerToClient`) em um processo real conectado por WebSocket; não há partidas compartilhadas entre navegadores nesta versão.

## Regras desta versão

- **8 jogadores, 100 HP cada.** Partidas normais até sobrar um participante. Derrota causa 3 de dano base + 2 por Pokémon inimigo sobrevivente + 1 a cada cinco rodadas.
- **6 cartas na loja**, reroll por 2 de ouro, trava de loja; **10 espaços de banco**. Apenas as quatro famílias básicas aparecem na loja.
- **Cinco raridades** no motor. Bulbasaur e Charmander: 1; Squirtle: 2; Pikachu: 3. As raridades 4 e 5 ficam sem Pokémon até futuras adições.
- **Nível de jogador automático 1–6** conforme rodadas 1, 4, 8, 13, 19, 26. O limite de Pokémon em campo é igual ao nível de jogador.
- **Renda:** +5 por rodada, juros de +1 a cada 10 de ouro (limite +3) e +1 após vitória. Ouro inicial: 9.
- **Pokémon:** cada um tem seis stats base (Vida, Vel, Atk, Def, SpA, SpD), um IV independente por status (0–100) e nível 1–100. Multiplicador: `(0,8 + IV × 0,004) × (1 + nível × 0,05)`; nível 0 seria a base sem aumento e nível 100 alcança +500%. Evoluções têm multiplicador adicional próprio.
- **Evolução:** três unidades iguais da mesma etapa se fundem na próxima etapa; preserva o maior nível das três e a média dos seis IVs. A cadeia é Bulbasaur → Ivysaur → Venusaur, Charmander → Charmeleon → Charizard, Squirtle → Wartortle → Blastoise, Pikachu → Raichu.
- **Combate:** seleção do alvo vivo mais próximo, avanço até o alcance, ataques físicos comuns que geram +10 de energia, habilidade ao atingir a energia exigida, defesa física/especial, velocidades, barras de vida e energia, efeitos e registro de dano, dano recebido, cura e mitigação.
- **Tipos:** Planta (regeneração), Venenoso (dano contínuo), Fogo (mais dano), Água (resistência), Elétrico (mais velocidade). Somente Pokémon em campo contam. Cópias idênticas da mesma etapa não aumentam o contador.
- **Sem batalhas especiais** nesta etapa; trilha mostra os capítulos 1–10 e continua com confrontos comuns até a decisão.

## Controles

| Ação | Controle |
| --- | --- |
| Mover treinador | Clique direito na arena |
| Aproximar/afastar câmera | Scroll na arena |
| Comprar | Clique na carta da loja |
| Mover para hexágono / banco / trocar | Arraste o Pokémon |
| Colocar rapidamente do banco | Dois cliques no Pokémon |
| Vender | Arraste até VENDER ou selecione e pressione E |
| Reroll | Botão ROLETAR ou tecla D |
| Examinar stats/IV | Clique no Pokémon |
| Espiar rival | Clique no jogador da classificação; VOLTAR para a sua arena |
| Dados de combate | Aba COMBATE; métricas no rodapé do painel |

## GitHub Pages

1. Coloque **todo o conteúdo desta pasta** na raiz de um repositório GitHub.
2. Em *Settings → Pages → Build and deployment*, escolha **GitHub Actions**.
3. Envie um commit para `main` ou `master`. O workflow instala dependências com `npm ci`, confere os tipos, executa testes, gera `dist/` e publica o site.

O caminho base do Astro é calculado a partir de `GITHUB_REPOSITORY` pelo próprio build, funcionando em repositórios do tipo `usuario.github.io` e `usuario.github.io/nome-do-repositorio`. Também é possível definir `PUBLIC_BASE_PATH` manualmente se necessário.

### Desenvolvimento local opcional

`npm install`, `npm run dev`, `npm test`, `npm run check`, `npm run build`.
