# PokéTactics V18.9 — relatório técnico de integração

## Estado e limites da auditoria

Esta entrega contém **implementação de código e auditoria estrutural de 65 formas em 35 famílias**, não uma aprovação visual completa. O ZIP de entrada não continha `public/sprite`, `public/portrait`, `scripts` originais, nem dependências npm. O manifesto inicial tinha 29 entradas. Portanto os marcadores extraídos de PMD reais ainda não foram medidos neste ambiente, nem se observaram 65 espécies rodando em navegador.

As configurações visuais abaixo cobrem cada forma individualmente, mas a coluna "manifesto" não constitui aprovação visual. `sim` significa que havia referência PMD no manifesto recebido; `não` significa que o gerador do checkout original deve resolver os recursos.

## Intervenções por família

- **caterpie** — Caterpie lança pelo rosto; Metapod não dá investida defensiva; Butterfree tem sombra aérea e emissão por asas.
- **weedle** — Weedle investe com ferrão; Kakuna não avança na defesa; Beedrill distingue Jab e preparação.
- **bulbasaur** — Bulbo/planta/flor foram escolhidos como origem traseira; três estágios com sombra apoiada.
- **charmander** — Ataque físico avança; habilidade usa recuo; ponto frontal preserva chama de cauda.
- **squirtle** — Recuo leve no básico e pulsação pequena na conjuração; concha e cauda não comandam o centro da âncora.
- **pikachu** — Choques sem investida forçada, composição elétrica curta; cauda não altera âncora.
- **koffing** — Fumegantes/voadores com sombras menores; emissão pelo corpo (duplo Weezing precisa inspeção do PMD).
- **snorlax** — Hop lógico não deve ser duplicado com o Hop PMD quando há Shadow markers; contato e aterrissagem.
- **articuno** — Sombra aérea pequena e discreta; manter forma de gelo do efeito existente.
- **zapdos** — Descarga estática, sem avanço genérico; sombra aérea.
- **moltres** — Evitar partículas extras além do efeito pré-existente; sombra aérea.
- **mewtwo** — Conjuração sem avanço e origem nas mãos quando PMD disponibilizar.
- **mew** — Conjuração/cura sem avanço; sombra de flutuação delicada.
- **cubone** — Lançamento pela mão/osso do PMD, sem emissão central.
- **onix** — Sombra alongada e mais ampla; Slam pode ser alias de Attack mas recebe impulso visual distinto.
- **geodude** — Punch e Slam têm avanços moderados; Golem Withdraw não recebe avanço físico adicional.
- **chansey** — Ovos ligados a mãos PMD; tratamento de cura não é substituído por avanço.
- **eevee** — Bola com recuo discreto; sem salto artificial.
- **vaporeon** — A origem aquática prefere boca/head PMD.
- **flareon** — Fogo com recuo curto, origem frontal.
- **jolteon** — Descarga elétrica com pulso discreto, sem investida.
- **umbreon** — Postura de solo e pulso discreto, sem salto automático.
- **sylveon** — Região de mãos/apêndices quando disponível, sem deslocamentos exagerados.
- **leafeon** — Planta emitida pela região traseira em ação apropriada.
- **glaceon** — Ataque glaciante estacionário e liberação com recuo leve.
- **espeon** — Conjuração psíquica ligada à região da cabeça, sem salto.
- **rhyhorn** — Sombra robusta, sensação de peso e avanços graduais por estágio.
- **vulpix** — Emissões de fogo pela boca; Ninetales tem recuo graduado sem mexer na cauda.
- **dratini** — Sopro alinhado à cabeça; Dragonair com conjuração curta; Dragonite sem salto aditivo no PMD.
- **diglett** — Sombra em modo embedded, sem buraco desenhado fora do sprite; apenas rastro no travel.
- **voltorb** — Explosão apresentada por pulso controlado; a regra de auto-perda de vida foi preservada.
- **gastly** — Gastly/Haunter usam sombra aérea e pontos de emissão anatômicos; Gengar mantém postura de solo.
- **machop** — Ataques carregados usam Kick PMD, sem alterações no empurrão 1/2/3.
- **magikarp** — Magikarp básico com investida horizontal e habilidade Hop; Gyarados RearUp/Rumble separados via perfil nominal (sway).
- **staryu** — Staryu/Starmie lançam pelo núcleo; Twirl/Rotate podem ser o mesmo sheet e os alvos continuam determinados pelo servidor.

## Matriz individual de formas e movimentos

