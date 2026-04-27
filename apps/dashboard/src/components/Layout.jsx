import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Nav from "./Nav.jsx";
import s from "./Layout.module.css";

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <div className={`${s.shell} ${menuOpen ? s.menuOpen : ""}`}>
      <button
        type="button"
        className={s.menuButton}
        onClick={() => setMenuOpen(true)}
        aria-label="Відкрити меню"
        aria-controls="dashboard-sidebar"
        aria-expanded={menuOpen}
      >
        <span />
        <span />
        <span />
      </button>

      {menuOpen && (
        <button
          type="button"
          className={s.backdrop}
          onClick={() => setMenuOpen(false)}
          aria-label="Закрити меню"
        />
      )}

      <aside
        id="dashboard-sidebar"
        className={`${s.sidebar} ${menuOpen ? s.sidebarOpen : ""}`}
      >
        <div className={s.brandRow}>
          <div className={s.brand}>Lite Forest • Fulfillment</div>

          <button
            type="button"
            className={s.closeButton}
            onClick={() => setMenuOpen(false)}
            aria-label="Закрити меню"
          >
            ×
          </button>
        </div>

        <Nav onNavigate={() => setMenuOpen(false)} />

        <div className={s.sidebarFooter}>Безпека: RBAC • 2FA • Audit</div>
      </aside>

      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}