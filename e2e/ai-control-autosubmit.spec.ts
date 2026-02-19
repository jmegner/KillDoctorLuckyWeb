import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
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
    return turns ? turns.length : -1;
  }, gameStateStorageKey);

const seedStateAndCacheForControlAutoSubmit = async (page: Page, targetCurrentPlayer: 'player1' | 'player2') =>
  page.evaluate(
    async ({
      gameStateStorageKeyArg,
      redoStateStackStorageKeyArg,
      aiPrefsStorageKeyArg,
      aiResultsCacheStorageKeyArg,
      targetCurrentPlayerArg,
    }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seeded = wasm.newDefaultGameState();

      const findAnyValidPlan = () => {
        const boardRooms = JSON.parse(seeded.boardRoomsJson()) as Array<{ id?: number; Id?: number }>;
        const roomIds = boardRooms
          .map((room) => {
            const raw = typeof room.id === 'number' ? room.id : room.Id;
            return typeof raw === 'number' ? Math.trunc(raw) : NaN;
          })
          .filter((roomId) => Number.isFinite(roomId));
        const movablePieceIds = ['player1', 'player2', 'stranger1', 'stranger2'];

        for (const pieceId of movablePieceIds) {
          for (const roomId of roomIds) {
            const plan = [{ pieceId, roomId }];
            const validationError = seeded.validateTurnPlan(JSON.stringify(plan));
            if (!validationError) {
              return plan;
            }
          }
        }
        for (let firstPieceIndex = 0; firstPieceIndex < movablePieceIds.length; firstPieceIndex += 1) {
          const firstPieceId = movablePieceIds[firstPieceIndex];
          for (let secondPieceIndex = firstPieceIndex + 1; secondPieceIndex < movablePieceIds.length; secondPieceIndex += 1) {
            const secondPieceId = movablePieceIds[secondPieceIndex];
            for (const firstRoomId of roomIds) {
              for (const secondRoomId of roomIds) {
                const plan = [
                  { pieceId: firstPieceId, roomId: firstRoomId },
                  { pieceId: secondPieceId, roomId: secondRoomId },
                ];
                const validationError = seeded.validateTurnPlan(JSON.stringify(plan));
                if (!validationError) {
                  return plan;
                }
              }
            }
          }
        }
        return null;
      };

      if (targetCurrentPlayerArg === 'player2') {
        const openingPlan = findAnyValidPlan();
        if (!openingPlan) {
          seeded.free();
          throw new Error('Failed to find valid opening turn.');
        }
        const applyError = seeded.applyTurnPlan(JSON.stringify(openingPlan));
        if (applyError) {
          seeded.free();
          throw new Error(`Failed to apply opening turn while seeding player2 test state: ${applyError}`);
        }
      }

      const currentPlayerPieceId = seeded.currentPlayerPieceId();
      if (currentPlayerPieceId !== targetCurrentPlayerArg) {
        seeded.free();
        throw new Error(`Expected current player ${targetCurrentPlayerArg}, got ${currentPlayerPieceId}`);
      }

      const suggestedTurn = findAnyValidPlan();
      if (!suggestedTurn) {
        seeded.free();
        throw new Error('Failed to find valid cached suggestion.');
      }

      const snapshot = seeded.exportStateJson();
      const parsedSnapshot = JSON.parse(snapshot) as { normalTurns?: unknown; normal_turns?: unknown };
      const turns = Array.isArray(parsedSnapshot.normalTurns)
        ? parsedSnapshot.normalTurns
        : Array.isArray(parsedSnapshot.normal_turns)
          ? parsedSnapshot.normal_turns
          : null;
      const normalTurnCount = turns ? turns.length : -1;
      seeded.free();

      window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
      window.localStorage.removeItem(redoStateStackStorageKeyArg);
      window.localStorage.setItem(
        aiPrefsStorageKeyArg,
        JSON.stringify({
          minAnalysisLevel: 0,
          maxAnalysisLevel: 6000,
          analysisMaxTimeIndex: 0,
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
              stateJson: snapshot,
              analysisLevel: 5000,
              bestTurn: {
                isValid: true,
                validationMessage: '',
                suggestedTurnText: suggestedTurn.map((entry) => `${entry.pieceId}@R${entry.roomId}`).join(', '),
                suggestedTurn,
                heuristicScore: 0,
                numStatesVisited: 0,
                elapsedMs: 0,
              },
              previewRaw: '',
              elapsedMs: 0,
              levelElapsedMs: 1,
              lastUsedAtMs: Date.now() - 1000,
            },
          ],
        }),
      );

      return {
        normalTurnCount,
        currentPlayerPieceId,
      };
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
      aiPrefsStorageKeyArg: aiPrefsStorageKey,
      aiResultsCacheStorageKeyArg: aiResultsCacheStorageKey,
      targetCurrentPlayerArg: targetCurrentPlayer,
    },
  );

test.describe('AI control auto-submit during active analysis', () => {
  test('checking P1 control during analysis submits suggested turn when analysis finishes', async ({ page }) => {
    await page.goto('/');

    const seed = await seedStateAndCacheForControlAutoSubmit(page, 'player1');
    expect(seed.currentPlayerPieceId).toBe('player1');
    await page.reload();

    const aiPanel = page.locator('.ai-panel');
    const cancelButton = aiPanel.getByRole('button', { name: 'Cancel' });
    const controlRow = page.locator('.planner-line').filter({ hasText: 'Control' }).first();
    const p1ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P1' });

    await expect(cancelButton).toBeEnabled();
    await expect(p1ControlCheckbox).not.toBeChecked();

    const beforeTurnCount = await readNormalTurnCount(page);
    expect(beforeTurnCount).toBe(seed.normalTurnCount);

    await p1ControlCheckbox.check();

    await expect.poll(() => readNormalTurnCount(page), { timeout: 15_000 }).toBe(beforeTurnCount + 1);
  });

  test('checking P3 control during analysis submits suggested turn when analysis finishes', async ({ page }) => {
    await page.goto('/');

    const seed = await seedStateAndCacheForControlAutoSubmit(page, 'player2');
    expect(seed.currentPlayerPieceId).toBe('player2');
    await page.reload();

    const aiPanel = page.locator('.ai-panel');
    const cancelButton = aiPanel.getByRole('button', { name: 'Cancel' });
    const controlRow = page.locator('.planner-line').filter({ hasText: 'Control' }).first();
    const p3ControlCheckbox = controlRow.getByRole('checkbox', { name: 'P3' });

    await expect(cancelButton).toBeEnabled();
    await expect(p3ControlCheckbox).not.toBeChecked();

    const beforeTurnCount = await readNormalTurnCount(page);
    expect(beforeTurnCount).toBe(seed.normalTurnCount);

    await p3ControlCheckbox.check();

    await expect.poll(() => readNormalTurnCount(page), { timeout: 15_000 }).toBe(beforeTurnCount + 1);
  });
});
