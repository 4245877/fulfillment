// apps/dashboard/src/pages/settings/sections/InfraSection.jsx
import React from "react";
import { Card, FieldRow, Toggle, NumberInput, TextArea } from "../ui.jsx";
import styles from "../../Settings.module.css";

const ROLE_OPTIONS = [
  { value: "api", label: "API" },
  { value: "dashboard", label: "Панель керування" },
  { value: "worker", label: "Загальний воркер" },
  { value: "slicer", label: "Нарізання STL" },
  { value: "media", label: "Медіа / прев’ю" },
  { value: "storage", label: "Сховище STL / G-code" },
  { value: "db", label: "База даних" },
  { value: "cache", label: "Кеш / Redis" },
  { value: "queue", label: "Черги" },
  { value: "search", label: "Пошук / індексація" },
  { value: "printers", label: "Принтери / шлюз ферми" },
  { value: "webhooks", label: "Вебхуки" },
  { value: "edge", label: "Інтернет-фільтр / edge-вузол" },
  { value: "reverse_proxy", label: "Зворотний проксі" },
  { value: "backup", label: "Резервні копії" },
  { value: "monitoring", label: "Моніторинг" },
  { value: "failover", label: "Відмовостійкість / резерв" },
  { value: "replication", label: "Реплікація" },
  { value: "vpn", label: "VPN / захищена мережа" },
];

const NODE_PURPOSE_OPTIONS = [
  { value: "primary", label: "Основний" },
  { value: "standby", label: "Резервний" },
  { value: "support", label: "Допоміжний" },
  { value: "edge", label: "Вхідний вузол / інтернет-фільтр" },
  { value: "worker", label: "Обчислювальний воркер" },
  { value: "storage", label: "Сховище" },
  { value: "other", label: "Інше" },
];

const STORAGE_PROVIDER_OPTIONS = [
  { value: "local", label: "Локальне" },
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
  { value: "database", label: "База даних" },
  { value: "disabled", label: "Вимкнено" },
];

const FAILOVER_MODE_OPTIONS = [
  { value: "manual", label: "Ручний" },
  { value: "semi_auto", label: "Напівавтоматичний" },
  { value: "automatic", label: "Автоматичний" },
];

const FAILOVER_STRATEGY_OPTIONS = [
  { value: "active_standby", label: "Активний + резервний" },
  { value: "active_active", label: "Два активні вузли" },
  { value: "cold_standby", label: "Холодний резерв" },
];

const TLS_TERMINATION_OPTIONS = [
  { value: "edge", label: "На інтернет-фільтрі / edge-вузлі" },
  { value: "app", label: "На сервері застосунку" },
  { value: "external", label: "Зовнішній балансувальник / CDN" },
  { value: "disabled", label: "Вимкнено" },
];

const MAINTENANCE_SERVED_BY_OPTIONS = [
  { value: "edge", label: "Edge-вузол / інтернет-фільтр" },
  { value: "active_app", label: "Активний сервер застосунку" },
  { value: "standby_app", label: "Резервний сервер застосунку" },
  { value: "disabled", label: "Не показувати сторінку технічних робіт" },
];

