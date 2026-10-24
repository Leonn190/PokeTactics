#!/usr/bin/env python3
"""Baixa sprites completos do PMDCollab, portraits Normal e ícones para PokéTactics.

Fontes:
  PMDCollab/SpriteCollab  https://github.com/PMDCollab/SpriteCollab
  PokeAPI/sprites          https://github.com/PokeAPI/sprites

Requisitos: Python 3.10+ e Git instalado (para o acervo PMD).
Não necessita de pacotes Python de terceiros.

Exemplos:
  python baixar_assets_poketactics.py
  python baixar_assets_poketactics.py --pmd gen1-2
  python baixar_assets_poketactics.py --pmd ids --ids 1,4,7,25,39
  python baixar_assets_poketactics.py --sem-pmd
  python baixar_assets_poketactics.py --destino D:/PokeTactics_Assets
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PMD_REPO = "https://github.com/PMDCollab/SpriteCollab.git"
POKEAPI_RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites"
PMD_BRANCH = "master"

# IDs da PokéAPI: 1–18 representam os tipos tradicionais.
TIPOS = {
    "normal": 1, "fighting": 2, "flying": 3, "poison": 4,
    "ground": 5, "rock": 6, "bug": 7, "ghost": 8,
    "steel": 9, "fire": 10, "water": 11, "grass": 12,
    "electric": 13, "psychic": 14, "ice": 15, "dragon": 16,
    "dark": 17, "fairy": 18,
}

# Apenas Pokébolas propriamente ditas; exclui itens como Light Ball/Iron Ball.
# Nomes LA* correspondem aos modelos especiais de Legends: Arceus no repositório.
POKEBOLAS = (
    "poke-ball", "great-ball", "ultra-ball", "master-ball",
    "premier-ball", "luxury-ball", "heal-ball", "net-ball",
    "nest-ball", "dive-ball", "repeat-ball", "timer-ball",
    "quick-ball", "dusk-ball", "cherish-ball", "safari-ball",
    "sport-ball", "park-ball", "dream-ball", "beast-ball",
    "level-ball", "lure-ball", "moon-ball", "friend-ball",
    "love-ball", "heavy-ball", "fast-ball", "strange-ball",
    "lapoke-ball", "lagreat-ball", "laultra-ball",
    "lafeather-ball", "lawing-ball", "lajet-ball",
    "laheavy-ball", "laleaden-ball", "lagigaton-ball",
    "laorigin-ball", "lastrange-ball",
)


def argumentos() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Baixa animações do PMD, portraits Normal, tipos e Pokébolas."
    )
    parser.add_argument(
        "--destino", type=Path, default=Path("PokeTactics_Assets"),
        help="Pasta de saída (padrão: ./PokeTactics_Assets).",
    )
    parser.add_argument(
        "--pmd", choices=("todos", "gen1-2", "ids"), default="todos",
        help="Quais Pokémon baixar do PMD (padrão: todos).",
    )
    parser.add_argument(
        "--ids", default="", help="Lista de IDs da Pokédex; usar com --pmd ids. Ex.: 1,4,7,25"
    )
    parser.add_argument("--sem-pmd", action="store_true", help="Baixar apenas tipos e Pokébolas.")
    parser.add_argument("--sem-tipos", action="store_true", help="Não baixar ícones de tipagem.")
    parser.add_argument("--sem-pokebolas", action="store_true", help="Não baixar Pokébolas.")
    parser.add_argument("--sem-portraits", action="store_true", help="Não baixar portraits Normal.")
    parser.add_argument("--trabalhadores", type=int, default=6, help="Downloads simultâneos (1–16).")
    parser.add_argument("--atualizar-imagens", action="store_true", help="Substituir PNGs existentes.")
    parser.add_argument("--nao-atualizar-pmd", action="store_true", help="Não buscar novos commits se já clonado.")
    return parser.parse_args()


def selecionar_ids(args: argparse.Namespace) -> list[int] | None:
    if args.pmd == "todos":
        return None
    if args.pmd == "gen1-2":
        return list(range(1, 252))
    try:
        ids = sorted({int(x.strip()) for x in args.ids.split(",") if x.strip()})
    except ValueError as exc:
        raise ValueError("--ids deve conter apenas números separados por vírgulas.") from exc
    if not ids or any(n < 1 or n > 9999 for n in ids):
        raise ValueError("Informe pelo menos um ID da Pokédex entre 1 e 9999.")
    return ids


def git(comando: list[str], pasta: Path | None = None) -> str:
    cmd = ["git"] + (["-C", str(pasta)] if pasta else []) + comando
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True)
    if completed.stderr.strip():
        # O Git frequentemente escreve o progresso e avisos no stderr.
        print(completed.stderr.strip()[-1100:])
    return completed.stdout.strip()


def padrões_pmd(ids: list[int] | None, portraits: bool) -> list[str]:
    paths = ["/LICENSE.md", "/README.md", "/sprite_config.json",
             "/spritebot_credits.txt", "/credit_names.txt"]
    if ids is None:
        paths.append("/sprite/**")
        if portraits:
            # Só portrait/<dex>/Normal.png, sem emoções nem subformas/shinies.
            paths.append("/portrait/*/Normal.png")
            paths.append("/portrait/*/credits.txt")
    else:
        for pokedex_id in ids:
            folder = f"{pokedex_id:04d}"
            # Inclui todos os arquivos de animação, offsets, sombras, XML e créditos.
            paths.append(f"/sprite/{folder}/**")
            if portraits:
                paths.append(f"/portrait/{folder}/Normal.png")
                paths.append(f"/portrait/{folder}/credits.txt")
    return paths


def baixar_pmd(destino: Path, ids: list[int] | None, portraits: bool, atualizar: bool) -> dict:
    if not shutil.which("git"):
        raise RuntimeError("Git não encontrado. Instale Git for Windows: https://git-scm.com/downloads")
    pasta = destino / "pmd"
    pasta_git = pasta / ".git"
    if pasta.exists() and not pasta_git.exists():
        raise RuntimeError(f"{pasta} existe, mas não é um clone gerenciado pelo script. "
                           "Escolha outra pasta com --destino para não sobrescrever seus arquivos.")

    if not pasta.exists():
        print("[PMD] Iniciando clone parcial do SpriteCollab. O acervo completo pode ser muito grande...")
        git(["clone", "--depth", "1", "--filter=blob:none", "--sparse",
             "--branch", PMD_BRANCH, PMD_REPO, str(pasta)])
    else:
        origem = git(["remote", "get-url", "origin"], pasta)
        if "pmdcollab/spritecollab" not in origem.lower():
            raise RuntimeError(f"Origem inesperada em {pasta}: {origem}")
        if atualizar:
            print("[PMD] Atualizando o repositório (somente fast-forward)...")
            git(["pull", "--ff-only", "origin", PMD_BRANCH], pasta)
        else:
            print("[PMD] Usando cópia existente, sem atualizar commits.")

    # Acumula padrões anteriores. Trocar para um subconjunto não apaga assets já obtidos.
    existentes = git(["sparse-checkout", "list"], pasta).splitlines()
    anteriores = [s for s in existentes if s.startswith(("/sprite/", "/portrait/"))]
    padroes = list(dict.fromkeys(padrões_pmd(ids, portraits) + anteriores))
    print(f"[PMD] Selecionando {len(padroes)} padrões de arquivos...")
    git(["sparse-checkout", "set", "--no-cone", *padroes], pasta)

    pasta_sprites = pasta / "sprite"
    if not pasta_sprites.is_dir():
        raise RuntimeError("Não encontrei a pasta pmd/sprite após o checkout.")

    # A conferência percorre diretórios, mas não abre os PNGs (rápida e sem memória extra).
    sheets = sum(1 for _ in pasta_sprites.rglob("*-Anim.png"))
    xmls = sum(1 for _ in pasta_sprites.rglob("AnimData.xml"))
    retratos = sum(1 for _ in (pasta / "portrait").rglob("Normal.png")) if portraits else 0
    print(f"[PMD] {sheets} spritesheets de animação, {xmls} XMLs, "
          f"{retratos} portraits Normal na pasta.")
    return {
        "fonte": "https://github.com/PMDCollab/SpriteCollab",
        "commit": git(["rev-parse", "HEAD"], pasta),
        "ultima_solicitacao": "todos" if ids is None else f"{len(ids)} IDs solicitados",
        "observacao_contagem": "As contagens incluem arquivos preservados de execuções anteriores.",
        "sprites_dir": "pmd/sprite",
        "portraits_dir": "pmd/portrait" if portraits else None,
        "spritesheets_anim": sheets,
        "arquivos_animdata_xml": xmls,
        "portraits_normal": retratos,
        "licenca": "CC BY-NC 4.0: atribuição obrigatória, uso não comercial",
    }


def baixar_png(nome: str, url: str, caminho: Path, atualizar: bool) -> tuple[str, str, str]:
    if caminho.exists() and caminho.stat().st_size >= 8 and not atualizar:
        return (nome, "existente", url)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    parcial = caminho.with_name(caminho.name + ".part")
    request = Request(url, headers={"User-Agent": "PokeTacticsAssets/1.0", "Accept": "image/png"})
    for tentativa in range(1, 5):
        try:
            with urlopen(request, timeout=35) as resposta, parcial.open("wb") as arquivo:
                inicio = resposta.read(8)
                if inicio != b"\x89PNG\r\n\x1a\n":
                    raise RuntimeError("A resposta não contém um arquivo PNG válido.")
                arquivo.write(inicio)
                while bloco := resposta.read(256 * 1024):
                    arquivo.write(bloco)
            os.replace(parcial, caminho)
            return (nome, "baixado", url)
        except (HTTPError, URLError, OSError, RuntimeError) as exc:
            parcial.unlink(missing_ok=True)
            # 404 não é temporário; demais erros merecem retentativas.
            if isinstance(exc, HTTPError) and exc.code == 404:
                return (nome, "erro: 404", url)
            if tentativa == 4:
                return (nome, f"erro: {exc}", url)
            time.sleep(0.7 * 2 ** (tentativa - 1))
    return (nome, "erro desconhecido", url)


def baixar_imagens(destino: Path, trabalhadores: int, atualizar: bool,
                   tipos: bool, bolas: bool) -> dict:
    tarefas: list[tuple[str, str, Path, str]] = []
    if tipos:
        for nome, numero in TIPOS.items():
            url = f"{POKEAPI_RAW}/types/generation-ix/scarlet-violet/{numero}.png"
            tarefas.append((nome, url, destino / "tipos" / f"{nome}.png", "tipos"))
    if bolas:
        for nome in POKEBOLAS:
            url = f"{POKEAPI_RAW}/items/{nome}.png"
            tarefas.append((nome, url, destino / "pokebolas" / f"{nome}.png", "pokebolas"))

    resultados: dict[str, dict] = {"tipos": {}, "pokebolas": {}}
    with ThreadPoolExecutor(max_workers=trabalhadores) as executor:
        pendentes = {
            executor.submit(baixar_png, nome, url, arquivo, atualizar): (categoria, arquivo)
            for nome, url, arquivo, categoria in tarefas
        }
        total = len(pendentes)
        for numero, futuro in enumerate(as_completed(pendentes), start=1):
            categoria, arquivo = pendentes[futuro]
            nome, estado, url = futuro.result()
            resultados[categoria][nome] = {
                "arquivo": arquivo.relative_to(destino).as_posix(),
                "fonte": url,
                "estado": estado,
            }
            print(f"[{numero:02d}/{total:02d}] {categoria}/{nome}: {estado}")
    return resultados


def gravar_metadados(destino: Path, resumo: dict) -> None:
    (destino / "manifesto_assets.json").write_text(
        json.dumps(resumo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    creditos = """# Fontes, direitos e créditos — PokéTactics

