import React from "react";
import { NavLink } from "react-router-dom";
import s from "./Nav.module.css";

export default function Nav() {
  const cls = ({ isActive }) => (isActive ? `${s.link} ${s.active}` : s.link);

  return (
    <nav className={s.nav}>
      <NavLink to="/" end className={cls}>
        Дошка
      </NavLink>

      <NavLink to="/orders" className={cls}>
        Замовлення
      </NavLink>

      <NavLink to="/shipments" className={cls}>
        Відправлення
      </NavLink>

      <NavLink to="/audit" className={cls}>
        Журнал подій
      </NavLink>

      <NavLink to="/settings" className={cls}>
        Налаштування
      </NavLink>
    </nav>
  );
}
