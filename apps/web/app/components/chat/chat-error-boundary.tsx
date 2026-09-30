import { Component, type ReactNode } from "react";

// edge's render-error containment; public copy never includes the caught error.
export class ChatErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="chat-error" role="alert">
      <p>The conversation couldn’t be displayed. Please try again.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>Try again</button>
    </div>;
    return this.props.children;
  }
}
