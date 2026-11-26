import { expect, test, type Page } from '@playwright/test';
import { boot, collectProblems, layoutChecks, settle, tapAt } from './helpers';

// Guards the layout a visitor sees: in each reachable state no control may be painted over by
// something else and no text may run through other text. This is the check that catches a
// panel covering the dock or a label colliding with its value. It is deliberately strict; if
// it fails, fix the layout rather than the check.

const PANELS = ['What is happening', 'Impact', 'Physiology', 'Structures'];

async function expectClean(page: Page, state: string): Promise<void> {
  // Let the open/close transitions finish so the checks see the settled layout.
  await page.waitForTimeout(1200);
  const r = await layoutChecks(page);
  expect({ state, covered: r.covered, textHit: r.textHit }).toEqual({ state, covered: [], textHit: [] });
}

// The same sequence runs per project; each state starts from the bare stage.
async function closeEverything(page: Page): Promise<void> {
  // The scrim spans the stage but the launcher sits over its centre, so tap its top-left
  // corner, which is always bare stage, the way a visitor taps outside a menu to dismiss it.
  const scrim = page.getByRole('button', { name: 'Close panels menu' });
  if (await scrim.isVisible().catch(() => false)) await scrim.click({ position: { x: 4, y: 4 } });
}

test('no covered control and no overlapping text in the main states', async ({ page }, info) => {
  const problems = collectProblems(page);
  const touch = info.project.name === 'phone';
  await boot(page);

  await expectClean(page, 'rest');

  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Panels' })).toBeVisible();
  await expectClean(page, 'panels menu');
  await closeEverything(page);

  for (const label of PANELS) {
    const menu = page.getByRole('menu', { name: 'Panels' });
    if (!(await menu.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Panels', exact: true }).click();
    }
    await menu.getByRole('menuitemcheckbox', { name: new RegExp('^' + label) }).click();
    await expectClean(page, 'panel: ' + label);
    // Opening one panel while another is open replaces it, so no explicit close is needed.
  }

  // Close the open panel by choosing it again, then open the administration sheet.
  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /^Structures/ }).click();
  await page.getByRole('button', { name: 'Administer' }).click();
  await expectClean(page, 'administration sheet');
  await page.getByRole('button', { name: 'Administer' }).click();

  // Wait the way a visitor does. On a wide screen the sheet docks at the right, so closing it
  // makes the camera re-frame the body for about 600 ms (FLIGHT_MS); a tap during that slide
  // lands on the moving body and selects nothing (reproduced: a tap 0 ms after closing missed,
  // 1500 ms later hit the heart). So wait until the sheet's dialog is gone, let the animations
  // finish, then pause briefly for the flight before tapping the chest.
  await expect(page.getByRole('dialog', { name: 'Administration drawer' })).toBeHidden({ timeout: 20_000 });
  await settle(page);
  await page.waitForTimeout(1000);

  await tapAt(page, 0.5, 0.4, touch);
  await expect(page.getByRole('region', { name: 'Structures' })).toBeVisible({ timeout: 20_000 });
  await expectClean(page, 'organ selected');

  expect(problems.list).toEqual([]);
});
