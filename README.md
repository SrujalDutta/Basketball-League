# Indian Basketball Pro League

Scroll-driven 3D arena website for the Indian Basketball Pro League (IBPL) under-16 tournament.

## Run it on your computer (Windows)

1. Install Python once from https://www.python.org/downloads/ and tick **Add python.exe to PATH**.
2. Download this repository once: green **Code** button → **Download ZIP**, then right-click → **Extract All**.
3. Double-click **`start-site.bat`**. It downloads the latest version from GitHub, then opens http://localhost:8000.

Every later double-click updates the site automatically before starting it.

## Files

- `index.html`: page layout, text, styles and scroll logic
- `scene.js`: the 3D arena (three.js)
- `vendor/`: three.js r147 and its post-processing helpers (MIT licence)
- `serve.py` + `start-site.bat`: local server with auto-update
- `classic.html`: the earlier non-3D version

Add `#lite` to the address (`http://localhost:8000/#lite`) for a lighter mode on slower computers.
