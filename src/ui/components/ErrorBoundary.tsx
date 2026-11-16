import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './errorboundary.module.css';

/**
 * THE LAST LINE OF DEFENCE AGAINST A BLANK PAGE.
 *
 * A render error anywhere in the React tree used to unmount the whole app and leave an empty
 * white page: no message, no way back, and no warning banner. This boundary replaces the
 * tree with the error text, a Reload button and the NOT FOR CLINICAL USE wording, because
 * that warning must be visible in every state the page can be in, including a broken one.
 *
 * It catches errors thrown while RENDERING. Errors in event handlers and in the sim worker
 * are not React render errors and are not caught here; the 3D view has its own fallback in
 * App.tsx for a failed or lost WebGL context.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CORPUS: the interface crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={styles.root} role="alert" data-error-boundary>
        <div className={styles.card}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.message}>{error.message || 'An unknown error stopped the interface.'}</p>
          <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
        <footer className={styles.banner}>
          <strong>NOT FOR CLINICAL USE {'—'} EDUCATIONAL SIMULATION</strong>
        </footer>
      </div>
    );
  }
}
