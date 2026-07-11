import { expect, test } from '@playwright/test';

const boardCases = [
  {
    label: 'AltDownNoWarp',
    boardName: 'BoardAltDownNoWarp',
    imagePath: /BoardAltDownNoWarp\.jpg$/,
    doctorRoomId: 9,
    player1RoomId: 6,
  },
  {
    label: 'AltUpNoWarp',
    boardName: 'BoardAltUpNoWarp',
    imagePath: /BoardAltUpNoWarp\.jpg$/,
    doctorRoomId: 23,
    player1RoomId: 17,
  },
  {
    label: 'Jacob1',
    boardName: 'BoardJacob1',
    imagePath: /BoardJacob1\.png$/,
    doctorRoomId: 15,
    player1RoomId: 1,
  },
  {
    label: 'Jacob1B',
    boardName: 'BoardJacob1B',
    imagePath: /BoardJacob1B\.png$/,
    doctorRoomId: 15,
    player1RoomId: 1,
  },
] as const;

for (const boardCase of boardCases) {
  test(`${boardCase.label} can be selected and started from setup`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await page.getByRole('button', { name: 'Setup' }).click();

    const boardSelect = page.getByRole('combobox', { name: 'Board' });
    await boardSelect.selectOption(boardCase.boardName);
    await expect(boardSelect).toHaveValue(boardCase.boardName);
    await page.getByRole('checkbox', { name: 'Advanced' }).check();
    await expect(page.getByLabel('Doctor room')).toHaveValue(boardCase.doctorRoomId.toString());
    await expect(page.getByLabel('P1 room')).toHaveValue(boardCase.player1RoomId.toString());

    await page.getByRole('button', { name: 'Start New Game' }).click();

    await expect(page.locator('image').first()).toHaveAttribute('href', boardCase.imagePath);

    const savedSetup = await page.evaluate((boardName) => {
      const storageKey = `kdl.gameState.v1.${boardName}`;
      const snapshot = window.localStorage.getItem(storageKey);
      if (!snapshot) {
        throw new Error(`Expected ${storageKey} snapshot to be saved.`);
      }
      const parsed = JSON.parse(snapshot) as {
        boardName?: string;
        normalSetup?: {
          boardName: string;
          doctorRoomId: number;
          player1RoomId: number;
        };
      };
      return {
        boardName: parsed.boardName,
        setupBoardName: parsed.normalSetup?.boardName,
        doctorRoomId: parsed.normalSetup?.doctorRoomId,
        player1RoomId: parsed.normalSetup?.player1RoomId,
      };
    }, boardCase.boardName);

    expect(savedSetup).toEqual({
      boardName: boardCase.boardName,
      setupBoardName: boardCase.boardName,
      doctorRoomId: boardCase.doctorRoomId,
      player1RoomId: boardCase.player1RoomId,
    });
  });
}
