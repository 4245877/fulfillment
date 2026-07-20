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
            <p className={styles.eyebrow}>Ошибка приложения</p>
            <h1 className={styles.title}>Интерфейс не смог открыться</h1>
            <p className={styles.description}>
              Мне очень жаль — произошло что-то серьёзное. Пожалуйста,
              перезагрузите страницу, я сразу постараюсь всё восстановить. Если
              это повторится, передайте администратору технические детали —
              я бережно сохранила их ниже.
            </p>

            <div className={styles.actions}>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => window.location.reload()}
              >
                Перезагрузить
              </button>
              <a className="btn btn-secondary" href="/">
                На главную
              </a>
            </div>

            <details className={styles.details}>
              <summary>Технические детали</summary>
              <pre>{String(this.state.error?.stack || this.state.error)}</pre>
            </details>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
