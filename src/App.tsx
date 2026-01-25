import './App.css';
import PlayArea from './components/PlayArea';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Kill Doctor Lucky (Deterministic Variant)</h1>
      </header>
      <PlayArea />
    </div>
  );
}

export default App;
