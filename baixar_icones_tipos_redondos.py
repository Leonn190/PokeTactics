#!/usr/bin/env python3
"""Baixa SOMENTE os 18 ícones redondos e coloridos dos tipos Pokémon.

Fonte: https://github.com/partywhale/pokemon-type-icons (licença MIT).
Os SVGs originais já incluem círculo colorido e símbolo branco.
Requer apenas Python 3.10+ (nenhuma biblioteca adicional).

Uso:
  py baixar_icones_tipos_redondos.py
  py baixar_icones_tipos_redondos.py --saida D:/PokeTactics_Assets/tipos_redondos
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


TIPOS = (
    "normal", "fire", "water", "grass", "electric", "ice",
    "fighting", "poison", "ground", "flying", "psychic", "bug",
    "rock", "ghost", "dragon", "dark", "steel", "fairy",
)
BASE_URL = "https://raw.githubusercontent.com/partywhale/pokemon-type-icons/main/icons"
NAMESPACE_SVG = "{http://www.w3.org/2000/svg}"


def baixar_icone(tipo: str, destino: Path) -> tuple[str, str]:
    caminho = destino / f"{tipo}.svg"
    url = f"{BASE_URL}/{tipo}.svg"
    requisicao = Request(url, headers={"User-Agent": "PokeTactics-TypeIcons/1.0"})

    for tentativa in range(4):
        try:
            with urlopen(requisicao, timeout=30) as resposta:
                conteudo = resposta.read()

            # Confere que baixou SVG mesmo e que há um círculo no desenho.
            raiz = ET.fromstring(conteudo)
            if raiz.tag != f"{NAMESPACE_SVG}svg":
                raise ValueError("O arquivo recebido não é um SVG.")
            if raiz.find(f".//{NAMESPACE_SVG}circle") is None:
                raise ValueError("O SVG não possui o fundo circular esperado.")

            temporario = caminho.with_suffix(".svg.part")
            temporario.write_bytes(conteudo)
            os.replace(temporario, caminho)
            return tipo, "OK"
        except (HTTPError, URLError, OSError, ValueError, ET.ParseError) as erro:
            if tentativa == 3:
                return tipo, f"ERRO: {erro}"
            time.sleep(0.6 * 2 ** tentativa)

    return tipo, "ERRO desconhecido"


def main() -> int:
    parser = argparse.ArgumentParser(description="Baixa apenas 18 ícones de tipos redondos e coloridos.")
    parser.add_argument(
        "--saida", type=Path, default=Path("PokeTactics_Assets/tipos_redondos"),
        help="Diretório onde serão salvos os SVGs.",
    )
    args = parser.parse_args()
    destino = args.saida.expanduser().resolve()
    destino.mkdir(parents=True, exist_ok=True)

    falhas = 0
    with ThreadPoolExecutor(max_workers=6) as executor:
        tarefas = [executor.submit(baixar_icone, tipo, destino) for tipo in TIPOS]
        for futuro in as_completed(tarefas):
            tipo, resultado = futuro.result()
            print(f"{tipo:10s} {resultado}")
            if resultado != "OK":
                falhas += 1

    print(f"\n{len(TIPOS) - falhas}/{len(TIPOS)} ícones baixados em: {destino}")
    if falhas:
        print("Execute novamente para tentar os arquivos que falharam.", file=sys.stderr)
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main())
