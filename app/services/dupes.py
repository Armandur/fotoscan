"""Perceptuell hash (dHash) för dubblett-/liknande-detektering. Ren Pillow,
inga extra beroenden. Beräknas från thumbnailen (redan nedskalad = snabbt)."""
from pathlib import Path

from PIL import Image


def dhash_from_path(path: Path, size: int = 8) -> str:
    """64-bitars difference hash som 16-siffrig hex. Jämför intilliggande
    pixlar radvis i en (size+1 x size) gråskalebild."""
    img = Image.open(path).convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(img.getdata())
    w = size + 1
    bits = 0
    for row in range(size):
        for col in range(size):
            left = px[row * w + col]
            right = px[row * w + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:016x}"


def hamming(a: str, b: str) -> int:
    """Antal skiljande bitar mellan två hex-hashar."""
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def group_similar(items: list[tuple[int, str]], threshold: int) -> list[list[int]]:
    """Gruppera id:n vars hashar ligger inom threshold (Hamming) från varandra,
    via union-find. Returnerar bara grupper med minst två foton. O(n²) - räcker
    gott för projektets skala (<1000)."""
    parent = {i: i for i, _ in items}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    n = len(items)
    for i in range(n):
        for j in range(i + 1, n):
            if hamming(items[i][1], items[j][1]) <= threshold:
                union(items[i][0], items[j][0])

    groups: dict[int, list[int]] = {}
    for i, _ in items:
        groups.setdefault(find(i), []).append(i)
    return [g for g in groups.values() if len(g) > 1]
