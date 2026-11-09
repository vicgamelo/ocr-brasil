"""Renders the sample images used by the OCR test and the demo page (`npm run fixtures`).

Every number is fictitious: the CPF and CNPJs are the usual test values (the alphanumeric CNPJ is
the Receita Federal's own example) and the boletos are built here, with their own check digits, by
a second implementation of the FEBRABAN rules (independent from src/boleto.ts on purpose).
Fonts: DejaVu (bundled with matplotlib, Bitstream Vera license).
"""

from __future__ import annotations

import json
import random
from datetime import date
from pathlib import Path

import matplotlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "fixtures"
FONTS = Path(matplotlib.get_data_path()) / "fonts" / "ttf"


def font(size: int, mono: bool = False, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSansMono" if mono else "DejaVuSans"
    return ImageFont.truetype(str(FONTS / f"{name}{'-Bold' if bold else ''}.ttf"), size)


# --- FEBRABAN check digits (second implementation) ---------------------------------------------


def mod10(digits: str) -> int:
    total = 0
    for i, d in enumerate(reversed(digits)):
        p = int(d) * (2 if i % 2 == 0 else 1)
        total += p // 10 + p % 10
    return (10 - total % 10) % 10


def mod11_weights(digits: str) -> int:
    return sum(int(d) * (2 + i % 8) for i, d in enumerate(reversed(digits))) % 11


def bancario_linha(bank: str, due: date, cents: int, free: str) -> str:
    factor = 1000 + (due - date(2025, 2, 22)).days
    body = f"{bank}9{factor:04d}{cents:010d}{free}"
    dv = 11 - mod11_weights(body)
    barcode = body[:4] + str(1 if dv in (0, 10, 11) else dv) + body[4:]
    f1, f2, f3 = barcode[0:4] + barcode[19:24], barcode[24:34], barcode[34:44]
    linha = f"{f1}{mod10(f1)}{f2}{mod10(f2)}{f3}{mod10(f3)}{barcode[4]}{barcode[5:19]}"
    return f"{linha[0:5]}.{linha[5:10]} {linha[10:15]}.{linha[15:21]} {linha[21:26]}.{linha[26:32]} {linha[32]} {linha[33:]}"


def arrecadacao_linha(segment: str, cents: int, rest: str) -> str:
    body = f"8{segment}6{cents:011d}{rest}"  # 6 = amount in reais, mod 10
    barcode = body[:3] + str(mod10(body)) + body[3:]
    blocks = [barcode[i : i + 11] for i in range(0, 44, 11)]
    return " ".join(f"{b}-{mod10(b)}" for b in blocks)


# --- rendering ---------------------------------------------------------------------------------


def lines_image(lines: list[tuple[str, ImageFont.FreeTypeFont]], width: int, pad: int = 40, gap: int = 18,
                bg: int = 250, fg: int = 25) -> Image.Image:
    height = pad * 2 + sum(f.size + gap for _, f in lines)
    img = Image.new("L", (width, height), bg)
    d = ImageDraw.Draw(img)
    y = pad
    for text, f in lines:
        d.text((pad, y), text, font=f, fill=fg)
        y += f.size + gap
    return img


def photo(img: Image.Image, seed: int) -> Image.Image:
    """Uneven light, a slight rotation, blur and sensor noise, like a phone photo of a page."""
    rng = np.random.default_rng(seed)
    img = img.rotate(1.6, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=250)
    a = np.asarray(img, dtype=np.float32)
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    light = 1.0 - 0.45 * (xx / w) ** 1.5 - 0.15 * (yy / h)  # shadow towards the right
    a = a * light + rng.normal(0, 6, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    return out.convert("RGB")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    random.seed(7)
    expected: dict[str, list[str]] = {}

    linha = bancario_linha("999", date(2026, 12, 10), 123456, "".join(random.choice("0123456789") for _ in range(25)))
    boleto = lines_image(
        [
            ("BANCO DE EXEMPLO  |  999  |  " + linha, font(26, mono=True, bold=True)),
            ("Local de pagamento: em qualquer banco até o vencimento", font(22)),
            ("Beneficiário: Empresa Exemplo Ltda    CNPJ 11.222.333/0001-81", font(22)),
            ("Vencimento: 10/12/2026    Valor do documento: R$ 1.234,56", font(22)),
            ("Pagador: Fulana de Tal    CPF 529.982.247-25", font(22)),
            ("Documento fictício, gerado para teste", font(18)),
        ],
        width=1400,
    )
    boleto.convert("RGB").save(OUT / "boleto.png", optimize=True)
    expected["boleto.png"] = ["BOLETO:" + linha.replace(".", "").replace(" ", ""), "CNPJ:11222333000181", "CPF:52998224725"]

    # The same boleto as a worse phone photo: shadow, noise, blur, half the resolution, strong JPEG.
    foto = photo(boleto, seed=5)
    foto = foto.resize((foto.width * 11 // 20, foto.height * 11 // 20), Image.Resampling.BILINEAR)
    foto.save(OUT / "boleto-foto.jpg", quality=45)
    expected["boleto-foto.jpg"] = expected["boleto.png"]

    nota = lines_image(
        [
            ("NOTA FISCAL DE SERVIÇO ELETRÔNICA (EXEMPLO)", font(30, bold=True)),
            ("Prestador: Exemplo Tecnologia S.A.", font(26)),
            ("CNPJ: 12.ABC.345/01DE-35", font(28)),
            ("Tomador: Fulana de Tal", font(26)),
            ("CPF: 529.982.247-25", font(28)),
            ("Valor dos serviços: R$ 2.500,00    ISS: R$ 125,00", font(26)),
        ],
        width=1100,
        gap=24,
    )
    photo(nota, seed=3).save(OUT / "nota-foto.jpg", quality=72)
    expected["nota-foto.jpg"] = ["CNPJ:12ABC34501DE35", "CPF:52998224725"]

    conta = arrecadacao_linha("3", 18790, "".join(random.choice("0123456789") for _ in range(29)))
    luz = lines_image(
        [
            ("CONTA DE ENERGIA (EXEMPLO)    Total a pagar: R$ 187,90", font(24, bold=True)),
            ("Código para pagamento:", font(22)),
            (conta, font(28, mono=True)),
        ],
        width=1000,
    ).filter(ImageFilter.GaussianBlur(0.6))
    luz.convert("RGB").save(OUT / "conta-luz.png", optimize=True)
    expected["conta-luz.png"] = ["BOLETO:" + conta.replace("-", "").replace(" ", "")]

    cartao = lines_image(
        [
            ("COMPROVANTE DE INSCRIÇÃO (EXEMPLO)", font(26, bold=True)),
            ("NÚMERO DE INSCRIÇÃO", font(20)),
            ("11.222.333/0001-81    MATRIZ", font(30, bold=True)),
            ("NOME EMPRESARIAL: EMPRESA EXEMPLO LTDA", font(22)),
        ],
        width=900,
        bg=35,
        fg=235,
    )
    cartao.convert("RGB").save(OUT / "cartao-escuro.png", optimize=True)
    expected["cartao-escuro.png"] = ["CNPJ:11222333000181"]

    (OUT / "expected.json").write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n")
    for name in expected:
        print(name, (OUT / name).stat().st_size // 1024, "KB")



if __name__ == "__main__":
    main()
