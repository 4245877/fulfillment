import React, { useEffect, useRef, useState } from "react";
import styles from "../Settings.module.css";

import { useSettingsConfig } from "./useSettingsConfig";

import UiSection from "./sections/UiSection";
import BackupsSection from "./sections/BackupsSection";
import PricingSection from "./sections/PricingSection";
import InfraSection from "./sections/InfraSection";
import SecuritySection from "./sections/SecuritySection";

const SECTION_OFFSET_PX = 80;
const OBSERVER_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];

const SECTIONS = [
  {
    id: "ui",
    navTitle: "Загальне",
    render: ({ cfg, patch }) => <UiSection cfg={cfg} patch={patch} />,
  },
  {
    id: "backups",
    navTitle: "Резервні копії",
    render: ({ cfg, patch, doAction }) => (
      <BackupsSection cfg={cfg} patch={patch} doAction={doAction} />
    ),
  },
  {
    id: "pricing",
    navTitle: "Ціноутворення",
    render: ({ showToast }) => <PricingSection showToast={showToast} />,
  },
  {
    id: "infra",
    navTitle: "Інфраструктура",
    render: ({ cfg, patch }) => <InfraSection cfg={cfg} patch={patch} />,
  },
  {
    id: "security",
    navTitle: "Безпека",
    render: ({ cfg, patch }) => <SecuritySection cfg={cfg} patch={patch} />,
  },
];

function getInitialActiveSection() {
  if (typeof window === "undefined") {
    return SECTIONS[0].id;
  }

  const hashSectionId = window.location.hash.replace(/^#/, "");

  return SECTIONS.some((section) => section.id === hashSectionId)
    ? hashSectionId
    : SECTIONS[0].id;
}

function resolveActiveSection() {
  const activationLine = SECTION_OFFSET_PX + 1;

  let current = SECTIONS[0].id;
  let closest = SECTIONS[0].id;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const section of SECTIONS) {
    const node = document.getElementById(section.id);

    if (!node) {
      continue;
    }

    const { top } = node.getBoundingClientRect();
    const distance = Math.abs(top - activationLine);

    if (distance < closestDistance) {
      closestDistance = distance;
      closest = section.id;
    }

    if (top <= activationLine) {
      current = section.id;
    } else {
      break;
    }
  }

  return current === SECTIONS[0].id ? closest : current;
}

export default function SettingsPage() {
  const {
    cfg,
    patch,
    toast,
    exportJson,
    importJson,
    resetAll,
    showToast,
    doAction,
  } = useSettingsConfig();

  const fileInputRef = useRef(null);
  const [activeSection, setActiveSection] = useState(getInitialActiveSection);

  useEffect(() => {
    let frameId = 0;

    const updateActiveSection = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;

        const current = resolveActiveSection();

        setActiveSection((prev) => (prev === current ? prev : current));
      });
    };

    const observer = new IntersectionObserver(updateActiveSection, {
      root: null,
      rootMargin: `-${SECTION_OFFSET_PX}px 0px -55% 0px`,
      threshold: OBSERVER_THRESHOLDS,
    });

    const sectionNodes = SECTIONS.map((section) =>
      document.getElementById(section.id)
    ).filter(Boolean);

    sectionNodes.forEach((node) => observer.observe(node));

    updateActiveSection();

    window.addEventListener("hashchange", updateActiveSection);
    window.addEventListener("resize", updateActiveSection);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      observer.disconnect();
      window.removeEventListener("hashchange", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, []);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportChange = (event) => {
    const file = event.target.files?.[0];

    if (file) {
      importJson(file);
    }

    event.target.value = "";
  };

  const handleResetClick = () => {
    const confirmed = window.confirm(
      "Скинути всі локальні налаштування до значень за замовчуванням?"
    );

    if (confirmed) {
      resetAll();
    }
  };

  return (
    <div
      className={styles.container}
      style={{ "--section-offset": `${SECTION_OFFSET_PX}px` }}
    >
      <aside className={styles.sidebar} aria-label="Панель навігації та дій">
        <div>
          <h1 className={styles.sidebarTitle}>Центр керування</h1>
          <p className={styles.sidebarSubtitle}>
            Конфігурація інтерфейсу, сервісів і операцій в одному місці.
          </p>
        </div>

        <div className={styles.sidebarActions}>
          <button className="btn btn-secondary" type="button" onClick={exportJson}>
            Експорт JSON
          </button>

          <button
            className="btn btn-secondary"
            type="button"
            onClick={handleImportClick}
            aria-label="Імпорт налаштувань з JSON"
          >
            Імпорт JSON
          </button>

          <input
            ref={fileInputRef}
            className={styles.visuallyHiddenInput}
            type="file"
            accept=".json,application/json"
            tabIndex={-1}
            onChange={handleImportChange}
          />

          <button className="btn btn-danger" type="button" onClick={handleResetClick}>
            Скинути
          </button>
        </div>

        <hr className={styles.sidebarDivider} />

        <nav className={styles.navMenu} aria-label="Розділи налаштувань">
          {SECTIONS.map((section, index) => {
            const isActive = activeSection === section.id;

            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={
                  isActive
                    ? `${styles.navLink} ${styles.navLinkActive}`
                    : styles.navLink
                }
                aria-current={isActive ? "location" : undefined}
              >
                <span className={styles.navIndex}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{section.navTitle}</span>
              </a>
            );
          })}
        </nav>

        {toast ? (
          <div className={styles.toastWrapper}>
            <div
              className={`${styles.toast} ${
                toast.kind === "error"
                  ? styles.toastError
                  : styles.toastSuccess
              }`}
              role={toast.kind === "error" ? "alert" : "status"}
            >
              {toast.text}
            </div>
          </div>
        ) : null}
      </aside>

      <main className={styles.content}>
        <header className={styles.pageIntro}>
          <div>
            <div className={styles.pageEyebrow}>Адміністрування</div>
            <h2 className={styles.pageTitle}>Налаштування системи</h2>
            <p className={styles.pageDescription}>
              Керуйте інтерфейсом, інфраструктурою, інтеграціями та правилами
              безпеки з єдиного робочого простору.
            </p>
          </div>

          <div className={styles.localStatus}>
            <span aria-hidden="true" />
            {activeSection === "pricing"
              ? "Зберігається на сервері"
              : "Локальні зміни"}
          </div>
        </header>

        {SECTIONS.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className={styles.sectionAnchor}
          >
            {section.render({ cfg, patch, doAction, showToast })}
          </section>
        ))}

        <p className={styles.footerNote}>
          Примітка: більшість налаштувань зберігаються локально в браузері —
          синхронізація з сервером і застосування до Board/Ops буде додана
          пізніше. Виняток — розділ «Ціноутворення», який зберігається
          безпосередньо у файл pricing.yml на сервері.
        </p>
      </main>
    </div>
  );
}