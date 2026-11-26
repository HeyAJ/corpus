import { expect, test } from '@playwright/test';
import { boot, collectProblems } from './helpers';

// Guards the once-per-browser welcome dialog: shown on a fresh profile, remembered after
// acceptance, and never allowed to take the permanent banner away with it.
test('the welcome dialog is asked once and the banner stays', async ({ page }) => {
  const problems = collectProblems(page);
  await boot(page, { accept: false });

  const accept = page.getByRole('button', { name: 'I understand' });
  await expect(accept).toBeVisible();
  await accept.click();
  await expect(accept).toHaveCount(0);

  await page.reload({ waitUntil: 'load' });
  await expect(page.getByText('Starting body engine')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'I understand' })).toHaveCount(0);
  await expect(page.locator('body')).toContainText('NOT FOR CLINICAL USE — EDUCATIONAL SIMULATION');

  expect(problems.list).toEqual([]);
});
