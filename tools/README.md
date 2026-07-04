# tools/

Asset-extraction tooling for regenerating the editor's game data
(`public/gamedata/*.json`) from a local Fallout Shelter install. You only need
this if you want to refresh that committed JSON after a game update; the editor
itself runs entirely from the JSON already in the repo.

## Contents

- `AssetRipper_win_x64.zip` - the [AssetRipper](https://github.com/AssetRipper/AssetRipper)
  release used by the extraction chain (committed so a fresh clone has everything).
  Unzip it to `tools/AssetRipper/` so `tools/AssetRipper/AssetRipper.GUI.Free.exe` exists.
- `AssetRipper/` (local-only) - the unzipped tool.
- `export/` (local-only, ~1.2 GB) - AssetRipper's exported Unity project. Never
  committed: it is extracted game content owned by Bethesda.

## Refreshing game data

1. Unzip `AssetRipper_win_x64.zip` to `tools/AssetRipper/`.
2. Create the Python venv once: `cd scripts/extract && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt`.
3. Run the full chain from the repo root: `pnpm gamedata:refresh`
   (set `FSSE_GAME_DIR` if the game is not in the default Steam location).

See the header comment in `scripts/refresh-gamedata.mjs` for stage-by-stage
details and partial re-run flags.
