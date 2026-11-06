import './demo/environment.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { applyTheme, getTheme } from './lib/theme.js'
import { enablePerformanceMetrics, performanceSamples, observeLongTasks } from './lib/performanceMetrics.js'

applyTheme(getTheme())
if (import.meta.env.MODE === 'demo' && import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').then(registration => registration.update()).catch(() => {});
}
if (new URLSearchParams(window.location.search).get('performance') === '1') {
  enablePerformanceMetrics();
  observeLongTasks();
  window.fotoPerformance = performanceSamples;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
