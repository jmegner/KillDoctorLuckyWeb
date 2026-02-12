import { expect, test } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const sanityStorageKey = 'kdl.playwright.sanity';

test('redo remains available after refresh and does not disturb unrelated localStorage keys', async ({ page }) => {
  await page.goto('/');

  const redoButton = page.getByRole('button', { name: 'Redo' });
  await expect(redoButton).toBeDisabled();

  await page.evaluate(async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg, sanityStorageKeyArg }) => {
    const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
    await wasm.default();
    const seededState = wasm.newDefaultGameState();
    const snapshot = seededState.exportStateJson();
    seededState.free();

    window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
    window.localStorage.setItem(redoStateStackStorageKeyArg, JSON.stringify([snapshot]));
    window.localStorage.setItem(sanityStorageKeyArg, 'keep-me');
  }, {
    gameStateStorageKeyArg: gameStateStorageKey,
    redoStateStackStorageKeyArg: redoStateStackStorageKey,
    sanityStorageKeyArg: sanityStorageKey,
  });

  await page.reload();

  await expect(redoButton).toBeEnabled();
  await redoButton.click();
  await expect(redoButton).toBeDisabled();

  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), redoStateStackStorageKey)).toBeNull();
  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), sanityStorageKey)).toBe('keep-me');
});
