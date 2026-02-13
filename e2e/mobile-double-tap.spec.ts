import { expect, test, devices, type Locator, type Page } from '@playwright/test';

const iPhone13 = devices['iPhone 13'];
const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';

test.use({
  viewport: iPhone13.viewport,
  userAgent: iPhone13.userAgent,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
});

const dispatchTouchRoomClick = async (room: Locator, detail: number = 1) => {
  await room.evaluate((element, clickDetail) => {
    const event = new PointerEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: clickDetail,
      pointerType: 'touch',
    });
    element.dispatchEvent(event);
  }, detail);
};

const readNormalTurnCount = async (page: Page) =>
  page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return -1;
    }
    const parsed = JSON.parse(raw) as { normalTurns?: unknown };
    if (!Array.isArray(parsed.normalTurns)) {
      return -1;
    }
    return parsed.normalTurns.length;
  }, gameStateStorageKey);

const seedStateWithStrangerAtDistinctRoom = async (page: Page) => {
  const seedResult = await page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seeded = wasm.newDefaultGameState();

      const openingTurn = [{ pieceId: 'player1', roomId: 13 }];
      const validation = seeded.validateTurnPlan(JSON.stringify(openingTurn));
      if (validation) {
        seeded.free();
        throw new Error(`Failed to validate opening turn for stranger-room seed: ${validation}`);
      }
      const applyError = seeded.applyTurnPlan(JSON.stringify(openingTurn));
      if (applyError) {
        seeded.free();
        throw new Error(`Failed to apply opening turn for stranger-room seed: ${applyError}`);
      }

      const boardRooms = JSON.parse(seeded.boardRoomsJson()) as Array<{
        id?: number;
        Id?: number;
        name?: string;
        Name?: string;
      }>;
      const roomNameById = new Map<number, string>();
      for (const room of boardRooms) {
        const idRaw = typeof room.id === 'number' ? room.id : room.Id;
        const nameRaw = typeof room.name === 'string' ? room.name : room.Name;
        if (typeof idRaw === 'number' && typeof nameRaw === 'string' && nameRaw.length > 0) {
          roomNameById.set(Math.trunc(idRaw), nameRaw);
        }
      }

      const positions = Array.from(seeded.piecePositions(), (value) => Number(value));
      const currentPieceId = seeded.currentPlayerPieceId();
      const pieceIndexById = new Map<string, number>([
        ['doctor', 0],
        ['player1', 1],
        ['player2', 2],
        ['stranger1', 3],
        ['stranger2', 4],
      ]);
      const currentIndex = pieceIndexById.get(currentPieceId);
      if (currentIndex === undefined) {
        seeded.free();
        throw new Error(`Unexpected current player piece id: ${currentPieceId}`);
      }
      const currentRoomId = positions[currentIndex];
      const strangerRoomId = [positions[3], positions[4]].find((roomId) => roomId !== currentRoomId);
      if (strangerRoomId === undefined) {
        seeded.free();
        throw new Error('Could not find stranger in a room different from current player room.');
      }
      const targetRoomName = roomNameById.get(strangerRoomId);
      if (!targetRoomName) {
        seeded.free();
        throw new Error(`Could not resolve room name for stranger room id ${strangerRoomId}.`);
      }

      const snapshot = seeded.exportStateJson();
      seeded.free();

      window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
      window.localStorage.removeItem(redoStateStackStorageKeyArg);

      const parsedSnapshot = JSON.parse(snapshot) as { normalTurns?: unknown };
      const normalTurnCount = Array.isArray(parsedSnapshot.normalTurns) ? parsedSnapshot.normalTurns.length : -1;
      return { targetRoomName, normalTurnCount };
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
    },
  );
  await page.reload();
  return seedResult;
};

test.describe('mobile forgiving double-tap', () => {
  test('submits turn when second tap is slower but within forgiving window', async ({ page }) => {
    await page.goto('/');

    const undoButton = page.getByRole('button', { name: 'Undo' });
    const room = page.locator('.room-layer rect[aria-label="dining hall"]');

    await expect(undoButton).toBeDisabled();

    await dispatchTouchRoomClick(room);
    await page.waitForTimeout(350);
    await dispatchTouchRoomClick(room);

    await expect(undoButton).toBeEnabled();
  });

  test('does not submit turn when taps are too far apart', async ({ page }) => {
    await page.goto('/');

    const undoButton = page.getByRole('button', { name: 'Undo' });
    const room = page.locator('.room-layer rect[aria-label="dining hall"]');

    await expect(undoButton).toBeDisabled();

    await dispatchTouchRoomClick(room);
    await page.waitForTimeout(850);
    await dispatchTouchRoomClick(room);
    await page.waitForTimeout(150);

    await expect(undoButton).toBeDisabled();
  });

  test('does not submit turn when second tap is on a different room', async ({ page }) => {
    await page.goto('/');

    const undoButton = page.getByRole('button', { name: 'Undo' });
    const firstRoom = page.locator('.room-layer rect[aria-label="dining hall"]');
    const secondRoom = page.locator('.room-layer rect[aria-label="kitchen"]');

    await expect(undoButton).toBeDisabled();

    await dispatchTouchRoomClick(firstRoom);
    await page.waitForTimeout(300);
    await dispatchTouchRoomClick(secondRoom);
    await page.waitForTimeout(150);

    await expect(undoButton).toBeDisabled();
  });

  test('double-tap on a room with stranger takes priority over piece-selection tap behavior', async ({ page }) => {
    await page.goto('/');

    const seed = await seedStateWithStrangerAtDistinctRoom(page);
    const room = page.locator(`.room-layer rect[aria-label="${seed.targetRoomName}"]`);
    const selectedLine = page.locator('.planner-line').filter({ hasText: 'Selected' }).first();
    const beforeTurnCount = await readNormalTurnCount(page);

    await dispatchTouchRoomClick(room);
    await expect(selectedLine).not.toContainText('None');

    await page.waitForTimeout(350);
    await dispatchTouchRoomClick(room);

    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount + 1);
  });

  test('room-with-stranger taps outside grace window do not submit', async ({ page }) => {
    await page.goto('/');

    const seed = await seedStateWithStrangerAtDistinctRoom(page);
    const room = page.locator(`.room-layer rect[aria-label="${seed.targetRoomName}"]`);
    const selectedLine = page.locator('.planner-line').filter({ hasText: 'Selected' }).first();
    const beforeTurnCount = await readNormalTurnCount(page);

    await dispatchTouchRoomClick(room);
    await expect(selectedLine).not.toContainText('None');

    await page.waitForTimeout(850);
    await dispatchTouchRoomClick(room);
    await page.waitForTimeout(150);

    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount);
  });
});
