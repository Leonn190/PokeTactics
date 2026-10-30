# PokéTactics V18.5 — notas de integração

## Escopo

Atualização incremental das três pastas `config/`, `server/` e `src/`. Não substitui nem exclui os recursos originais de `public/`.

## Principais implementações

- `config/animacoes.json`: tabela de perfis visuais para microavanço/recuo, saltos, pulsação, sombras e âncoras de projétil por família e estágio.
- `server/data.ts`: o ataque básico preserva a animação escolhida explicitamente na configuração do Pokémon; valores de dano e atributos anteriores permanecem.
- `src/client/animation/visual-profiles.ts`, `src/client/vfx/casting-glints.ts`: movimentos e partículas cosméticos independentes das posições lógicas; sem timers próprios.
- `src/client/render/shadows.ts`: sombras cacheadas com escalas/opacidades individuais, terreno escurecido de Diglett/Dugtrio e suporte para saltos.
- `src/client/render/projectile-origin.ts`: pontos de origem visuais configuráveis por tipo de corpo.
- Ajustes de nomes de animação PMD em `config/pokemons.json` e chamadas do servidor, incluindo `Hop` de Magikarp, `Shock` de Pikachu, `Slam` de Onix, `Punch` de Geodude, `Shoot` de Blissey e animações dos fantasmas.
- Gyarados: preparação de mordida (`RearUp`) e acabamento da caudada (`Rumble`) com a regra anterior de dano e empurrão.
- Voltorb/Electrode: anunciam a explosão por 0,28 segundo antes do dano e do custo de 20% de vida máxima.
- Staryu/Starmie: espécie incomum nova, duas fases evolutivas, tipagens Água/Água+Psíquico, habilidade `Refração Estelar` que amplia o número de alvos regulares durante 3 s, com projéteis e impactos individualizados e energia por ataque.
- `src/client/pmd-manifest.json`: registros para 120 e 121 baseados nos seus AnimData.xml; o gerador do projeto deve atualizá-los novamente a partir dos arquivos locais durante o build.
- `src/pages/index.astro`, `src/styles/global.css`, `src/client/hud.ts`: inventário apoiado em área de chão; 9 espaços físicos e Pokébolas em extensão separada, sem título/painel; ações existentes reutilizadas.
- Texto de habilidades no catálogo e prévia de dano individual por disparo para Staryu/Starmie.

## Verificações executadas neste ambiente

- Checagem estrita do TypeScript de `server/**/*.ts` e `src/**/*.ts`: passou, sem erros.
- Simulação de Staryu: buff, dois alvos, sem duplicar energia, dano no impacto, expiração e retorno a alvo único: passou.
- Simulação de Starmie: três alvos e as mesmas garantias: passou.
- Simulação de Voltorb: telegráfo visual seguido de dano e gasto de 20% da vida máxima: passou.
- Simulação de Magikarp: carregado dispara `Hop`: passou.
- Comparação de arquivos: todos os 67 arquivos originais preservados.

## Limitações e dependências

Os `public/sprite/`, `public/portrait/`, `package.json`, `tsconfig.json`, scripts de build e dependências externas não fazem parte do ZIP de entrada, portanto não foi possível rodar `npm run build`, `npm run check` do projeto completo nem inspecionar o jogo num navegador. A checagem de TypeScript acima utilizou configuração estrita temporária e não o script npm do repositório.

Depois de substituir as pastas no checkout original, execute `npm run check` e `npm run build`. O build original executa `scripts/generate-pmd-manifest.mjs --skip-missing` e deve ler os arquivos PMD reais de `public/`. Confirme as animações exatas em todas as espécies, particularmente aquelas cujos sprites não estavam no manifesto recebido. Os fallback de animação são seguros, mas a revisão visual em runtime de *todas* as espécies e resoluções ainda é necessária antes de considerar essa etapa integralmente validada.
