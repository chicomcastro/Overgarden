#!/usr/bin/env python3
"""Extract sprite atlas data from the Unity project into web/assets/.

Reads PNG dimensions straight from the IHDR chunk (no PIL needed) and sprite
frame rects from Unity .meta files, then writes a JSON atlas the browser uses
to slice frames at runtime via drawImage. Also copies the needed PNGs/audio.
"""
import json, os, re, shutil, struct

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.join(ROOT, "Overgarden", "Assets")
OUT = os.path.join(ROOT, "web", "assets")
IMG_OUT = os.path.join(OUT, "img")
SND_OUT = os.path.join(OUT, "audio")
os.makedirs(IMG_OUT, exist_ok=True)
os.makedirs(SND_OUT, exist_ok=True)


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", path
    w, h = struct.unpack(">II", head[16:24])
    return w, h


def parse_meta(meta_path):
    """Return (fileIDToName dict, [(name, x, y, w, h)]) from a texture .meta."""
    with open(meta_path, encoding="utf-8") as f:
        text = f.read()

    fid = {}
    m = re.search(r"fileIDToRecycleName:\n((?:    \d+: .*\n)+)", text)
    if m:
        for line in m.group(1).splitlines():
            k, v = line.strip().split(": ", 1)
            fid[k] = v

    sprites = []
    # Each sprite: name then a rect block with x/y/width/height
    for sm in re.finditer(
        r"name: (.+?)\n\s*rect:\n\s*serializedVersion: \d+\n"
        r"\s*x: (-?\d+)\n\s*y: (-?\d+)\n\s*width: (\d+)\n\s*height: (\d+)",
        text,
    ):
        name, x, y, w, h = sm.group(1), *map(int, sm.groups()[1:])
        sprites.append((name, x, y, w, h))
    return fid, sprites


def to_image_rect(x, y, w, h, sheet_h):
    """Unity rect (bottom-left origin) -> image rect (top-left origin)."""
    return {"x": x, "y": sheet_h - (y + h), "w": w, "h": h}


def copy_png(src_rel, dst_name):
    src = os.path.join(PROJ, src_rel)
    shutil.copy(src, os.path.join(IMG_OUT, dst_name))
    return png_size(src)


atlas = {"character": {}, "items": {}, "plants": {}, "plantData": {}, "ui": {}}

# ---- Character: walking (4 frames), idle (2), holding (2) per direction ----
CHAR = {
    "walk": ("Character/Walking", {"down": "Down", "up": "Up", "left": "Left", "right": "Right"}),
    "idle": ("Character/Idle", {"down": "Down stand", "up": "Up stand", "left": "Left stand", "right": "Right stand"}),
    "hold": ("Character/Holding", {"down": "Down get", "up": "Up get", "left": "Left get", "right": "Right get"}),
}
for kind, (folder, dirs) in CHAR.items():
    for dkey, fname in dirs.items():
        src_rel = f"Sprites/{folder}/{fname}.png"
        dst = f"char_{kind}_{dkey}.png"
        w, h = copy_png(src_rel, dst)
        fid, sprites = parse_meta(os.path.join(PROJ, src_rel + ".meta"))
        # order frames by the numeric suffix in the name (_0, _1, ...)
        sprites.sort(key=lambda s: int(re.search(r"_(\d+)$", s[0]).group(1)))
        frames = [to_image_rect(x, y, fw, fh, h) for (_, x, y, fw, fh) in sprites]
        atlas["character"][f"{kind}_{dkey}"] = {"sheet": dst, "w": w, "h": h, "frames": frames}

# ---- Plant spritesheets ----
plant_sheets = {}
for sheet_name, src_rel in {
    "Plants_1": "Sprites/Plants/Plants_1.png",
    "Plants_2": "Sprites/Plants/Plants_2.png",
}.items():
    w, h = copy_png(src_rel, sheet_name + ".png")
    fid, sprites = parse_meta(os.path.join(PROJ, src_rel + ".meta"))
    rects = {name: (x, y, fw, fh) for (name, x, y, fw, fh) in sprites}
    fid_to_rect = {}
    for f_id, name in fid.items():
        if name in rects:
            x, y, fw, fh = rects[name]
            fid_to_rect[f_id] = to_image_rect(x, y, fw, fh, h)
    plant_sheets[sheet_name] = {"sheet": sheet_name + ".png", "w": w, "h": h, "fid": fid_to_rect}
    atlas["plants"][sheet_name] = {"sheet": sheet_name + ".png", "w": w, "h": h}

