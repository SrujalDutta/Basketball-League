# Indian Basketball Pro League (IBPL) website

Two designs for the client to compare, sharing one stylesheet, one script and the 3D arena.

| Design | Open | What it is |
|---|---|---|
| **B · Home + pages** (main) | `index.html` → http://localhost:8000 | Home is a 10-section arena scroll; About, League, Franchises, Development, Gallery, Partners, Contact and Register Now are separate pages |
| **A · All in one scroll** | `scroll.html` → http://localhost:8000/scroll.html | Every page is a section of one arena scroll |

## Run it on your computer (Windows)

1. Install Python once from https://www.python.org/downloads/ and tick **Add python.exe to PATH**.
2. Download this repository once: green **Code** button → **Download ZIP**, then right-click → **Extract All**.
3. Double-click **`start-site.bat`**. It downloads the latest version from GitHub, then opens http://localhost:8000.

## Where to change things

- **Settings** (registration open/closed, the Google Form link, contact email): top of `site.js` (`IBPL = { … }`)
- **Player registration** is free and uses a Google Form: paste its link into `REGISTRATION_FORM_URL`
- **Announcements**: `content/news.json` · **Gallery**: `content/gallery.json` (photos in `assets/gallery/`)
- **Page text**: the `.html` files · **Styles**: `site.css`
- **3D arena**: `scene.js` (camera routes for each design are in `ROUTES`)
- **Placeholders**: anything marked "Awaiting details" on the site is waiting for confirmed facts from the client

## Files

- `site.css`, `site.js`: shared styles and behaviour (menu, panels, forms, registration, swish)
- `arena.js`: scroll → camera, loader, scorebug (scroll pages only)
- `scene.js` + `vendor/`: the 3D arena (three.js r147, MIT licence)
- `assets/`: logos, leadership photos, arena stills used as page heroes
- `serve.py` + `start-site.bat`: local server with auto-update
- `sitemap.xml`, `robots.txt`: replace `https://www.example.com` with the real domain at launch

Add `#lite` to the address for a lighter 3D mode on slower computers.
