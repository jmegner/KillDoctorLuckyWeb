import { expect, test } from '@playwright/test';

test('Jacob1 can be selected and started from setup', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Setup' }).click();

  const boardSelect = page.getByRole('combobox', { name: 'Board' });
  await boardSelect.selectOption('BoardJacob1');
  await expect(boardSelect).toHaveValue('BoardJacob1');
  await page.getByRole('checkbox', { name: 'Advanced' }).check();
  await expect(page.getByLabel('Doctor room')).toHaveValue('15');
  await expect(page.getByLabel('P1 room')).toHaveValue('1');

  await page.getByRole('button', { name: 'Start New Game' }).click();

  await expect(page.locator('image').first()).toHaveAttribute('href', /BoardJacob1\.png$/);

  const savedSetup = await page.evaluate(() => {
    const snapshot = window.localStorage.getItem('kdl.gameState.v1.BoardJacob1');
    if (!snapshot) {
      throw new Error('Expected BoardJacob1 snapshot to be saved.');
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
  });

  expect(savedSetup).toEqual({
    boardName: 'BoardJacob1',
    setupBoardName: 'BoardJacob1',
    doctorRoomId: 15,
    player1RoomId: 1,
  });
});
