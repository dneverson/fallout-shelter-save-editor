import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Section } from './sections.ts';

/**
 * Typed navigation to a section route, optionally with a detail selection (the master-detail
 * sub-resource - a dweller serializeId, a room deserializeID, or a pet row id like `e:5`).
 * The URL is the single source of truth for the active section AND the current selection, so
 * row clicks, deep-links, and browser/mouse back-forward all go through here:
 *
 *   goTo('dwellers')      -> #/dwellers          (selection cleared)
 *   goTo('dwellers', 42)  -> #/dwellers/42       (dweller 42 open in the sheet)
 *   goTo('pets', 'e:5')   -> #/pets/e:5
 */
export function useSectionNavigate(): (section: Section, detail?: string | number | null) => void {
  const navigate = useNavigate();
  return useCallback(
    (section, detail) => navigate(detail == null ? `/${section}` : `/${section}/${detail}`),
    [navigate],
  );
}
