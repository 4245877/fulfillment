import React from "react";
import styles from "./components/SystemState.module.css";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("UI crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <main className={styles.page}>
          <section className={`${styles.card} ${styles.errorCard}`} role="alert">
            <p className={styles.eyebrow}>Помилка застосунку</p>
            <h1 className={styles.title}>Інтерфейс не вдалося завантажити</h1>
            <p className={styles.description}>
              Перезавантажте сторінку. Якщо помилка повториться, передайте
              технічні деталі адміністратору.
            </p>

            <div className={styles.actions}>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => window.location.reload()}
              >
                Перезавантажити
              </button>
              <a className="btn btn-secondary" href="/">
                На головну
              </a>
            </div>

            <details className={styles.details}>
              <summary>Технічні деталі</summary>
              <pre>{String(this.state.error?.stack || this.state.error)}</pre>
            </details>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