## Sprites animados e portraits PMD

- Fonte: https://github.com/PMDCollab/SpriteCollab
- Licença informada pelos autores: CC BY-NC 4.0, com atribuição e uso não comercial.
- Confira e preserve `pmd/LICENSE.md`, `pmd/spritebot_credits.txt`,
  `pmd/credit_names.txt` e os `credits.txt` individuais.
- Animations: `pmd/sprite/<número de 4 dígitos>/*-Anim.png`, com
  `*-Offsets.png`, `*-Shadow.png` e `AnimData.xml` correspondentes.
- Retrato neutro: `pmd/portrait/<número de 4 dígitos>/Normal.png`.
- Não se deve supor que todo Pokémon possui todas as animações e retratos.

## Tipos e Pokébolas

- Fonte: https://github.com/PokeAPI/sprites
- As imagens fazem referência à franquia Pokémon e podem estar sujeitas a
  direitos de seus respectivos criadores e titulares.
- Verifique a política de uso de cada coleção antes de distribuir/comercializar.

## Uso no jogo

Esta pasta é um acervo de origem, NÃO uma pasta pronta para publicar inteira
no GitHub Pages. Selecione e otimize os assets de fato usados no PokéTactics.
O diretório `pmd/.git` existe para permitir atualizações do acervo e NÃO deve
ser copiado para `public/` nem incluído em deploys.
"""
    (destino / "FONTES_E_CREDITOS.md").write_text(creditos, encoding="utf-8")


def main() -> int:
    args = argumentos()
    if not 1 <= args.trabalhadores <= 16:
        print("ERRO: --trabalhadores deve estar entre 1 e 16.", file=sys.stderr)
        return 2
    if args.pmd != "ids" and args.ids:
        print("ERRO: use --pmd ids junto com --ids.", file=sys.stderr)
        return 2
    try:
        ids = selecionar_ids(args)
    except ValueError as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2
    destino = args.destino.expanduser().resolve()
    destino.mkdir(parents=True, exist_ok=True)
    print(f"Pasta de saída: {destino}")
    manifesto = destino / "manifesto_assets.json"
    try:
        anterior = json.loads(manifesto.read_text(encoding="utf-8")) if manifesto.exists() else {}
        if not isinstance(anterior, dict):
            anterior = {}
    except (OSError, ValueError):
        anterior = {}
    resumo: dict = {
        **anterior,
        "gerado_em": datetime.now(timezone.utc).isoformat(),
        "uso": "Acervo para seleção manual no PokéTactics; não publique tudo de uma vez.",
    }
    falha_pmd = False
    if not args.sem_pmd:
        try:
            resumo["pmd"] = baixar_pmd(destino, ids, not args.sem_portraits, not args.nao_atualizar_pmd)
        except (RuntimeError, subprocess.CalledProcessError, OSError) as exc:
            falha_pmd = True
            print(f"[PMD] ERRO: {exc}", file=sys.stderr)
            print("[PMD] É possível repetir o script depois; arquivos já baixados serão reaproveitados.")

    imagens = baixar_imagens(
        destino, args.trabalhadores, args.atualizar_imagens,
        not args.sem_tipos, not args.sem_pokebolas,
    )
    if not args.sem_tipos:
        resumo["tipos"] = imagens["tipos"]
    if not args.sem_pokebolas:
        resumo["pokebolas"] = imagens["pokebolas"]
    gravar_metadados(destino, resumo)
    erros = [(categoria, nome) for categoria, itens in imagens.items()
             for nome, dados in itens.items() if str(dados["estado"]).startswith("erro")]
    print(f"\nConcluído em: {destino}")
    print("Manifesto: manifesto_assets.json | Créditos: FONTES_E_CREDITOS.md")
    if erros:
        print(f"Falharam {len(erros)} PNG(s). Execute novamente para tentar baixar os restantes.")
    return 1 if falha_pmd or erros else 0


if __name__ == "__main__":
    raise SystemExit(main())
