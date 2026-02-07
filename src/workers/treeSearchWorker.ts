import wasmBindgenInit, { newDefaultGameState } from '@/KdlRust/pkg/kill_doctor_lucky_rust';

type AnalyzeRequest = {
  type: 'analyze';
  runId: number;
  stateJson: string;
  analysisLevel: number;
};

type WorkerRequest = AnalyzeRequest;

type WorkerResponse =
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

let wasmReadyPromise: Promise<void> | null = null;

const ensureWasmReady = () => {
  if (!wasmReadyPromise) {
    wasmReadyPromise = wasmBindgenInit().then(() => undefined);
  }
  return wasmReadyPromise;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'analyze') {
    return;
  }
  try {
    await ensureWasmReady();
    const gameState = newDefaultGameState();
    const importError = gameState.importStateJson(message.stateJson);
    if (importError) {
      const response: WorkerResponse = {
        type: 'analysisError',
        runId: message.runId,
        message: importError,
      };
      workerScope.postMessage(response);
      return;
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

    const response: WorkerResponse = {
      type: 'analysisResult',
      runId: message.runId,
      analysisRaw,
      previewRaw,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Tree search worker failed.';
    const response: WorkerResponse = {
      type: 'analysisError',
      runId: message.runId,
      message: messageText,
    };
    workerScope.postMessage(response);
  }
};

export {};
