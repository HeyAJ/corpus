import { expect, test, type Page } from '@playwright/test';
import { acceptWelcome, boot, collectProblems, settle } from './helpers';

// Guards the ways into the body that a visitor has besides tapping it: the search field in the
// panels menu, a shared link, the Cut control and the Reset view pill. Names are the accessible
// ones (roles, labels, visible text), never CSS-module class names, because those are hashed.

/** Open a link as a visitor does: a fresh page, the welcome dialog accepted, the engine running. */
async function openLink(page: Page, hash: string): Promise<void> {
  await page.goto('/' + hash, { waitUntil: 'load' });
  await expect(page.locator('canvas').first()).toBeAttached({ timeout: 60_000 });
  await expect(page.getByText('Starting body engine')).toHaveCount(0, { timeout: 90_000 });
  await acceptWelcome(page);
}

test('searching "pyr" opens a kidney and selects a renal pyramid', async ({ page }) => {
  const problems = collectProblems(page);
  await boot(page);

  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  const field = page.getByRole('combobox', { name: 'Find an organ or structure' });
  await field.fill('pyr');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible();
  await field.press('Enter');

  const structures = page.getByRole('region', { name: 'Structures' });
  await expect(structures).toContainText(/(Left|Right) kidney/i, { timeout: 20_000 });
  // The selected structure is the one row the panel has opened in place.
  const open = structures.locator('li[data-open="true"]');
  await expect(open).toHaveCount(1, { timeout: 20_000 });
  await expect(open).toContainText(/pyramid/i);

  expect(problems.list).toEqual([]);
});

test('a share link restores the body and the view, and a malformed one is ignored', async ({ page }) => {
  const problems = collectProblems(page);
  await openLink(page, '#v=1&sex=female&weeks=28&organ=uterus&layers=vessels');

  const structures = page.getByRole('region', { name: 'Structures' });
  await expect(structures).toContainText(/Uterus/i, { timeout: 30_000 });
  // On a phone the corner switches are deliberately absent while a bottom sheet is open (they
  // would sit under it), so close the Structures sheet first, as a visitor would to reach them.
  // The Vessels switch announces its state through aria-pressed; its name flips with it.
  await structures.getByRole('button', { name: 'Close Structures' }).click();
  await expect(structures).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hide blood vessels' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name: /^Reproduction/ }).click();
  const repro = page.getByRole('region', { name: 'Reproduction' });
  await expect(repro).toBeVisible();
  await expect(repro.getByRole('slider', { name: 'Gestational age' })).toHaveValue('28', { timeout: 20_000 });

  // A malformed link: a fresh page keeps the default body and selects nothing.
  await openLink(page, '#v=1&organ=alert(1)&weeks=999');
  await page.reload({ waitUntil: 'load' });
  await expect(page.getByText('Starting body engine')).toHaveCount(0, { timeout: 90_000 });
  await acceptWelcome(page);
  await settle(page);
  await expect(page.getByRole('region', { name: 'Structures' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show blood vessels' })).toHaveAttribute('aria-pressed', 'false');

  expect(problems.list).toEqual([]);
});

test('the Cut control marks the chosen side as selected', async ({ page }) => {
  const problems = collectProblems(page);
  await openLink(page, '#v=1&organ=heart');

  const structures = page.getByRole('region', { name: 'Structures' });
  await expect(structures).toContainText(/\d+ parts/, { timeout: 30_000 });
  const front = structures.getByRole('radio', { name: 'Front' });
  await front.click();
  await expect(front).toHaveAttribute('aria-checked', 'true');
  await expect(structures.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false');
  await settle(page);

  expect(problems.list).toEqual([]);
});

test('Reset view appears after a Shift+drag and goes when clicked', async ({ page }, info) => {
  // A two-finger drag is not practical to synthesise on a phone, so this is desktop only.
  test.skip(info.project.name === 'phone', 'Shift+drag is a mouse gesture');
  const problems = collectProblems(page);
  await boot(page);

  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  const reset = page.getByRole('button', { name: 'Reset view' });
  await expect(reset).toHaveCount(0);

  await page.keyboard.down('Shift');
  await page.mouse.move(vp.width * 0.4, vp.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(vp.width * 0.5, vp.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(reset).toBeVisible({ timeout: 20_000 });
  await reset.click();
  await expect(reset).toHaveCount(0, { timeout: 20_000 });

  expect(problems.list).toEqual([]);
});
