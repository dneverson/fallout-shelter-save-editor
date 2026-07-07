// Landing description shown on the no-save screen. Renders independent of disclaimer
// acceptance so it is present in the server-delivered/rendered DOM for search engines and
// link-preview crawlers (which never dismiss the disclaimer), while also giving first-time
// human visitors a plain-language summary of what the tool does. Purely static text - no
// state, no interactivity. The single <h1> lives in the TopBar; this uses <h2>/<h3>.

const FEATURES: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: 'Dwellers',
    detail: 'SPECIAL stats, level, happiness, health, gear, appearance, and reviving the dead.',
  },
  { term: 'Vault', detail: 'caps, food, water, power, Nuka-Cola, lunchboxes, and game mode.' },
  {
    term: 'Rooms',
    detail: 'rearrange the layout, upgrade, apply themes, clear rocks, and repair.',
  },
  {
    term: 'Season passes',
    detail: "view every season's full reward track and claim rewards you missed.",
  },
  {
    term: 'Family tree',
    detail: 'see your vault lineage and genetics stats the game never shows you.',
  },
  {
    term: 'Item catalogs',
    detail: 'every weapon, outfit, pet, junk item, and recipe in the game.',
  },
];

export function LandingIntro() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-8 text-neutral-300">
      <h2 className="text-xl font-semibold text-neutral-100">
        Edit your Fallout Shelter vault in your browser
      </h2>
      <p className="mt-3 text-sm leading-relaxed">
        A free, open-source Fallout Shelter save editor. Load your{' '}
        <code className="text-neutral-200">Vault1.sav</code> file, change almost anything about your
        vault, and export a working save back to the game. Everything runs locally in your browser -
        your save is never uploaded to a server.
      </p>

      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        What you can do
      </h3>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
        {FEATURES.map((f) => (
          <li key={f.term}>
            <span className="font-medium text-neutral-100">{f.term}:</span> {f.detail}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs leading-relaxed text-neutral-500">
        Works with saves from PC, Android, iOS, and Switch. Free and open source (MIT). No accounts,
        no ads, no telemetry.
      </p>
    </section>
  );
}
