from PIL import Image, ImageEnhance, ImageOps, ImageStat

# Justeringsfält (multiplikatorer, 1.0 = oförändrat) och deras standardvärden.
ADJ_FIELDS = (
    "adj_brightness", "adj_contrast", "adj_gamma", "adj_saturation",
    "adj_red", "adj_green", "adj_blue",
)


def has_adjustments(photo) -> bool:
    """True om fotot har någon färg-/tonjustering som avviker från standard."""
    if getattr(photo, "auto_tone", 0):
        return True
    return any(abs(getattr(photo, f, 1.0) - 1.0) > 1e-3 for f in ADJ_FIELDS)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def suggest_auto(img: Image.Image) -> dict:
    """Analysera en bild och föreslå justeringsvärden (vitbalans + ljus +
    kontrast) som konkreta slider-värden, så användaren ser och kan finjustera
    vad "Auto" kommit fram till."""
    rgb = img.convert("RGB")
    r, g, b = ImageStat.Stat(rgb).mean
    gray = (r + g + b) / 3 or 1.0

    # Vitbalans (grey-world): skala varje kanal mot grånivån.
    red = _clamp(gray / r if r else 1.0, 0.5, 1.5)
    green = _clamp(gray / g if g else 1.0, 0.5, 1.5)
    blue = _clamp(gray / b if b else 1.0, 0.5, 1.5)

    lum = rgb.convert("L")
    lmean = ImageStat.Stat(lum).mean[0] or 1.0
    brightness = _clamp(128.0 / lmean, 0.5, 1.7)

    # Kontrast utifrån histogrammets 2:a och 98:e percentil.
    hist = lum.histogram()
    total = sum(hist) or 1

    def _pct(p: float) -> int:
        target, c = total * p, 0
        for i, v in enumerate(hist):
            c += v
            if c >= target:
                return i
        return 255

    spread = max(1, _pct(0.98) - _pct(0.02))
    contrast = _clamp(255 * 0.92 / spread, 0.6, 1.8)

    return {
        "adj_brightness": round(brightness, 2),
        "adj_contrast": round(contrast, 2),
        "adj_gamma": 1.0,
        "adj_saturation": 1.0,
        "adj_red": round(red, 2),
        "adj_green": round(green, 2),
        "adj_blue": round(blue, 2),
    }


def apply_adjustments(img: Image.Image, photo) -> Image.Image:
    """Applicera fotots sparade justeringar på en (redan orienterad) RGB-bild.

    Ordning: auto-ton -> gamma -> per-kanal -> ljusstyrka -> kontrast -> mättnad.
    """
    if getattr(photo, "auto_tone", 0):
        img = ImageOps.autocontrast(img, cutoff=1)

    gamma = getattr(photo, "adj_gamma", 1.0) or 1.0
    if abs(gamma - 1.0) > 1e-3:
        inv = 1.0 / gamma
        lut = [min(255, int((i / 255) ** inv * 255 + 0.5)) for i in range(256)]
        img = img.point(lut * len(img.getbands()))  # samma kurva på alla kanaler

    r = getattr(photo, "adj_red", 1.0)
    g = getattr(photo, "adj_green", 1.0)
    b = getattr(photo, "adj_blue", 1.0)
    if any(abs(x - 1.0) > 1e-3 for x in (r, g, b)):
        rc, gc, bc = img.split()
        rc = rc.point([min(255, int(i * r + 0.5)) for i in range(256)])
        gc = gc.point([min(255, int(i * g + 0.5)) for i in range(256)])
        bc = bc.point([min(255, int(i * b + 0.5)) for i in range(256)])
        img = Image.merge("RGB", (rc, gc, bc))

    brightness = getattr(photo, "adj_brightness", 1.0)
    if abs(brightness - 1.0) > 1e-3:
        img = ImageEnhance.Brightness(img).enhance(brightness)

    contrast = getattr(photo, "adj_contrast", 1.0)
    if abs(contrast - 1.0) > 1e-3:
        img = ImageEnhance.Contrast(img).enhance(contrast)

    saturation = getattr(photo, "adj_saturation", 1.0)
    if abs(saturation - 1.0) > 1e-3:
        img = ImageEnhance.Color(img).enhance(saturation)

    return img
