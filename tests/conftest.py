import os
import tempfile
from pathlib import Path

# Peka DATA_DIR/PHOTO_DIR till en temp-katalog INNAN app-modulerna importeras,
# så proven aldrig skriver thumbnails eller cache i dev-datan.
_tmp = Path(tempfile.mkdtemp(prefix="fotoscan-test-"))
os.environ["DATA_DIR"] = str(_tmp / "data")
os.environ["PHOTO_DIR"] = str(_tmp / "photos")
(_tmp / "data" / "thumbnails").mkdir(parents=True)
(_tmp / "data" / "rendered").mkdir(parents=True)
(_tmp / "photos").mkdir()
