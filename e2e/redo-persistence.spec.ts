import { expect, test } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const sanityStorageKey = 'kdl.playwright.sanity';
const aiPrefsStorageKey = 'kdl.ai.v1';

test('redo remains available after refresh and does not disturb unrelated localStorage keys', async ({ page }) => {
  await page.goto('/');

  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
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

test('undo clears AI control for the undone player before analysis can auto-submit', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async ({ gameStateStorageKeyArg, aiPrefsStorageKeyArg, redoStateStackStorageKeyArg }) => {
    const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
    await wasm.default();
    const seededState = wasm.newDefaultGameState();
    const boardRooms = JSON.parse(seededState.boardRoomsJson());
    const roomIds = (Array.isArray(boardRooms) ? boardRooms : [])
      .map((room) => {
        if (typeof room?.id === 'number') {
          return Math.trunc(room.id);
        }
        if (typeof room?.Id === 'number') {
          return Math.trunc(room.Id);
        }
        return NaN;
      })
      .filter((roomId) => Number.isFinite(roomId));
    const movablePieceIds = ['player1', 'player2', 'stranger1', 'stranger2'];
    const candidatePlans: Array<Array<{ pieceId: string; roomId: number }>> = [];

    for (const pieceId of movablePieceIds) {
      for (const roomId of roomIds) {
        candidatePlans.push([{ pieceId, roomId }]);
      }
    }
    for (let firstPieceIndex = 0; firstPieceIndex < movablePieceIds.length; firstPieceIndex += 1) {
      const firstPieceId = movablePieceIds[firstPieceIndex];
      for (let secondPieceIndex = firstPieceIndex + 1; secondPieceIndex < movablePieceIds.length; secondPieceIndex += 1) {
        const secondPieceId = movablePieceIds[secondPieceIndex];
        for (const firstRoomId of roomIds) {
          for (const secondRoomId of roomIds) {
            candidatePlans.push([
              { pieceId: firstPieceId, roomId: firstRoomId },
              { pieceId: secondPieceId, roomId: secondRoomId },
            ]);
          }
        }
      }
    }

    let appliedPlan: Array<{ pieceId: string; roomId: number }> | null = null;
    for (const plan of candidatePlans) {
      const validationError = seededState.validateTurnPlan(JSON.stringify(plan));
      if (validationError) {
        continue;
      }
      const applyError = seededState.applyTurnPlan(JSON.stringify(plan));
      if (!applyError) {
        appliedPlan = plan;
        break;
      }
    }
    if (!appliedPlan) {
      seededState.free();
      throw new Error('Failed to seed one-turn game with any valid turn plan.');
    }

    const snapshot = seededState.exportStateJson();
    seededState.free();

    window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
    window.localStorage.setItem(
      aiPrefsStorageKeyArg,
      JSON.stringify({
        minAnalysisLevel: 0,
        analysisMaxTimeIndex: 0,
        controlP1: true,
        controlP3: false,
      }),
    );
    window.localStorage.removeItem(redoStateStackStorageKeyArg);
  }, {
    gameStateStorageKeyArg: gameStateStorageKey,
    aiPrefsStorageKeyArg: aiPrefsStorageKey,
    redoStateStackStorageKeyArg: redoStateStackStorageKey,
  });

  await page.reload();

  const undoButton = page.getByRole('button', { name: 'Undo' });
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
  const controlRow = page.locator('.planner-line').filter({ hasText: 'Control' }).first();
  const p1ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P1' });
  const turnPlannerTitle = page.locator('.planner-panel .planner-title').first();

  await expect(undoButton).toBeEnabled();
  await expect(p1ControlCheckbox).toBeChecked();

  await undoButton.click();

  await expect(p1ControlCheckbox).not.toBeChecked();
  await expect(turnPlannerTitle).toContainText('Turn 1/2: P1');
  await expect(redoButton).toBeEnabled();
  await page.waitForTimeout(2500);
  await expect(redoButton).toBeEnabled();
  await expect.poll(async () =>
    page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}').controlP1, aiPrefsStorageKey),
  ).toBe(false);
});

test('Anim Redo redoes the turn even when animation checkbox is off', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg }) => {
    const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
    await wasm.default();
    const seededState = wasm.newDefaultGameState();
    const snapshot = seededState.exportStateJson();
    seededState.free();

    window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
    window.localStorage.setItem(redoStateStackStorageKeyArg, JSON.stringify([snapshot]));
  }, {
    gameStateStorageKeyArg: gameStateStorageKey,
    redoStateStackStorageKeyArg: redoStateStackStorageKey,
  });

  await page.reload();

  const animationsPanel = page.locator('.planner-animations');
  const animationOnCheckbox = animationsPanel.getByRole('checkbox', { name: 'On' });
  const animRedoButton = animationsPanel.getByRole('button', { name: 'Anim Redo' });
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });

  await expect(animationOnCheckbox).toBeChecked();
  await animationOnCheckbox.uncheck();
  await expect(animationOnCheckbox).not.toBeChecked();

  await expect(animRedoButton).toBeEnabled();
  await animRedoButton.click();

  await expect(redoButton).toBeDisabled();
  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), redoStateStackStorageKey)).toBeNull();
});
