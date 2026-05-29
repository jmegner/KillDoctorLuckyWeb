import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const sanityStorageKey = 'kdl.playwright.sanity';
const aiPrefsStorageKey = 'kdl.ai.v1';
const aiResultsCacheStorageKey = 'kdl.aiResultsCache.v1';

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

const readRedoStackLength = async (page: Page) =>
  page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return 0;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  }, redoStateStackStorageKey);

const dispatchRoomDoubleClick = async (room: import('@playwright/test').Locator) => {
  await room.evaluate((element) => {
    const buildMouseEvent = (type: 'click' | 'dblclick', detail: number) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail,
      });

    element.dispatchEvent(buildMouseEvent('click', 1));
    element.dispatchEvent(buildMouseEvent('click', 2));
    element.dispatchEvent(buildMouseEvent('dblclick', 2));
  });
};

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
            analysisMaxTimeIndex: 1,
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

const seedManualRedoScenario = async (
  page: Page,
  options?: { seedAiSuggestionForTopRedo?: boolean },
): Promise<{ redoRoomName: string }> =>
  page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg, aiPrefsStorageKeyArg, aiResultsCacheStorageKeyArg, seedAiSuggestionForTopRedoArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seededState = wasm.newDefaultGameState();
      try {
        const pieceIndexById: Record<string, number> = {
          doctor: 0,
          player1: 1,
          player2: 2,
          stranger1: 3,
          stranger2: 4,
        };
        const boardRooms = JSON.parse(seededState.boardRoomsJson()) as Array<{
          id?: number;
          Id?: number;
          name?: string;
          Name?: string;
        }>;
        const roomNameById = new Map<number, string>();
        for (const room of boardRooms) {
          const roomIdRaw = typeof room.id === 'number' ? room.id : room.Id;
          const roomNameRaw = typeof room.name === 'string' ? room.name : room.Name;
          if (typeof roomIdRaw === 'number' && typeof roomNameRaw === 'string' && roomNameRaw.length > 0) {
            roomNameById.set(Math.trunc(roomIdRaw), roomNameRaw);
          }
        }
        const roomIds = Array.from(roomNameById.keys()).sort((a, b) => a - b);
        const appliedTurns: Array<{
          pieceId: string;
          roomId: number;
          roomName: string;
          snapshot: string;
        }> = [];

        for (let turnIndex = 0; turnIndex < 3; turnIndex += 1) {
          const currentPlayerPieceId = seededState.currentPlayerPieceId();
          const currentPlayerIndex = pieceIndexById[currentPlayerPieceId];
          if (currentPlayerIndex === undefined) {
            throw new Error(`Unexpected current player piece id: ${currentPlayerPieceId}`);
          }
          const positions = Array.from(seededState.piecePositions(), (value) => Number(value));
          const currentRoomId = positions[currentPlayerIndex];
          let didApplyTurn = false;

          for (const roomId of roomIds) {
            if (roomId === currentRoomId) {
              continue;
            }
            const roomName = roomNameById.get(roomId);
            if (!roomName) {
              continue;
            }
            const plan = [{ pieceId: currentPlayerPieceId, roomId }];
            const validationError = seededState.validateTurnPlan(JSON.stringify(plan));
            if (validationError) {
              continue;
            }
            const applyError = seededState.applyTurnPlan(JSON.stringify(plan));
            if (applyError) {
              continue;
            }
            appliedTurns.push({
              pieceId: currentPlayerPieceId,
              roomId,
              roomName,
              snapshot: seededState.exportStateJson(),
            });
            didApplyTurn = true;
            break;
          }

          if (!didApplyTurn) {
            throw new Error(`Failed to seed valid single-piece turn ${turnIndex + 1}.`);
          }
        }

        window.localStorage.setItem(gameStateStorageKeyArg, appliedTurns[0].snapshot);
        window.localStorage.setItem(
          redoStateStackStorageKeyArg,
          JSON.stringify([appliedTurns[2].snapshot, appliedTurns[1].snapshot]),
        );
        if (seedAiSuggestionForTopRedoArg) {
          window.localStorage.setItem(
            aiPrefsStorageKeyArg,
            JSON.stringify({
              minAnalysisLevel: 0,
              maxAnalysisLevel: 1,
              analysisMaxTimeIndex: 1,
              controlP1: false,
              controlP3: false,
              showOnBoardP1: false,
              showOnBoardP3: false,
            }),
          );
          window.localStorage.setItem(
            aiResultsCacheStorageKeyArg,
            JSON.stringify({
              version: 1,
              entries: [
                {
                  stateJson: appliedTurns[0].snapshot,
                  analysisLevel: 1,
                  bestTurn: {
                    isValid: true,
                    validationMessage: '',
                    suggestedTurnText: `${appliedTurns[1].pieceId}->${appliedTurns[1].roomName}`,
                    suggestedTurn: [{ pieceId: appliedTurns[1].pieceId, roomId: appliedTurns[1].roomId }],
                    heuristicScore: 0,
                    numStatesVisited: 1,
                    elapsedMs: 1,
                  },
                  previewRaw: '',
                  elapsedMs: 1,
                  levelElapsedMs: 1,
                  lastUsedAtMs: 1700000000000,
                },
              ],
            }),
          );
        } else {
          window.localStorage.removeItem(aiResultsCacheStorageKeyArg);
        }
        return {
          redoRoomName: appliedTurns[1].roomName,
        };
      } finally {
        seededState.free();
      }
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
      aiPrefsStorageKeyArg: aiPrefsStorageKey,
      aiResultsCacheStorageKeyArg: aiResultsCacheStorageKey,
      seedAiSuggestionForTopRedoArg: options?.seedAiSuggestionForTopRedo ?? false,
    },
  );

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
        analysisMaxTimeIndex: 1,
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

