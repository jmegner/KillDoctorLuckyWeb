import { expect, test } from '@playwright/test';
import { analyzeTreeSearchRequest } from '../src/workers/treeSearchWorkerCore';

test.describe('analysis worker lifetime', () => {
  test('releases wasm game states after each analysis request', async () => {
    let freeCalls = 0;
    const successResponse = analyzeTreeSearchRequest(
      {
        type: 'analyze',
        runId: 1,
        stateJson: '{"ok":true}',
        analysisLevel: 2.9,
      },
      () => ({
        importStateJson: () => '',
        findBestTurn: (analysisLevel: number) =>
          JSON.stringify({
            isValid: true,
            suggestedTurn: [{ pieceId: 'player1', roomId: analysisLevel }],
          }),
        previewTurnPlan: (plannedTurnJson: string) => plannedTurnJson,
        free: () => {
          freeCalls += 1;
        },
      }),
    );
    const failureResponse = analyzeTreeSearchRequest(
      {
        type: 'analyze',
        runId: 2,
        stateJson: '{"ok":false}',
        analysisLevel: 1,
      },
      () => ({
        importStateJson: () => {
          throw new Error('boom');
        },
        findBestTurn: () => '',
        previewTurnPlan: () => '',
        free: () => {
          freeCalls += 1;
        },
      }),
    );

    expect(freeCalls).toBe(2);
    expect(successResponse).toEqual({
      type: 'analysisResult',
      runId: 1,
      analysisRaw: '{"isValid":true,"suggestedTurn":[{"pieceId":"player1","roomId":2}]}',
      previewRaw: '[{"pieceId":"player1","roomId":2}]',
    });
    expect(failureResponse).toEqual({
      type: 'analysisError',
      runId: 2,
      message: 'boom',
    });
  });
});
