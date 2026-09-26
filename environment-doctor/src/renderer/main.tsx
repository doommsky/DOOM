import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/app.css';
import { App } from './App';
import { getBridge } from './api/client';

const root = createRoot(document.getElementById('root')!);
try {
  getBridge();
  root.render(<StrictMode><App /></StrictMode>);
} catch (e) {
  root.render(
    <div className="fullbleed" role="alert">
      <div className="card danger" style={{ maxWidth: 560 }}>
        <h1 className="t-h2">Environment Doctor couldn’t start safely</h1>
        <p className="c-muted">{(e as Error).message} Nothing was scanned or changed.</p>
        <p className="c-subtle t-small">Next step: reinstall the app. If this keeps happening, the installation may have been modified.</p>
      </div>
    </div>,
  );
}
