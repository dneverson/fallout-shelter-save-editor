import { test, expect, type Page } from '@playwright/test';

// Cross-tab jump scroll (the behaviour jsdom can't exercise): arriving on the Recipes tab
// focused on a recipe must scroll the virtualized 380+ row table so that row is rendered AND
// in view. A virtualized row far from the current scroll offset isn't even in the DOM, so this
// fails hard if the mount-time scroll-to-focusRowId regresses. We test MULTIPLE sequential
// jumps because the reported symptom was "works once, then not again".

// A few recipe ids spread across the alphabetical sort, so each jump needs a real scroll.
const JUMPS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'PowerArmor_MkVI', name: 'X-01 Mk VI Power Armor' }, // bottom
  { id: '032Pistol', name: '.32 Pistol' }, // top
  { id: 'LabCoat', name: 'Lab Coat' }, // middle
  { id: 'PulseRifle_Enhanced', name: 'Enhanced Pulse Rifle' }, // upper quarter
  { id: 'Rifle_Rusty', name: 'Rusty Lever-Action Rifle' }, // lower quarter
];

// The table body is the second rowgroup (after the header rowgroup); scope to it so we match
// the table ROW, not the side panel's copy of the recipe name.
async function expectRowInView(page: Page, name: string): Promise<void> {
  const targetRow = page.getByRole('rowgroup').nth(1).getByText(name, { exact: true });
  await expect(targetRow).toBeVisible();
  await expect(targetRow).toBeInViewport();
}

test('every recipe jump scrolls its row into view (same-tab, repeated)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'I understand and accept the risks' }).click();
  // Section views only mount once a save is loaded; the sandbox is the quickest way in.
  await page.getByRole('button', { name: 'Start fresh / sandbox' }).click();
  await page.getByRole('heading', { name: 'Dwellers' }).waitFor({ timeout: 15000 });

  for (const { id, name } of JUMPS) {
    await page.evaluate((recipeId) => {
      window.location.hash = `#/recipes/${recipeId}`;
    }, id);
    await expectRowInView(page, name);
  }
});

test('recipe jump scrolls into view after leaving and re-entering the tab (remount)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'I understand and accept the risks' }).click();
  // Section views only mount once a save is loaded; the sandbox is the quickest way in.
  await page.getByRole('button', { name: 'Start fresh / sandbox' }).click();
  await page.getByRole('heading', { name: 'Dwellers' }).waitFor({ timeout: 15000 });

  for (const { id, name } of JUMPS) {
    // Leave the Recipes tab entirely, then jump back in - forces a fresh RecipesView mount,
    // the same path as arriving from the Outfits/Weapons "Craftable" link.
    await page.evaluate(() => {
      window.location.hash = '#/dwellers';
    });
    await page.evaluate((recipeId) => {
      window.location.hash = `#/recipes/${recipeId}`;
    }, id);
    await expectRowInView(page, name);
  }
});