const REPLICATION_MODE_OPTIONS = [
  { value: "async", label: "Асинхронна" },
  { value: "sync", label: "Синхронна" },
  { value: "semi_sync", label: "Напівсинхронна" },
  { value: "snapshot", label: "Знімок" },
  { value: "manual", label: "Ручна" },
  { value: "disabled", label: "Вимкнено" },
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
  const name = node.name || "Без назви";

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

  const renderNodeSelect = (value, onChange, placeholder = "Не вибрано") => (
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
      title="3) Інфраструктура"
      sub="Вузли, вхідний трафік, відмовостійкість, реплікація, сховище, воркери, пошук, ресурси та режим технічних робіт"
    >
      <FieldRow
        label="Вузли"
        hint="Фізичні або віртуальні сервери. Призначення сервера зберігається окремо від технічних ролей."
      >
        <div className={styles.inputGroup}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Назва</th>
                  <th>Призначення</th>
                  <th>Ролі</th>
                  <th>Хост</th>
                  <th>Статус</th>
                  <th>Диск</th>
                  <th>Завдання</th>
                  <th>Дії</th>
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
                            Видалити
                          </button>
                        </td>
                      </tr>

                      <tr>
                        <td colSpan={8}>
                          <details>
                            <summary>Деталі вузла</summary>

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
                                    Пріоритет
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
                                    Майданчик
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
                                    URL перевірки стану
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
                                    Публічний хост
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
                                    Внутрішній хост
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
                                  label="Вузол увімкнено"
                                />

                                <Toggle
                                  value={node.canBePromoted === true}
                                  onChange={(value) =>
                                    updateNode(index, {
                                      canBePromoted: value,
                                    })
                                  }
                                  label="Можна зробити активним"
                                />

                                <Toggle
                                  value={node.isTrafficEntry === true}
                                  onChange={(value) =>
                                    updateNode(index, {
                                      isTrafficEntry: value,
                                    })
                                  }
                                  label="Вхідна точка трафіку"
                                />
                              </div>

                              <div>
                                <div className={styles.inputLabel}>Ролі</div>
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
                                    Остання перевірка
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
                                    Версія
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
                                    Вільний диск, ГБ
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
                                    Затримка черги
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
                                placeholder="Нотатки щодо сервера"
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
                  name: "Новий вузол",
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
            Додати вузол
          </button>
        </div>
      </FieldRow>

      <FieldRow
        label="Трафік і вхідна точка"
        hint="Шлях користувача: інтернет-фільтр → активний сервер застосунку. У разі аварії активний сервер можна замінити резервним."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Вхідний вузол</div>
            {renderNodeSelect(traffic.entryNodeId, (value) =>
              patch("infra.traffic.entryNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>
              Активний сервер застосунку
            </div>
            {renderNodeSelect(traffic.activeAppNodeId, (value) =>
              patch("infra.traffic.activeAppNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>
              Резервний сервер застосунку
            </div>
            {renderNodeSelect(traffic.standbyAppNodeId, (value) =>
              patch("infra.traffic.standbyAppNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>Публічний домен</div>
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
            <div className={styles.inputLabel}>Завершення TLS</div>
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
            <div className={styles.inputLabel}>Сторінка технічних робіт</div>
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
            label="Дозволити прямий доступ до сервера застосунку"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Відмовостійкість"
        hint="Для початку безпечніше ручне перемикання: автоматичне перемикання без надійної реплікації БД може створити більше проблем."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={failover.enabled === true}
            onChange={(value) => patch("infra.failover.enabled", value)}
            label="Увімкнути відмовостійкість"
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
              <div className={styles.inputLabel}>Стратегія</div>
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
              <div className={styles.inputLabel}>Основний вузол</div>
              {renderNodeSelect(failover.primaryNodeId, (value) =>
                patch("infra.failover.primaryNodeId", value),
              )}
            </div>

            <div>
              <div className={styles.inputLabel}>Резервний вузол</div>
              {renderNodeSelect(failover.standbyNodeId, (value) =>
                patch("infra.failover.standbyNodeId", value),
              )}
            </div>

            <div>
              <div className={styles.inputLabel}>Вхідний вузол трафіку</div>
              {renderNodeSelect(failover.trafficEntryNodeId, (value) =>
                patch("infra.failover.trafficEntryNodeId", value),
              )}
            </div>

            <div>
              <div className={styles.inputLabel}>Інтервал перевірки, с</div>
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
                Помилок до статусу недоступності
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
              <div className={styles.inputLabel}>RTO, хв</div>
              <NumberInput
                value={failover.rtoMinutes}
                min={0}
                max={10080}
                onChange={(value) => patch("infra.failover.rtoMinutes", value)}
              />
            </div>

            <div>
              <div className={styles.inputLabel}>RPO, хв</div>
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
              label="Автоматично робити резервний вузол активним"
            />

            <Toggle
              value={failover.requireManualApproval !== false}
              onChange={(value) =>
                patch("infra.failover.requireManualApproval", value)
              }
              label="Вимагати ручного підтвердження"
            />
          </div>

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Останнє перемикання</div>
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
            placeholder="Причина останнього перемикання"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Реплікація"
        hint="Окремо налаштовуються база даних, файли, пошуковий індекс, налаштування та черги."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={replication.enabled === true}
            onChange={(value) => patch("infra.replication.enabled", value)}
            label="Увімкнути реплікацію"
          />

          <details open>
            <summary>База даних</summary>

            <div className={`${styles.inputGrid2} ${styles.max720}`}>
              <Toggle
                value={replication.database?.enabled === true}
                onChange={(value) =>
                  patch("infra.replication.database.enabled", value)
                }
                label="Реплікувати БД"
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
                <div className={styles.inputLabel}>Вузол-джерело</div>
                {renderNodeSelect(replication.database?.sourceNodeId, (value) =>
                  patch("infra.replication.database.sourceNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Цільовий вузол</div>
                {renderNodeSelect(replication.database?.targetNodeId, (value) =>
                  patch("infra.replication.database.targetNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Макс. затримка, с</div>
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
            <summary>Файли</summary>

            <div className={`${styles.inputGrid2} ${styles.max720}`}>
              <Toggle
                value={replication.files?.enabled === true}
                onChange={(value) =>
                  patch("infra.replication.files.enabled", value)
                }
                label="Реплікувати файли"
              />

              <div>
                <div className={styles.inputLabel}>Вузол-джерело</div>
                {renderNodeSelect(replication.files?.sourceNodeId, (value) =>
                  patch("infra.replication.files.sourceNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Цільовий вузол</div>
                {renderNodeSelect(replication.files?.targetNodeId, (value) =>
                  patch("infra.replication.files.targetNodeId", value),
                )}
              </div>

              <div>
                <div className={styles.inputLabel}>Інтервал, хв</div>
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
                label="Зображення та медіа"
              />

              <Toggle
                value={replication.files?.includeSettings === true}
                onChange={(value) =>
                  patch("infra.replication.files.includeSettings", value)
                }
                label="Налаштування"
              />
            </div>
          </details>

          <details>
            <summary>Пошуковий індекс і черги</summary>

            <div className={`${styles.inputGrid2} ${styles.max720}`}>
              <Toggle
                value={replication.searchIndex?.rebuildOnPromote !== false}
                onChange={(value) =>
                  patch("infra.replication.searchIndex.rebuildOnPromote", value)
                }
                label="Перебудовувати індекс під час перемикання на резервний вузол"
              />

              <Toggle
                value={replication.searchIndex?.replicateIndex === true}
                onChange={(value) =>
                  patch("infra.replication.searchIndex.replicateIndex", value)
                }
                label="Реплікувати пошуковий індекс"
              />

              <Toggle
                value={replication.queues?.replicatePendingJobs === true}
                onChange={(value) =>
                  patch("infra.replication.queues.replicatePendingJobs", value)
                }
                label="Реплікувати завдання в очікуванні"
              />

              <Toggle
                value={replication.queues?.replaySafeOnly !== false}
                onChange={(value) =>
                  patch("infra.replication.queues.replaySafeOnly", value)
                }
                label="Повторювати лише безпечні завдання"
              />
            </div>
          </details>
        </div>
      </FieldRow>

      <FieldRow
        label="Зв’язок із резервними копіями"
        hint="Тут лише топологія резервних копій. Розклад, строк зберігання, експорт і архіви краще залишити в розділі «Резервні копії»."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Вузол резервних копій</div>
            {renderNodeSelect(backupTopology.backupNodeId, (value) =>
              patch("infra.backupTopology.backupNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>Основний вузол для резервної копії</div>
            {renderNodeSelect(backupTopology.backupPrimaryNodeId, (value) =>
              patch("infra.backupTopology.backupPrimaryNodeId", value),
            )}
          </div>

          <div>
            <div className={styles.inputLabel}>Резервний вузол для резервної копії</div>
            {renderNodeSelect(backupTopology.backupStandbyNodeId, (value) =>
              patch("infra.backupTopology.backupStandbyNodeId", value),
            )}
          </div>

          <Toggle
            value={backupTopology.monitorBackups !== false}
            onChange={(value) =>
              patch("infra.backupTopology.monitorBackups", value)
            }
            label="Моніторити стан резервних копій"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Сховище файлів"
        hint="STL, G-code, зображення, прев’ю, тимчасові файли та захист від дублікатів."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Тип сховища</div>
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
            <div className={styles.inputLabel}>Макс. розмір STL, МБ</div>
            <NumberInput
              value={storage.maxStlFileMb}
              min={1}
              max={100000}
              onChange={(value) => patch("infra.storage.maxStlFileMb", value)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Макс. розмір архіву, МБ</div>
            <NumberInput
              value={storage.maxArchiveMb}
              min={1}
              max={100000}
              onChange={(value) => patch("infra.storage.maxArchiveMb", value)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>TTL тимчасових файлів, год</div>
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
            <div className={styles.inputLabel}>Мін. вільний диск, ГБ</div>
            <NumberInput
              value={storage.minFreeDiskGb}
              min={0}
              max={100000}
              onChange={(value) => patch("infra.storage.minFreeDiskGb", value)}
            />
          </div>

          <div>
            <div className={styles.inputLabel}>Контрольна сума</div>
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
            label="Зберігати G-code після нарізання"
          />

          <Toggle
            value={storage.enableDeduplication}
            onChange={(value) =>
              patch("infra.storage.enableDeduplication", value)
            }
            label="Увімкнути дедуплікацію STL"
          />

          <Toggle
            value={storage.enableChecksum !== false}
            onChange={(value) => patch("infra.storage.enableChecksum", value)}
            label="Перевіряти контрольні суми файлів"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Нарізання STL"
        hint="Підготовка G-code, розрахунок витрати пластику та важкі завдання воркерів слайсера."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={slicing.enabled}
            onChange={(value) => patch("infra.slicing.enabled", value)}
            label="Увімкнути нарізання STL"
          />

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Макс. паралельних завдань</div>
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
              <div className={styles.inputLabel}>Тайм-аут, хв</div>
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
              <div className={styles.inputLabel}>Профіль за замовчуванням</div>
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
              label="Зберігати артефакти невдалого нарізання"
            />

            <Toggle
              value={slicing.autoSliceOnProductImport}
              onChange={(value) =>
                patch("infra.slicing.autoSliceOnProductImport", value)
              }
              label="Автонарізання під час імпорту товару"
            />

            <Toggle
              value={slicing.autoSliceBeforePrint}
              onChange={(value) =>
                patch("infra.slicing.autoSliceBeforePrint", value)
              }
              label="Автонарізання перед друком"
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Воркери та черги"
        hint="Окремі ліміти за типами фонових завдань."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Імпорт товарів</div>
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
            <div className={styles.inputLabel}>Нарізання STL</div>
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
            <div className={styles.inputLabel}>Медіа / прев’ю</div>
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
            <div className={styles.inputLabel}>Індексація пошуку</div>
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
            <div className={styles.inputLabel}>Синхронізація залишків</div>
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
        label="Пошук та індексація"
        hint="Підготовка до каталогу на сотні тисяч товарів."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={search.enabled}
            onChange={(value) => patch("infra.search.enabled", value)}
            label="Увімкнути пошук"
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
              <div className={styles.inputLabel}>Розмір пакета</div>
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
                Паралельність переіндексації
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
              label="Автоіндексація під час зміни товару"
            />

            <Toggle
              value={search.rebuildIndexAllowed}
              onChange={(value) =>
                patch("infra.search.rebuildIndexAllowed", value)
              }
              label="Дозволити повну перебудову індексу"
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Обмеження ресурсів"
        hint="Захист від перевантаження CPU, RAM і переповнення диска тимчасовими файлами."
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
            <div className={styles.inputLabel}>Мін. вільний диск, ГБ</div>
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
            label="Ставити воркери на паузу за нестачі диска"
          />

          <Toggle
            value={resources.pauseSlicingOnHighLoad}
            onChange={(value) =>
              patch("infra.resources.pauseSlicingOnHighLoad", value)
            }
            label="Ставити нарізання на паузу за високого навантаження"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Ліміти зовнішніх інтеграцій"
        hint="Окремі ліміти запитів за сервісами замість одного загального externalApiRateLimitRps."
      >
        <div className={`${styles.inputGrid2} ${styles.max720}`}>
          <div>
            <div className={styles.inputLabel}>Нова Пошта, RPS</div>
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
            <div className={styles.inputLabel}>Укрпошта, RPS</div>
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
            <div className={styles.inputLabel}>Платіжний провайдер, RPS</div>
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
        label="Режим технічних робіт"
        hint="Можна окремо обмежити каталог, замовлення, завантаження, черги, нарізання та надсилання завдань на принтери."
      >
        <div className={styles.inputGroup}>
          <Toggle
            value={maintenance.enabled}
            onChange={(value) => patch("infra.maintenance.enabled", value)}
            label="Увімкнути режим технічних робіт"
          />

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <Toggle
              value={maintenance.allowCatalogRead}
              onChange={(value) =>
                patch("infra.maintenance.allowCatalogRead", value)
              }
              label="Дозволити читання каталогу"
            />

            <Toggle
              value={maintenance.allowAdminLogin}
              onChange={(value) =>
                patch("infra.maintenance.allowAdminLogin", value)
              }
              label="Дозволити вхід в адмінпанель"
            />

            <Toggle
              value={maintenance.blockCheckout}
              onChange={(value) =>
                patch("infra.maintenance.blockCheckout", value)
              }
              label="Заборонити оформлення замовлення"
            />

            <Toggle
              value={maintenance.blockUploads}
              onChange={(value) =>
                patch("infra.maintenance.blockUploads", value)
              }
              label="Заборонити завантаження STL"
            />

            <Toggle
              value={maintenance.pauseQueues}
              onChange={(value) =>
                patch("infra.maintenance.pauseQueues", value)
              }
              label="Поставити черги на паузу"
            />

            <Toggle
              value={maintenance.pauseSlicing}
              onChange={(value) =>
                patch("infra.maintenance.pauseSlicing", value)
              }
              label="Поставити нарізання на паузу"
            />

            <Toggle
              value={maintenance.pausePrinterDispatch}
              onChange={(value) =>
                patch("infra.maintenance.pausePrinterDispatch", value)
              }
              label="Зупинити надсилання завдань на принтери"
            />
          </div>

          <div className={`${styles.inputGrid2} ${styles.max720}`}>
            <div>
              <div className={styles.inputLabel}>Початок технічних робіт</div>
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
              <div className={styles.inputLabel}>Завершення технічних робіт</div>
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
            placeholder="Повідомлення для користувачів"
          />
        </div>
      </FieldRow>
    </Card>
  );
}