import './App.css';
import PlayArea from './components/PlayArea';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <p className="app-kicker">Deterministic 2-Player</p>
        <h1 className="app-title">Kill Doctor Lucky</h1>
        <p className="app-subtitle">
          Build a turn plan by selecting your piece or a stranger, then click rooms to set
          destinations.
        </p>
      </header>
      <PlayArea />
    </div>
  );
}

export default App;