| Espécie | Básico PMD | Habilidade PMD | Âncora de emissão | Sombra | Manifesto no ZIP |
|---|---|---|---|---|---|
| Caterpie | `Shoot` | `Attack` | `mouth` | contato, escala 1.00 | sim |
| Metapod | `Shoot` | `SpAttack` | `body` | contato, escala 1.00 | sim |
| Butterfree | `Shoot` | `FlapAround` | `wings` | aérea, escala 0.61 | sim |
| Weedle | `Attack` | `Strike` | `mouth` | contato, escala 1.00 | sim |
| Kakuna | `Attack` | `Twirl` | `body` | contato, escala 1.00 | sim |
| Beedrill | `Attack` | `Jab` | `hands` | aérea, escala 0.67 | sim |
| Bulbasaur | `Shoot` | `Attack` | `back` | contato, escala 0.88 | sim |
| Ivysaur | `Shoot` | `Attack` | `back` | contato, escala 1.05 | sim |
| Venusaur | `Shoot` | `Attack` | `back` | contato, escala 1.25 | sim |
| Charmander | `Attack` | `Attack` | `mouth` | contato, escala 1.00 | sim |
| Charmeleon | `Attack` | `Attack` | `mouth` | contato, escala 1.00 | sim |
| Charizard | `Attack` | `Attack` | `mouth` | contato, escala 1.02 | sim |
| Squirtle | `Attack` | `Attack` | `mouth` | contato, escala 1.00 | sim |
| Wartortle | `Attack` | `Attack` | `mouth` | contato, escala 1.00 | sim |
| Blastoise | `Attack` | `Attack` | `mouth` | contato, escala 1.00 | sim |
| Pikachu | `Shoot` | `Shock` | `body` | contato, escala 1.00 | sim |
| Raichu | `Shoot` | `Shock` | `body` | contato, escala 1.00 | sim |
| Koffing | `Attack` | `Gas` | `body` | aérea, escala 0.60 | sim |
| Weezing | `Attack` | `Gas` | `body` | aérea, escala 0.68 | sim |
| Snorlax | `Attack` | `Hop` | `body` | contato, escala 1.25 | sim |
| Articuno | `Shoot` | `Attack` | `wings` | aérea, escala 0.70 | não |
| Zapdos | `Shoot` | `Attack` | `body` | aérea, escala 0.75 | não |
| Moltres | `Shoot` | `Attack` | `body` | aérea, escala 0.78 | não |
| Mewtwo | `Shoot` | `Attack` | `hands` | contato, escala 1.00 | não |
| Mew | `Shoot` | `Charge` | `hands` | aérea, escala 0.43 | não |
| Cubone | `Attack` | `Shoot` | `hands` | contato, escala 1.00 | não |
| Marowak | `Attack` | `Shoot` | `hands` | contato, escala 1.00 | não |
| Onix | `Attack` | `Slam` | `front` | contato, escala 1.45 | não |
| Steelix | `Attack` | `Strike` | `front` | contato, escala 1.58 | não |
| Geodude | `Attack` | `Punch` | `hands` | contato, escala 0.75 | não |
| Graveler | `Attack` | `Slam` | `hands` | contato, escala 1.10 | não |
| Golem | `Attack` | `Withdraw` | `body` | contato, escala 1.25 | não |
| Chansey | `Attack` | `SpAttack` | `hands` | contato, escala 1.00 | não |
| Blissey | `Attack` | `Shoot` | `hands` | contato, escala 1.00 | não |
| Eevee | `Attack` | `Shoot` | `front` | contato, escala 1.00 | não |
| Vaporeon | `Attack` | `SpAttack` | `mouth` | contato, escala 1.00 | não |
| Flareon | `Attack` | `Shoot` | `mouth` | contato, escala 1.00 | não |
| Jolteon | `Attack` | `Shock` | `body` | contato, escala 1.00 | não |
| Umbreon | `Attack` | `Emit` | `body` | contato, escala 1.00 | não |
| Sylveon | `Attack` | `SpAttack` | `hands` | contato, escala 1.00 | não |
| Leafeon | `Attack` | `Shoot` | `back` | contato, escala 1.00 | não |
| Glaceon | `Attack` | `Shoot` | `mouth` | contato, escala 1.00 | não |
| Espeon | `Attack` | `Twirl` | `head` | contato, escala 1.00 | não |
| Rhyhorn | `Attack` | `Walk` | `front` | contato, escala 1.13 | não |
| Rhydon | `Attack` | `Walk` | `front` | contato, escala 1.25 | não |
| Rhyperior | `Attack` | `Walk` | `front` | contato, escala 1.35 | não |
| Vulpix | `Shoot` | `SpAttack` | `mouth` | contato, escala 1.00 | não |
| Ninetales | `Shoot` | `SpAttack` | `mouth` | contato, escala 1.00 | não |
| Dratini | `Shoot` | `Shoot` | `mouth` | contato, escala 0.77 | não |
| Dragonair | `Shoot` | `Shoot` | `mouth` | aérea, escala 0.86 | não |
| Dragonite | `Attack` | `Hop` | `body` | contato, escala 1.05 | não |
| Diglett | `Attack` | `Attack` | `front` | embedded, escala 1.00 | sim |
| Dugtrio | `Attack` | `Attack` | `front` | embedded, escala 1.00 | sim |
| Voltorb | `Attack` | `Attack` | `front` | contato, escala 0.77 | sim |
| Electrode | `Attack` | `Attack` | `front` | contato, escala 1.02 | sim |
| Gastly | `Shoot` | `Lick` | `mouth` | aérea, escala 0.55 | sim |
| Haunter | `Shoot` | `MultiStrike` | `hands` | aérea, escala 0.60 | sim |
| Gengar | `Shoot` | `Strike` | `hands` | contato, escala 0.76 | sim |
| Machop | `Attack` | `Kick` | `front` | contato, escala 0.83 | não |
| Machoke | `Attack` | `Kick` | `front` | contato, escala 1.00 | não |
| Machamp | `Attack` | `Kick` | `front` | contato, escala 1.15 | não |
| Magikarp | `Attack` | `Hop` | `front` | contato, escala 1.00 | não |
| Gyarados | `Attack` | `Attack` | `mouth` | contato, escala 1.00 | não |
| Staryu | `Shoot` | `Twirl` | `core` | contato, escala 0.64 | sim |
| Starmie | `Shoot` | `Twirl` | `core` | contato, escala 0.69 | sim |