test('Ani Redo redoes the turn even when animation checkbox is off', async ({ page }) => {
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
  const animRedoButton = page.getByRole('button', { name: 'Ani Redo' });
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

test('Undo all clears both AI control checkboxes', async ({ page }) => {
  await page.goto('/');

  await seedStateWithTurns(page, { turnCount: 2, controlP1: true, controlP3: true });
  await page.reload();

  const undoAllButton = page.getByRole('button', { name: 'Undo all' });
  const controlRow = page.locator('.planner-line').filter({ hasText: 'Control' }).first();
  const p1ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P1' });
  const p3ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P3' });

  await expect(p1ControlCheckbox).toBeChecked();
  await expect(p3ControlCheckbox).toBeChecked();

  await undoAllButton.click();

  await expect(p1ControlCheckbox).not.toBeChecked();
  await expect(p3ControlCheckbox).not.toBeChecked();
});

test('manually replaying the top redo turn preserves deeper redo history', async ({ page }) => {
  await page.goto('/');

  const seed = await seedManualRedoScenario(page);
  await page.reload();

  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
  const turnPlannerTitle = page.locator('.planner-panel .planner-title').first();
  const redoRoom = page.locator(`.room-layer rect[aria-label="${seed.redoRoomName}"]`).first();

  await expect(turnPlannerTitle).toContainText('Turn 2/4');
  await expect(redoButton).toBeEnabled();
  await expect.poll(() => readRedoStackLength(page)).toBe(2);

  await dispatchRoomDoubleClick(redoRoom);

  await expect.poll(() => readNormalTurnCount(page)).toBe(3);
  await expect(turnPlannerTitle).toContainText('Turn 3/4');
  await expect(redoButton).toBeEnabled();
  await expect.poll(() => readRedoStackLength(page)).toBe(1);

  await redoButton.click();

  await expect.poll(() => readNormalTurnCount(page)).toBe(4);
  await expect(redoButton).toBeDisabled();
  await expect.poll(() => readRedoStackLength(page)).toBe(0);
  await expect(turnPlannerTitle).toContainText('Turn 4: P3');
  await expect(turnPlannerTitle).not.toContainText('/');
  await expect(page.locator('.planner-line').filter({ hasText: 'Planned' }).first()).toContainText('No moves planned.');
});

test('AI Do replaying the top redo turn preserves deeper redo history', async ({ page }) => {
  await page.goto('/');

  await seedManualRedoScenario(page, { seedAiSuggestionForTopRedo: true });
  await page.reload();

  const aiPanel = page.locator('.ai-panel');
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
  const aiDoButton = aiPanel.getByRole('button', { name: 'Do' });
  const turnPlannerTitle = page.locator('.planner-panel .planner-title').first();

  await expect.poll(() => readRedoStackLength(page)).toBe(2);
  await expect(redoButton).toBeEnabled();
  await expect(aiDoButton).toBeEnabled();

  await aiDoButton.click();

  await expect.poll(() => readNormalTurnCount(page)).toBe(3);
  await expect(turnPlannerTitle).toContainText('Turn 3/4');
  await expect(redoButton).toBeEnabled();
  await expect.poll(() => readRedoStackLength(page)).toBe(1);

  await redoButton.click();

  await expect.poll(() => readNormalTurnCount(page)).toBe(4);
  await expect(redoButton).toBeDisabled();
  await expect.poll(() => readRedoStackLength(page)).toBe(0);
});
