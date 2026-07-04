// Cross-platform conversion.
//
// FINDING (reverse-engineered from the decompiled v2.4.1 Assembly-CSharp):
// `SerializeHelper.PackSaveData` builds ONE platform-agnostic dictionary - there is no
// `RuntimePlatform` / `Application.platform` / OS field written to the save. The crypto
// (AES-256-CBC, fixed key+IV) and the JSON are identical across PC / Android / iOS / Switch.
// The only platform-correlated key is `deviceName` (cosmetic - `SystemInfo.deviceName`,
// e.g. "AM16R2"); `appVersion` is the game version and `versionCount` is a save counter,
// neither platform-specific.
//
// THEREFORE there are NO save-field deltas to apply between platforms, and inventing any
// would risk corrupting the save. "Conversion" is the honest minimal-correct operation:
// the re-encrypted bytes (which Export already produces) are byte-compatible everywhere;
// you simply place the file at the target platform's save location under the same
// `Vault<N>.sav` name. (The cosmetic `deviceName` field is left as-is - the game overwrites
// it with the local device on its next save, and a power user can still edit it in Advanced.)
//
// `.sav`, `spd.dat`, and `nvf.dat` all live together in ONE folder per platform
//. `basePath` below is that shared folder and is the single
// source of truth for every file location the app shows - both the export dialog and the
// Season tab's "Where's my file?" help derive from it, so the two can never drift.
//
// Only the PC path is firsthand-verified (the owner's platform); the mobile/console paths
// are community-reported guidance and require device-specific access (root / a backup
// tool / console save transfer) - flagged below rather than asserted.

export type PlatformId = 'pc' | 'steamdeck' | 'msstore' | 'android' | 'ios' | 'switch' | 'xbox';

export interface PlatformTarget {
  id: PlatformId;
  label: string;
  /**
   * The folder where Fallout Shelter keeps its three save files on this platform -
   * `Vault<N>.sav`, `spd.dat`, and `nvf.dat` all coexist here. The single source of truth
   * for file locations across the export dialog and the Season "Where's my file?" help.
   */
  basePath: string;
  /** True only for the firsthand-verified platform (PC); others are guidance. */
  verified: boolean;
  /** Extra device-specific caveat, if any. */
  note?: string;
}

/** The fixed names of the two season-pass files (the `.sav` name varies as `Vault<N>.sav`). */
export const SEASON_FILE_NAMES = { spd: 'spd.dat', nvf: 'nvf.dat' } as const;

export const PLATFORM_TARGETS: readonly PlatformTarget[] = [
  {
    id: 'pc',
    // Confirmed (Steam & standalone) against real on-disk files.
    // The `Documents\My Games\…` pattern is used by other Bethesda titles, NOT Fallout Shelter.
    label: 'PC (Windows)',
    basePath: '%LOCALAPPDATA%\\FalloutShelter\\',
    verified: true,
  },
  {
    id: 'steamdeck',
    // Steam Deck runs the Windows build through Proton, so the save lives inside the game's
    // Proton prefix (Steam app id 588430) where %LOCALAPPDATA% maps to
    // .../drive_c/users/steamuser/AppData/Local/FalloutShelter/.
    label: 'Steam Deck (Proton)',
    basePath:
      '~/.local/share/Steam/steamapps/compatdata/588430/pfx/drive_c/users/steamuser/AppData/Local/FalloutShelter/',
    verified: false,
    note: 'On a microSD install the prefix lives under that card instead of the internal drive.',
  },
  {
    id: 'msstore',
    // The Microsoft Store / Windows 10 UWP build sandboxes its data under a per-package folder
    // (the hash after the underscore varies per install), NOT the plain %LOCALAPPDATA%\FalloutShelter\.
    label: 'PC (Microsoft Store)',
    basePath: '%LOCALAPPDATA%\\Packages\\BethesdaSoftworks.FalloutShelter_<hash>\\LocalState\\',
    verified: false,
    note: 'The package hash varies per install. If that folder instead holds a SystemAppData\\wgs container, the save is Xbox-cloud-wrapped and not directly loadable.',
  },
  {
    id: 'android',
    label: 'Android',
    basePath: '/Android/data/com.bethsoft.falloutshelter/files/',
    verified: false,
    note: 'App-private storage - needs a file manager with root, or adb.',
  },
  {
    id: 'ios',
    label: 'iOS',
    basePath: 'Fallout Shelter app sandbox → Documents/',
    verified: false,
    note: 'Sandboxed - needs an iTunes/Finder file-sharing or backup tool.',
  },
  {
    id: 'switch',
    label: 'Nintendo Switch',
    basePath: 'Console save-data storage for Fallout Shelter',
    verified: false,
    note: 'Requires the console’s save-data transfer/backup flow.',
  },
  {
    id: 'xbox',
    // No on-console file access, but Xbox Play Anywhere shares its cloud save with the Windows 10
    // Microsoft Store build, so the edit route is: sync on that PC build, edit, sync back.
    label: 'Xbox',
    basePath: 'No direct console access. Sync to the PC (Microsoft Store) build and edit there',
    verified: false,
    note: 'Xbox Play Anywhere shares the cloud save with the Microsoft Store version; edit it on that PC build, then let it sync back to the console.',
  },
];

export function platformTarget(id: PlatformId): PlatformTarget {
  return PLATFORM_TARGETS.find((p) => p.id === id) ?? PLATFORM_TARGETS[0];
}
