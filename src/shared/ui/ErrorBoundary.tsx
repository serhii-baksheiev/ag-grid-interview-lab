import { Component, type ErrorInfo, type ReactNode } from 'react';
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info);
  }
  render() {
    return this.state.failed ? (
      <div className="notice error" role="alert">
        <h2>This view could not be displayed.</h2>
        <p>
          Reload to restart the local demo. Unsaved configuration will be lost.
        </p>
        <button onClick={() => window.location.reload()}>
          Reload application
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
