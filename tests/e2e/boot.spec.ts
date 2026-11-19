import { expect, test } from '@playwright/test';
import { boot, collectProblems } from './helpers';

// Guards the first thing a visitor gets: the production build starts cleanly, says what it
// is (the permanent not-for-clinical-use banner and title), is cross-origin isolated (so the
// waveform channel uses SharedArrayBuffer) and is already showing a live heart rate.
test('boots cleanly, with the banner, isolation and a heart rate', async ({ page }) => {
  const problems = collectProblems(page);
  await boot(page);

  expect(await page.title()).toContain('NOT FOR CLINICAL USE');
  await expect(page.locator('body')).toContainText('NOT FOR CLINICAL USE — EDUCATIONAL SIMULATION');
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  expect(await page.locator('body').innerText()).not.toContain('degraded waveform transport');

  // The heart-rate pill carries its number in its accessible name: "Heart rate 66 beats per minute".
  await expect(page.locator('[aria-label^="Heart rate "]').first()).toHaveAttribute(
    'aria-label',
    /^Heart rate \d+ beats per minute/,
  );

  expect(problems.list).toEqual([]);
});
