import { expect, test } from '@playwright/test';

test('full turn history cannot widen the mobile page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const initialWidth = await page.locator('.play-area').evaluate((playArea) => playArea.getBoundingClientRect().width);

  await page.locator('.play-area-summary').evaluate((summary) => {
    const history = document.createElement('pre');
    history.className = 'game-summary game-summary--history';
    history.textContent = [
      'Turn 1: Player 1 moved normally.',
      `Turn 2: ${'unbroken-history-segment-'.repeat(40)}`,
    ].join('\n');
    summary.append(history);
  });

  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    historyWidth: document.querySelector('.game-summary--history')?.getBoundingClientRect().width ?? 0,
    playAreaWidth: document.querySelector('.play-area')?.getBoundingClientRect().width ?? 0,
    summaryWidth: document.querySelector('.play-area-summary')?.getBoundingClientRect().width ?? 0,
    viewportWidth: window.innerWidth,
  }));

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.playAreaWidth).toBeCloseTo(initialWidth, 5);
  expect(layout.historyWidth).toBeLessThanOrEqual(layout.summaryWidth);
});