## Arquitetura e garantias

- `scripts/generate-pmd-manifest.mjs`: usa `AnimData.xml`, decompõe PNGs `Shadow`/`Offsets` (marcadores; nunca texturas) em coordenadas compactas por direção/frame, reconhece `CopyOf`, `HitFrame` inclusive zero, Rush/Return, e recalcula o manifesto apenas a partir das 65 formas preservadas.
- `src/client/animation/pmd-metadata.ts`: indexa âncoras/frames e interpreta aliases/HitFrame.
- `src/client/arena.ts`: mantém âncoras PMD estáveis, usa pixels opacos só para a altura das barras, seleciona perfil básico ou carregado e deriva sombra de chão; mantém os demais estados e interações.
- `src/client/render/shadows.ts`: texturas cacheadas de contato em vez de buracos artificiais; perfis de voo/solo e tamanho de sombra PMD.
- `src/client/render/projectile-origin.ts`: prioriza pontos de cabeça/mãos/corpo do PMD e, na ausência, fallback anatômico por estágio e direção.
- `server/combat/effects.ts`: apenas acrescenta `sourceId` para apresentação visual; nenhuma regra do motor é alterada.
- `src/client/vfx/casting-glints.ts`: pulso visual próximo ao `HitFrame` quando conhecido, sem mudar o relógio lógico ou aplicar novo dano.

## Validação realizada

- **PASSOU:** `tsc` estrito de `server/**/*.ts` e `src/**/*.ts` em configuração temporária, sem compilar Astro e sem dependências npm do projeto.
- **PASSOU:** `node scripts/check-v18-9.mjs` (35 famílias, 65 formas, todas com perfil por ação, seis ausentes, sem configurações PMD órfãs).
- **PASSOU:** teste do gerador com PNGs sintéticos para marcadores brancos de sombra, canais RGB, Offsets, 8 direções, aliases e `HitFrame=0`.
- **PASSOU:** diff de configuração: gameplay (atributos das formas preservadas, ataques, regras, itens, sinergias, fases, engine e UI de itens) igual ao original; efeito só ganha referência visual `sourceId`.
- **NÃO EXECUTADO:** `npm run build`, `npm run check` do projeto completo (dependências e tooling fora do ZIP); teste em navegador, capturas antes/depois e aferição de FPS real (assets ausentes).

## Aplicação no repositório original

**Mescle** `config/`, `server/`, `src/` e os scripts novos `scripts/generate-pmd-manifest.mjs`, `scripts/check-v18-9.mjs` e `scripts/prune-v18-9-assets.mjs`; **não exclua** `public/` ou arquivos não presentes no ZIP. O `prebuild` do repositório já chama `node scripts/generate-pmd-manifest.mjs --skip-missing`, portanto substitua esse script pela V18.9. Execute `node scripts/prune-v18-9-assets.mjs` para verificar arte exclusiva dos seis removidos e `node scripts/prune-v18-9-assets.mjs --apply` para apagá-la somente após revisar a lista. Depois execute `npm run check && npm run build` no checkout com os assets reais. Se algum PMD estiver ausente, o gerador mantém fallback existente e emite avisos; certifique-se de que todos os 65 IDs existam no build antes de aprovar visualmente.

Após build, teste cada item da matriz em uma luta e, em especial, Magikarp, Diglett, Gyarados, Snorlax, Onix e Pokémon voadores. Este relatório não afirma aprovação visual inexistente.
