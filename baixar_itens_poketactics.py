#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Baixa os 27 sprites de itens aprovados para o PokéTactics.

Coloque este arquivo na RAIZ do repositório (ao lado de config/ e public/) e execute:

    python baixar_itens_poketactics.py

Saída:
    public/itens/green.png               -> componente verde
    public/itens/regeneration.png        -> receita green+green
    public/itens/guinsoo.png             -> receita orange+red
    public/itens/manifest.json           -> relação dos IDs do jogo com os PNGs

Só usa bibliotecas padrão do Python. Se Pillow estiver instalado, também
redimensiona/padroniza todos os PNGs a 128x128 com transparência; se não
estiver, conserva os PNGs originais (já prontos para uso).

Atenção: os desenhos são propriedade intelectual da Riot Games. Verifique
as permissões de uso antes de publicá-los em um jogo independente.
"""

from __future__ import annotations

import argparse
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Arquivos escolhidos: coluna A da tabela aprovada pelo usuário.
# Os nomes abaixo foram conferidos no índice de arquivos do CommunityDragon.
FONTE = "https://raw.communitydragon.org/latest/game/assets/maps/tft/icons/items/hexcore"

# Chave = ID real de config/itens.json; valor = nome original do PNG do TFT.
SPRITES_COMPONENTES = {
    "green": "tft_item_giantsbelt.png",
    "blue": "tft_item_negatroncloak.png",
    "purple": "tft_item_needlesslylargerod.png",
    "orange": "tft_item_bfsword.png",
    "yellow": "tft_item_chainvest.png",
    "red": "tft_item_recurvebow.png",
}

# Chave = campo "effect" de cada receita em config/itens.json.
SPRITES_EFEITOS = {
    "regeneration": "tft_item_warmogsarmor.png",
    "adaptive_shield": "tft_item_crownguard.png",
    "ally_healing": "tft_item_moonstone.png",
    "vampirism": "tft_item_bloodthirster.png",
    "burn_aura": "tft_item_eternalflame.png",
    "cast_haste": "tft_item_zekesherald.png",
    "magic_guard": "tft_item_dragonsclaw.png",
    "scaling_spa": "tft_item_archangelsstaff.png",
    "opening_immunity": "tft_item_quicksilver.png",
    "focused_defense": "tft_item_gargoylestoneplate.png",
    "bonus_energy": "tft_item_bluebuff.png",
    "archmage": "tft_item_rabadonsdeathcap.png",
    "spell_critical": "tft_item_jeweledgauntlet.png",
    "magic_sunder": "tft_item_voidstaff.png",
    "cast_wave": "tft_item_artifact_ludenstempest.png",
    "executioner": "tft_item_deathblade.png",
    "armor_break": "tft_item_lastwhisper.png",
    "guinsoo": "tft_item_guinsoosrageblade.png",
    "bramble": "tft_item_bramblevest.png",
    "titan": "tft_item_titansresolve.png",
    "longbow": "tft_item_rapidfirecannon.png",
}

ASSINATURA_PNG = b"\x89PNG\r\n\x1a\n"


def buscar_pillow():
    """Pillow é opcional: os sprites também funcionam sem instalação extra."""
    try:
        from PIL import Image, ImageOps
        return Image, ImageOps
    except ImportError:
        return None, None


def obter_dados(url: str, tentativas: int = 3) -> bytes:
    for tentativa in range(1, tentativas + 1):
        requisicao = Request(
            url,
            headers={
                "User-Agent": "PokeTactics-ItemImporter/1.0 (Python urllib)",
                "Accept": "image/png,image/*;q=0.8",
            },
        )
        try:
            with urlopen(requisicao, timeout=30) as resposta:
                # Proteção contra respostas inesperadamente grandes.
                dados = resposta.read(8 * 1024 * 1024 + 1)
                if len(dados) > 8 * 1024 * 1024:
                    raise ValueError("Arquivo maior que 8 MB")
                if not dados.startswith(ASSINATURA_PNG):
                    raise ValueError("Servidor não retornou um PNG válido")
                return dados
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as erro:
            # Erros 404 não melhoram com repetição.
            if isinstance(erro, HTTPError) and erro.code == 404:
                raise RuntimeError(f"Sprite não encontrado (HTTP 404): {url}") from erro
            if tentativa == tentativas:
                raise RuntimeError(f"Falha ao baixar {url}: {erro}") from erro
            time.sleep(tentativa * 1.5)
    raise RuntimeError(f"Não foi possível baixar: {url}")


def padronizar_png(dados: bytes, tamanho: int, Image, ImageOps) -> bytes:
    """Centraliza o ícone em PNG RGBA quadrado, sem cortar a arte original."""
    if Image is None:
        return dados
    with Image.open(BytesIO(dados)) as arquivo:
        arquivo.load()  # Valida o arquivo PNG inteiro.
        arte = arquivo.convert("RGBA")
    arte = ImageOps.contain(arte, (tamanho, tamanho), method=Image.Resampling.LANCZOS)
    quadrado = Image.new("RGBA", (tamanho, tamanho), (0, 0, 0, 0))
    posicao = ((tamanho - arte.width) // 2, (tamanho - arte.height) // 2)
    quadrado.alpha_composite(arte, posicao)
    saida = BytesIO()
    quadrado.save(saida, format="PNG", optimize=True)
    return saida.getvalue()


def existente_valido(caminho: Path, tamanho: int, Image) -> bool:
    if not caminho.is_file() or caminho.stat().st_size < 100:
        return False
    try:
        with caminho.open("rb") as arquivo:
            if arquivo.read(8) != ASSINATURA_PNG:
                return False
        if Image is not None:
            with Image.open(caminho) as arte:
                arte.verify()
            with Image.open(caminho) as arte:
                return arte.size == (tamanho, tamanho)
        return True
    except (OSError, ValueError, SyntaxError):
        return False


def gravar_atomicamente(caminho: Path, conteudo: bytes) -> None:
    """Não deixa PNG incompleto caso a gravação seja interrompida."""
    temporario = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=caminho.parent, prefix=".item-", suffix=".tmp", delete=False) as arquivo:
            temporario = Path(arquivo.name)
            arquivo.write(conteudo)
        os.replace(temporario, caminho)
    finally:
        if temporario is not None:
            temporario.unlink(missing_ok=True)


def validar_catalogo(config: dict) -> tuple[dict, dict]:
    componentes = config.get("components")
    receitas = config.get("recipes")
    if not isinstance(componentes, dict) or not isinstance(receitas, dict):
        raise ValueError("config/itens.json precisa ter os objetos 'components' e 'recipes'.")

    for chave, receita in receitas.items():
        if not isinstance(receita, dict) or not isinstance(receita.get("effect"), str):
            raise ValueError(f"Receita inválida: {chave}")

    faltando_componentes = sorted(set(componentes) - set(SPRITES_COMPONENTES))
    faltando_efeitos = sorted({r["effect"] for r in receitas.values()} - set(SPRITES_EFEITOS))
    if faltando_componentes or faltando_efeitos:
        detalhes = []
        if faltando_componentes:
            detalhes.append("Componentes sem sprite: " + ", ".join(faltando_componentes))
        if faltando_efeitos:
            detalhes.append("Efeitos sem sprite: " + ", ".join(map(str, faltando_efeitos)))
        raise ValueError("; ".join(detalhes))

    for chave, receita in receitas.items():
        partes = chave.split("+")
        if len(partes) != 2 or any(parte not in componentes for parte in partes):
            raise ValueError(f"Componentes da receita {chave} não existem no JSON")
    for nome in list(componentes) + [r["effect"] for r in receitas.values()]:
        if not nome or not nome.isascii() or not all(c.isalnum() or c == "_" for c in nome):
            raise ValueError(f"Nome inseguro para arquivo: {nome!r}")
    return componentes, receitas


def main() -> int:
    parser = argparse.ArgumentParser(description="Baixa os sprites escolhidos do TFT para public/itens do PokéTactics.")
    parser.add_argument("--tamanho", type=int, default=128, help="Dimensão do ícone se Pillow estiver instalado (padrão: 128).")
    parser.add_argument("--forcar", action="store_true", help="Baixa novamente até os PNGs existentes.")
    argumentos = parser.parse_args()
    if not 16 <= argumentos.tamanho <= 1024:
        parser.error("--tamanho deve estar entre 16 e 1024")

    raiz = Path(__file__).resolve().parent
    caminho_config = raiz / "config" / "itens.json"
    if not caminho_config.is_file() or not (raiz / "public").is_dir():
        print("ERRO: coloque este .py na raiz do PokéTactics, onde existem config/itens.json e public/.", file=sys.stderr)
        return 1

    try:
        config = json.loads(caminho_config.read_text(encoding="utf-8-sig"))
        componentes, receitas = validar_catalogo(config)
    except (OSError, json.JSONDecodeError, ValueError) as erro:
        print(f"ERRO na configuração: {erro}", file=sys.stderr)
        return 1

    pasta = raiz / "public" / "itens"
    pasta.mkdir(parents=True, exist_ok=True)
    Image, ImageOps = buscar_pillow()
    if Image is None:
        print("AVISO: Pillow não instalado. Vou preservar o tamanho original dos PNGs.")
        print("Para normalizar em 128x128: python -m pip install pillow\n")

    mapa_componentes = {}
    mapa_receitas = {}
    mapa_efeitos = {}
    origens = {}
    tarefas = []

    for id_comp in componentes:
        imagem = SPRITES_COMPONENTES[id_comp]
        nome_arquivo = f"{id_comp}.png"
        mapa_componentes[id_comp] = f"/itens/{nome_arquivo}"
        tarefas.append((nome_arquivo, imagem))
        origens[nome_arquivo] = f"{FONTE}/{imagem}"

    for receita_id, dados in receitas.items():
        efeito = dados["effect"]
        imagem = SPRITES_EFEITOS[efeito]
        nome_arquivo = f"{efeito}.png"
        caminho = f"/itens/{nome_arquivo}"
        mapa_receitas[receita_id] = caminho
        mapa_efeitos[efeito] = caminho
        if nome_arquivo not in origens:
            tarefas.append((nome_arquivo, imagem))
            origens[nome_arquivo] = f"{FONTE}/{imagem}"

    print(f"PokéTactics: {len(mapa_componentes)} componentes + {len(mapa_receitas)} receitas.")
    print(f"Destino: {pasta}")
    print(f"Total de arquivos PNG únicos: {len(tarefas)}\n")
    baixados = 0
    aproveitados = 0
    falhas = []

    for posicao, (nome_arquivo, imagem) in enumerate(tarefas, start=1):
        destino = pasta / nome_arquivo
        prefixo = f"[{posicao:02}/{len(tarefas):02}] {nome_arquivo}"
        if not argumentos.forcar and existente_valido(destino, argumentos.tamanho, Image):
            print(f"{prefixo} — já existe, ignorado")
            aproveitados += 1
            continue
        try:
            url = f"{FONTE}/{imagem}"
            dados = obter_dados(url)
            resultado = padronizar_png(dados, argumentos.tamanho, Image, ImageOps)
            gravar_atomicamente(destino, resultado)
            baixados += 1
            print(f"{prefixo} — OK ({len(resultado) // 1024} KB)")
        except (RuntimeError, OSError, ValueError) as erro:
            falhas.append((nome_arquivo, str(erro)))
            print(f"{prefixo} — FALHA: {erro}", file=sys.stderr)

    if falhas:
        print(f"\nERRO: {len(falhas)} sprite(s) falharam; manifest.json não será atualizado.", file=sys.stderr)
        print("Você pode executar de novo: os arquivos já baixados serão reaproveitados.", file=sys.stderr)
        return 1

    manifesto = {
        "description": "Sprites de itens escolhidos para o PokéTactics (opção A)",
        "source": FONTE,
        "components": mapa_componentes,
        "recipes": mapa_receitas,
        "effects": mapa_efeitos,
        "original_urls": origens,
    }
    gravar_atomicamente(
        pasta / "manifest.json",
        (json.dumps(manifesto, indent=2, ensure_ascii=False) + "\n").encode("utf-8"),
    )
    print(f"\nCONCLUÍDO: {len(tarefas)} sprites disponíveis ({baixados} novos, {aproveitados} reaproveitados).")
    print("Manifesto: public/itens/manifest.json")
    print("Exemplo de acesso no jogo: /itens/guinsoo.png")
    print("Observação: este script baixa os assets, mas não modifica o HUD para usá-los.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelado pelo usuário.", file=sys.stderr)
        sys.exit(130)
