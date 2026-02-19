import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const aiPrefsStorageKey = 'kdl.ai.v1';
const aiResultsCacheStorageKey = 'kdl.aiResultsCache.v1';
const animationPrefsStorageKey = 'kdl.settings.v1';

type SeededTwoStateCache = {
  initialTurnCount: number;
};

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

const seedTwoCachedStates = async (
  page: Page,
  options: { controlP1: boolean; controlP3: boolean },
): Promise<SeededTwoStateCache> =>
  page.evaluate(
    async ({
      gameStateStorageKeyArg,
      redoStateStackStorageKeyArg,
      aiPrefsStorageKeyArg,
      aiResultsCacheStorageKeyArg,
      animationPrefsStorageKeyArg,
      controlP1Arg,
      controlP3Arg,
    }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seeded = wasm.newDefaultGameState();

      try {
        const boardRooms = JSON.parse(seeded.boardRoomsJson()) as Array<{ id?: number; Id?: number }>;
        const roomIds = boardRooms
          .map((room) => {
            const raw = typeof room.id === 'number' ? room.id : room.Id;
            return typeof raw === 'number' ? Math.trunc(raw) : NaN;
          })
          .filter((roomId) => Number.isFinite(roomId));
        const movablePieceIds = ['player1', 'player2', 'stranger1', 'stranger2'];

        const findAnyValidPlan = () => {
          for (const pieceId of movablePieceIds) {
            for (const roomId of roomIds) {
              const plan = [{ pieceId, roomId }];
              const validationError = seeded.validateTurnPlan(JSON.stringify(plan));
              if (!validationError) {
                return plan;
              }
            }
          }
          return null;
        };

        const toSuggestedTurnText = (plan: Array<{ pieceId: string; roomId: number }>) =>
          plan.map((entry) => `${entry.pieceId}@R${entry.roomId}`).join(', ');

        const snapshot0 = seeded.exportStateJson();
        const firstPlan = findAnyValidPlan();
        if (!firstPlan) {
          throw new Error('Failed to find valid plan for initial state.');
        }
        const firstApplyError = seeded.applyTurnPlan(JSON.stringify(firstPlan));
        if (firstApplyError) {
          throw new Error(`Failed to apply first seed plan: ${firstApplyError}`);
        }

        const snapshot1 = seeded.exportStateJson();
        const secondPlan = findAnyValidPlan();
        if (!secondPlan) {
          throw new Error('Failed to find valid plan for second state.');
        }

        const parsedSnapshot0 = JSON.parse(snapshot0) as { normalTurns?: unknown; normal_turns?: unknown };
        const turns0 = Array.isArray(parsedSnapshot0.normalTurns)
          ? parsedSnapshot0.normalTurns
          : Array.isArray(parsedSnapshot0.normal_turns)
            ? parsedSnapshot0.normal_turns
            : null;
        const initialTurnCount = turns0 ? turns0.length : -1;

        window.localStorage.setItem(gameStateStorageKeyArg, snapshot0);
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
        window.localStorage.setItem(
          aiResultsCacheStorageKeyArg,
          JSON.stringify({
            version: 1,
            entries: [
              {
                stateJson: snapshot0,
                analysisLevel: 20,
                bestTurn: {
                  isValid: true,
                  validationMessage: '',
                  suggestedTurnText: toSuggestedTurnText(firstPlan),
                  suggestedTurn: firstPlan,
                  heuristicScore: 0,
                  numStatesVisited: 0,
                  elapsedMs: 0,
                },
                previewRaw: '',
                elapsedMs: 0,
                levelElapsedMs: 1,
                lastUsedAtMs: Date.now() - 1000,
              },
              {
                stateJson: snapshot1,
                analysisLevel: 20,
                bestTurn: {
                  isValid: true,
                  validationMessage: '',
                  suggestedTurnText: toSuggestedTurnText(secondPlan),
                  suggestedTurn: secondPlan,
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
        window.localStorage.setItem(
          animationPrefsStorageKeyArg,
          JSON.stringify({
            animationEnabled: true,
            animationSpeedIndex: 2,
          }),
        );

        return { initialTurnCount };
      } finally {
        seeded.free();
      }
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
      aiPrefsStorageKeyArg: aiPrefsStorageKey,
      aiResultsCacheStorageKeyArg: aiResultsCacheStorageKey,
      animationPrefsStorageKeyArg: animationPrefsStorageKey,
      controlP1Arg: options.controlP1,
      controlP3Arg: options.controlP3,
    },
  );

test.describe('AI submit waits for animation completion', () => {
  test('auto-control queues cached follow-up turn until current animation finishes', async ({ page }) => {
    await page.goto('/');

    const seed = await seedTwoCachedStates(page, { controlP1: true, controlP3: true });
    await page.reload();

    await expect.poll(() => readNormalTurnCount(page), { timeout: 6000 }).toBe(seed.initialTurnCount + 1);
    await expect
      .poll(async () => (await readAiLineValue(page, 'Status'))?.includes('queued') ?? false, { timeout: 6000 })
      .toBe(true);
    await page.waitForTimeout(350);
    await expect.poll(() => readNormalTurnCount(page), { timeout: 1200 }).toBe(seed.initialTurnCount + 1);
    await expect.poll(() => readNormalTurnCount(page), { timeout: 25000 }).toBe(seed.initialTurnCount + 2);
  });

  test('Do queues while animation is in progress', async ({ page }) => {
    await page.goto('/');

    const seed = await seedTwoCachedStates(page, { controlP1: false, controlP3: false });
    await page.reload();

    const aiPanel = page.locator('.ai-panel');
    const doButton = aiPanel.getByRole('button', { name: 'Do' });

    await expect
      .poll(async () => (await readAiLineValue(page, 'Suggested')) !== 'No suggestion yet.', { timeout: 5000 })
      .toBe(true);
    await doButton.click();
    await expect.poll(() => readNormalTurnCount(page), { timeout: 6000 }).toBe(seed.initialTurnCount + 1);
    await expect
      .poll(async () => (await readAiLineValue(page, 'Suggested')) !== 'No suggestion yet.', { timeout: 5000 })
      .toBe(true);

    await doButton.click();
    await expect
      .poll(async () => (await readAiLineValue(page, 'Status'))?.includes('queued') ?? false, { timeout: 5000 })
      .toBe(true);
    await page.waitForTimeout(350);
    await expect.poll(() => readNormalTurnCount(page), { timeout: 1200 }).toBe(seed.initialTurnCount + 1);
    await expect.poll(() => readNormalTurnCount(page), { timeout: 25000 }).toBe(seed.initialTurnCount + 2);
  });

  test('T&D queues while animation is in progress', async ({ page }) => {
    await page.goto('/');

    const seed = await seedTwoCachedStates(page, { controlP1: false, controlP3: false });
    await page.reload();

    const aiPanel = page.locator('.ai-panel');
    const doButton = aiPanel.getByRole('button', { name: 'Do' });
    const thinkAndDoButton = aiPanel.getByRole('button', { name: 'T&D' });

    await expect
      .poll(async () => (await readAiLineValue(page, 'Suggested')) !== 'No suggestion yet.', { timeout: 5000 })
      .toBe(true);
    await doButton.click();
    await expect.poll(() => readNormalTurnCount(page), { timeout: 6000 }).toBe(seed.initialTurnCount + 1);
    await expect
      .poll(async () => (await readAiLineValue(page, 'Suggested')) !== 'No suggestion yet.', { timeout: 5000 })
      .toBe(true);

    await thinkAndDoButton.click();
    await expect
      .poll(async () => (await readAiLineValue(page, 'Status'))?.includes('queued') ?? false, { timeout: 5000 })
      .toBe(true);
    await page.waitForTimeout(350);
    await expect.poll(() => readNormalTurnCount(page), { timeout: 1200 }).toBe(seed.initialTurnCount + 1);
    await expect.poll(() => readNormalTurnCount(page), { timeout: 25000 }).toBe(seed.initialTurnCount + 2);
  });
});
