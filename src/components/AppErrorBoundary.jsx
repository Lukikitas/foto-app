import { Component } from 'react';

/**
 * Pantalla de recuperación: si un render lanza (por un lote grande, una foto
 * rota, etc.) la app entera se desmontaba y quedaba la pantalla en negro.
 * Este borde captura el error y ofrece reintentar o recargar.
 */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Error de la app:', error, info?.componentStack);
  }

  retry() {
    this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error" role="alert">
          <div className="app-error__box">
            <h1>La app tuvo un problema</h1>
            <p>
              No se perdió lo guardado: los reclamos y las fotos siguen en el
              historial. Probá de nuevo; si sigue fallando, recargá la app.
            </p>
            <p className="app-error__detail">
              {String(this.state.error?.message || this.state.error)}
            </p>
            <div className="app-error__actions">
              <button type="button" className="btn btn--primary" onClick={this.retry}>
                Reintentar
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => window.location.reload()}
              >
                Recargar la app
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}