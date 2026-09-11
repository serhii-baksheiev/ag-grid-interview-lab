import { Component, type ErrorInfo, type ReactNode } from 'react';
export class ErrorBoundary extends Component<
  { children: ReactNode; storageKey: string },
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
          Reset this saved view to try again. Other screens remain available.
        </p>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(this.props.storageKey);
            } catch {
              /* Storage can be unavailable. */
            }
            this.setState({ failed: false });
          }}
        >
          Reset saved view
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
