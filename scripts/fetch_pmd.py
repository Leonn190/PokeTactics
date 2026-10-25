"""Baixa spritesheets PMD para as quatro famílias iniciais e gera metadados.

Executar da pasta poke-tft: python3 scripts/fetch_pmd.py
Fontes: https://github.com/PMDCollab/SpriteCollab (CC BY-NC 4.0).
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import json
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public' / 'pmd'
OUT = ROOT / 'src' / 'client' / 'pmd-manifest.json'
DEX = (1, 2, 3, 4, 5, 6, 7, 8, 9, 25, 26)
WANTED = ('Idle', 'Walk', 'Sleep', 'Rotate', 'Hurt', 'Attack', 'Shoot', 'Charge', 'Withdraw', 'Strike')
BASE = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite'


def download(dex: int, filename: str, required: bool = True) -> bool:
    path = DEST / f'{dex:04d}' / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 100:
        return True
    command = ['curl', '-LfsS', '--retry', '3', '--retry-delay', '1', '--connect-timeout', '15',
               '--max-time', '45', '-o', str(path), f'{BASE}/{dex:04d}/{filename}']
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        path.unlink(missing_ok=True)
        if required:
            raise RuntimeError(f'{dex:04d}/{filename}: {result.stderr.strip()}')
        return False
    return True


def main() -> None:
    with ThreadPoolExecutor(max_workers=11) as pool:
        jobs = [pool.submit(download, dex, 'AnimData.xml') for dex in DEX]
        for job in as_completed(jobs):
            job.result()

    manifest = {}
    tasks = set()
    for dex in DEX:
        root = ET.parse(DEST / f'{dex:04d}' / 'AnimData.xml').getroot()
        entries = {node.findtext('Name'): node for node in root.findall('./Anims/Anim')}
        result = {}
        for name in WANTED:
            if name not in entries:
                continue
            source = entries[name]
            actual = source.findtext('CopyOf') or name
            source = entries[actual]
            durations = [int(node.text or '6') for node in source.findall('./Durations/Duration')]
            if not durations:
                continue
            result[name] = {'file': f'{actual}-Anim.png',
                            'width': int(source.findtext('FrameWidth') or '32'),
                            'height': int(source.findtext('FrameHeight') or '32'),
                            'durations': durations}
            tasks.add((dex, f'{actual}-Anim.png'))
        for required in ('Idle', 'Walk', 'Sleep', 'Hurt'):
            if required not in result:
                raise RuntimeError(f'{dex:04d} sem {required}')
        manifest[str(dex)] = result

    with ThreadPoolExecutor(max_workers=14) as pool:
        jobs = [pool.submit(download, dex, name) for dex, name in sorted(tasks)]
        for job in as_completed(jobs):
            job.result()

    # PNG: assinatura (8), largura e altura (4 bytes cada após IHDR).
    for dex, animations in manifest.items():
        for name, meta in animations.items():
            data = (DEST / f'{int(dex):04d}' / meta['file']).read_bytes()
            if data[:8] != b'\x89PNG\r\n\x1a\n':
                raise RuntimeError(f'Arquivo PNG inválido: {dex}/{name}')
            width = int.from_bytes(data[16:20], 'big')
            height = int.from_bytes(data[20:24], 'big')
            expected = meta['width'] * len(meta['durations'])
            if width != expected or height % meta['height'] != 0:
                raise RuntimeError(f'Geometria inesperada: {dex}/{name} ({width}x{height} vs {expected}x{meta["height"]})')
            meta['directions'] = height // meta['height']

    OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'PMD: {len(manifest)} espécies, {len(tasks)} PNGs validados, {OUT.relative_to(ROOT)}')
    for dex, anims in manifest.items():
        missing = [key for key in WANTED if key not in anims]
        print(f'{int(dex):04d}: {len(anims)} animações, ausentes: {missing or "nenhuma"}')


if __name__ == '__main__':
    main()
