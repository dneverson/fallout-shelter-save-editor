import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { Dweller, DwellerRarity, Gender } from '../../../domain/model/saveSchema.ts';
import { useSaveStore } from '../../../state/saveStore.ts';
import { useUIStore } from '../../../state/uiStore.ts';
import { pushToast } from '../../../state/toastStore.ts';
import { useGameData } from '../../hooks/useGameData.ts';
import { useVisualAssets } from '../../hooks/useVisualAssets.ts';
import {
  hairLabel,
  isKnownOutfitId,
  isKnownWeaponId,
  outfitEnduranceBonus,
} from '../../../domain/gamedata/gameData.ts';
import {
  autoPickPartner,
  createPet,
  deleteEquippedPet,
  detachPet,
  editEquippedPet,
  equipOutfit,
  equipWeapon,
  removeDwellers,
  setColors,
  setFaceMask,
  setGender,
  setHair,
  setHappiness,
  setHealth,
  setLastName,
  setLevel,
  setMaxHealth,
  maxOutHealth,
  setName,
  setPartner,
  setPregnancy,
  setRadiation,
  setRarity,
  setStat,
  unequipOutfit,
  unequipWeapon,
  type ClampOpts,
  type NewPet,
} from '../../../domain/ops/dwellerOps.ts';
import { NumberField } from '../forms/NumberField.tsx';
import { ColorField } from '../forms/ColorField.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { FamilyBlock } from './FamilyBlock.tsx';
import { HairPicker } from './HairPicker.tsx';
import { AppearanceGridDialog } from './AppearanceGridDialog.tsx';
import { InfoTooltip } from '../InfoTooltip.tsx';
import { fieldHelp } from '../../lib/fieldHelp.ts';
import { EquipPickerDialog } from './EquipPickerDialog.tsx';
import { outfitSchema, weaponSchema } from '../table/schemas/itemSchemas.tsx';
import { outfitAllowedForGender } from '../../../domain/gamedata/itemStats.ts';
import { PetAttachDialog, type CurrentPet } from './PetAttachDialog.tsx';
import { selectPetRows, type PetRow } from '../../../domain/selectors/petSelectors.ts';
import { assignPet } from '../../../domain/ops/petOps.ts';
import {
  cancelBabyDelivery,
  deliverBabyNow,
  dwellerTimers,
  fastForwardTeam,
  growUpChildNow,
  pregnancyPendingChildren,
  setPendingChildren,
  wastelandTeams,
} from '../../../domain/ops/timerOps.ts';
import { formatDuration } from '../../../domain/tasks/taskLookup.ts';

// Lazy so the PixiJS renderer (the bulk of the bundle) loads only when a character sheet
// with a preview is first opened - not on the import/landing screens (perf).
const DwellerPreview = lazy(() =>
  import('./DwellerPreview.tsx').then((m) => ({ default: m.DwellerPreview })),
);

// Dense, single-view character sheet (everything visible, no
// accordions). Every control live-applies through a pure dwellerOps op wrapped in
// `applyEdit`, so each deliberate change is one undo step; Export is the only commit
// to disk. The "allow out-of-range" toggle relaxes the SPECIAL/level/
// happiness clamps for power users. Equipment slots open modal pickers - weapon/
// outfit from the catalog table, pets via the two-mode attach/edit dialog. The
// preview + layer-toggle chips render through PixiJS.

interface CharacterSheetProps {
  dweller: Dweller;
  onClose: () => void;
}

const RARITIES: DwellerRarity[] = ['Common', 'Normal', 'Rare', 'Legendary'];

// SPECIAL: stats.stats index → letter + full name (index 0 is a placeholder).
const SPECIAL: ReadonlyArray<{ index: number; letter: string; name: string }> = [
  { index: 1, letter: 'S', name: 'Strength' },
  { index: 2, letter: 'P', name: 'Perception' },
  { index: 3, letter: 'E', name: 'Endurance' },
  { index: 4, letter: 'C', name: 'Charisma' },
  { index: 5, letter: 'I', name: 'Intelligence' },
  { index: 6, letter: 'A', name: 'Agility' },
  { index: 7, letter: 'L', name: 'Luck' },
];

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-4">
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400/80">
        {title}
        {help && <InfoTooltip text={help} />}
      </h4>
      {children}
    </section>
  );
}

