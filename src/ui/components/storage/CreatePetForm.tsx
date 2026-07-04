import { useMemo, useState } from 'react';
import type { GameData } from '../../../domain/gamedata/gameData.ts';
import { petBonusRange } from '../../../domain/gamedata/gameData.ts';
import type { Pet } from '../../../domain/gamedata/schemas.ts';
import type { NewPet } from '../../../domain/ops/dwellerOps.ts';
import { NumberField } from '../forms/NumberField.tsx';

// Shared "create a pet instance" form: breed + rarity selectors
// determine the locked bonus EFFECT (shown read-only); only the rolled VALUE (within the
// rarity's [min,max], out-of-range override) and the unique NAME are editable. Emits a finished
// NewPet to the caller, which decides where it goes (equipped on a dweller, or granted
// into storage). Mounted only while its host dialog is open, so form state inits fresh.
//
// NOTE: currently used only by AddItemsDialog. PetAttachDialog still has its OWN inline
// create view; adopting this shared form there (and retiring that duplicate) is an open
// cleanup.

/** Lightly humanize an EBonusEffect id for display (e.g. "DamageBoost" → "Damage Boost"). */
const prettyBonus = (bonus: string): string => bonus.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

interface CreatePetFormProps {
  gameData: GameData | null;
  allowOutOfRange: boolean;
  /** Submit handler - receives the finished, value-clamped instance. */
  onCreate: (pet: NewPet) => void;
  submitLabel: string;
  /** Externally disable submission (e.g. the storage-capacity guardrail). */
  submitDisabled?: boolean;
}

export function CreatePetForm({
  gameData,
  allowOutOfRange,
  onCreate,
  submitLabel,
  submitDisabled = false,
}: CreatePetFormProps) {
  const pets = useMemo(() => gameData?.pets ?? [], [gameData]);

  // breed (display name) → its pets keyed by rarity, for the selectors.
  const breeds = useMemo(() => {
    const byBreed = new Map<string, Pet[]>();
    for (const pet of pets) {
      const list = byBreed.get(pet.breed);
      if (list) list.push(pet);
      else byBreed.set(pet.breed, [pet]);
    }
    return [...byBreed.entries()]
      .map(([breed, list]) => ({ breed, name: list[0].name, byRarity: list }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pets]);

  const [breed, setBreed] = useState(() => breeds[0]?.breed ?? '');
  const selectedBreed = breeds.find((b) => b.breed === breed) ?? breeds[0];
  const rarityChoices = selectedBreed?.byRarity ?? [];
  const [petId, setPetId] = useState(() => rarityChoices[0]?.id ?? '');

  // Keep the chosen rarity valid when the breed changes (adjust-during-render).
  const selectedPet = rarityChoices.find((p) => p.id === petId) ?? rarityChoices[0];
  if (selectedPet && selectedPet.id !== petId) setPetId(selectedPet.id);

  const range = selectedPet && gameData ? petBonusRange(gameData, selectedPet.id) : null;
  const [value, setValue] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);
  // Default the new pet's value to the top of the range and its name to the breed.
  const effectiveValue = value ?? range?.max ?? 0;
  const effectiveName = name ?? selectedPet?.name ?? '';

  if (breeds.length === 0) {
    return (
      <p className="text-sm text-amber-500">Pet catalog unavailable - game data did not load.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Breed</span>
          <select
            aria-label="Breed"
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            {breeds.map((b) => (
              <option key={b.breed} value={b.breed}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Rarity</span>
          <select
            aria-label="Rarity"
            value={petId}
            onChange={(e) => setPetId(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            {rarityChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rarity}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="text-sm text-neutral-300">
        <span className="text-neutral-400">Bonus (locked): </span>
        {selectedPet ? prettyBonus(selectedPet.bonus) : '–'}
        {range && (
          <span className="text-neutral-400">
            {' '}
            - legal range {range.min}–{range.max}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <NumberField
          label="Bonus value"
          value={effectiveValue}
          onCommit={setValue}
          min={range?.min ?? 0}
          max={range?.max ?? 9999}
          allowOutOfRange={allowOutOfRange}
        />
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">Unique name</span>
          <input
            type="text"
            aria-label="Unique name"
            value={effectiveName}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>
      <div>
        <button
          type="button"
          disabled={!selectedPet || submitDisabled}
          onClick={() => {
            if (!selectedPet) return;
            onCreate({
              petId: selectedPet.id,
              uniqueName: effectiveName,
              bonus: selectedPet.bonus,
              bonusValue: effectiveValue,
            });
          }}
          className="rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
