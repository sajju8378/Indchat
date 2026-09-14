import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Uncaught React Error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleResetAndReload = (): void => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('Could not clear storage:', e);
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-4 select-text">
          <div className="w-full max-w-md rounded-3xl border border-red-900/60 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-950/80 text-red-400 border border-red-800/80">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-base font-bold text-white">Application Encountered an Issue</h1>
                <p className="text-xs text-slate-400">Simple E2EE Chat recovered safely</p>
              </div>
            </div>

            <div className="mb-5 rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-red-300 font-mono overflow-auto max-h-36">
              {this.state.error?.message || 'An unexpected runtime error occurred.'}
            </div>

            <div className="space-y-2.5 text-xs">
              <button
                onClick={this.handleReload}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 transition"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Application</span>
              </button>

              <button
                onClick={this.handleResetAndReload}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center justify-center gap-2 border border-slate-700 transition"
              >
                <Trash2 className="w-4 h-4 text-amber-400" />
                <span>Clear Local Cache & Restart</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
