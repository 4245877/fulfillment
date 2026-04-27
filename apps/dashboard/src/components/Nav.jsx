import React from "react";
import { NavLink } from "react-router-dom";
import s from "./Nav.module.css";

export default function Nav({ onNavigate }) {
  const cls = ({ isActive }) => (isActive ? `${s.link} ${s.active}` : s.link);

  return (
    <nav className={s.nav} aria-label="Основна навігація">
      <NavLink to="/" end className={cls} onClick={onNavigate}>
        Дошка
      </NavLink>

      <NavLink to="/orders" className={cls} onClick={onNavigate}>
        Замовлення
      </NavLink>

      <NavLink to="/shipments" className={cls} onClick={onNavigate}>
        Відправлення
      </NavLink>

      <NavLink to="/audit" className={cls} onClick={onNavigate}>
        Журнал подій
      </NavLink>

      <NavLink to="/settings" className={cls} onClick={onNavigate}>
        Налаштування
      </NavLink>
    </nav>
  );
}