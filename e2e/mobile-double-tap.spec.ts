import { readFileSync } from 'node:fs';
import { expect, test, devices, type Locator, type Page } from '@playwright/test';

const iPhone13 = devices['iPhone 13'];
const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const pieceLabelById = {
  doctor: 'Dr',
  player1: 'P1',
  player2: 'P3',
  stranger1: 'p2',
  stranger2: 'p4',
} as const;
const playAreaSource = readFileSync(new URL('../src/components/PlayArea.tsx', import.meta.url), 'utf8');
const touchDoubleTapGraceMsMatch = playAreaSource.match(/const touchDoubleTapGraceMs = (\d+);/);

if (!touchDoubleTapGraceMsMatch) {
  throw new Error('Could not find touchDoubleTapGraceMs in src/components/PlayArea.tsx.');
}

const touchDoubleTapGraceMs = Number(touchDoubleTapGraceMsMatch[1]);
const withinGraceDelayMs = Math.max(60, touchDoubleTapGraceMs - 300);
const outsideGraceDelayMs = touchDoubleTapGraceMs + 200;

test.use({
  viewport: iPhone13.viewport,
  userAgent: iPhone13.userAgent,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
});

const dispatchTouchRoomTap = async (
  room: Locator,
  options?: {
    detail?: number;
    clickDelayMs?: number;
  },
) => {
  await room.evaluate(
    async (element, tapOptions) => {
      const detail = tapOptions?.detail ?? 1;
      const clickDelayMs = tapOptions?.clickDelayMs ?? 0;
      const emitDoubleClickAfterClick = tapOptions?.emitDoubleClickAfterClick ?? false;
      const pointerBase = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: 'touch',
        pointerId: 1,
        isPrimary: true,
      };

      element.dispatchEvent(new PointerEvent('pointerdown', pointerBase));
      element.dispatchEvent(new PointerEvent('pointerup', pointerBase));
      if (clickDelayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, clickDelayMs));
      }
      element.dispatchEvent(
        new PointerEvent('click', {
          ...pointerBase,
          detail,
        }),
      );
      if (emitDoubleClickAfterClick) {
        element.dispatchEvent(
          new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            composed: true,
            detail: Math.max(2, detail),
          }),
        );
      }
    },
    {
      detail: options?.detail ?? 1,
      clickDelayMs: options?.clickDelayMs ?? 0,
      emitDoubleClickAfterClick: options?.emitDoubleClickAfterClick ?? false,
    },
  );
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

const seedStateWithDefaultSnapshot = async (page: Page) => {
  const normalTurnCount = await page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seeded = wasm.newDefaultGameState();
      const snapshot = seeded.exportStateJson();
      seeded.free();

      window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
      window.localStorage.removeItem(redoStateStackStorageKeyArg);

      const parsedSnapshot = JSON.parse(snapshot) as { normalTurns?: unknown };
      return Array.isArray(parsedSnapshot.normalTurns) ? parsedSnapshot.normalTurns.length : -1;
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
    },
  );
  await page.reload();
  return normalTurnCount;
};

const tapRoomTwiceAndCaptureBeforeTurnCount = async (page: Page, room: Locator, interTapDelayMs: number) => {
  const beforeTurnCount = await readNormalTurnCount(page);
  await dispatchTouchRoomTap(room);
  await expect.poll(() => readNormalTurnCount(page), { timeout: 400 }).toBe(beforeTurnCount);
  await page.waitForTimeout(interTapDelayMs);
  await dispatchTouchRoomTap(room);
  return beforeTurnCount;
};

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

