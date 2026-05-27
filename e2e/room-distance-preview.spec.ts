import { expect, test, type Locator, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';

const plannerLine = (page: Page, label: string) =>
  page.locator('.planner-line').filter({ hasText: label }).first();

const dispatchRoomClick = async (room: Locator) => {
  await room.evaluate((element) => {
    element.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: 1,
      }),
    );
  });
};

const seedDefaultStateAndFindNonSelectableRoom = async (page: Page) => {
  const roomName = await page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seededState = wasm.newDefaultGameState();

      try {
        const pieceIndexById = new Map<string, number>([
          ['doctor', 0],
          ['player1', 1],
          ['player2', 2],
          ['stranger1', 3],
          ['stranger2', 4],
        ]);
        const currentPlayerPieceId = seededState.currentPlayerPieceId();
        const selectablePieceIds =
          currentPlayerPieceId === 'player1'
            ? ['player1', 'stranger1', 'stranger2']
            : ['player2', 'stranger1', 'stranger2'];
        const positions = Array.from(seededState.piecePositions(), (value) => Number(value));
        const selectableRoomIds = new Set(
          selectablePieceIds.map((pieceId) => {
            const pieceIndex = pieceIndexById.get(pieceId);
            if (pieceIndex === undefined) {
              throw new Error(`Unexpected selectable piece id: ${pieceId}`);
            }
            return positions[pieceIndex];
          }),
        );

        const boardRooms = JSON.parse(seededState.boardRoomsJson()) as Array<{
          id?: number;
          Id?: number;
          name?: string;
          Name?: string;
        }>;
        const targetRoom = boardRooms.find((room) => {
          const roomId = typeof room.id === 'number' ? room.id : room.Id;
          const name = typeof room.name === 'string' ? room.name : room.Name;
          return typeof roomId === 'number' && typeof name === 'string' && !selectableRoomIds.has(roomId);
        });
        if (!targetRoom) {
          throw new Error('Could not find a room without a selectable piece.');
        }

        const targetRoomName = typeof targetRoom.name === 'string' ? targetRoom.name : targetRoom.Name;
        if (!targetRoomName) {
          throw new Error('Target room did not have a name.');
        }

        window.localStorage.setItem(gameStateStorageKeyArg, seededState.exportStateJson());
        window.localStorage.removeItem(redoStateStackStorageKeyArg);
        return targetRoomName;
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
  return roomName;
};

test.describe('room distance preview', () => {
  test('clicking a room with no selected piece toggles distance indicators', async ({ page }) => {
    await page.goto('/');
    const roomName = await seedDefaultStateAndFindNonSelectableRoom(page);
    const selectedLine = plannerLine(page, 'Selected');
    const room = page.locator(`.room-layer rect[aria-label="${roomName}"]`).first();

    await expect(selectedLine).toContainText('None');
    await expect(page.locator('.room-distance-box')).toHaveCount(0);

    await dispatchRoomClick(room);

    await expect(selectedLine).toContainText('None');
    await expect(page.locator('.room-distance-box').first()).toBeVisible();

    await dispatchRoomClick(room);

    await expect(selectedLine).toContainText('None');
    await expect(page.locator('.room-distance-box')).toHaveCount(0);
  });
});
