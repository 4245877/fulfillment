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
        aria-label="Открыть меню"
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
          aria-label="Закрыть меню"
        />
      )}

      <aside
        id="dashboard-sidebar"
        className={`${s.sidebar} ${menuOpen ? s.sidebarOpen : ""}`}
      >
        <div className={s.brandRow}>
          <div className={s.brand}>
            <span className={s.brandMark} aria-hidden="true">
              <span />
              <span />
            </span>

            <span className={s.brandCopy}>
              <span className={s.brandEyebrow}>Fulfillment</span>
              <span className={s.brandName}>Lite Forest</span>
            </span>
          </div>

          <button
            type="button"
            className={s.closeButton}
            onClick={() => setMenuOpen(false)}
            aria-label="Закрыть меню"
          >
            ×
          </button>
        </div>

        <Nav onNavigate={() => setMenuOpen(false)} />

        <div className={s.sidebarFooter}>
          <span className={s.securityDot} aria-hidden="true" />
          <span>
            <strong>Защищённый контур</strong>
            <small>RBAC · 2FA · Audit</small>
          </span>
        </div>
      </aside>

      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
