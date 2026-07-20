// apps/dashboard/src/pages/settings/sections/InfraSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput, TextArea } from "../ui.jsx";
import styles from "../../Settings.module.css";

const ROLE_OPTIONS = [
  { value: "api", label: "API" },
  { value: "dashboard", label: "Панель управления" },
  { value: "worker", label: "Общий воркер" },
  { value: "slicer", label: "Нарезка STL" },
  { value: "media", label: "Медиа / превью" },
  { value: "storage", label: "Хранилище STL / G-code" },
  { value: "db", label: "База данных" },
  { value: "cache", label: "Кеш / Redis" },
  { value: "queue", label: "Очереди" },
  { value: "search", label: "Поиск / индексация" },
  { value: "printers", label: "Принтеры / шлюз фермы" },
  { value: "webhooks", label: "Вебхуки" },
  { value: "edge", label: "Интернет-фильтр / edge-узел" },
  { value: "reverse_proxy", label: "Обратный прокси" },
  { value: "backup", label: "Резервные копии" },
  { value: "monitoring", label: "Мониторинг" },
  { value: "failover", label: "Отказоустойчивость / резерв" },
  { value: "replication", label: "Репликация" },
  { value: "vpn", label: "VPN / защищённая сеть" },
];

const NODE_PURPOSE_OPTIONS = [
  { value: "primary", label: "Основной" },
  { value: "standby", label: "Резервный" },
  { value: "support", label: "Вспомогательный" },
  { value: "edge", label: "Входной узел / интернет-фильтр" },
  { value: "worker", label: "Вычислительный воркер" },
  { value: "storage", label: "Хранилище" },
  { value: "other", label: "Другое" },
];

const STORAGE_PROVIDER_OPTIONS = [
  { value: "local", label: "Локальное" },
  { value: "s3", label: "S3" },
  { value: "minio", label: "MinIO" },
];

const CHECKSUM_OPTIONS = [
  { value: "sha256", label: "SHA-256" },
  { value: "sha1", label: "SHA-1" },
  { value: "md5", label: "MD5" },
];

const SEARCH_PROVIDER_OPTIONS = [
  { value: "meilisearch", label: "Meilisearch" },
  { value: "elasticsearch", label: "Elasticsearch" },
  { value: "opensearch", label: "OpenSearch" },
  { value: "database", label: "База данных" },
  { value: "disabled", label: "Выключено" },
];

const FAILOVER_MODE_OPTIONS = [
  { value: "manual", label: "Ручной" },
  { value: "semi_auto", label: "Полуавтоматический" },
  { value: "automatic", label: "Автоматический" },
];

const FAILOVER_STRATEGY_OPTIONS = [
  { value: "active_standby", label: "Активный + резервный" },
  { value: "active_active", label: "Два активных узла" },
  { value: "cold_standby", label: "Холодный резерв" },
];

const TLS_TERMINATION_OPTIONS = [
  { value: "edge", label: "На интернет-фильтре / edge-узле" },
  { value: "app", label: "На сервере приложения" },
  { value: "external", label: "Внешний балансировщик / CDN" },
  { value: "disabled", label: "Выключено" },
];

const MAINTENANCE_SERVED_BY_OPTIONS = [
  { value: "edge", label: "Edge-узел / интернет-фильтр" },
  { value: "active_app", label: "Активный сервер приложения" },
  { value: "standby_app", label: "Резервный сервер приложения" },
  { value: "disabled", label: "Не показывать страницу технических работ" },
];

const REPLICATION_MODE_OPTIONS = [
  { value: "async", label: "Асинхронная" },
  { value: "sync", label: "Синхронная" },
  { value: "semi_sync", label: "Полусинхронная" },
  { value: "snapshot", label: "Снимок" },
  { value: "manual", label: "Ручная" },
  { value: "disabled", label: "Выключено" },
];

function getNodeRoles(node) {
  if (Array.isArray(node.roles)) return node.roles;
  if (node.role) return [node.role];

  return [];
}

function formatReadonlyValue(value, empty = "—") {
  if (value === null || value === undefined || value === "") return empty;

  return String(value);
}

function getOptionLabel(options, value, empty = "—") {
  const option = options.find((item) => item.value === value);

  return option?.label || empty;
}

function getNodeKey(node, index) {
  return node.id || node.name || `node-${index}`;
}

function buildNodeOptionLabel(node, index) {
  const id = node.id || `node-${index + 1}`;
  const name = node.name || "Без названия";

  return `${name} (${id})`;
}