const seedDefaultStateForCurrentPlayerSelection = async (page: Page) => {
  const seededScenario = await page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seededState = wasm.newDefaultGameState();

      try {
        const pieceId = seededState.currentPlayerPieceId();
        const pieceIndexById = new Map<string, number>([
          ['doctor', 0],
          ['player1', 1],
          ['player2', 2],
          ['stranger1', 3],
          ['stranger2', 4],
        ]);
        const pieceIndex = pieceIndexById.get(pieceId);
        if (pieceIndex === undefined) {
          throw new Error(`Unexpected current player piece id: ${pieceId}`);
        }

        const positions = Array.from(seededState.piecePositions(), (value) => Number(value));
        const currentRoomId = positions[pieceIndex];

        const boardRooms = JSON.parse(seededState.boardRoomsJson()) as Array<{
          id?: number;
          Id?: number;
          name?: string;
          Name?: string;
        }>;
        const roomNameById = new Map<number, string>();
        for (const room of boardRooms) {
          const roomId = typeof room.id === 'number' ? room.id : room.Id;
          const roomName = typeof room.name === 'string' ? room.name : room.Name;
          if (typeof roomId === 'number' && typeof roomName === 'string' && roomName.length > 0) {
            roomNameById.set(Math.trunc(roomId), roomName);
          }
        }

        const candidateRoomIds = Array.from(roomNameById.keys()).sort((a, b) => a - b);
        let destinationRoomId: number | null = null;
        for (const roomId of candidateRoomIds) {
          if (roomId === currentRoomId) {
            continue;
          }
          const validation = seededState.validateTurnPlan(JSON.stringify([{ pieceId, roomId }]));
          if (!validation) {
            destinationRoomId = roomId;
            break;
          }
        }
        if (destinationRoomId === null) {
          throw new Error(`Could not find valid destination room for ${pieceId}.`);
        }

        const currentRoomName = roomNameById.get(currentRoomId);
        const destinationRoomName = roomNameById.get(destinationRoomId);
        if (!currentRoomName || !destinationRoomName) {
          throw new Error(
            `Could not resolve room names for current=${currentRoomId} destination=${destinationRoomId}.`,
          );
        }

        const snapshot = seededState.exportStateJson();
        window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
        window.localStorage.removeItem(redoStateStackStorageKeyArg);

        return {
          pieceId,
          currentRoomName,
          destinationRoomId,
          destinationRoomName,
        };
      } finally {
        seededState.free();
      }
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
    },
  );

  await page.reload();
  return seededScenario as {
    pieceId: keyof typeof pieceLabelById;
    currentRoomName: string;
    destinationRoomId: number;
    destinationRoomName: string;
  };
};

