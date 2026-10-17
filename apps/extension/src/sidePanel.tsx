import { createRoot } from 'react-dom/client';
import './popup.css';

function SidePanelPlaceholder() {
  return (
    <div className="app stack">
      <div className="card stack">
        <div className="brand">YTDL Studio</div>
        <div className="muted">
          O MVP usa o popup da extensão. O side panel fica reservado para a próxima iteração.
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<SidePanelPlaceholder />);