export default function InfraSection({ cfg, patch }) {
  const infra = cfg?.infra || {};

  const nodes = infra.nodes || [];
  const traffic = infra.traffic || {};
  const failover = infra.failover || {};
  const replication = infra.replication || {};
  const backupTopology = infra.backupTopology || {};
  const storage = infra.storage || {};
  const slicing = infra.slicing || {};
  const search = infra.search || {};
  const pools = infra.pools || {};
  const resources = infra.resources || {};
  const rateLimits = infra.rateLimits || {};
  const maintenance = infra.maintenance || {};

  const nodeOptions = nodes.map((node, index) => ({
    value: node.id || node.name || `node-${index + 1}`,
    label: buildNodeOptionLabel(node, index),
  }));

  const updateNode = (index, changes) => {
    const next = [...nodes];
    next[index] = { ...next[index], ...changes };
    patch("infra.nodes", next);
  };

  const toggleNodeRole = (index, roleValue, enabled) => {
    const currentRoles = getNodeRoles(nodes[index]);

    const nextRoles = enabled
      ? Array.from(new Set([...currentRoles, roleValue]))
      : currentRoles.filter((role) => role !== roleValue);

    updateNode(index, {
      roles: nextRoles,
      role: undefined,
    });
  };

  const renderNodeSelect = (value, onChange, placeholder = "Не выбрано") => (
    <select
      className="select"
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {nodeOptions.map((node) => (
        <option key={node.value} value={node.value}>
          {node.label}
        </option>
      ))}
    </select>
  );

  return (
    <Card
      title="3) Инфраструктура"
      sub="Узлы, входящий трафик, отказоустойчивость, репликация, хранилище, воркеры, поиск, ресурсы и режим технических работ"
    >
      <FieldRow
        label="Узлы"
        hint="Физические или виртуальные серверы. Назначение сервера хранится отдельно от технических ролей."
      >
        <div className={styles.inputGroup}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Назначение</th>
                  <th>Роли</th>
                  <th>Хост</th>
                  <th>Статус</th>
                  <th>Диск</th>
                  <th>Задачи</th>
                  <th>Действия</th>
                </tr>
              </thead>

              <tbody>
                {nodes.map((node, index) => {
                  const nodeRoles = getNodeRoles(node);
                  const roleLabels = nodeRoles
                    .map((role) => getOptionLabel(ROLE_OPTIONS, role, role))
                    .join(", ");

                  return (
                    <React.Fragment key={getNodeKey(node, index)}>
                      <tr>
                        <td>
                          <input
                            className="input"
                            value={node.name || ""}
                            onChange={(event) =>
                              updateNode(index, { name: event.target.value })
                            }
                          />
                        </td>

                        <td>
                          <select
                            className="select"
                            value={node.purpose || "other"}
                            onChange={(event) =>
                              updateNode(index, {
                                purpose: event.target.value,
                              })
                            }
                          >
                            {NODE_PURPOSE_OPTIONS.map((purpose) => (
                              <option key={purpose.value} value={purpose.value}>
                                {purpose.label}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td>{roleLabels || "—"}</td>

                        <td>
                          <input
                            className="input"
                            value={node.host || ""}
                            onChange={(event) =>
                              updateNode(index, { host: event.target.value })
                            }
                          />
                        </td>

                        <td>{formatReadonlyValue(node.status)}</td>

                        <td>
                          {node.diskFreeGb === null ||
                          node.diskFreeGb === undefined
                            ? "—"
                            : `${node.diskFreeGb} ГБ`}
                        </td>

                        <td>{formatReadonlyValue(node.activeJobs)}</td>

                        <td className={styles.tableActionCell}>
                          <button
                            className="btn btn-secondary btn-sm"
                            type="button"
                            onClick={() => {
                              const next = nodes.filter(
                                (_, nodeIndex) => nodeIndex !== index,
                              );
                              patch("infra.nodes", next);
                            }}
                          >
                            Удалить
                          </button>
                        </td>
                      </tr>

                      <tr>
                        <td colSpan={8}>
                          <details>
                            <summary>Детали узла</summary>

                            <div className={styles.inputGroup}>
                              <div
                                className={`${styles.inputGrid2} ${styles.max720}`}
                              >
                                <div>
                                  <div className={styles.inputLabel}>ID</div>
                                  <input
                                    className="input"
                                    value={node.id || ""}
                                    onChange={(event) =>
                                      updateNode(index, {
                                        id: event.target.value,
                                      })
                                    }
                                    placeholder="main-01"
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    Приоритет
                                  </div>
                                  <NumberInput
                                    value={node.priority}
                                    min={0}
                                    max={1000}
                                    onChange={(value) =>
                                      updateNode(index, { priority: value })
                                    }
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    Площадка
                                  </div>
                                  <input
                                    className="input"
                                    value={node.site || ""}
                                    onChange={(event) =>
                                      updateNode(index, {
                                        site: event.target.value,
                                      })
                                    }
                                    placeholder="main / backup / edge"
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    URL проверки состояния
                                  </div>
                                  <input
                                    className="input"
                                    value={node.healthcheckUrl || ""}
                                    onChange={(event) =>
                                      updateNode(index, {
                                        healthcheckUrl: event.target.value,
                                      })
                                    }
                                    placeholder="https://host/health"
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    Публичный хост
                                  </div>
                                  <input
                                    className="input"
                                    value={node.publicHost || ""}
                                    onChange={(event) =>
                                      updateNode(index, {
                                        publicHost: event.target.value,
                                      })
                                    }
                                    placeholder="shop.example.com"
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    Внутренний хост
                                  </div>
                                  <input
                                    className="input"
                                    value={node.privateHost || ""}
                                    onChange={(event) =>
                                      updateNode(index, {
                                        privateHost: event.target.value,
                                      })
                                    }
                                    placeholder="10.0.0.10"
                                  />
                                </div>
                              </div>

                              <div
                                className={`${styles.inputGrid2} ${styles.max720}`}
                              >
                                <Toggle
                                  value={node.enabled !== false}
                                  onChange={(value) =>
                                    updateNode(index, { enabled: value })
                                  }
                                  label="Узел включён"
                                />

                                <Toggle
                                  value={node.canBePromoted === true}
                                  onChange={(value) =>
                                    updateNode(index, {
                                      canBePromoted: value,
                                    })
                                  }
                                  label="Можно сделать активным"
                                />

                                <Toggle
                                  value={node.isTrafficEntry === true}
                                  onChange={(value) =>
                                    updateNode(index, {
                                      isTrafficEntry: value,
                                    })
                                  }
                                  label="Входная точка трафика"
                                />
                              </div>

                              <div>
                                <div className={styles.inputLabel}>Роли</div>
                                <div className={styles.inputGroup}>
                                  {ROLE_OPTIONS.map((role) => (
                                    <label
                                      key={role.value}
                                      className={styles.roleOption}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={nodeRoles.includes(role.value)}
                                        onChange={(event) =>
                                          toggleNodeRole(
                                            index,
                                            role.value,
                                            event.target.checked,
                                          )
                                        }
                                      />
                                      {role.label}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div
                                className={`${styles.inputGrid2} ${styles.max720}`}
                              >
                                <div>
                                  <div className={styles.inputLabel}>
                                    Последняя проверка
                                  </div>
                                  <input
                                    className="input"
                                    value={node.lastSeenAt || ""}
                                    onChange={(event) =>
                                      updateNode(index, {
                                        lastSeenAt: event.target.value,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    Версия
                                  </div>
                                  <input
                                    className="input"
                                    value={node.version || ""}
                                    onChange={(event) =>
                                      updateNode(index, {
                                        version: event.target.value,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    CPU, %
                                  </div>
                                  <NumberInput
                                    value={node.cpuLoad}
                                    min={0}
                                    max={100}
                                    onChange={(value) =>
                                      updateNode(index, { cpuLoad: value })
                                    }
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    RAM, МБ
                                  </div>
                                  <NumberInput
                                    value={node.memoryUsedMb}
                                    min={0}
                                    max={10000000}
                                    onChange={(value) =>
                                      updateNode(index, {
                                        memoryUsedMb: value,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    Свободный диск, ГБ
                                  </div>
                                  <NumberInput
                                    value={node.diskFreeGb}
                                    min={0}
                                    max={10000000}
                                    onChange={(value) =>
                                      updateNode(index, {
                                        diskFreeGb: value,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <div className={styles.inputLabel}>
                                    Задержка очереди
                                  </div>
                                  <NumberInput
                                    value={node.queueLag}
                                    min={0}
                                    max={10000000}
                                    onChange={(value) =>
                                      updateNode(index, { queueLag: value })
                                    }
                                  />
                                </div>
                              </div>

                              <TextArea
                                value={node.notes || ""}
                                onChange={(value) =>
                                  updateNode(index, { notes: value })
                                }
                                rows={3}
                                placeholder="Заметки о сервере"
                              />
                            </div>
                          </details>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() =>
              patch("infra.nodes", [
                ...nodes,
                {
                  id: `node-${nodes.length + 1}`,
                  name: "Новый узел",
                  purpose: "worker",
                  roles: ["worker"],
                  host: "",
                  publicHost: "",
                  privateHost: "",
                  healthcheckUrl: "",
                  site: "",
                  priority: 10,
                  enabled: true,
                  canBePromoted: false,
                  isTrafficEntry: false,
                  notes: "",
                  status: "",
                  lastSeenAt: "",
                  version: "",
                  cpuLoad: null,
                  memoryUsedMb: null,
                  diskFreeGb: null,
                  activeJobs: null,
                  queueLag: null,
                },
              ])
            }
          >
            Добавить узел
          </button>
        </div>
      </FieldRow>

      <FieldRow
        label="Трафик и входная точка"
        hint="Путь пользователя: интернет-фильтр → активный сервер приложения. В случае аварии активный сервер можно заменить резервным."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Входной узел</div>
            {renderNodeSelect(traffic.entryNodeId, (value) =>
              patch("infra.traffic.entryNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>
              Активный сервер приложения
            </div>
            {renderNodeSelect(traffic.activeAppNodeId, (value) =>
              patch("infra.traffic.activeAppNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>
              Резервный сервер приложения
            </div>
            {renderNodeSelect(traffic.standbyAppNodeId, (value) =>
              patch("infra.traffic.standbyAppNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>Публичный домен</div>
            <input
              className="input"
              value={traffic.publicDomain || ""}
              onChange={(event) =>
                patch("infra.traffic.publicDomain", event.target.value)
              }
              placeholder="shop.example.com"
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Завершение TLS</div>
            <select
              className="select"
              value={traffic.tlsTermination || "edge"}
              onChange={(event) =>
                patch("infra.traffic.tlsTermination", event.target.value)
              }
            >
              {TLS_TERMINATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className={styles.inputLabel}>Страница технических работ</div>
            <select
              className="select"
              value={traffic.maintenanceServedBy || "edge"}
              onChange={(event) =>
                patch("infra.traffic.maintenanceServedBy", event.target.value)
              }
            >
              {MAINTENANCE_SERVED_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <Toggle
            value={traffic.allowDirectAppAccess === true}
            onChange={(value) =>
              patch("infra.traffic.allowDirectAppAccess", value)
            }
            label="Разрешить прямой доступ к серверу приложения"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Отказоустойчивость"
        hint="Для начала безопаснее ручное переключение: автоматическое переключение без надёжной репликации БД может создать больше проблем."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={failover.enabled === true}
            onChange={(value) => patch("infra.failover.enabled", value)}
            label="Включить отказоустойчивость"
          />

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Режим</div>
              <select
                className="select"
                value={failover.mode || "manual"}
                onChange={(event) =>
                  patch("infra.failover.mode", event.target.value)
                }
              >
                {FAILOVER_MODE_OPTIONS.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className={styles.inputLabel}>Стратегия</div>
              <select
                className="select"
                value={failover.strategy || "active_standby"}
                onChange={(event) =>
                  patch("infra.failover.strategy", event.target.value)
                }
              >
                {FAILOVER_STRATEGY_OPTIONS.map((strategy) => (
                  <option key={strategy.value} value={strategy.value}>
                    {strategy.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className={styles.inputLabel}>Основной узел</div>
              {renderNodeSelect(failover.primaryNodeId, (value) =>
                patch("infra.failover.primaryNodeId", value),
              )}
            </div>

            <div>
              <div className={styles.inputLabel}>Резервный узел</div>
              {renderNodeSelect(failover.standbyNodeId, (value) =>
                patch("infra.failover.standbyNodeId", value),
              )}
            </div>

            <div>
              <div className={styles.inputLabel}>Входной узел трафика</div>
              {renderNodeSelect(failover.trafficEntryNodeId, (value) =>
                patch("infra.failover.trafficEntryNodeId", value),
              )}
            </div>

            <div>
              <div className={styles.inputLabel}>Интервал проверки, с</div>
              <NumberInput
                value={failover.healthcheckIntervalSec}
                min={1}
                max={3600}
                onChange={(value) =>
                  patch("infra.failover.healthcheckIntervalSec", value)
                }
              />
            </div>

            <div>
              <div className={styles.inputLabel}>
                Ошибок до статуса недоступности
              </div>
              <NumberInput
                value={failover.unhealthyAfterFailures}
                min={1}
                max={100}
                onChange={(value) =>
                  patch("infra.failover.unhealthyAfterFailures", value)
                }
              />
            </div>

            <div>
              <div className={styles.inputLabel}>RTO, мин</div>
              <NumberInput
                value={failover.rtoMinutes}
                min={0}
                max={10080}
                onChange={(value) => patch("infra.failover.rtoMinutes", value)}
              />
            </div>

            <div>
              <div className={styles.inputLabel}>RPO, мин</div>
              <NumberInput
                value={failover.rpoMinutes}
                min={0}
                max={10080}
                onChange={(value) => patch("infra.failover.rpoMinutes", value)}
              />
            </div>
          </div>

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <Toggle
              value={failover.autoPromoteStandby === true}
              onChange={(value) =>
                patch("infra.failover.autoPromoteStandby", value)
              }
              label="Автоматически делать резервный узел активным"
            />

            <Toggle
              value={failover.requireManualApproval !== false}
              onChange={(value) =>
                patch("infra.failover.requireManualApproval", value)
              }
              label="Требовать ручного подтверждения"
            />
          </div>

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Последнее переключение</div>
              <input
                className="input"
                type="datetime-local"
                value={failover.lastFailoverAt || ""}
                onChange={(event) =>
                  patch("infra.failover.lastFailoverAt", event.target.value)
                }
              />
            </div>
          </div>

          <TextArea
            value={failover.lastFailoverReason || ""}
            onChange={(value) =>
              patch("infra.failover.lastFailoverReason", value)
            }
            rows={3}
            placeholder="Причина последнего переключения"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Репликация"
        hint="Отдельно настраиваются база данных, файлы, поисковый индекс, настройки и очереди."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={replication.enabled === true}
            onChange={(value) => patch("infra.replication.enabled", value)}
            label="Включить репликацию"
          />

          <details open>
            <summary>База данных</summary>

            <div className={`${styles.inputGrid2} ${styles.max720}`}>
              <Toggle
                value={replication.database?.enabled === true}
                onChange={(value) =>
                  patch("infra.replication.database.enabled", value)
                }
                label="Реплицировать БД"
              />

              <div>
                <div className={styles.inputLabel}>Режим</div>
                <select
                  className="select"
                  value={replication.database?.mode || "async"}
                  onChange={(event) =>
                    patch("infra.replication.database.mode", event.target.value)
                  }
                >
                  {REPLICATION_MODE_OPTIONS.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className={styles.inputLabel}>Узел-источник</div>
                {renderNodeSelect(replication.database?.sourceNodeId, (value) =>
                  patch("infra.replication.database.sourceNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Целевой узел</div>
                {renderNodeSelect(replication.database?.targetNodeId, (value) =>
                  patch("infra.replication.database.targetNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Макс. задержка, с</div>
                <NumberInput
                  value={replication.database?.maxLagSeconds}
                  min={0}
                  max={86400}
                  onChange={(value) =>
                    patch("infra.replication.database.maxLagSeconds", value)
                  }
                />
              </div>
            </div>
          </details>

          <details open>
            <summary>Файлы</summary>

            <div className={`${styles.inputGrid2} ${styles.max720}`}>
              <Toggle
                value={replication.files?.enabled === true}
                onChange={(value) =>
                  patch("infra.replication.files.enabled", value)
                }
                label="Реплицировать файлы"
              />

              <div>
                <div className={styles.inputLabel}>Узел-источник</div>
                {renderNodeSelect(replication.files?.sourceNodeId, (value) =>
                  patch("infra.replication.files.sourceNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Целевой узел</div>
                {renderNodeSelect(replication.files?.targetNodeId, (value) =>
                  patch("infra.replication.files.targetNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Интервал, мин</div>
                <NumberInput
                  value={replication.files?.intervalMinutes}
                  min={1}
                  max={10080}
                  onChange={(value) =>
                    patch("infra.replication.files.intervalMinutes", value)
                  }
                />
              </div>
            </div>

            <div className={`${styles.inputGrid2} ${styles.max720}`}>
              <Toggle
                value={replication.files?.includeStl === true}
                onChange={(value) =>
                  patch("infra.replication.files.includeStl", value)
                }
                label="STL"
              />

              <Toggle
                value={replication.files?.includeGcode === true}
                onChange={(value) =>
                  patch("infra.replication.files.includeGcode", value)
                }
                label="G-code"
              />

              <Toggle
                value={replication.files?.includeMedia === true}
                onChange={(value) =>
                  patch("infra.replication.files.includeMedia", value)
                }
                label="Изображения и медиа"
              />

              <Toggle
                value={replication.files?.includeSettings === true}
                onChange={(value) =>
                  patch("infra.replication.files.includeSettings", value)
                }
                label="Настройки"
              />
            </div>
          </details>

          <details>
            <summary>Поисковый индекс и очереди</summary>

            <div className={`${styles.inputGrid2} ${styles.max720}`}>
              <Toggle
                value={replication.searchIndex?.rebuildOnPromote !== false}
                onChange={(value) =>
                  patch("infra.replication.searchIndex.rebuildOnPromote", value)
                }
                label="Перестраивать индекс при переключении на резервный узел"
              />

              <Toggle
                value={replication.searchIndex?.replicateIndex === true}
                onChange={(value) =>
                  patch("infra.replication.searchIndex.replicateIndex", value)
                }
                label="Реплицировать поисковый индекс"
              />

              <Toggle
                value={replication.queues?.replicatePendingJobs === true}
                onChange={(value) =>
                  patch("infra.replication.queues.replicatePendingJobs", value)
                }
                label="Реплицировать задачи в ожидании"
              />

              <Toggle
                value={replication.queues?.replaySafeOnly !== false}
                onChange={(value) =>
                  patch("infra.replication.queues.replaySafeOnly", value)
                }
                label="Повторять только безопасные задачи"
              />
            </div>
          </details>
        </div>
      </FieldRow>

      <FieldRow
        label="Связь с резервными копиями"
        hint="Здесь только топология резервных копий. Расписание, срок хранения, экспорт и архивы лучше оставить в разделе «Резервные копии»."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Узел резервных копий</div>
            {renderNodeSelect(backupTopology.backupNodeId, (value) =>
              patch("infra.backupTopology.backupNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>Основной узел для резервной копии</div>
            {renderNodeSelect(backupTopology.backupPrimaryNodeId, (value) =>
              patch("infra.backupTopology.backupPrimaryNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>Резервный узел для резервной копии</div>
            {renderNodeSelect(backupTopology.backupStandbyNodeId, (value) =>
              patch("infra.backupTopology.backupStandbyNodeId", value),
            )}
          </div>

          <Toggle
            value={backupTopology.monitorBackups !== false}
            onChange={(value) =>
              patch("infra.backupTopology.monitorBackups", value)
            }
            label="Мониторить состояние резервных копий"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Хранилище файлов"
        hint="STL, G-code, изображения, превью, временные файлы и защита от дубликатов."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Тип хранилища</div>
            <select
              className="select"
              value={storage.provider || "local"}
              onChange={(event) =>
                patch("infra.storage.provider", event.target.value)
              }
            >
              {STORAGE_PROVIDER_OPTIONS.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className={styles.inputLabel}>Макс. размер STL, МБ</div>
            <NumberInput
              value={storage.maxStlFileMb}
              min={1}
              max={100000}
              onChange={(value) => patch("infra.storage.maxStlFileMb", value)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Макс. размер архива, МБ</div>
            <NumberInput
              value={storage.maxArchiveMb}
              min={1}
              max={100000}
              onChange={(value) => patch("infra.storage.maxArchiveMb", value)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>TTL временных файлов, ч</div>
            <NumberInput
              value={storage.tempFilesTtlHours}
              min={1}
              max={8760}
              onChange={(value) =>
                patch("infra.storage.tempFilesTtlHours", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Мин. свободный диск, ГБ</div>
            <NumberInput
              value={storage.minFreeDiskGb}
              min={0}
              max={100000}
              onChange={(value) => patch("infra.storage.minFreeDiskGb", value)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Контрольная сумма</div>
            <select
              className="select"
              value={storage.checksumAlgorithm || "sha256"}
              onChange={(event) =>
                patch("infra.storage.checksumAlgorithm", event.target.value)
              }
            >
              {CHECKSUM_OPTIONS.map((algorithm) => (
                <option key={algorithm.value} value={algorithm.value}>
                  {algorithm.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <Toggle
            value={storage.keepGeneratedGcode}
            onChange={(value) =>
              patch("infra.storage.keepGeneratedGcode", value)
            }
            label="Сохранять G-code после нарезки"
          />

          <Toggle
            value={storage.enableDeduplication}
            onChange={(value) =>
              patch("infra.storage.enableDeduplication", value)
            }
            label="Включить дедупликацию STL"
          />

          <Toggle
            value={storage.enableChecksum !== false}
            onChange={(value) => patch("infra.storage.enableChecksum", value)}
            label="Проверять контрольные суммы файлов"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Нарезка STL"
        hint="Подготовка G-code, расчёт расхода пластика и тяжёлые задачи воркеров слайсера."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={slicing.enabled}
            onChange={(value) => patch("infra.slicing.enabled", value)}
            label="Включить нарезку STL"
          />

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Макс. параллельных задач</div>
              <NumberInput
                value={slicing.maxConcurrentJobs}
                min={0}
                max={999}
                onChange={(value) =>
                  patch("infra.slicing.maxConcurrentJobs", value)
                }
              />
            </div>

            <div>
              <div className={styles.inputLabel}>Тайм-аут, мин</div>
              <NumberInput
                value={slicing.timeoutMinutes}
                min={1}
                max={1440}
                onChange={(value) =>
                  patch("infra.slicing.timeoutMinutes", value)
                }
              />
            </div>

            <div>
              <div className={styles.inputLabel}>Профиль по умолчанию</div>
              <input
                className="input"
                value={slicing.defaultProfile || ""}
                onChange={(event) =>
                  patch("infra.slicing.defaultProfile", event.target.value)
                }
                placeholder="pla-0.2mm"
              />
            </div>
          </div>

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <Toggle
              value={slicing.keepFailedArtifacts}
              onChange={(value) =>
                patch("infra.slicing.keepFailedArtifacts", value)
              }
              label="Сохранять артефакты неудачной нарезки"
            />

            <Toggle
              value={slicing.autoSliceOnProductImport}
              onChange={(value) =>
                patch("infra.slicing.autoSliceOnProductImport", value)
              }
              label="Автонарезка при импорте товара"
            />

            <Toggle
              value={slicing.autoSliceBeforePrint}
              onChange={(value) =>
                patch("infra.slicing.autoSliceBeforePrint", value)
              }
              label="Автонарезка перед печатью"
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Воркеры и очереди"
        hint="Отдельные лимиты по типам фоновых задач."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Импорт товаров</div>
            <NumberInput
              value={pools.imports?.maxWorkers}
              min={0}
              max={999}
              onChange={(value) =>
                patch("infra.pools.imports.maxWorkers", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Нарезка STL</div>
            <NumberInput
              value={pools.slicing?.maxWorkers}
              min={0}
              max={999}
              onChange={(value) =>
                patch("infra.pools.slicing.maxWorkers", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Медиа / превью</div>
            <NumberInput
              value={pools.media?.maxWorkers}
              min={0}
              max={999}
              onChange={(value) =>
                patch("infra.pools.media.maxWorkers", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Индексация поиска</div>
            <NumberInput
              value={pools.searchIndexing?.maxWorkers}
              min={0}
              max={999}
              onChange={(value) =>
                patch("infra.pools.searchIndexing.maxWorkers", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Вебхуки</div>
            <NumberInput
              value={pools.webhooks?.maxWorkers}
              min={0}
              max={999}
              onChange={(value) =>
                patch("infra.pools.webhooks.maxWorkers", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Синхронизация остатков</div>
            <NumberInput
              value={pools.inventorySync?.maxWorkers}
              min={0}
              max={999}
              onChange={(value) =>
                patch("infra.pools.inventorySync.maxWorkers", value)
              }
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Поиск и индексация"
        hint="Подготовка к каталогу на сотни тысяч товаров."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={search.enabled}
            onChange={(value) => patch("infra.search.enabled", value)}
            label="Включить поиск"
          />

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Провайдер</div>
              <select
                className="select"
                value={search.provider || "meilisearch"}
                onChange={(event) =>
                  patch("infra.search.provider", event.target.value)
                }
              >
                {SEARCH_PROVIDER_OPTIONS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className={styles.inputLabel}>Размер пакета</div>
              <NumberInput
                value={search.indexBatchSize}
                min={1}
                max={100000}
                onChange={(value) =>
                  patch("infra.search.indexBatchSize", value)
                }
              />
            </div>

            <div>
              <div className={styles.inputLabel}>
                Параллельность переиндексации
              </div>
              <NumberInput
                value={search.reindexConcurrency}
                min={1}
                max={999}
                onChange={(value) =>
                  patch("infra.search.reindexConcurrency", value)
                }
              />
            </div>
          </div>

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <Toggle
              value={search.autoReindexOnProductChange}
              onChange={(value) =>
                patch("infra.search.autoReindexOnProductChange", value)
              }
              label="Автоиндексация при изменении товара"
            />

            <Toggle
              value={search.rebuildIndexAllowed}
              onChange={(value) =>
                patch("infra.search.rebuildIndexAllowed", value)
              }
              label="Разрешить полную перестройку индекса"
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Ограничения ресурсов"
        hint="Защита от перегрузки CPU, RAM и переполнения диска временными файлами."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Макс. CPU, %</div>
            <NumberInput
              value={resources.maxCpuPercent}
              min={1}
              max={100}
              onChange={(value) =>
                patch("infra.resources.maxCpuPercent", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Макс. RAM, %</div>
            <NumberInput
              value={resources.maxMemoryPercent}
              min={1}
              max={100}
              onChange={(value) =>
                patch("infra.resources.maxMemoryPercent", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Мин. свободный диск, ГБ</div>
            <NumberInput
              value={resources.minFreeDiskGb}
              min={0}
              max={100000}
              onChange={(value) =>
                patch("infra.resources.minFreeDiskGb", value)
              }
            />
          </div>
        </div>

        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <Toggle
            value={resources.pauseWorkersOnLowDisk}
            onChange={(value) =>
              patch("infra.resources.pauseWorkersOnLowDisk", value)
            }
            label="Ставить воркеры на паузу при нехватке диска"
          />

          <Toggle
            value={resources.pauseSlicingOnHighLoad}
            onChange={(value) =>
              patch("infra.resources.pauseSlicingOnHighLoad", value)
            }
            label="Ставить нарезку на паузу при высокой нагрузке"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Лимиты внешних интеграций"
        hint="Отдельные лимиты запросов по сервисам вместо одного общего externalApiRateLimitRps."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Новая Почта, RPS</div>
            <NumberInput
              value={rateLimits.novaPoshtaRps}
              min={0}
              max={1000}
              onChange={(value) =>
                patch("infra.rateLimits.novaPoshtaRps", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Укрпочта, RPS</div>
            <NumberInput
              value={rateLimits.ukrposhtaRps}
              min={0}
              max={1000}
              onChange={(value) =>
                patch("infra.rateLimits.ukrposhtaRps", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Telegram, RPS</div>
            <NumberInput
              value={rateLimits.telegramRps}
              min={0}
              max={1000}
              onChange={(value) =>
                patch("infra.rateLimits.telegramRps", value)
              }
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Платёжный провайдер, RPS</div>
            <NumberInput
              value={rateLimits.paymentProviderRps}
              min={0}
              max={1000}
              onChange={(value) =>
                patch("infra.rateLimits.paymentProviderRps", value)
              }
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Режим технических работ"
        hint="Можно отдельно ограничить каталог, заказы, загрузки, очереди, нарезку и отправку заданий на принтеры."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={maintenance.enabled}
            onChange={(value) => patch("infra.maintenance.enabled", value)}
            label="Включить режим технических работ"
          />

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <Toggle
              value={maintenance.allowCatalogRead}
              onChange={(value) =>
                patch("infra.maintenance.allowCatalogRead", value)
              }
              label="Разрешить чтение каталога"
            />

            <Toggle
              value={maintenance.allowAdminLogin}
              onChange={(value) =>
                patch("infra.maintenance.allowAdminLogin", value)
              }
              label="Разрешить вход в админпанель"
            />

            <Toggle
              value={maintenance.blockCheckout}
              onChange={(value) =>
                patch("infra.maintenance.blockCheckout", value)
              }
              label="Запретить оформление заказа"
            />

            <Toggle
              value={maintenance.blockUploads}
              onChange={(value) =>
                patch("infra.maintenance.blockUploads", value)
              }
              label="Запретить загрузку STL"
            />

            <Toggle
              value={maintenance.pauseQueues}
              onChange={(value) =>
                patch("infra.maintenance.pauseQueues", value)
              }
              label="Поставить очереди на паузу"
            />

            <Toggle
              value={maintenance.pauseSlicing}
              onChange={(value) =>
                patch("infra.maintenance.pauseSlicing", value)
              }
              label="Поставить нарезку на паузу"
            />

            <Toggle
              value={maintenance.pausePrinterDispatch}
              onChange={(value) =>
                patch("infra.maintenance.pausePrinterDispatch", value)
              }
              label="Остановить отправку заданий на принтеры"
            />
          </div>

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Начало технических работ</div>
              <input
                className="input"
                type="datetime-local"
                value={maintenance.startsAt || ""}
                onChange={(event) =>
                  patch("infra.maintenance.startsAt", event.target.value)
                }
              />
            </div>

            <div>
              <div className={styles.inputLabel}>Завершение технических работ</div>
              <input
                className="input"
                type="datetime-local"
                value={maintenance.endsAt || ""}
                onChange={(event) =>
                  patch("infra.maintenance.endsAt", event.target.value)
                }
              />
            </div>
          </div>

          <TextArea
            value={maintenance.message || ""}
            onChange={(value) => patch("infra.maintenance.message", value)}
            rows={3}
            placeholder="Сообщение для пользователей"
          />
        </div>
      </FieldRow>
    </Card>
  );
}