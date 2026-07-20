import React from "react";
import { Link } from "react-router-dom";
import styles from "../components/SystemState.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Ошибка 404</p>
        <h1 className={styles.title}>Страница не найдена</h1>
        <p className={styles.description}>
          Ой… я всюду посмотрела, но такой страницы здесь нет. Возможно,
          адрес изменился. Вернёмся на доску — там всё на своих местах.
        </p>
        <div className={styles.actions}>
          <Link className="btn btn-primary" to="/">
            Вернуться на доску
          </Link>
        </div>
      </section>
    </main>
  );
}
