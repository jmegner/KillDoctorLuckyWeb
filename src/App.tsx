import { useEffect, useState } from 'react';
import './App.css';
import PlayArea from './components/PlayArea';
import { newDefaultGameState, type GameStateHandle } from '@/KdlRust/pkg/kill_doctor_lucky_rust';

function App() {
  const [gameState, setGameState] = useState<GameStateHandle | null>(null);
  const [summary, setSummary] = useState<string>('');

  useEffect(() => {
    try {
      const state = newDefaultGameState();
      setGameState(state);
      setSummary(state.summary(0));
    } catch (error) {
      setSummary(`Failed to create game state: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    if (gameState) {
      setSummary(gameState.summary(0));
    }
  }, [gameState]);

  return (
    <>
      <h3>Kill Doctor Lucky</h3>
      <PlayArea />
      <pre className="game-summary">{summary}</pre>
    </>
  );
}

export default App;
