import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const sanityStorageKey = 'kdl.playwright.sanity';
const aiPrefsStorageKey = 'kdl.ai.v1';

const readNormalTurnCount = async (page: Page) =>
  page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return -1;
    }
    const parsed = JSON.parse(raw) as { normalTurns?: unknown; normal_turns?: unknown };
    const turns = Array.isArray(parsed.normalTurns)
      ? parsed.normalTurns
      : Array.isArray(parsed.normal_turns)
        ? parsed.normal_turns
        : null;
    return turns ? turns.length + 1 : -1;
  }, gameStateStorageKey);

const seedStateWithTurns = async (
  page: Page,
  options: { turnCount: number; controlP1: boolean; controlP3: boolean },
) => {
  await page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg, aiPrefsStorageKeyArg, turnCountArg, controlP1Arg, controlP3Arg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seededState = wasm.newDefaultGameState();
      try {
        const boardRooms = JSON.parse(seededState.boardRoomsJson()) as Array<{ id?: number; Id?: number }>;
        const roomIds = boardRooms
          .map((room) => {
            const raw = typeof room.id === 'number' ? room.id : room.Id;
            return typeof raw === 'number' ? Math.trunc(raw) : NaN;
          })
          .filter((roomId) => Number.isFinite(roomId));
        const movablePieceIds = ['player1', 'player2', 'stranger1', 'stranger2'];

        const applyAnyValidPlan = () => {
          for (const pieceId of movablePieceIds) {
            for (const roomId of roomIds) {
              const plan = [{ pieceId, roomId }];
              const validationError = seededState.validateTurnPlan(JSON.stringify(plan));
              if (validationError) {
                continue;
              }
              const applyError = seededState.applyTurnPlan(JSON.stringify(plan));
              if (!applyError) {
                return true;
              }
            }
          }
          return false;
        };

        for (let index = 0; index < turnCountArg; index += 1) {
          if (applyAnyValidPlan()) {
            continue;
          }
          throw new Error(`Failed to seed turn ${index + 1}.`);
        }

        window.localStorage.setItem(gameStateStorageKeyArg, seededState.exportStateJson());
        window.localStorage.removeItem(redoStateStackStorageKeyArg);
        window.localStorage.setItem(
          aiPrefsStorageKeyArg,
          JSON.stringify({
            minAnalysisLevel: 0,
            maxAnalysisLevel: 5,
            analysisMaxTimeIndex: 0,
            controlP1: controlP1Arg,
            controlP3: controlP3Arg,
            showOnBoardP1: false,
            showOnBoardP3: false,
          }),
        );
      } finally {
        seededState.free();
      }
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
      aiPrefsStorageKeyArg: aiPrefsStorageKey,
      turnCountArg: options.turnCount,
      controlP1Arg: options.controlP1,
      controlP3Arg: options.controlP3,
    },
  );
};

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

  const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
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
  const animRedoButton = page.getByRole('button', { name: 'Anim Redo' });
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });

  await expect(animationOnCheckbox).toBeChecked();
  await animationOnCheckbox.uncheck();
  await expect(animationOnCheckbox).not.toBeChecked();

  await expect(animRedoButton).toBeEnabled();
  await animRedoButton.click();

  await expect(redoButton).toBeDisabled();
  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), redoStateStackStorageKey)).toBeNull();
});

test('Undo AI stops at the opponent turn of the most recent AI-controlled player and keeps Control checked', async ({ page }) => {
  await page.goto('/');

  await seedStateWithTurns(page, { turnCount: 3, controlP1: false, controlP3: false });
  await page.reload();

  const undoAiButton = page.getByRole('button', { name: 'Undo AI' });
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
  const controlRow = page.locator('.planner-line').filter({ hasText: 'Control' }).first();
  const p1ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P1' });
  const turnPlannerTitle = page.locator('.planner-panel .planner-title').first();

  await p1ControlCheckbox.check();
  await undoAiButton.click();

  await expect(turnPlannerTitle).toContainText('Turn 2/4: P3');
  await expect(p1ControlCheckbox).toBeChecked();
  await expect(redoButton).toBeEnabled();
  await expect.poll(() => readNormalTurnCount(page)).toBe(2);
});

test('Undo AI stays enabled after a single controlled P1 turn and keeps Control checked', async ({ page }) => {
  await page.goto('/');

  await seedStateWithTurns(page, { turnCount: 1, controlP1: true, controlP3: false });
  await page.reload();

  const undoAiButton = page.getByRole('button', { name: 'Undo AI' });
  const controlRow = page.locator('.planner-line').filter({ hasText: 'Control' }).first();
  const p1ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P1' });
  const turnPlannerTitle = page.locator('.planner-panel .planner-title').first();

  await expect(undoAiButton).toBeEnabled();
  await undoAiButton.click();

  await expect(p1ControlCheckbox).toBeChecked();
  await expect(turnPlannerTitle).toContainText('P3');
});

test('Undo AI stays enabled with both Control checkboxes checked', async ({ page }) => {
  await page.goto('/');

  await seedStateWithTurns(page, { turnCount: 1, controlP1: true, controlP3: true });
  await page.reload();

  const undoAiButton = page.getByRole('button', { name: 'Undo AI' });
  const controlRow = page.locator('.planner-line').filter({ hasText: 'Control' }).first();
  const p1ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P1' });
  const p3ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P3' });

  await expect(undoAiButton).toBeEnabled();
  await expect(p1ControlCheckbox).toBeChecked();
  await expect(p3ControlCheckbox).toBeChecked();
});

test('Undo all and Redo all traverse the full available history', async ({ page }) => {
  await page.goto('/');

  await seedStateWithTurns(page, { turnCount: 3, controlP1: false, controlP3: false });
  await page.reload();

  const undoAllButton = page.getByRole('button', { name: 'Undo all' });
  const redoAllButton = page.getByRole('button', { name: 'Redo all' });
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
  const turnPlannerTitle = page.locator('.planner-panel .planner-title').first();

  await expect.poll(() => readNormalTurnCount(page)).toBe(4);
  await undoAllButton.click();

  await expect(turnPlannerTitle).toContainText('Turn 1/4: P1');
  await expect(redoAllButton).toBeEnabled();
  await expect.poll(() => readNormalTurnCount(page)).toBe(1);

  await redoAllButton.click();

  await expect(turnPlannerTitle).toContainText('Turn 4: P3');
  await expect(redoButton).toBeDisabled();
  await expect.poll(() => readNormalTurnCount(page)).toBe(4);
});
