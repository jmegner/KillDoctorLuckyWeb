import { expect, test, type Page } from '@playwright/test';

const readAiLineValue = async (page: Page, labelText: string) =>
  page.evaluate((labelArg) => {
    const lines = Array.from(document.querySelectorAll('.ai-panel .planner-line'));
    for (const line of lines) {
      const label = line.querySelector('.planner-label')?.textContent?.trim();
      if (label === labelArg) {
        return line.querySelector('.planner-value')?.textContent?.trim() ?? null;
      }
    }
    return null;
  }, labelText);

const waitForAnalysisToSettle = async (page: Page) => {
  const aiPanel = page.locator('.ai-panel');
  await expect(aiPanel.getByRole('button', { name: 'Think', exact: true })).toBeEnabled({ timeout: 20_000 });
  await expect
    .poll(async () => (await readAiLineValue(page, 'Status')) ?? '', { timeout: 20_000 })
    .not.toMatch(/Analyzing|failed/i);
};

const cancelAiAnalysisIfRunning = async (page: Page) => {
  const cancelButton = page.locator('.ai-panel').getByRole('button', { name: 'Cancel' });
  if (await cancelButton.isEnabled()) {
    await cancelButton.click();
    await expect(cancelButton).toBeDisabled({ timeout: 20_000 });
  }
};

test.describe('production preview smoke', () => {
  test('initial auto-analysis completes in preview mode', async ({ page }) => {
    await page.goto('/');

    await waitForAnalysisToSettle(page);

    await expect
      .poll(() => readAiLineValue(page, 'Suggested'), { timeout: 5_000 })
      .not.toBe('No suggestion yet.');
  });

  test('manual Think completes in preview mode', async ({ page }) => {
    await page.goto('/');

    await cancelAiAnalysisIfRunning(page);

    const aiPanel = page.locator('.ai-panel');
    await aiPanel.getByRole('button', { name: 'Think', exact: true }).click();

    await waitForAnalysisToSettle(page);

    await expect
      .poll(() => readAiLineValue(page, 'Suggested'), { timeout: 5_000 })
      .not.toBe('No suggestion yet.');
  });

  test('analysis can restart offline after the preview app loads', async ({ page }) => {
    await page.goto('/');

    await cancelAiAnalysisIfRunning(page);
    await page.context().setOffline(true);

    const aiPanel = page.locator('.ai-panel');
    await aiPanel.getByRole('button', { name: 'Think', exact: true }).click();

    await waitForAnalysisToSettle(page);

    await expect
      .poll(() => readAiLineValue(page, 'Suggested'), { timeout: 5_000 })
      .not.toBe('No suggestion yet.');
  });
});
