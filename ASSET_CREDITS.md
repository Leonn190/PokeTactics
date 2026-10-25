# Créditos dos sprites PMD

As spritesheets animadas dos Pokémon Bulbasaur, Ivysaur, Venusaur, Charmander,
Charmeleon, Charizard, Squirtle, Wartortle, Blastoise, Pikachu e Raichu vêm do
[PMD Sprite Repository (PMDCollab/SpriteCollab)](https://github.com/PMDCollab/SpriteCollab).

- Animações e metadados originais: arquivos `sprite/<dex>/` do repositório.
- Direitos e licenciamento do material da comunidade: [Creative Commons
  Attribution-NonCommercial 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
- Política de contribuição e uso: [README oficial](https://github.com/PMDCollab/SpriteCollab#readme).
- Sprites estáticos remanescentes (UI e chefes): [PokeAPI/sprites](https://github.com/PokeAPI/sprites).

O projeto inclui apenas as spritesheets estritamente usadas pelas quatro
famílias, os seus metadados `AnimData.xml` e um manifesto gerado localmente.
Sprites PMD devem ser utilizados apenas em projetos não comerciais, respeitando
a atribuição aos colaboradores. Para créditos individuais, consulte o
repositório PMDCollab correspondente às espécies.

Recriar os dados de animação e baixar as fontes novamente:

```bash
python3 scripts/fetch_pmd.py
```

Os efeitos de partículas desenhados no canvas (pólen, água, fogo e raios) foram
implementados no código do PokéTactics e não são cópias de animações do PMDCollab.
