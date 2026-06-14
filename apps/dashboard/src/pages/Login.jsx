import React, { useState } from "react";
import styles from "./Login.module.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={(event) => event.preventDefault()}>
        <p className={styles.eyebrow}>Fulfillment</p>
        <h1>Вхід до панелі</h1>
        <p className={styles.description}>
          Введіть email і одноразовий код доступу.
        </p>

        <div className={styles.fields}>
          <label className="form-group">
            <span className="form-label">Email</span>
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="form-group">
            <span className="form-label">Одноразовий код</span>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>

          <button className="btn btn-primary btn-lg" type="submit">
            Увійти
          </button>
        </div>
      </form>
    </main>
  );
}
