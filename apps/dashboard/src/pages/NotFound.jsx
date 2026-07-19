import React from "react";
import { Link } from "react-router-dom";
import styles from "../components/SystemState.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Помилка 404</p>
        <h1 className={styles.title}>Сторінку не знайдено</h1>
        <p className={styles.description}>
          Ой… я всюди подивилася, але такої сторінки тут немає. Можливо,
          адреса змінилася. Повернімося на дошку — там усе на своїх місцях.
        </p>
        <div className={styles.actions}>
          <Link className="btn btn-primary" to="/">
            Повернутися на дошку
          </Link>
        </div>
      </section>
    </main>
  );
}
