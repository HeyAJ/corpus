import { expect, test } from '@playwright/test';
import { boot, collectProblems } from './helpers';

// Guards the no-WebGL path: a browser that refuses a GL context (a blocklisted GPU, a locked-
// down kiosk) must get the explanatory card, the banner and live numbers, not a blank page.
test('without WebGL the fallback card, the banner and a heart rate still show', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for the fallback card');
  // Two console errors are expected, and only these. three.js logs the first itself when the
  // context request returns null; src/ui/App.tsx logs the second on purpose when `new Viewer`
  // throws for lack of WebGL 2. Anything else still fails the test.
  const problems = collectProblems(page, [
    /^console: THREE\.WebGLRenderer: Error creating WebGL context\.$/,
    /^console: CORPUS: the 3D view could not start/,
  ]);
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error: a deliberate partial override of an overloaded DOM method.
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (/webgl/i.test(String(type))) return null;
      return (real as (...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
  await boot(page);

  const card = page.getByRole('alert');
  await expect(card).toBeVisible();
  expect((await card.innerText()).split('\n')[0].trim()).toBe('The 3D body cannot be shown on this device.');
  await expect(page.locator('body')).toContainText('NOT FOR CLINICAL USE — EDUCATIONAL SIMULATION');
  await expect(page.locator('[aria-label^="Heart rate "]').first()).toHaveAttribute(
    'aria-label',
    /^Heart rate \d+ beats per minute/,
  );

  expect(problems.list).toEqual([]);
});
