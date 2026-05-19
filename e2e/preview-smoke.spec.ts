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

const noSuggestionText = 'No suggestion yet.';
const runningStatusPattern = /^(Analyzing|L\d+,)/i;

const readAiStatus = (page: Page) => readAiLineValue(page, 'Status');

const readAiSuggested = (page: Page) => readAiLineValue(page, 'Suggested');

const waitForAnalysisToSettle = async (page: Page) => {
  const aiPanel = page.locator('.ai-panel');
  const thinkButton = aiPanel.getByRole('button', { name: 'Think', exact: true });

  await expect
    .poll(
      async () => {
        const status = (await readAiStatus(page)) ?? '';
        if (/failed/i.test(status)) {
          return `failed: ${status}`;
        }
        if (!(await thinkButton.isEnabled()) || runningStatusPattern.test(status)) {
          return 'running';
        }
        return (await readAiSuggested(page)) === noSuggestionText ? 'waiting-for-suggestion' : 'settled';
      },
      { timeout: 20_000 },
    )
    .toBe('settled');
};

const waitForAiPanelIdle = async (page: Page) => {
  const aiPanel = page.locator('.ai-panel');
  const thinkButton = aiPanel.getByRole('button', { name: 'Think', exact: true });

  await expect
    .poll(
      async () => {
        const status = (await readAiStatus(page)) ?? '';
        return (await thinkButton.isEnabled()) && !runningStatusPattern.test(status);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
};

const cancelAiAnalysisIfRunning = async (page: Page) => {
  const aiPanel = page.locator('.ai-panel');
  const cancelButton = aiPanel.getByRole('button', { name: 'Cancel' });
  const thinkButton = aiPanel.getByRole('button', { name: 'Think', exact: true });

  await expect
    .poll(
      async () => {
        if (await cancelButton.isEnabled()) {
          return 'running';
        }
        return (await thinkButton.isEnabled()) ? 'idle' : 'transitioning';
      },
      { timeout: 5_000 },
    )
    .not.toBe('transitioning');

  if (await cancelButton.isEnabled()) {
    await cancelButton.click();
    await waitForAiPanelIdle(page);
  }
};

const clickThinkAndWaitForAnalysisToSettle = async (page: Page) => {
  const thinkButton = page.locator('.ai-panel').getByRole('button', { name: 'Think', exact: true });

  await thinkButton.click();
  await expect(thinkButton).toBeDisabled({ timeout: 5_000 });
  await waitForAnalysisToSettle(page);
};

test.describe('production preview smoke', () => {
  test('initial auto-analysis completes in preview mode', async ({ page }) => {
    await page.goto('/');

    await waitForAnalysisToSettle(page);

    await expect.poll(() => readAiSuggested(page), { timeout: 5_000 }).not.toBe(noSuggestionText);
  });

  test('manual Think completes in preview mode', async ({ page }) => {
    await page.goto('/');

    await waitForAnalysisToSettle(page);

    await clickThinkAndWaitForAnalysisToSettle(page);

    await expect.poll(() => readAiSuggested(page), { timeout: 5_000 }).not.toBe(noSuggestionText);
  });

  test('analysis can restart offline after the preview app loads', async ({ page }) => {
    await page.goto('/');

    await cancelAiAnalysisIfRunning(page);
    await page.context().setOffline(true);

    await clickThinkAndWaitForAnalysisToSettle(page);

    await expect.poll(() => readAiSuggested(page), { timeout: 5_000 }).not.toBe(noSuggestionText);
  });
});