test.describe('mobile forgiving double-tap', () => {
  test('submits turn on a fast touch double tap', async ({ page }) => {
    await page.goto('/');
    const seededTurnCount = await seedStateWithDefaultSnapshot(page);
    expect(seededTurnCount).toBe(0);

    const room = page.locator('.room-layer rect[aria-label="dining hall"]');

    const beforeTurnCount = await tapRoomTwiceAndCaptureBeforeTurnCount(page, room, 60);

    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount + 1);
  });

  test('submits turn when second tap is slower but within forgiving window', async ({ page }) => {
    await page.goto('/');
    const seededTurnCount = await seedStateWithDefaultSnapshot(page);
    expect(seededTurnCount).toBe(0);

    const room = page.locator('.room-layer rect[aria-label="dining hall"]');

    const beforeTurnCount = await tapRoomTwiceAndCaptureBeforeTurnCount(page, room, withinGraceDelayMs);

    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount + 1);
  });

  test('does not submit turn when taps are too far apart', async ({ page }) => {
    await page.goto('/');
    const seededTurnCount = await seedStateWithDefaultSnapshot(page);
    expect(seededTurnCount).toBe(0);

    const room = page.locator('.room-layer rect[aria-label="dining hall"]');

    const beforeTurnCount = await tapRoomTwiceAndCaptureBeforeTurnCount(page, room, outsideGraceDelayMs);

    await expect.poll(() => readNormalTurnCount(page), { timeout: 1200 }).toBe(beforeTurnCount);
  });

  test('does not submit turn when second tap is on a different room', async ({ page }) => {
    await page.goto('/');

    const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
    const firstRoom = page.locator('.room-layer rect[aria-label="dining hall"]');
    const secondRoom = page.locator('.room-layer rect[aria-label="kitchen"]');

    await expect(undoButton).toBeDisabled();

    await dispatchTouchRoomTap(firstRoom);
    await page.waitForTimeout(300);
    await dispatchTouchRoomTap(secondRoom);
    await page.waitForTimeout(150);

    await expect(undoButton).toBeDisabled();
  });

  test('double-tap on a room with stranger takes priority over piece-selection tap behavior', async ({ page }) => {
    await page.goto('/');

    const seed = await seedStateWithStrangerAtDistinctRoom(page);
    const room = page.locator(`.room-layer rect[aria-label="${seed.targetRoomName}"]`);
    const selectedLine = page.locator('.planner-line').filter({ hasText: 'Selected' }).first();
    const beforeTurnCount = await readNormalTurnCount(page);

    await dispatchTouchRoomTap(room);
    await expect(selectedLine).not.toContainText('None');

    await page.waitForTimeout(withinGraceDelayMs);
    await dispatchTouchRoomTap(room);

    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount + 1);
  });

  test('room-with-stranger taps outside grace window do not submit', async ({ page }) => {
    await page.goto('/');

    const seed = await seedStateWithStrangerAtDistinctRoom(page);
    const room = page.locator(`.room-layer rect[aria-label="${seed.targetRoomName}"]`);
    const selectedLine = page.locator('.planner-line').filter({ hasText: 'Selected' }).first();
    const beforeTurnCount = await readNormalTurnCount(page);

    await dispatchTouchRoomTap(room);
    await expect(selectedLine).not.toContainText('None');

    await page.waitForTimeout(outsideGraceDelayMs);
    await dispatchTouchRoomTap(room);
    await page.waitForTimeout(150);

    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount);
  });

  test('uses tap timing instead of click delivery timing for forgiving double-tap', async ({ page }) => {
    await page.goto('/');
    const seededTurnCount = await seedStateWithDefaultSnapshot(page);
    expect(seededTurnCount).toBe(0);

    const room = page.locator('.room-layer rect[aria-label="dining hall"]');
    const beforeTurnCount = await readNormalTurnCount(page);
    const delayedSecondClickMs = 400;
    const withinGraceTapGapMs = Math.max(60, touchDoubleTapGraceMs - 200);

    await dispatchTouchRoomTap(room);
    await expect.poll(() => readNormalTurnCount(page), { timeout: 400 }).toBe(beforeTurnCount);

    await page.waitForTimeout(withinGraceTapGapMs);
    await dispatchTouchRoomTap(room, { clickDelayMs: delayedSecondClickMs });

    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount + 1);
  });

  test('touch tap to select a room-piece and touch tap to a destination does not get promoted by a following dblclick', async ({
    page,
  }) => {
    await page.goto('/');

    const seed = await seedDefaultStateForCurrentPlayerSelection(page);
    const pieceLabel = pieceLabelById[seed.pieceId];
    const currentRoom = page.locator(`.room-layer rect[aria-label="${seed.currentRoomName}"]`).first();
    const destinationRoom = page.locator(`.room-layer rect[aria-label="${seed.destinationRoomName}"]`).first();
    const selectedLine = page.locator('.planner-line').filter({ hasText: 'Selected' }).first();
    const plannedLine = page.locator('.planner-line').filter({ hasText: 'Planned' }).first();
    const beforeTurnCount = await readNormalTurnCount(page);

    await dispatchTouchRoomTap(currentRoom);
    await expect(selectedLine).toContainText(pieceLabel);

    await dispatchTouchRoomTap(destinationRoom, { detail: 2, emitDoubleClickAfterClick: true });
    await page.waitForTimeout(150);

    await expect(selectedLine).toContainText('None');
    await expect(plannedLine).toContainText(`${pieceLabel}@R${seed.destinationRoomId}`);
    await expect.poll(() => readNormalTurnCount(page)).toBe(beforeTurnCount);
  });
});
