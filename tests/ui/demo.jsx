import '../../src/demo/environment.js';
import { createRoot } from 'react-dom/client';
import App from '../../src/App.jsx';
import '../../src/index.css';
const root = createRoot(document.getElementById('root'));
document.addEventListener('unmount-demo', () => root.unmount(), { once: true });
root.render(<App />);
