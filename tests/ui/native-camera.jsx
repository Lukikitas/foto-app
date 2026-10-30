import { createRoot } from 'react-dom/client';
import NativeCameraEntry from '../../src/components/NativeCameraEntry';
import '../../src/index.css';
import '../../src/App.css';

// The production capture entry, isolated from all backend requests and data.
createRoot(document.getElementById('root')).render(<NativeCameraEntry />);
