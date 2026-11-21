import { expect, test } from '@playwright/test';
import { boot, collectProblems, settle, tapAt } from './helpers';

// Guards picking an organ in the real 3D view: a tap on the chest selects one (the Structures
// panel then lists its parts) and a tap on empty space at the stage edge clears it again.
test('tapping the chest selects an organ and empty space clears it', async ({ page }, info) => {
  const problems = collectProblems(page);
  const touch = info.project.name === 'phone';
  await boot(page);

  await tapAt(page, 0.5, 0.4, touch);
  const structures = page.getByRole('region', { name: 'Structures' });
  // The shared panel header shows the title and, in a separate meta element, "Heart · 17 parts",
  // so a visitor reads the part count beside the organ name rather than in one "Structures · N" run.
  await expect(structures).toContainText(/\d+ parts/, { timeout: 20_000 });

  // Selecting an organ makes the camera fly to frame it (about 600 ms) and, on a wide screen,
  // re-frame around the docked panel. A tap on empty space while that slide runs was seen to
  // miss once in a full run on the desktop project, so wait as a visitor does: until the
  // animations have finished, plus a short pause for the flight.
  await settle(page);
  await page.waitForTimeout(1000);
  // WHERE IS EMPTY SPACE? On a phone the left edge is bare stage. On a wide screen the docked
  // panel makes the camera frame the organ larger, and then the lung fills the left edge: a tap
  // there correctly selects the lung instead (seen in a screenshot, heart open, tap at 2 %,
  // right lung selected). The strip above the docked panel, at the top right, is bare there.
  if (touch) await tapAt(page, 0.02, 0.5, touch);
  else await tapAt(page, 0.87, 0.005, touch);
  await expect(structures).toHaveCount(0, { timeout: 20_000 });

  expect(problems.list).toEqual([]);
});
