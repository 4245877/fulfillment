import React from "react";
import { Outlet } from "react-router-dom";
import Nav from "./Nav.jsx";
import s from "./Layout.module.css";

export default function Layout() {
  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.brand}>DRUKARNYA • Fulfillment</div>
        <Nav />
        <div className={s.sidebarFooter}>Безпека: RBAC • 2FA • Audit</div>
      </aside>

      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
