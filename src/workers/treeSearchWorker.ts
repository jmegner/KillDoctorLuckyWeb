import wasmBindgenInit, { initSync, newGameStateForBoard } from '@/KdlRust/pkg/kill_doctor_lucky_rust';
import { analyzeTreeSearchRequest, type AnalyzeRequest, type WorkerResponse } from './treeSearchWorkerCore';

type InitRequest = {
  type: 'init';
  wasmModule: WebAssembly.Module;
};

type WorkerRequest = InitRequest | AnalyzeRequest;

let wasmReadyPromise: Promise<void> | null = null;
let wasmModule: WebAssembly.Module | null = null;

const ensureWasmReady = () => {
  if (!wasmReadyPromise) {
    if (wasmModule) {
      try {
        initSync({ module: wasmModule });
        wasmReadyPromise = Promise.resolve();
      } catch (error) {
        wasmReadyPromise = Promise.reject(error);
      }
    } else {
      wasmReadyPromise = wasmBindgenInit().then(() => undefined);
    }
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
  if (message.type === 'init') {
    wasmModule = message.wasmModule;
    wasmReadyPromise = null;
    return;
  }
  if (message.type !== 'analyze') {
    return;
  }
  try {
    await ensureWasmReady();
    workerScope.postMessage(analyzeTreeSearchRequest(message, newGameStateForBoard));
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