export function CharacterSheet({ dweller, onClose }: CharacterSheetProps) {
  const save = useSaveStore((s) => s.save);
  const originalSave = useSaveStore((s) => s.originalSave);
  const applyEdit = useSaveStore((s) => s.applyEdit);
  const { data: gameData } = useGameData();
  const { assets: visualAssets } = useVisualAssets();
  const allowOutOfRange = useUIStore((s) => s.allowOutOfRange);
  const setAllowOutOfRange = useUIStore((s) => s.setAllowOutOfRange);

  // Which equip picker is open (null = none); the pet flow has its own dialog.
  const [equipPicker, setEquipPicker] = useState<'weapon' | 'outfit' | null>(null);
  // Which appearance grid picker is open (hair / face + facial hair).
  const [appearancePicker, setAppearancePicker] = useState<'hair' | 'face' | null>(null);
  const [petDialogOpen, setPetDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Live appearance preview while dragging a color picker (ColorField.onPreview).
  // Holds the would-be ARGB so the Pixi canvas recolors instantly without routing each
  // pointer move through applyEdit (whole-save clone + health check + undo + every store
  // subscriber re-rendering). Cleared once the committed color catches up on blur - via
  // render-sync, since the project bans setState-in-useEffect.
  const [colorPreview, setColorPreview] = useState<{ skin?: number; hair?: number }>({});
  const [lastColors, setLastColors] = useState({
    skin: dweller.skinColor,
    hair: dweller.hairColor,
  });
  if (dweller.skinColor !== lastColors.skin || dweller.hairColor !== lastColors.hair) {
    setLastColors({ skin: dweller.skinColor, hair: dweller.hairColor });
    setColorPreview({});
  }

  // Overlay any active draft colors onto the dweller passed to the preview canvas; the
  // form fields keep reading the committed `dweller`.
  const previewDweller: Dweller =
    colorPreview.skin === undefined && colorPreview.hair === undefined
      ? dweller
      : {
          ...dweller,
          ...(colorPreview.skin !== undefined ? { skinColor: colorPreview.skin } : {}),
          ...(colorPreview.hair !== undefined ? { hairColor: colorPreview.hair } : {}),
        };

  const id = dweller.serializeId;
  const rangeOpts: ClampOpts | undefined = allowOutOfRange ? { clamp: false } : undefined;

  const statValue = (index: number): number => dweller.stats?.stats?.[index]?.value ?? 0;
  const isFemale = dweller.gender === 1;
  const maxHealth = dweller.health?.maxHealth ?? 1000;

  // Partner choices for the pregnancy section: OPPOSITE-gender dwellers only (two men or
  // two women cannot have a child in this game), name-sorted. The recorded partner stays
  // listed even if same-gender (a broken save link) so the select never shows a blank.
  // Living-Quarters timers attached to this dweller (pregnancy due / child grow-up)
  // and the wasteland team they are travelling with, if any.
  const timers = useMemo(
    () => (save ? dwellerTimers(save, id) : { pregnancy: null, childGrowUp: null }),
    [save, id],
  );
  const team = useMemo(
    () => (save ? (wastelandTeams(save).find((t) => t.dwellers.includes(id)) ?? null) : null),
    [save, id],
  );
  // Babies the current pregnancy delivers (partnership `pendingChildren`); null hides
  // the selector when there is no RaisingBaby entry to write to.
  const pendingChildren = useMemo(
    () => (save ? pregnancyPendingChildren(save, id) : null),
    [save, id],
  );

  const partnerOptions = useMemo(
    () =>
      (save?.dwellers?.dwellers ?? [])
        .filter(
          (d) =>
            d.serializeId !== id &&
            (d.gender !== dweller.gender || d.serializeId === dweller.relations?.partner),
        )
        .map((d) => ({
          id: d.serializeId,
          name: `${d.name ?? ''} ${d.lastName ?? ''}`.trim() || `Dweller ${d.serializeId}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [save, id, dweller.gender, dweller.relations?.partner],
  );

  // The equipped outfit's Endurance bonus feeds HP scaling: the game adds it to base
  // Endurance when recomputing max HP on level change (dwellerHealth.ts).
  const endBonus = gameData ? outfitEnduranceBonus(gameData, dweller.equipedOutfit?.id) : 0;

  const weaponId = dweller.equipedWeapon?.id ?? null;
  const outfitId = dweller.equipedOutfit?.id ?? null;
  const petId = dweller.equippedPet?.id ?? null;
  const weaponName = weaponId ? (gameData?.weaponById.get(weaponId)?.name ?? weaponId) : null;
  const outfitName = outfitId ? (gameData?.outfitById.get(outfitId)?.name ?? outfitId) : null;
  const petName = petId
    ? dweller.equippedPet?.extraData?.uniqueName || gameData?.petById.get(petId)?.name || petId
    : null;

  // Outfit picker options: some outfits are gender-locked art (dresses are `F_*`, male-cut
  // suits are `M_*`), so only offer what this dweller can actually wear. The currently-equipped
  // outfit is always kept in the list so an existing (even mismatched) outfit never vanishes.
  const outfitOptions = useMemo(
    () =>
      (gameData?.outfits ?? []).filter(
        (o) => o.id === outfitId || outfitAllowedForGender(o, dweller.gender),
      ),
    [gameData, dweller.gender, outfitId],
  );

  // Picker tables draw from the game-data catalog (equipping writes ids directly).
  const weaponTable = useMemo(() => weaponSchema(gameData?.enums), [gameData]);
  const outfitTable = useMemo(() => outfitSchema(gameData?.enums), [gameData]);

  // Every owned pet instance for the picker's "Owned" tab, projected by the same selector
  // the Pets tab uses so the table shares its columns/shape. This dweller's OWN equipped
  // pet is excluded - it lives in the Edit tab and reassigning it to itself is a no-op.
  const ownedPets = useMemo<PetRow[]>(
    () =>
      save
        ? selectPetRows(save, gameData ?? undefined).filter(
            (r) => !(r.location.kind === 'equipped' && r.location.dwellerId === id),
          )
        : [],
    [save, gameData, id],
  );

  const currentPet: CurrentPet | null = dweller.equippedPet
    ? {
        id: dweller.equippedPet.id,
        uniqueName: dweller.equippedPet.extraData?.uniqueName ?? '',
        bonus: dweller.equippedPet.extraData?.bonus ?? '',
        bonusValue: dweller.equippedPet.extraData?.bonusValue ?? 0,
      }
    : null;

  // Id-existence guard: only write ids the game knows (the picker can only surface valid catalog
  // rows, so this just guards the impossible case rather than corrupting the save).
  // Equip applies instantly and closes the picker; a success toast confirms it
  // landed so a quick click doesn't feel like nothing happened.
  const onEquipWeapon = (wid: string): void => {
    if (gameData && !isKnownWeaponId(gameData, wid)) return;
    applyEdit((s) => equipWeapon(s, id, wid), 'Equip weapon');
    pushToast(`Equipped ${gameData?.weaponById.get(wid)?.name ?? wid}.`, 'success');
  };
  const onEquipOutfit = (oid: string): void => {
    if (gameData && !isKnownOutfitId(gameData, oid)) return;
    applyEdit((s) => equipOutfit(s, id, oid), 'Equip outfit');
    pushToast(`Equipped ${gameData?.outfitById.get(oid)?.name ?? oid}.`, 'success');
  };
  const onCreatePet = (pet: NewPet): void => {
    applyEdit((s) => createPet(s, id, pet), 'Create pet');
    pushToast(
      `Equipped ${pet.uniqueName || gameData?.petById.get(pet.petId)?.name || 'pet'}.`,
      'success',
    );
  };

  const maxAllSpecial = (): void =>
    applyEdit(
      (s) => SPECIAL.reduce((acc, { index }) => setStat(acc, id, index, 10, rangeOpts), s),
      'Max all SPECIAL',
    );

  const equipChipClass =
    'rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-left text-sm text-neutral-300 hover:border-amber-600/60 hover:text-neutral-100';

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-neutral-800 p-4">
      {/* Identity ---------------------------------------------------------------- */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-neutral-400">First name</span>
            <input
              type="text"
              aria-label="First name"
              defaultValue={dweller.name ?? ''}
              key={`name-${id}-${dweller.name ?? ''}`}
              onBlur={(e) => applyEdit((s) => setName(s, id, e.target.value), 'Set name')}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-neutral-400">Last name</span>
            <input
              type="text"
              aria-label="Last name"
              defaultValue={dweller.lastName ?? ''}
              key={`last-${id}-${dweller.lastName ?? ''}`}
              onBlur={(e) => applyEdit((s) => setLastName(s, id, e.target.value), 'Set last name')}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded px-2 py-1 text-neutral-400 hover:text-neutral-100"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Gender</span>
          <div className="flex overflow-hidden rounded border border-neutral-700">
            {([1, 2] as Gender[]).map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={dweller.gender === g}
                onClick={() => applyEdit((s) => setGender(s, id, g), 'Set gender')}
                className={`px-3 py-1 text-sm ${
                  dweller.gender === g
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {g === 1 ? 'Female' : 'Male'}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Rarity</span>
          <select
            aria-label="Rarity"
            value={(dweller.rarity as DwellerRarity) ?? 'Normal'}
            onChange={(e) =>
              applyEdit((s) => setRarity(s, id, e.target.value as DwellerRarity), 'Set rarity')
            }
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Character preview + layer toggles (PixiJS) --------------------------- */}
      {visualAssets ? (
        <Suspense
          fallback={
            <div className="mt-3 rounded border border-dashed border-neutral-700 px-3 py-4 text-center text-xs text-neutral-400">
              Loading preview…
            </div>
          }
        >
          <DwellerPreview dweller={previewDweller} assets={visualAssets} />
        </Suspense>
      ) : (
        <div className="mt-3 rounded border border-dashed border-neutral-700 px-3 py-4 text-center text-xs text-neutral-400">
          Loading preview…
        </div>
      )}

      {/* Power-user toggle -------------------------------------------------- */}
      <label className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={allowOutOfRange}
          onChange={(e) => setAllowOutOfRange(e.target.checked)}
        />
        Allow out-of-range values (cheat)
      </label>

      {/* SPECIAL ---------------------------------------------------------------- */}
      <Section title="SPECIAL" help={fieldHelp.special}>
        <div className="grid grid-cols-4 gap-2">
          {SPECIAL.map(({ index, letter }) => (
            <NumberField
              key={index}
              label={letter}
              value={statValue(index)}
              onCommit={(v) => applyEdit((s) => setStat(s, id, index, v, rangeOpts), 'Set SPECIAL')}
              min={1}
              max={10}
              allowOutOfRange={allowOutOfRange}
              className="[&_span]:text-center"
            />
          ))}
          <button
            type="button"
            onClick={maxAllSpecial}
            className="self-end rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40"
          >
            Max all
          </button>
        </div>
        <span className="sr-only">{SPECIAL.map((s) => s.name).join(' ')}</span>
      </Section>

      {/* Level + vitals --------------------------------------------------------- */}
      <Section title="Level & vitals" help={fieldHelp.health}>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Level"
            value={dweller.experience?.currentLevel ?? 1}
            onCommit={(v) => applyEdit((s) => setLevel(s, id, v, rangeOpts, endBonus), 'Set level')}
            min={1}
            max={50}
            allowOutOfRange={allowOutOfRange}
          />
          <NumberField
            label="Happiness"
            value={dweller.happiness?.happinessValue ?? 0}
            onCommit={(v) => applyEdit((s) => setHappiness(s, id, v, rangeOpts), 'Set happiness')}
            min={0}
            max={100}
            allowOutOfRange={allowOutOfRange}
          />
          <NumberField
            label="Radiation"
            value={dweller.health?.radiationValue ?? 0}
            onCommit={(v) => applyEdit((s) => setRadiation(s, id, v), 'Set radiation')}
            min={0}
            max={maxHealth}
            allowOutOfRange={allowOutOfRange}
          />
          <NumberField
            label="Health"
            value={dweller.health?.healthValue ?? 0}
            onCommit={(v) => applyEdit((s) => setHealth(s, id, v), 'Set health')}
            min={0}
            max={maxHealth}
            allowOutOfRange={allowOutOfRange}
          />
          <NumberField
            label="Max HP"
            value={dweller.health?.maxHealth ?? 0}
            onCommit={(v) => applyEdit((s) => setMaxHealth(s, id, v), 'Set max HP')}
            min={0}
            max={9999}
            allowOutOfRange={allowOutOfRange}
          />
          <button
            type="button"
            onClick={() => applyEdit((s) => maxOutHealth(s, id), 'Max HP')}
            className="self-end rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40"
          >
            Max HP (644)
          </button>
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">
          Setting level rescales max HP from Endurance (+ outfit) and refills health.
        </p>
      </Section>

      {/* Appearance | Equipment -------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4">
        <Section title="Appearance" help={fieldHelp.colors}>
          <div className="flex flex-col gap-3">
            <ColorField
              label="Skin"
              value={dweller.skinColor ?? 0xffffffff}
              onCommit={(v) => applyEdit((s) => setColors(s, id, { skin: v }), 'Set skin color')}
              onPreview={(v) => setColorPreview((p) => ({ ...p, skin: v }))}
            />
            <ColorField
              label="Hair color"
              value={dweller.hairColor ?? 0xffffffff}
              onCommit={(v) => applyEdit((s) => setColors(s, id, { hair: v }), 'Set hair color')}
              onPreview={(v) => setColorPreview((p) => ({ ...p, hair: v }))}
            />
            {gameData ? (
              <>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-neutral-400">Hair</span>
                  <button
                    type="button"
                    aria-label="Pick hair"
                    className={equipChipClass}
                    onClick={() => setAppearancePicker('hair')}
                  >
                    {dweller.hair ? hairLabel(gameData, dweller.hair) : 'None'}
                  </button>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-neutral-400">
                    Face accessory
                  </span>
                  <button
                    type="button"
                    aria-label="Pick face accessory"
                    className={equipChipClass}
                    onClick={() => setAppearancePicker('face')}
                  >
                    {dweller.faceMask ? hairLabel(gameData, dweller.faceMask) : 'None'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <HairPicker
                  label="Hair"
                  kind="hair"
                  value={dweller.hair ?? null}
                  gender={dweller.gender}
                  gameData={gameData}
                  onCommit={(v) => applyEdit((s) => setHair(s, id, v ?? ''), 'Set hair')}
                />
                <HairPicker
                  label="Face accessory"
                  kind="face"
                  value={dweller.faceMask ?? null}
                  gender={dweller.gender}
                  gameData={gameData}
                  allowNone
                  onCommit={(v) => applyEdit((s) => setFaceMask(s, id, v), 'Set facial hair')}
                />
              </>
            )}
          </div>
        </Section>

        <Section title="Equipment" help={fieldHelp.outfit}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">Weapon</span>
              <button
                type="button"
                className={equipChipClass}
                onClick={() => setEquipPicker('weapon')}
              >
                {weaponName ?? '–'}
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">Outfit</span>
              <button
                type="button"
                className={equipChipClass}
                onClick={() => setEquipPicker('outfit')}
              >
                {outfitName ?? '–'}
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">Pet</span>
              <button
                type="button"
                className={equipChipClass}
                onClick={() => setPetDialogOpen(true)}
              >
                {petName ?? 'Attach a pet…'}
              </button>
            </div>
          </div>
        </Section>
      </div>

      {/* Pregnancy (female only) ------------------------------------------------- */}
      {isFemale && (
        <Section title="Pregnancy" help={fieldHelp.pregnancy}>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={dweller.pregnant === true}
                onChange={(e) =>
                  applyEdit(
                    // Forcing a pregnancy also auto-picks a partner when none is recorded
                    // (random compatible dweller, non-relatives preferred, relatives only
                    // as a last resort); the "Having a child with" select can override it.
                    (s) => {
                      const next = setPregnancy(s, id, { pregnant: e.target.checked });
                      return e.target.checked ? autoPickPartner(next, id) : next;
                    },
                    'Set pregnancy',
                  )
                }
              />
              Pregnant
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={dweller.babyReady === true}
                onChange={(e) =>
                  // Flag and due timer travel as a pair, both directions: ticking
                  // delivers (flag + timer complete, what the game writes itself);
                  // unticking cancels AND restores the timer from the imported save
                  // instead of leaving it stranded at 0s.
                  applyEdit(
                    (s) =>
                      e.target.checked
                        ? deliverBabyNow(s, id)
                        : originalSave
                          ? cancelBabyDelivery(s, originalSave, id)
                          : setPregnancy(s, id, { babyReady: false }),
                    e.target.checked ? 'Deliver baby now' : 'Cancel baby delivery',
                  )
                }
              />
              Baby ready
            </label>
          </div>
          {/* The other parent (`relations.partner`) - shown while pregnant so it's clear who
              the child is with, and editable for fixing up a broken/missing link. */}
          {dweller.pregnant === true && (
            <label className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">
                Having a child with
              </span>
              <select
                value={dweller.relations?.partner ?? -1}
                onChange={(e) =>
                  applyEdit((s) => setPartner(s, id, Number(e.target.value)), 'Set partner')
                }
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
              >
                <option value={-1}>Unknown / none recorded</option>
                {partnerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* Baby count (`partners[].pendingChildren`): the game only rolls twins/triplets
              when this is 0, so a stored 2/3 forces the multi-birth - no breeding pet
              needed. Only shown when a RaisingBaby entry exists to write to. */}
          {pendingChildren !== null && (
            <label className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
              <span className="text-[11px] uppercase tracking-wide text-neutral-400">
                Babies expected
              </span>
              <select
                value={pendingChildren === 2 || pendingChildren === 3 ? pendingChildren : 0}
                onChange={(e) =>
                  applyEdit(
                    (s) => setPendingChildren(s, id, Number(e.target.value)),
                    'Set babies expected',
                  )
                }
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
              >
                <option value={0}>1 (default roll)</option>
                <option value={2}>2 - twins</option>
                <option value={3}>3 - triplets</option>
              </select>
              <InfoTooltip text={fieldHelp.pendingChildren} />
            </label>
          )}
          {dweller.babyReady === true ? (
            <p className="mt-2 text-[11px] text-neutral-500">
              Baby is due now ("Baby ready" above) - in game, tap the mother to deliver; the birth
              needs free vault space.
            </p>
          ) : timers.pregnancy ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
              <span>
                {(timers.pregnancy.remainingSeconds ?? 0) > 0 ? (
                  <>
                    Baby due in{' '}
                    <span className="text-neutral-100">
                      {formatDuration(timers.pregnancy.remainingSeconds ?? 0)}
                    </span>
                  </>
                ) : (
                  'Baby due now'
                )}
              </span>
              <InfoTooltip text={fieldHelp.pregnancyTimer} />
              <button
                type="button"
                onClick={() => {
                  // Completes the due timer AND ticks "Baby ready" - the same pair
                  // the game writes when the pregnancy finishes on its own.
                  applyEdit((s) => deliverBabyNow(s, id), 'Deliver baby now');
                  pushToast('Baby marked ready - delivery on next load in game');
                }}
                className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                Deliver now
              </button>
            </div>
          ) : (
            dweller.pregnant === true && (
              <p className="mt-2 text-[11px] text-neutral-500">
                No due timer recorded yet - it runs while the mother is inside a Living Quarters.
              </p>
            )
          )}
        </Section>
      )}

      {/* Growing up (only when this dweller IS a child with a grow-up timer). A due
          timer (0s) shows its state instead of a button that would change nothing. */}
      {timers.childGrowUp && (
        <Section title="Growing up" help={fieldHelp.childGrowUp}>
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
            {(timers.childGrowUp.remainingSeconds ?? 0) > 0 ? (
              <>
                <span>
                  Adult in{' '}
                  <span className="text-neutral-100">
                    {formatDuration(timers.childGrowUp.remainingSeconds ?? 0)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    applyEdit((s) => growUpChildNow(s, id), 'Grow up now');
                    pushToast('Child grows up on next load in game');
                  }}
                  className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  Grow up now
                </button>
              </>
            ) : (
              <span className="text-emerald-300/90">Becomes an adult on next load</span>
            )}
          </div>
        </Section>
      )}

      {/* Exploring (only when this dweller is on a travelling wasteland team) ------- */}
      {team && (
        <Section title="Exploring" help={fieldHelp.exploringTimer}>
          <p className="text-sm text-neutral-300">
            {team.phase === 'exploring' ? (
              <>
                Out in the wasteland for{' '}
                <span className="text-neutral-100">{formatDuration(team.elapsedSeconds)}</span>
                {team.dwellers.length > 1 && ` (team of ${team.dwellers.length})`}
              </>
            ) : (
              <>
                Returning home,{' '}
                <span className="text-neutral-100">
                  {formatDuration(
                    Math.max(0, (team.returnTripDuration ?? 0) - team.elapsedSeconds),
                  )}
                </span>{' '}
                left{team.dwellers.length > 1 && ` (team of ${team.dwellers.length})`}
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {team.phase === 'exploring' ? (
              <>
                {[
                  { label: '+1 h', seconds: 3_600 },
                  { label: '+8 h', seconds: 8 * 3_600 },
                  { label: '+1 d', seconds: 86_400 },
                ].map(({ label, seconds }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      applyEdit(
                        (s) => fastForwardTeam(s, team.index, seconds),
                        `Explore ${label} longer`,
                      );
                      pushToast(`Exploration advanced ${label}`);
                    }}
                    className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
                  >
                    {label}
                  </button>
                ))}
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  applyEdit(
                    (s) => fastForwardTeam(s, team.index, team.returnTripDuration ?? 0),
                    'Return to vault now',
                  );
                  pushToast('Team arrives home on next load in game');
                }}
                className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                Return now
              </button>
            )}
          </div>
        </Section>
      )}

      {/* Family / relationship viewer - read-only, click to walk. */}
      <FamilyBlock serializeId={id} />

      {/* Delete (confirm; undoable). Same scrubbing op as the bulk Remove - a plain
          list splice would leave dangling references (see removeDwellers). */}
      <div className="mt-6 border-t border-neutral-800 pt-3">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          title={fieldHelp.removeDweller}
          className="w-full rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/30"
        >
          Delete dweller
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete dweller"
        message={
          <>
            Delete{' '}
            <span className="text-neutral-100">
              {[dweller.name, dweller.lastName].filter(Boolean).join(' ') || `#${id}`}
            </span>
            ? Anything they have equipped goes with them, and they leave their room and exploration
            team. You can undo this while the editor is open.
          </>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          applyEdit((s) => removeDwellers(s, [id]), 'Delete dweller');
          setConfirmDelete(false);
          onClose();
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      {/* Equip pickers - mounted only while open so state resets each time. */}
      {equipPicker === 'weapon' && (
        <EquipPickerDialog
          open
          onClose={() => setEquipPicker(null)}
          title="Equip weapon"
          currentSummary={weaponName ?? '–'}
          data={gameData?.weapons ?? []}
          schema={weaponTable}
          persistKey="equip.weapon"
          getRowId={(w) => w.id}
          equippedId={weaponId}
          onEquip={onEquipWeapon}
          onReset={() => applyEdit((s) => unequipWeapon(s, id), 'Unequip weapon')}
          resetLabel="Reset to Fist"
        />
      )}
      {equipPicker === 'outfit' && (
        <EquipPickerDialog
          open
          onClose={() => setEquipPicker(null)}
          title="Equip outfit"
          currentSummary={outfitName ?? '–'}
          data={outfitOptions}
          schema={outfitTable}
          persistKey="equip.outfit"
          getRowId={(o) => o.id}
          equippedId={outfitId}
          onEquip={onEquipOutfit}
          onReset={() => applyEdit((s) => unequipOutfit(s, id), 'Unequip outfit')}
          resetLabel="Reset to jumpsuit"
        />
      )}
      {appearancePicker && gameData && (
        <AppearanceGridDialog
          title={appearancePicker === 'hair' ? 'Pick hair' : 'Pick face accessory'}
          kind={appearancePicker}
          gender={dweller.gender}
          current={(appearancePicker === 'hair' ? dweller.hair : dweller.faceMask) ?? null}
          gameData={gameData}
          assets={visualAssets}
          allowNone={appearancePicker === 'face'}
          onPick={(v) =>
            appearancePicker === 'hair'
              ? applyEdit((s) => setHair(s, id, v ?? ''), 'Set hair')
              : applyEdit((s) => setFaceMask(s, id, v), 'Set facial hair')
          }
          onClose={() => setAppearancePicker(null)}
        />
      )}
      {petDialogOpen && (
        <PetAttachDialog
          onClose={() => setPetDialogOpen(false)}
          gameData={gameData}
          ownedPets={ownedPets}
          current={currentPet}
          allowOutOfRange={allowOutOfRange}
          onAssign={(pet) => {
            applyEdit((s) => assignPet(s, pet.location, id), 'Assign pet');
            pushToast(`Assigned ${pet.uniqueName || pet.breed || 'pet'}.`, 'success');
          }}
          onCreate={onCreatePet}
          onEdit={(changes) => applyEdit((s) => editEquippedPet(s, id, changes), 'Edit pet')}
          onDetach={() => {
            applyEdit((s) => detachPet(s, id), 'Detach pet');
            pushToast('Pet detached to storage.', 'success');
          }}
          onDelete={() => {
            applyEdit((s) => deleteEquippedPet(s, id), 'Delete pet');
            pushToast('Pet deleted.', 'success');
          }}
        />
      )}
    </aside>
  );
}
