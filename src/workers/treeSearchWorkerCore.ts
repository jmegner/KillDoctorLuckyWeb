export type AnalyzeRequest = {
  type: 'analyze';
  runId: number;
  stateJson: string;
  analysisLevel: number;
};

export type WorkerResponse =
  | {
      type: 'analysisResult';
      runId: number;
      analysisRaw: string;
      previewRaw: string;
    }
  | {
      type: 'analysisError';
      runId: number;
      message: string;
    };

export type WorkerGameState = {
  importStateJson: (stateJson: string) => string;
  findBestTurn: (analysisLevel: number) => string;
  previewTurnPlan: (plannedTurnJson: string) => string;
  free: () => void;
};

export type WorkerGameStateFactory = () => WorkerGameState;

export const analyzeTreeSearchRequest = (
  message: AnalyzeRequest,
  createGameState: WorkerGameStateFactory,
): WorkerResponse => {
  const gameState = createGameState();
  try {
    const importError = gameState.importStateJson(message.stateJson);
    if (importError) {
      return {
        type: 'analysisError',
        runId: message.runId,
        message: importError,
      };
    }

    const analysisLevel = Math.max(0, Math.trunc(message.analysisLevel));
    const analysisRaw = gameState.findBestTurn(analysisLevel);
    let previewRaw = '';
    try {
      const parsed = JSON.parse(analysisRaw) as {
        isValid?: boolean;
        suggestedTurn?: unknown;
      };
      if (parsed.isValid && Array.isArray(parsed.suggestedTurn)) {
        previewRaw = gameState.previewTurnPlan(JSON.stringify(parsed.suggestedTurn));
      }
    } catch {
      previewRaw = '';
    }

    return {
      type: 'analysisResult',
      runId: message.runId,
      analysisRaw,
      previewRaw,
    };
  } catch (error) {
    return {
      type: 'analysisError',
      runId: message.runId,
      message: error instanceof Error ? error.message : 'Tree search worker failed.',
    };
  } finally {
    gameState.free();
  }
};
