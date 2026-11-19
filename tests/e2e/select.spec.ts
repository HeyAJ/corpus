import { expect, test } from '@playwright/test';
import { boot, collectProblems, tapAt } from './helpers';

// Guards picking an organ in the real 3D view: a tap on the chest selects one (the Structures
// panel then lists its parts) and a tap on empty space at the stage edge clears it again.
test('tapping the chest selects an organ and empty space clears it', async ({ page }, info) => {
  const problems = collectProblems(page);
  const touch = info.project.name === 'phone';
  await boot(page);

  await tapAt(page, 0.5, 0.4, touch);
  const structures = page.getByRole('region', { name: 'Structures' });
  await expect(structures).toContainText(/Structures\s+·\s+\d+ parts/, { timeout: 20_000 });

  await tapAt(page, 0.02, 0.5, touch);
  await expect(structures).toHaveCount(0, { timeout: 20_000 });

  expect(problems.list).toEqual([]);
});
