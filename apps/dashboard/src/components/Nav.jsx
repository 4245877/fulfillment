import React from "react";
import { NavLink } from "react-router-dom";
import s from "./Nav.module.css";

const NAV_GROUPS = [
  {
    label: "Операції",
    items: [
      { to: "/", end: true, label: "Дошка", icon: "board" },
      { to: "/orders", label: "Замовлення", icon: "orders" },
      { to: "/printers", label: "3D-принтери", icon: "printers" },
      { to: "/inventory", label: "Матеріали", icon: "inventory" },
      { to: "/shipments", label: "Відправлення", icon: "shipments" },
      { to: "/appeals", label: "Звернення", icon: "appeals" },
      { to: "/product-reports", label: "Скарги", icon: "reports" },
    ],
  },
  {
    label: "Система",
    items: [
      { to: "/audit", label: "Журнал подій", icon: "audit" },
      { to: "/settings", label: "Налаштування", icon: "settings" },
    ],
  },
];

function NavIcon({ name }) {
  const paths = {
    board: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="4" rx="2" />
        <rect x="14" y="11" width="7" height="10" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
      </>
    ),
    orders: (
      <>
        <path d="M6 3h12l2 4-8 4-8-4 2-4Z" />
        <path d="M4 7v10l8 4 8-4V7M12 11v10" />
      </>
    ),
    printers: (
      <>
        <path d="M7 4h10v5H7zM5 9h14l2 3v6H3v-6l2-3Z" />
        <path d="M8 14h8v7H8zM7 12h.01M17 12h.01" />
      </>
    ),
    inventory: (
      <>
        <path d="M4 7h16v13H4zM3 4h18v3H3z" />
        <path d="M9 11h6" />
      </>
    ),
    shipments: (
      <>
        <path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
    appeals: (
      <>
        <path d="M5 5h14v10H8l-3 3V5Z" />
        <path d="M8 9h8M8 12h5" />
      </>
    ),
    reports: (
      <>
        <path d="M12 3 3.5 19h17L12 3Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    audit: (
      <>
        <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.8-1.8l.9-1.9L15 4l-1.9.9a7 7 0 0 0-2.2 0L9 4 6.9 6.1 7.8 8A7 7 0 0 0 7 9.8l-2 .7v3l2 .7a7 7 0 0 0 .8 1.8l-.9 1.9L9 20l1.9-.9a7 7 0 0 0 2.2 0l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .8-1.8l2-.7Z" />
      </>
    ),
  };

  return (
    <svg
      className={s.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export default function Nav({ onNavigate }) {
  const cls = ({ isActive }) => (isActive ? `${s.link} ${s.active}` : s.link);

  return (
    <nav className={s.nav} aria-label="Основна навігація">
      {NAV_GROUPS.map((group) => (
        <div className={s.group} key={group.label}>
          <div className={s.groupLabel}>{group.label}</div>

          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={cls}
              onClick={onNavigate}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
              <span className={s.activeMark} aria-hidden="true" />
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
