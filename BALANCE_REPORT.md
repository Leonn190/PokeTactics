# PokéTactics v10 — auditoria inicial do balanceamento

Os valores de atributos e de habilidades do pedido foram preservados exatamente. Não foi aplicado ajuste automático com base nestas simulações.

## Método

- Duelos entre as oito famílias jogáveis, todas contra todas, com lados invertidos (128 confrontos por grupo).
- Dois grupos: estágio inicial e última evolução disponível. IV 50, nível 1, posições padronizadas.
- Quatro composições 2v2 com posições invertidas, sem equipamentos nem bônus de sinergia.
- Cada combate é simulado no motor TypeScript por até 30 s; mede vitória, DPS efetivo sobre HP, duração, número de carregados, cura, absorção e controle.
- Para reproduzir: `node --import tsx scripts/simulate-balance.ts`.

## Duelos 1v1

| Família | Raridade | Vitória inicial | DPS inicial | Vitória evoluída | DPS evoluído |
| --- | --- | ---: | ---: | ---: | ---: |
| Caterpie | Comum | 25,0% | 22,2 | 68,8% | 41,1 |
| Weedle | Comum | 43,8% | 24,6 | 56,3% | 57,9 |
| Bulbasaur | Incomum | 37,5% | 19,5 | 81,3% | 46,4 |
| Charmander | Incomum | 50,0% | 25,2 | 93,8% | 64,6 |
| Squirtle | Incomum | 6,3% | 12,3 | 43,8% | 29,4 |
| Pikachu | Incomum | 75,0% | 30,7 | 18,8% | 48,5 |
| Koffing | Raro | 68,8% | 18,6 | 31,3% | 26,7 |
| Snorlax | Épico | 93,8% | 18,0 | 6,3% | 14,2 |

Médias adicionais:

- Carregados por duelo, forma inicial: de 0,75 (Snorlax) a 1,88 (Charmander).
- Carregados por duelo, última evolução: de 0,75 (Snorlax) a 2,38 (Charmander).
- Butterfree recuperou, em média, 234,5 HP nos duelos de última evolução; Venusaur, 146,5 HP. Ambos podem curar a si mesmos.
- Snorlax aplicou em média 0,5 s de controle no cenário inicial contra os vários adversários testados (métrica de duração útil acumulada por duelo).
- A média de duração variou entre 8,4–26,2 s nos confrontos iniciais e 7,3–26,6 s nos confrontos evoluídos.

## Composições 2v2 (amostra exploratória)

| Equipe A | Equipe B | Vitórias da A (2 partidas) | Duração média |
| --- | --- | ---: | ---: |
| Blastoise + Butterfree | Beedrill + Raichu | 2 | 9,7 s |
| Weezing + Metapod | Charizard + Venusaur | 0 | 8,0 s |
| Snorlax + Butterfree | Raichu + Beedrill | 0 | 14,2 s |
| Venusaur + Weezing | Charizard + Blastoise | 0 | 12,5 s |

## Alertas para avaliar **sem alterar os valores já aprovados**

1. **Pikachu/Raichu:** Pikachu liderou incomuns iniciais no duelo (75% de vitória), mas Raichu terminou com 18,8% contra evoluções finais, pois enfrenta vários rivais de três estágios. Vale observar seu desempenho 2v2 antes de decidir qualquer melhoria.
2. **Squirtle:** muito fraco isoladamente no estágio inicial (6,3%), mas Blastoise com Butterfree venceu dois testes 2v2 contra dupla ofensiva. É plausível que o papel de tanque dependa da composição, e não de vitória individual.
3. **Snorlax:** domina confrontos iniciais como épico de alto custo (93,8%) e perde bastante contra evoluções completas (6,3%). Seu controle e resistência precisam ser avaliados em equipes e partidas longas para decidir se é aceitável.
4. **Koffing/Weezing:** o Raro inicial tem 68,8% de vitórias, enquanto o estágio final 31,3% contra todas as últimas evoluções. Não é motivo suficiente para buff imediato, mas merece atenção.
5. **Butterfree/Venusaur:** a cura em duelos isolados pode inflar a sobrevivência. A seleção dos dois aliados mais feridos foi testada; observar o efeito com mais unidades simultâneas é recomendável.

Uma amostra padronizada de 1v1 com IV fixo não representa o metagame real: itens, oportunidades de loja, custo, quantidade de cópias, posicionamento e composições podem inverter rankings. Os valores acima são sinais para testes in-game, não recomendações de alteração automática.

## Validação técnica

- `npm run check`: aprovado.
- `npm test`: 46 testes aprovados.
- `ASTRO_TELEMETRY_DISABLED=1 npm run build`: aprovado.
- Os arquivos PMD pesados permanecem externos ao ZIP. Os metadados de animação foram gerados dos XMLs originais, mas **o comportamento visual real deve ser conferido após mesclar `public/` com o repositório completo**.