GUID_SHEET = {
    "c5835a305ced1d142b100efe93c4b396": "Plants_1",  # stage sprites
    "34b2fb2c7e7ed0342b2c564dcf6265cb": "Plants_2",  # main icon
}


def ref_rect(file_id, guid):
    sheet = GUID_SHEET.get(guid)
    if not sheet:
        return None
    info = plant_sheets[sheet]
    rect = info["fid"].get(str(file_id))
    if not rect:
        return None
    return {"sheet": info["sheet"], **rect}


# ---- Plant data assets ----
plant_dir = os.path.join(PROJ, "Plants")
for fn in sorted(os.listdir(plant_dir)):
    if not fn.endswith(".asset"):
        continue
    with open(os.path.join(plant_dir, fn), encoding="utf-8") as f:
        t = f.read()
    name = re.search(r"plantName: (.+)", t).group(1).strip()
    rarity = int(re.search(r"plantRarity: (\d+)", t).group(1))
    mm = re.search(r"main: \{fileID: (\d+), guid: (\w+),", t)
    main = ref_rect(mm.group(1), mm.group(2)) if mm else None
    stages = []
    stage_block = re.search(r"stageSprite:\n((?:\s*- \{fileID:.*\n)+)", t)
    if stage_block:
        for sm in re.finditer(r"fileID: (\d+), guid: (\w+),", stage_block.group(1)):
            r = ref_rect(sm.group(1), sm.group(2))
            if r:
                stages.append(r)
    atlas["plantData"][name] = {"rarity": rarity, "main": main, "stages": stages}

# ---- Item / station icons (single-frame whole PNGs) ----
for key, src_rel in {
    "shovel": "Sprites/Itens/Shovel.png",
    "water": "Sprites/Itens/Water_Bucket.png",
    "seed": "Sprites/Itens/Seed.png",
    "bag": "Sprites/Miscellany/bag.png",
}.items():
    dst = f"item_{key}.png"
    w, h = copy_png(src_rel, dst)
    atlas["items"][key] = {"sheet": dst, "w": w, "h": h}

# ---- UI / misc ----
for key, src_rel in {
    "logo": "Sprites/logo-overgarden-small.png",
}.items():
    try:
        dst = f"ui_{key}.png"
        w, h = copy_png(src_rel, dst)
        atlas["ui"][key] = {"sheet": dst, "w": w, "h": h}
    except FileNotFoundError:
        pass

# ---- Audio ----
AUDIO = {
    "theme": "Music/Irish Folk Dance.mp3",
    "footsteps": "Sounds/Footsteps-in-grass-moderate-A-www.fesliyanstudios.com.mp3",
    "watering": "Sounds/Regar.wav",
    "pickup": "Sounds/pegar objeto.wav",
    # rio.wav (river ambient) intentionally skipped: 16MB uncompressed, too heavy for web
}
audio_manifest = {}
for key, src_rel in AUDIO.items():
    src = os.path.join(PROJ, src_rel)
    ext = os.path.splitext(src_rel)[1]
    dst = f"{key}{ext}"
    shutil.copy(src, os.path.join(SND_OUT, dst))
    audio_manifest[key] = dst
atlas["audio"] = audio_manifest

with open(os.path.join(OUT, "atlas.json"), "w", encoding="utf-8") as f:
    json.dump(atlas, f, indent=1)

print("Wrote atlas.json")
print("character keys:", list(atlas["character"].keys()))
print("plants:", list(atlas["plantData"].keys()))
print("sample Carrot:", json.dumps(atlas["plantData"].get("Carrot"), indent=1))
print("walk_down frames:", atlas["character"]["walk_down"]["frames"])
print("audio:", audio_manifest)
