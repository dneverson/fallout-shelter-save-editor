"""Extract enums + their integer values from Fallout Shelter's Assembly-CSharp.dll.

No .NET SDK on this machine, so we parse the managed-PE metadata directly with
dnfile (pure Python). An enum type is a value type with a special instance field
named `value__`; its other fields are the named members, whose values live in the
Constant metadata table.

Usage: python extract_enums.py  (writes scripts/extract/enums.json + prints summary)
"""
import json, sys, os
import dnfile

# Game install dir: overridable via FSSE_GAME_DIR (set by scripts/refresh-gamedata.mjs)
# so the whole pipeline has one source of truth; falls back to the default Steam path
# for standalone runs.
GAME_DIR = os.environ.get(
    "FSSE_GAME_DIR",
    r"C:\Program Files (x86)\Steam\steamapps\common\Fallout Shelter",
)
DLL = os.path.join(GAME_DIR, "FalloutShelter_Data", "Managed", "Assembly-CSharp.dll")
OUT = os.path.join(os.path.dirname(__file__), "enums.json")

pe = dnfile.dnPE(DLL)
md = pe.net.mdtables

# --- Build Field-row -> constant value map from the Constant table ---
# Constant.Parent is a HasConstant coded index; for enum members it points to a Field row.
import struct
# ECMA-335 element types -> (struct fmt, byte width)
ELEM = {
    0x02: ("<b", 1),  # bool
    0x04: ("<b", 1),  # i1
    0x05: ("<B", 1),  # u1
    0x06: ("<h", 2),  # i2
    0x07: ("<H", 2),  # u2
    0x08: ("<i", 4),  # i4
    0x09: ("<I", 4),  # u4
    0x0A: ("<q", 8),  # i8
    0x0B: ("<Q", 8),  # u8
    0x0C: ("<f", 4),  # r4
    0x0D: ("<d", 8),  # r8
}

def decode_const(etype, blob):
    raw = getattr(blob, "value", None)
    if raw is None:
        return None
    fmt = ELEM.get(etype)
    if not fmt:
        return None
    try:
        return struct.unpack(fmt[0], raw[: fmt[1]])[0]
    except Exception:
        return None

const_by_field = {}
constants = getattr(md, "Constant", None)
if constants:
    for row in constants.rows:
        parent = row.Parent  # MDTableIndex
        if parent is None:
            continue
        try:
            tbl = parent.table.name
            idx = parent.row_index
        except Exception:
            tbl, idx = None, None
        if tbl == "Field":
            const_by_field[idx] = decode_const(row.Type, row.Value)

# --- Iterate TypeDefs; detect enums; collect members ---
enums = {}
typedefs = md.TypeDef

for t in typedefs.rows:
    base = t.Extends
    base_name = ""
    try:
        base_name = base.row.TypeName if base and base.row else ""
    except Exception:
        base_name = ""
    if base_name != "Enum":
        continue
    name = str(t.TypeName)
    ns = str(t.TypeNamespace or "")
    members = {}
    for fidx in t.FieldList:           # list of MDTableIndex -> Field rows
        frow = fidx.row
        if frow is None:
            continue
        fname = str(frow.Name)
        if fname == "value__":
            continue
        val = const_by_field.get(fidx.row_index)
        if val is not None:
            members[fname] = val
    if members:
        key = f"{ns}.{name}" if ns else name
        enums[key] = members

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(enums, f, indent=1, ensure_ascii=False, default=str)

print(f"Extracted {len(enums)} enums -> {os.path.normpath(OUT)}")
# Print the ones most relevant to the save editor
INTEREST = ("pet", "bonus", "weapon", "outfit", "junk", "room", "rarity",
            "resource", "theme", "special", "stat", "gender")
print("\n=== Enums of interest ===")
for k in sorted(enums):
    if any(w in k.lower() for w in INTEREST):
        print(f"\n# {k}  ({len(enums[k])} members)")
        items = list(enums[k].items())
        for nm, vv in items[:60]:
            print(f"  {nm} = {vv}")
        if len(items) > 60:
            print(f"  ... (+{len(items)-60} more)")
