# Claude red-team audit — AG Grid IoT Interview Lab

Независимый adversarial-аудит решения, созданного Codex. Production-код в audit-ветке не изменялся. Все находки воспроизведены или подтверждены исходным кодом установленной версии AG Grid 36.1.0; гипотезы без доказательства перечислены отдельно как отклонённые.

## 1. Executive Summary

Приложение запускается, проходит lint/typecheck/unit/build, корректно использует современный AG Grid 36 (Theming API, объектный `rowSelection`, `getRowId` + `applyTransactionAsync`, контракт Infinite datasource, Grid State) и остаётся строго Community. Большинство сценариев Live Telemetry, Device Configuration и Analytics выдержали атаку: таймеры очищаются, ID стабильны, сортировка и фильтр корректны под потоком, валидация и dirty-state работают, XSS и formula injection недостижимы, `npm audit` чистый.

Однако найден **один P1**: Historical Logs можно навсегда перевести в состояние «Loading…»/пустого грида обычными действиями (быстрая смена сортировки/фильтра + смена размера или latency во время запроса) — datasource не завершает отменённые запросы, и AG Grid теряет слоты `maxConcurrentDatasourceRequests`. Восстановление только уходом с вкладки.

Плюс **восемь P2**: устаревший баннер ошибки после успешного Retry, потеря нажатий в Device filter, неработающая тёмная тема гридов, потеря всего сохранённого вида Configuration при фильтре по boolean-колонке, падение всего приложения от повреждённого сохранённого фильтра, flaky интеграционные тесты, тесты, не защищающие ключевые заявленные свойства (16 из 26 мутаций выживают), и 10+ секунд на первую отсортированную страницу 500k из-за yield через `setTimeout(0)`.

## 2. Verdict

**READY WITH FIXES.**

Лаб пригоден как основа для интервью, но перед живой демонстрацией нужно исправить F-01 (зависание Historical Logs) и F-04/F-05/F-06 — они проявляются именно в тех сценариях, которые README предлагает показать («simulate a failure and retry», «filter a device», тёмная тема).

## 3. Codex baseline

| Параметр                  | Значение                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Исходное состояние        | ветка `feat/iot-interview-lab`, коммитов нет; 54 файла приложения в состоянии intent-to-add, файлы Rig untracked |
| Признаки завершённости    | README/документы полные, все проверки зелёные, незавершённых TODO в `src` нет                                    |
| Baseline-коммит Rig 0.8.0 | `5a7ba85` — `chore: capture agent rig 0.8.0 install baseline`                                                    |
| Baseline-коммит Codex     | `c5b96b7` — `chore: capture codex implementation baseline`                                                       |
| Проверки до коммита       | `format:check` 0 · `lint` 0 · `typecheck` 0 · `test` 0 (9 файлов / 40 тестов) · `build` 0                        |
| Секреты                   | не найдены (скан рабочей копии и 164 tracked-файлов)                                                             |

## 4. Rig upgrade

| Параметр             | Значение                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Стабильная версия    | `create-agent-rig` **0.8.0** (npm `gitHead` `870f9a3ecae2881908ece8ec3e2ac13f84f505f5`), manifest `kind: init`                                                         |
| Исходный репозиторий | `https://github.com/serhii-baksheiev/create-agent-rig.git`                                                                                                             |
| Локальный checkout   | `C:\Users\SerhiiBaksheiev\Documents\create-agent-rig` найден, remote корректный, но содержит untracked-файлы и 7 worktree → использован чистый clone `%TEMP%\car-src`  |
| Ветка                | `master` (ветки `main` в remote нет; `HEAD → refs/heads/master`)                                                                                                       |
| Source SHA           | `8b96025e995c7431cdad3407f14a68b02ae53114` (`8b96025`), 2026-09-10 12:18:20 +0400, `fix(preflight): require a readable configured queue (RP-56) (#204)`, дерево чистое |
| Дельта от 0.8.0      | 49 коммитов; версия в `package.json` не менялась (0.8.0) — provenance фиксируется по SHA                                                                               |
| Package manager      | `pnpm@11.16.0` через corepack 0.35.0; `engines.node >=20`                                                                                                              |

### Gate source Rig

| Команда                                                                                                                  | Результат                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile`                                                                                | exit 0, 8.8 s                                                                                                                                |
| `corepack pnpm run build`                                                                                                | exit 0, 3.0 s                                                                                                                                |
| `corepack pnpm run typecheck`                                                                                            | exit 0, 10.0 s                                                                                                                               |
| `corepack pnpm run lint`                                                                                                 | exit 0, 15.9 s                                                                                                                               |
| `corepack pnpm test` (build + unit/template/e2e, полный параллелизм)                                                     | **exit 1**, 1103 s: 287 failed / 3583 passed / 19 skipped; 222 из них — таймауты                                                             |
| Повтор 27 упавших файлов в режиме CI (`vitest run --project unit --project template --testTimeout=15000 --maxWorkers=2`) | **exit 1**, 1276 s: 46 failed / 1431 passed / 14 skipped; 42 таймаута, набор упавших тестов меняется между прогонами                         |
| Изоляция `--maxWorkers=1`: `codex.test.ts`                                                                               | 0.8.0: 73 passed · master: 79 passed — **exit 0 на обоих**                                                                                   |
| Изоляция `--maxWorkers=1`: `queue-revalidation.test.ts`                                                                  | 0.8.0 и master: 1 failed / 23 passed, **идентичное** падение (`queue-revalidation.test.ts:583`, код выхода CLI 1 вместо 0)                   |
| GitHub check-runs для `8b96025`                                                                                          | `ci` (ubuntu, unit) success · `windows-unit` success · `e2e` success · `template-*` success · `windows-e2e` failure → success на перезапуске |

**Решение: применить.** Падения локального прогона доказуемо средовые: (1) доминируют таймауты под нагрузкой (параллельно работали 6 аудиторских субагентов и браузерные нагрузочные тесты; stage-диагностика тестов показывает запуск CLI-процессов 10–82 с при сборке stub-ов за 4–10 мс); (2) единственные повторяющиеся assertion-падения проходят в изоляции (`codex.test.ts`) или воспроизводятся идентично на уже установленной стабильной 0.8.0 (`queue-revalidation`), то есть не являются регрессией `main`; (3) upstream CI зелёный на Linux и Windows для этого SHA. Остаточный риск: `loop`-команда записи outcome на этой Windows-машине возвращает 1 — касается только unattended-циклов, которые в проекте не используются; риск тот же, что и у текущей 0.8.0.

### Dry-run и применение

```
upgrade --dry-run:  12 to replace, 0 new, 0 yours (kept), 68 already current
upgrade --yes:      12 to replace, 0 new, 0 yours (kept), 68 already current — Wrote 12 files.
```

Заменены: `.claude/hooks/lib/edit-input.mjs`, `.claude/skills/loop/SKILL.md`, `.agents/skills/loop/SKILL.md`, `.codex/agents/{test-writer,code-reviewer,security-scanner,prose-reviewer}.toml`, `.claude/scripts/{unattended-flag,preflight}.mjs`, `.claude/scripts/queue/{index,gate-rounds}.mjs`, `docs/decisions/codex-adapter.md`, плюс `.claude/.rig-manifest.json`.

Конфликтов нет. `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, `.codex/hooks.json`, `src/`, `e2e/`, `package*.json`, AG Grid skills — не изменены. Абсолютных путей и секретов в diff нет.

### Проверки после upgrade

| Проверка                                                             | Результат                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node .claude/scripts/doctor.mjs`                                    | verdict **GO**, 6/6 хуков `pass`                                                                                                                          |
| `node --check` пяти обновлённых `.mjs`                               | exit 0                                                                                                                                                    |
| Все хуки из `.claude/settings.json` и `.codex/hooks.json` существуют | да                                                                                                                                                        |
| Smoke `guard-secret-file` через новый `edit-input.mjs`               | чистый Write → 0; credential → 2; строковый `tool_input` → 2 («cannot safely inspect», новое поведение RP-85); отсутствующий `tool_input` → 0 (fail-open) |
| `npx skills ls -a codex -a claude-code`                              | `ag-dev`, `ag-update` (source `ag-grid/skills`) + 5 локальных skills, для Claude Code и Codex                                                             |
| Приложение после upgrade                                             | `format:check` 0 · `lint` 0 · `typecheck` 0 · `test` 0 (9 файлов / 40 тестов) · `build` 0 (основной checkout, после upgrade)                              |
| Результирующий baseline                                              | `b406f07b40a2dc464ba2cb241293ad8977bbf654` — `chore: upgrade agent rig from main at 8b96025`                                                              |

## 5. Environment

| Параметр                                        | Значение                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ОС                                              | Windows 11 Enterprise 10.0.26200, Intel Core Ultra 7 165H, 22 логических CPU                                               |
| Node.js / npm                                   | v24.18.0 / 11.3.0 (приложение: `npm ci`, `package-lock.json` v3, 274 записи)                                               |
| Браузер                                         | Chrome 152 (chrome-devtools MCP), изолированные контексты                                                                  |
| React / TypeScript / Vite / Vitest / Playwright | 19.3.0 / 6.0.3 / 8.3.0 / 5.0.0 / 1.63.0                                                                                    |
| AG Grid                                         | `ag-grid-community` 36.1.0, `ag-grid-react` 36.1.0 (транзитивно `ag-stack`, `ag-charts-types`); Enterprise-пакетов нет     |
| Запуск                                          | dev: `npm run dev` (127.0.0.1:5173, StrictMode + dev validations); prod: `npm run build` + `vite preview` (127.0.0.1:4173) |
| Ветка аудита                                    | `audit/claude-red-team` (worktree `.claude/worktrees/audit-claude-red-team`)                                               |

## 6. Commands and results

Все команды выполнены в audit-worktree `.claude/worktrees/audit-claude-red-team` на `b406f07` (ветка `audit/claude-red-team`), Node v24.18.0.

| Команда                                                                                                    | Exit  | Время                           | Результат                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----- | ------------------------------- | ----------------------------------------------------------------------------------- |
| `npm ci`                                                                                                   | 0     | 30.3 s                          | added 274 packages, found 0 vulnerabilities                                         |
| `npm ls ag-grid-community ag-grid-react react react-dom typescript vite vitest @playwright/test --depth=0` | 0     | 1.4 s                           | 36.1.0 / 36.1.0 / 19.3.0 / 19.3.0 / 6.0.3 / 8.3.0 / 5.0.0 / 1.63.0                  |
| `npm run format:check`                                                                                     | 0     | 2.5 s                           | All matched files use Prettier code style                                           |
| `npm run lint`                                                                                             | 0     | 11.9 s                          | без ошибок и предупреждений                                                         |
| `npm run typecheck`                                                                                        | 0     | 5.1 s                           | без ошибок                                                                          |
| `npm run test:unit`                                                                                        | 0     | 5.9 s                           | 8 файлов / 36 тестов                                                                |
| `npm run test:integration` ×5                                                                              | 0 ×5  | 17.9 / 7.5 / 8.9 / 9.9 / 10.8 s | 4/4 в каждом прогоне                                                                |
| `npm test` ×2                                                                                              | 0 ×2  | 17.5 / 15.7 s                   | 9 файлов / 40 тестов                                                                |
| `npm run build`                                                                                            | 0     | 7.8 s                           | JS 1,370.96 kB (gzip 389.92 kB), CSS 12.44 kB; предупреждение Vite о чанке > 500 kB |
| `npx playwright --version` / `npx playwright install chromium`                                             | 0 / 0 | 2.2 / 3.1 s                     | Version 1.63.0                                                                      |
| `npm run test:e2e`                                                                                         | 0     | 53.8 s                          | 12 passed (52.1 s), 1 worker                                                        |
| `npm audit --omit=dev`                                                                                     | 0     | 1.8 s                           | found 0 vulnerabilities                                                             |
| `npm audit`                                                                                                | 0     | 1.3 s                           | found 0 vulnerabilities                                                             |
| `git grep` по шаблонам AWS/GitHub/OpenAI/Slack-токенов, private key, licenseKey, password-литералов        | 1     | —                               | совпадений нет (164 tracked-файла); файлов `.env`, `.pem`, `.key`, `id_rsa` нет     |

Дополнительно:

| Прогон                                                                                                            | Результат                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Основной checkout до baseline-коммитов                                                                            | format:check, lint, typecheck, test (40), build — exit 0                                                                     |
| Основной checkout после upgrade Rig                                                                               | format:check, lint, typecheck, test (40), build — exit 0                                                                     |
| Source Rig                                                                                                        | см. раздел 4                                                                                                                 |
| Браузерные сценарии (dev и prod), инструментированные `console.error`/`console.warn`/`error`/`unhandledrejection` | 0 ошибок, 0 unhandled rejections, 0 предупреждений AG Grid (кроме ожидаемого #62 на намеренно подложенных неизвестных colId) |
| Node-проверка `deserializeState` на 10 входах                                                                     | см. F-02, F-03 и раздел 9                                                                                                    |
| Мутационное тестирование (26 мутаций, изолированная копия)                                                        | см. раздел 14                                                                                                                |

Не выполнено (ограничения аудита):

- проверка screen reader (NVDA/JAWS/VoiceOver) и реального zoom 400% — только эмуляция 320 px и статический анализ;
- браузеры кроме Chromium (Firefox, Safari);
- многочасовая нагрузка и heap-снимки на длительном потоке — утечки исключались инструментированием таймеров, статическим анализом и Node-замерами heap;
- clipboard/range selection — Enterprise, в Community недоступны;
- реальный Ctrl+Z в 450-миллисекундном окне сохранения (F-12 подтверждён через тот же API сервиса undo).

## 7. Coverage matrix

| Область                                                                                                                                                                                                              | Метод                                                                          | Покрытие                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| Первичная загрузка, все экраны, переключение вкладок                                                                                                                                                                 | браузер dev+prod, инструментированные `setInterval`/console/unhandledrejection | полное                               |
| Live Telemetry: 100/1k/10k, 100–1000 ms, 1000 changes, burst, pause/resume ×21, reset, смена размера на ходу, сортировка/фильтр под потоком, unmount/remount                                                         | браузер + long-task/lag probe                                                  | полное                               |
| Historical Logs: 10k/100k/500k, хвостовой блок, быстрые фильтры, сортировка во время pending, error/Retry/Refresh, смена датасета/latency/вкладки во время pending, пустой результат, Reset State, request inspector | браузер + эталон через `telemetryAt`                                           | полное                               |
| Device Configuration: все редакторы, границы чисел, пороги, dirty-state, Save/Revert selected/all, двойной Save, edit/undo во время Save, failed save, Add/Delete/Cancel, возврат с вкладки                          | браузер (реальные редакторы через API AG Grid)                                 | полное, кроме clipboard (Enterprise) |
| Analytics: группы, диаграмма vs данные, Save/Restore/Reset view                                                                                                                                                      | браузер                                                                        | полное                               |
| Grid State / localStorage: 7 видов мусора × 3 грида, boolean-фильтр, пустые `conditions`, reload                                                                                                                     | браузер + Node (`deserializeState`)                                            | полное                               |
| Тёмная тема, 320 px, 911×512, Tab-навигация                                                                                                                                                                          | браузер                                                                        | выборочно                            |
| Security                                                                                                                                                                                                             | статический анализ, Node-харнессы, dynamic XSS payload, `npm audit`            | полное                               |
| AG Grid API / licensing                                                                                                                                                                                              | исходники 36.1.0 в `node_modules`, `ag-dev` skill                              | полное                               |
| Performance                                                                                                                                                                                                          | браузер prod + Node-бенчмарки (медиана ≥5) + trace                             | полное                               |
| Accessibility                                                                                                                                                                                                        | статический анализ + вычисленный контраст + браузер                            | без screen reader                    |
| Тесты                                                                                                                                                                                                                | 3+ прогона, мутационное тестирование (26 мутаций) в изолированной копии        | полное                               |
| Документация / интервью                                                                                                                                                                                              | сверка всех 8 документов с кодом                                               | полное                               |

## 8. Confirmed findings

Сводка: **P0 — 0 · P1 — 1 · P2 — 8 · P3 — 10.**

| ID   | Severity | Category            | Название                                                                                      |
| ---- | -------- | ------------------- | --------------------------------------------------------------------------------------------- |
| F-01 | P1       | RACE                | Historical Logs навсегда зависает: datasource теряет слоты конкурентных запросов              |
| F-02 | P2       | CORRECTNESS         | Сохранённый фильтр с пустым `conditions` роняет всё приложение без пути восстановления        |
| F-03 | P2       | CORRECTNESS         | Фильтр по boolean-колонке Enabled стирает весь сохранённый вид Configuration                  |
| F-04 | P2       | CORRECTNESS         | Баннер ошибки остаётся после успешного Retry / Refresh cache                                  |
| F-05 | P2       | RACE                | Device filter теряет нажатия: асинхронный `stateUpdated` перезаписывает ввод                  |
| F-06 | P2       | AG-GRID-API         | Тёмная тема не применяется к гридам                                                           |
| F-07 | P2       | TESTING             | Интеграционные тесты сохранения нестабильны                                                   |
| F-08 | P2       | TESTING             | Ключевые заявленные свойства не защищены тестами (16/26 мутаций выживают)                     |
| F-09 | P2       | PERFORMANCE         | Отсортированная выборка 500k: >10 с, из которых ~95% — ожидание `setTimeout(0)`               |
| F-10 | P3       | PERFORMANCE         | Reset data / смена размера на 10k блокирует main thread 0.6–1.0 с                             |
| F-11 | P3       | PERFORMANCE         | Смена Network latency выбрасывает готовый индекс и пересчитывает выборку                      |
| F-12 | P3       | CORRECTNESS         | Undo во время сохранения безвозвратно расходует запись undo                                   |
| F-13 | P3       | ACCESSIBILITY       | Недостаточный контраст в светлой теме                                                         |
| F-14 | P3       | ACCESSIBILITY       | Поповер Columns обрезается на ширине 320 px                                                   |
| F-15 | P3       | ACCESSIBILITY       | ARIA-семантика: шумные live-регионы, неработающие имена гридов, фокус на деструктивной кнопке |
| F-16 | P3       | DOCUMENTATION       | Локальные неточности документации                                                             |
| F-17 | P3       | INTERVIEW-READINESS | Упражнения 2, 3, 4 в LIVE_CODING_TASKS ломают приложение или указывают не ту ветку кода       |
| F-18 | P3       | TESTING             | Слабые места E2E-сценариев                                                                    |
| F-19 | P3       | RIG-INTEGRATION     | Пробелы интеграции Rig: DoD-gate пуст, upgrade молча пропускает новый файл                    |

---

## [P1][RACE] F-01. Historical Logs навсегда зависает: datasource теряет слоты конкурентных запросов

Status: Confirmed
Confidence: High
Component: Historical Logs — Infinite Row Model datasource
Affected files: `src/features/historical-logs/datasource.ts:79-82`, `:93-96`, `:103-106`, `:119-128`; `src/features/historical-logs/HistoricalLogs.tsx:88-98`, `:243-246`
Environment: prod build (`vite preview`) и dev, Chrome 152, AG Grid 36.1.0

### Impact

Грид истории навсегда остаётся в «Loading…» или пустым; Refresh cache, Retry, смена latency, фильтры и новый datasource не помогают. Единственный выход — уйти с вкладки и вернуться. Метрики и request inspector показывают устаревшие данные уничтоженного datasource (`pending: 1`, «loading»). Это ключевой экран, который README предлагает демонстрировать.

### Preconditions

Запрос блока находится в полёте (любая latency > 0, включая значение по умолчанию 250 ms), и в это время происходит смена сигнатуры запроса (сортировка/фильтр) или пересоздание datasource (Dataset size / Network latency).

### Reproduction

Сценарий A (детерминированный):

1. Historical Logs, дождаться строк.
2. Network latency → 1500 ms.
3. В течение 1.5 с дважды сменить Dataset size (например, 10,000 → 500,000).

Сценарий B (реалистичный, latency по умолчанию 250 ms):

1. Дважды быстро кликнуть заголовок любой сортируемой колонки (asc → desc за <250 ms) — один запрос становится `cancelled`.
2. Нажать Refresh cache и сразу сменить Dataset size.

### Expected

Каждый вызов `getRows` завершается ровно одним `successCallback` или `failCallback`; новый datasource загружает первый блок.

### Actual

Сценарий A: через 8 с и после Refresh cache / latency 0 / нового фильтра — `row0: false`, метрики `["—","1"]`, оверлей `Loading...`; после ремаунта вкладки строки загружаются за 422 ms.
Сценарий B: через 8 с и после Refresh cache — `row0: false`, «Matching records 100,000» при выбранных 10,000, инспектор навсегда показывает `#4 [0–200) · loading`.

### Evidence

- Браузерный прогон (prod, `127.0.0.1:4173`), JSON-снимки состояния `A_after8s`, `A_afterRefreshCache`, `A_afterLatency0`, `A_afterFilter`, `A_afterRemount`, `B_afterDoubleSort`, `B_after8s`, `B_afterRefreshCache`.
- Отдельный прогон: после 5 быстрых смен фильтра (грид остался жив, но с одним свободным слотом) purge + смена размера на 500k → `pending: 1` более 60 с.
- AG Grid 36.1.0, `node_modules/ag-grid-community/dist/package/main.esm.mjs`: `RowNodeBlockLoader` — один bean на грид (`:52648`); счётчик `activeBlockLoadsCount` уменьшается только в `loadComplete` (`:52600`), который вызывается лишь из success/fail-колбэков блока; `checkBlockToLoad` прекращает загрузку при `activeBlockLoadsCount >= maxConcurrentRequests` (`:52615`).

### Root cause

`datasource.ts` на путях «устаревшее поколение» и «datasource уничтожен» делает `return` без вызова `params.successCallback`/`params.failCallback`. AG Grid считает такой запрос активным навсегда. Смена фильтра/сортировки во время запроса теряет один из двух слотов (`maxConcurrentDatasourceRequests={2}`); пересоздание datasource при занятом слоте (effect cleanup → `destroy()`) теряет следующий. После этого `getRows` больше не вызывается. `onStatus` уничтоженного datasource подавлен, поэтому UI замирает на последнем статусе (`pending: 1, total: undefined` → `loading=true`).

### Recommended fix

1. На всех путях отмены вызывать `params.failCallback()` (для устаревшего блока AG Grid только освободит слот — версия блока уже не совпадает).
2. При замене datasource сбрасывать `status` в `initialStatus`.
3. Не пересоздавать datasource при смене latency (см. F-11) — latency читать из ref.

### Regression test

Unit (fake timers): `getRows(A)` → `getRows(B)` с другим `filterModel` до истечения задержки → `destroy()` при ещё одном pending-запросе; ожидать, что каждый из трёх `params` получил ровно один success/fail-колбэк. E2E: сценарий B, затем проверка, что первая ячейка загрузилась в пределах разумного таймаута.

---

## [P2][CORRECTNESS] F-02. Сохранённый фильтр с пустым `conditions` роняет всё приложение без пути восстановления

Status: Confirmed
Confidence: High
Component: Grid State persistence
Affected files: `src/shared/grid/storage.ts:25-31`, `:128-141`; `src/shared/grid/useGridState.ts:10-13`; `src/shared/ui/ErrorBoundary.tsx`; `src/app/App.tsx:136-207`
Environment: prod build, Chrome 152; Node-проверка реального `deserializeState`

### Impact

Одна повреждённая запись localStorage (ручная правка, расширение, будущая ошибка сериализации) делает Historical Logs неоткрываемым навсегда, а после первого падения — и все остальные экраны до перезагрузки. Reset State недоступен, «Reload application» не очищает ключ, поэтому падение повторяется при каждом открытии истории. Это прямо противоречит заявлению README «Runtime shape checks reject malformed state».

### Preconditions

В `localStorage['iot-lab:v1:history']` находится комбинированная модель фильтра с пустым массивом условий. Штатный UI такую модель не создаёт.

### Reproduction

1. `localStorage.setItem('iot-lab:v1:history', '{"version":"36.1.0","filter":{"filterModel":{"deviceId":{"filterType":"text","operator":"OR","conditions":[]}}}}')`.
2. Открыть Historical Logs.
3. Переключиться на Live Telemetry.

### Expected

Валидатор отбрасывает запись (или только этот фильтр); экран открывается, Reset State доступен.

### Actual

`TypeError: Cannot read properties of undefined (reading 'type') at setLastTypeFromModel`; ErrorBoundary заменяет весь `<main>` («This view could not be displayed»); кнопка Reset State отсутствует; Live Telemetry после этого тоже не отображается (`otherTabAfterCrash.crashed: true`); ключ остаётся отравленным.

### Evidence

- Node 24 + реальный `storage.ts`: `emptyConditions ACCEPTED`.
- Браузер prod: `crashHistory = { crashed: true, resetButtonReachable: false, otherTabAfterCrash: { crashed: true, liveGrid: false }, storedStillPoisoned: true }`.
- Security-харнесс: три последовательных монтирования — падение каждый раз, упавший грид не перезаписывает запись.
- Остальные повреждения (`''`, битый JSON, `null`, массив, неизвестная версия, частично битый объект, валидный объект 49 КБ) обработаны корректно — см. раздел 9.
- Сопутствующий пробел той же функции: вложенные ключи секций (`filter.columnFilterState`, `columnOrder.extra`, лишние поля `sortModel[]`) пропускаются без проверки — `Object.fromEntries` копирует секции целиком.

### Root cause

`validFilter` принимает `conditions.length === 0`, а AG Grid предполагает хотя бы одно условие. Одна `ErrorBoundary` на все экраны и отсутствие сброса сохранённого состояния превращают локальную ошибку в глобальную.

### Recommended fix

Требовать `1 ≤ conditions.length ≤ maxNumConditions`; собирать секции из проверенных полей, а не копировать объект; ставить ErrorBoundary на экран, а в fallback добавить «Reset saved view», удаляющий `iot-lab:v1:*`.

### Regression test

`storage.test.ts`: вход с `"version":"36"` и `conditions: []` → `undefined`. Интеграционный: засеять ключ, открыть Historical Logs, ожидать роль `grid` и кнопку Reset State.

---

## [P2][CORRECTNESS] F-03. Фильтр по boolean-колонке Enabled стирает весь сохранённый вид Configuration

Status: Confirmed
Confidence: High
Component: Grid State persistence / Device Configuration
Affected files: `src/shared/grid/storage.ts:18-57`, `:128-135`; `src/features/device-configuration/columns.ts:37-43`; `src/shared/grid/base.ts:18-24`
Environment: prod build, Chrome 152; Node-проверка

### Impact

Пользователь фильтрует Enabled, настраивает ширины/сортировку/порядок — после reload всё молча сброшено, а сохранённая запись перезаписывается дефолтами. Потеря необратима и происходит в штатном сценарии, без подделки storage.

### Preconditions

Активный фильтр на колонке Enabled (`cellDataType: 'boolean'`, `filter: true` из `defaultColDef`).

### Reproduction

1. Device Configuration: ширина Device name 400, сортировка Sampling desc, фильтр Enabled = true.
2. Перезагрузить страницу, открыть Device Configuration.
3. Контроль: то же без boolean-фильтра.

### Expected

Ширина 400 и сортировка восстанавливаются.

### Actual

С фильтром: `nameWidth: 225`, `sort: []`, `filterModel: {}`, и в storage больше нет `"width":400`. Контроль без фильтра: `nameWidth: 400`, `sort: ["samplingInterval:desc"]`.

### Evidence

- Сохранённая самим приложением строка содержит `"filter":{"filterModel":{"enabled":{"filterType":"text","type":"true"}}}`.
- Node + реальный `deserializeState`: `withBooleanFilter REJECTED (undefined)`, `controlNoFilter ACCEPTED`.

### Root cause

AG Grid для boolean-колонки использует text filter с опциями `true`/`false` (`type: 'true'`). Белый список `validFilter` таких типов не содержит, а `deserializeState` отвергает **всё** состояние при одной неизвестной секции.

### Recommended fix

Добавить `true`/`false` (и опции остальных фильтров, которые реально использует приложение); валидировать секции независимо и отбрасывать только недопустимый фильтр/секцию.

### Regression test

`storage.test.ts`: round-trip состояния с `columnSizing` и `filterModel.enabled = {filterType:'text', type:'true'}` сохраняет обе секции; тест «один невалидный фильтр не удаляет columnSizing».

---

## [P2][CORRECTNESS] F-04. Баннер ошибки остаётся после успешного Retry / Refresh cache

Status: Confirmed
Confidence: High
Component: Historical Logs — error handling
Affected files: `src/features/historical-logs/datasource.ts:61`, `:73-75`, `:99`, `:107`; `src/features/historical-logs/HistoricalLogs.tsx:29-32`, `:194-196`, `:215-227`
Environment: dev и prod, Chrome 152

### Impact

Сценарий «simulate a failure and retry» из README и Interview Guide показывает ложное состояние: данные загружены, но `role="alert"` «Historical request failed…» висит. Screen reader объявляет ошибку, которой нет.

### Preconditions

Была ошибка запроса; симуляция выключена.

### Reproduction

1. Historical Logs, 10,000 записей, latency 250 ms.
2. Включить «Simulate request error», дождаться баннера.
3. Выключить симуляцию, нажать Retry (или Refresh cache).

### Expected

После успешной загрузки баннер исчезает.

### Actual

Таймлайн 250–3000 ms: с 500 ms `row0: true`, `pending: 0`, но `banner: true` до конца наблюдения; Refresh cache → `afterRefreshCache: true`.

### Evidence

Браузерный таймлайн `retry.timeline` (12 отсчётов). Testing-ревью: мутация «никогда не сбрасывать `failed`» и мутация «Retry не вызывает `purgeInfiniteCache`» выживают — существующий тест проверяет только кратковременное исчезновение кнопки.

### Root cause

`onStatus` умеет только поднимать флаг (`if (next.error) setRequestError(true)`), но никогда не опускает его. При Retry `setRequestError(false)` и синхронный `emit()` нового запроса (`pending++`) попадают в один React-батч, а `failed` в datasource ещё `true` (сбрасывается только при успехе) — итоговое состояние снова `true`. Последующий успех (`error: false`) баннер не снимает.

### Recommended fix

Сделать баннер производным от статуса (`status.error`) либо в `onStatus` синхронизировать флаг в обе стороны; сбрасывать `failed` в начале нового запроса.

### Regression test

Unit: после fail → success последний `onStatus` имеет `error: false`. Интеграционный: после Retry дождаться загруженной ячейки и убедиться, что `role="alert"` отсутствует спустя ≥1 с.

---

## [P2][RACE] F-05. Device filter теряет нажатия: асинхронный `stateUpdated` перезаписывает ввод

Status: Confirmed
Confidence: High
Component: Historical Logs — Device filter
Affected files: `src/features/historical-logs/HistoricalLogs.tsx:106-119`, `:249-254`
Environment: dev, Chrome 152

### Impact

При обычном наборе с паузой ≈350 ms (или при прокрутке/клике в гриде во время ввода) символы пропадают, и применяется другой фильтр, чем набрал пользователь — неверный результат запроса.

### Preconditions

Ввод в поле Device filter; пауза, достаточная для срабатывания 350 ms debounce, после чего пользователь продолжает печатать.

### Reproduction

1. Набрать `device-00`, пауза 380 ms.
2. Напечатать `0`, через 40 ms — `1` (каждый символ добавляется к текущему значению поля, как в браузере).

### Expected

Поле и фильтр: `device-0001`.

### Actual

Трасса: `after pause: device-00` → `typed 0 +40ms: device-00` (символ стёрт) → `typed 1 +20ms: device-001` → `settled: device-001`; применён фильтр `device-001`.

### Evidence

Браузерная трасса `deviceFilterTyping`; в более раннем прогоне поле откатилось с `device-000` на `device-00` через 30 ms после ввода. AG Grid диспатчит `stateUpdated` отложенно и для любых изменений состояния (фильтр, фокус, прокрутка, колонки).

### Root cause

`onStateUpdated` безусловно выполняет `setDevice(filterModel.deviceId?.filter ?? '')`. Отложенное событие от предыдущего применения фильтра приходит после нового нажатия и перезаписывает контролируемый input старым значением, пока новый debounce ещё не сработал.

### Recommended fix

Синхронизировать input из модели только при `event.sources` содержащем `filter` и при отсутствии pending debounce, либо сделать floating filter единственным источником правды.

### Regression test

Интеграционный/E2E: ввод → пауза 400 ms → ещё два символа → через 1 с поле и `getFilterModel().deviceId.filter` равны полному тексту; вариант с событием `stateUpdated` `sources: ['scroll']` во время ввода.

---

## [P2][AG-GRID-API] F-06. Тёмная тема не применяется к гридам

Status: Confirmed
Confidence: High
Component: App shell / Theming API
Affected files: `src/app/App.tsx:54-57`; `src/shared/grid/base.ts:8-17`; `src/app/styles.css` (`.app.dark`)
Environment: dev, Chrome 152

### Impact

Кнопка «Dark» затемняет оболочку, но все четыре грида остаются белыми. Нарушено заявление README «the shell offers light/dark themes», интерфейс выглядит сломанным, пользователь со светочувствительностью получает яркие таблицы. На интервью это неверная демонстрация Theming API.

### Preconditions

Нет.

### Reproduction

1. Нажать «☾ Dark».
2. `getComputedStyle(document.querySelector('.ag-root-wrapper')).backgroundColor`.
3. Добавить `.app` класс `ag-theme-mode` и повторить.

### Expected

Фон грида тёмный.

### Actual

Light: `rgb(255, 255, 255)`; Dark: `rgb(255, 255, 255)` при `data-ag-theme-mode="dark"` на `.app`; после добавления класса `ag-theme-mode`: `rgb(43, 43, 43)`.

### Evidence

`node_modules/ag-stack/dist/package/main.esm.mjs:3622`: режим темы применяется только в `:where(html[data-ag-theme-mode=…], body[data-ag-theme-mode=…], .ag-theme-mode[data-ag-theme-mode=…])`. У `div.app` нет класса `ag-theme-mode`. E2E тёмную тему не проверяет.

### Root cause

Атрибут `data-ag-theme-mode` поставлен на произвольный предок без класса `ag-theme-mode`.

### Recommended fix

`className={\`app ag-theme-mode ${dark ? 'dark' : ''}\`}`или установка атрибута на`document.body`/`documentElement`.

### Regression test

E2E: переключить тему и проверить вычисленный фон `.ag-root-wrapper` в обоих режимах.

---

## [P2][TESTING] F-07. Интеграционные тесты сохранения нестабильны

Status: Confirmed
Confidence: Medium
Component: Vitest integration suite
Affected files: `src/app/App.integration.test.tsx:43`, `:59`; `src/features/device-configuration/DeviceConfiguration.tsx:135-163`
Environment: Vitest 5 + jsdom, Windows 11

### Impact

Красный CI без изменения кода; команда привыкает перезапускать тесты, что противоречит правилу проекта «flaky ≠ retry».

### Preconditions

Нагруженная машина (параллельные процессы) — типичный CI-раннер.

### Reproduction

Повторно запускать `npx vitest run src/app` / `npm run test:integration`.

### Expected

Стабильно зелёный результат.

### Actual

При сильной параллельной нагрузке (6 аудиторских субагентов и браузерные нагрузочные прогоны) testing-ревью зафиксировало 3 падения из 11 прогонов интеграционного файла: `Unable to find an element with the text: Saved successfully` (`:43`) и `Unable to find role="alert"` (`:59`), ещё одно падение в полном прогоне и одно во время несвязанной мутации. На ненагруженной машине в audit-worktree `npm run test:integration` прошёл 5/5, `npm test` — 2/2. Нестабильность проявляется только под нагрузкой, отсюда Confidence Medium.

### Evidence

`findByText('Saved successfully')` и `findByRole('alert')` используют таймаут по умолчанию 1000 ms, тогда как сохранение — реальный `setTimeout` 450 ms плюс принудительные `refreshCells` и ререндер грида в jsdom; успешные прогоны этих тестов занимают 1.3–2.9 с.

### Root cause

Реальные таймеры и таймаут ожидания, сопоставимый с длительностью операции.

### Recommended fix

`vi.useFakeTimers({ shouldAdvanceTime: true })` + `await act(() => vi.advanceTimersByTimeAsync(450))`, либо явный `{ timeout: 3000 }`; сначала проверять «Saving changes…».

### Regression test

Прогон файла 20 раз подряд под нагрузкой (`--repeat`/цикл) без падений.

---

## [P2][TESTING] F-08. Ключевые заявленные свойства не защищены тестами (16 из 26 мутаций выживают)

Status: Confirmed
Confidence: High
Component: Unit/integration test suite
Affected files: `src/shared/grid/storage.test.ts:15-28`; `src/features/historical-logs/datasource.test.ts:51-74`, `:94-113`; `src/app/App.integration.test.tsx:19-31`, `:69-95`; `src/shared/data/generator.test.ts:11-20`; `src/features/historical-logs/query.test.ts:100-116`
Environment: изолированная копия `src/` в scratchpad с junction на `node_modules`; репозиторий не изменялся

### Impact

Зелёный набор тестов создаёт ложную уверенность именно там, где найдены F-01…F-05: README заявляет «Runtime shape checks reject malformed state», «Drafts survive navigation between tabs», «does not replace rowData on every tick», устойчивость к устаревшим ответам и Retry — ни одно из этих свойств не защищено от регрессии.

### Preconditions

Нет.

### Reproduction

Внести мутацию в копию исходников и запустить `npx vitest run`.

### Expected

Мутация ломает хотя бы один тест.

### Actual

Выживают: отключение валидации filter/columnOrder/columnVisibility/columnSizing (e3, e4, e6) и пропуск неизвестных секций (e5); удаление только одного из трёх stale-guard’ов (a2, a3); «никогда не сбрасывать `failed`» (b2); Retry без `purgeInfiniteCache` (l); замена транзакций Live на `setGridOption('rowData')` каждый тик (i1); удаление `getRowId` у Live (i2, «убит» только flaky-тестом F-07); размонтирование Configuration при смене вкладки (n); `statusFor` с `>` вместо `>=` (h); `samplingInterval` 3600 отклоняется (g2); редактирование во время сохранения (k); Reset State без сброса фильтров (m).

### Evidence

Полная таблица мутаций — раздел 14. Причины: невалидный вход в `storage.test.ts:23` не содержит `version` и отбрасывается раньше проверяемой ветки; интеграционный тест Retry ждёт исчезновения кнопки, которое происходит сразу после клика; тест статуса сравнивает с самой `statusFor`; тест сортировки по timestamp проходит без сортировки.

### Root cause

Тесты проверяют косвенные или тавтологичные признаки вместо наблюдаемого поведения.

### Recommended fix

Табличные тесты `deserializeState` с `version` и одной испорченной секцией; тесты datasource на каждый guard и на `onStatus`; интеграционный тест «Add device → другая вкладка → назад → 1 unsaved changes»; тест Live с перехватом `applyTransactionAsync`/`setGridOption`; граничные тесты `statusFor(35,35,42)`, `samplingInterval` 1 и 3600.

### Regression test

Повторить мутационный прогон: целевой уровень — все 26 мутаций убиты.

---

## [P2][PERFORMANCE] F-09. Отсортированная выборка 500k: >10 с, из которых ~95% — ожидание `setTimeout(0)`

Status: Confirmed
Confidence: High
Component: Historical Logs — local query engine
Affected files: `src/features/historical-logs/query.ts:16`, `:90-104`, `:118-138`
Environment: prod build, Chrome 152 (вкладка видима и в фокусе), Windows 11, CPU загружен ≤31%

### Impact

Первая страница после сортировки 500,000 записей появляется через 10.4–11.6 с (docs: 4,208 ms «в изолированном прогоне»). UI не замерзает, но пользователь 10 секунд смотрит на Loading; вместе с F-01 это увеличивает окно для зависания.

### Preconditions

Dataset size 500,000, Network latency 0, сортировка по Value.

### Reproduction

1. Historical Logs → 500,000 records, latency 0 ms.
2. Отсортировать Value asc/desc; смотреть длительность в request inspector.

### Expected

Время, близкое к CPU-стоимости запроса (Node: 1,744 ms CPU для сортировки 500k).

### Actual

Три прогона на видимой вкладке: 11,369 / 10,738 / 10,487 ms (inspector: 11,314 / 10,677 / 10,436 ms); максимальный лаг main thread 28–37 ms. Контрольный замер в той же вкладке: 700 последовательных `setTimeout(0)` — **10,805 ms** (~15.4 ms на yield).

### Evidence

Сортировка 500k выполняет 711 yield’ов (122 при сканировании, 589 при merge sort; Node-бенчмарк, медиана 5 прогонов). 711 × ~15 ms ≈ 10.9 с — практически всё время запроса. Под нагрузкой ранее: 9.5–11.3 с.

### Root cause

Кооперативный yield через `setTimeout(0)` с фиксированной частотой (каждые 4,096/16,384 элементов) платит минимальную задержку таймера браузера на каждой итерации (4 ms по спецификации для вложенных таймеров, ~15 ms при грубом разрешении таймера Windows).

### Recommended fix

Yield по бюджету времени (например, после 8–12 ms работы) и через неклампируемый канал (`MessageChannel`/`scheduler.yield()`); Node-вариант с бюджетом 8 ms: 147 yield’ов вместо 711. Дополнительно (P3) — не материализовать полный объект `telemetryAt` для каждой строки при сканировании (≈2/3 CPU).

### Regression test

Unit: число yield’ов ≤ CPU-время ÷ бюджет + число проходов merge sort. Браузерный бенчмарк time-to-first-sorted-page для 500k с порогом.

---

## [P3][PERFORMANCE] F-10. Reset data / смена размера на 10k блокирует main thread 0.6–1.0 с

Status: Confirmed
Confidence: High
Component: Live Telemetry
Affected files: `src/features/live-telemetry/LiveTelemetry.tsx:97-103`, `:150-160`
Environment: prod build, Chrome 152

### Impact

Кратковременный фриз интерфейса при явном действии на максимальном пресете. Документация это не упоминает.

### Preconditions

10,000 устройств.

### Reproduction

Live Telemetry → Devices 10,000 → Reset data (или 10,000 → 1,000).

### Expected

Отсутствие long task > ~200 ms.

### Actual

Максимальный лаг event loop: 655 / 678 / 714 ms при работающем потоке и 652 / 803 / 627 ms на паузе; ранее long task 829 и 1,187 ms; переход 10k → 1k — long task 1,002 ms. Поток не влияет.

### Evidence

Изолированно (dev, поток на паузе): `generateLiveDevices(10000)` — 33 ms; `setGridOption('rowData', 10k новых объектов)` — 377 ms; `applyTransaction` на 10k обновлений — 334 ms (без flash 257 ms). Trace сохранён (`trace-live-reset-10k.json.gz` в артефактах аудита не коммитится).

### Root cause

Полная замена `rowData` 10,000 новыми объектами заставляет AG Grid сопоставить и обновить все узлы.

### Recommended fix

Для Reset — применять транзакцию только к изменённым полям или показывать короткий loading-state; для смены размера — `applyTransaction({ add/remove })` для разницы.

### Regression test

Браузерный бенчмарк: long task при Reset 10k < 200 ms.

---

## [P3][PERFORMANCE] F-11. Смена Network latency выбрасывает готовый индекс и пересчитывает выборку

Status: Confirmed
Confidence: High
Component: Historical Logs
Affected files: `src/features/historical-logs/HistoricalLogs.tsx:88-98`
Environment: статический анализ + замеры F-09

### Impact

Latency не влияет на результат, но её смена пересоздаёт datasource: для 500k с сортировкой — повторные ~10 с и повод для F-01.

### Preconditions

Активная сортировка/фильтр.

### Reproduction

Отсортировать 500k, дождаться результата, сменить Network latency.

### Expected

Используется уже построенный индекс.

### Actual

Новый datasource, новый `prepareHistory` с нуля.

### Evidence

`latency` в зависимостях эффекта, создающего datasource; `index` хранится в замыкании старого datasource.

### Root cause

Параметр симуляции сети привязан к жизненному циклу datasource.

### Recommended fix

Хранить latency в ref (как `failRef`).

### Regression test

Смена latency не вызывает `prepareHistory` повторно (spy).

---

## [P3][CORRECTNESS] F-12. Undo во время сохранения безвозвратно расходует запись undo

Status: Confirmed
Confidence: Medium
Component: Device Configuration — undo/redo
Affected files: `src/features/device-configuration/DeviceConfiguration.tsx:44-46`, `:117-164`; `ConfigurationToolbar.tsx:64-77`
Environment: prod build, вызов через `api.undoCellEditing()` (тот же сервис, что Ctrl+Z в гриде)

### Impact

Если нажать Ctrl+Z в гриде в течение 450 ms сохранения, правка не откатывается, но её запись уходит в redo; после сохранения отменить этот черновик уже нельзя.

### Preconditions

Фокус в гриде, идёт сохранение (кнопки Undo/Redo тулбара отключены, клавиатура — нет).

### Reproduction

1. Изменить имя на «Draft 30», включить Simulate save error.
2. Save all; сразу Ctrl+Z (`api.undoCellEditing()`).
3. После «Save failed» снова Undo.

### Expected

Undo во время сохранения игнорируется без изменения стеков, либо откатывает правку после сохранения.

### Actual

До: undo 10. Во время сохранения значение осталось «Draft 30», стеки стали undo 9 / redo 1. Следующий Undo откатил другую, более раннюю правку; «Draft 30» остался.

### Evidence

Снимки `C5_failSave_keepsDrafts_undoDuringSave`. Реальным Ctrl+Z окно 450 ms не воспроизводилось — поэтому Confidence Medium.

### Root cause

`valueSetter` отказывает (`savingRef`), но сервис undo уже перенёс действие в redo-стек.

### Recommended fix

Во время сохранения перехватывать `Ctrl/Cmd+Z/Y` (`suppressKeyboardEvent`) или временно выключать `undoRedoCellEditing`.

### Regression test

Интеграционный тест с fake timers: undo во время saving не меняет размеры стеков.

---

## [P3][ACCESSIBILITY] F-13. Недостаточный контраст в светлой теме

Status: Confirmed
Confidence: High
Component: Styles
Affected files: `src/app/styles.css` (`--muted`, `.eyebrow`, `.step-number`, `--border` у полей ввода, `:focus-visible`)
Environment: вычисление WCAG 2.x по объявленным цветам

### Impact

Подписи под заголовками, info-panel, eyebrow, число групп Analytics и границы полей трудно читаемы.

### Preconditions

Светлая тема.

### Reproduction

Сравнить пары цветов из таблицы.

### Expected

Текст ≥ 4.5:1 (крупный ≥ 3:1), границы UI и фокус ≥ 3:1.

### Actual

`--muted #68778f` на `--background` — 4.16; на `--soft` — 4.31; `.eyebrow` — 4.09 (на панели 4.46); `.step-number` 32px/300 — 2.51; граница поля `#e1e6ef` на белом — 1.25 (у поиска Live границы нет); кольцо фокуса на фоне/notice/error — 2.86/2.96/2.82. Тёмная тема проходит.

### Evidence

Скрипт `scratchpad/a11y/contrast.mjs` (A11y-ревью), таблица — раздел 13.

### Root cause

Токены светлой палитры подобраны без проверки контраста.

### Recommended fix

Затемнить `--muted`, eyebrow, `.step-number`, `--border`; двухцветное кольцо фокуса.

### Regression test

Автоматическая проверка контраста (axe/Playwright) в обеих темах.

---

## [P3][ACCESSIBILITY] F-14. Поповер Columns обрезается на ширине 320 px

Status: Confirmed
Confidence: High
Component: `ColumnControls`
Affected files: `src/shared/grid/ColumnControls.tsx`; `src/app/styles.css` (`.column-controls > div`: `right: 0; min-width: 180px`)
Environment: dev, viewport 320×800

### Impact

На узком экране/при 400% zoom часть чекбоксов видимости колонок за левым краем (WCAG 1.4.10).

### Preconditions

Ширина 320 CSS px.

### Reproduction

Эмулировать 320×800, открыть Columns на Analytics и Live.

### Expected

Поповер целиком в viewport.

### Actual

Analytics: `left: -87` (половина ширины 180 px за экраном); Live: `left: -4`; Configuration: в пределах. Горизонтального скролла страницы нет.

### Evidence

Замер `getBoundingClientRect()`.

### Root cause

Абсолютное позиционирование от правого края кнопки без ограничения viewport.

### Recommended fix

`max-width: calc(100vw - 32px)`, выравнивание по краю viewport на узких экранах.

### Regression test

Playwright на 320 px: `left >= 0`.

---

## [P3][ACCESSIBILITY] F-15. ARIA-семантика: шумные live-регионы, неработающие имена гридов, фокус на деструктивной кнопке

Status: Confirmed
Confidence: High (статически), без проверки screen reader
Component: Historical Logs, Device Configuration
Affected files: `HistoricalLogs.tsx:199`, `:234`; `DeviceConfiguration.tsx:236-239`, `:261-283`, `:73-80`; `NameEditor.tsx:28-29`
Environment: статический анализ

### Impact

Screen reader объявляет «1», «0» без контекста при каждой загрузке блока; гриды не имеют доступных имён; в диалоге удаления Enter сразу подтверждает деструктивное действие; подсказки ошибок доступны только наведением.

### Preconditions

Использование assistive technology / клавиатуры.

### Reproduction

Прочитать указанную разметку; прокрутить Historical Logs с включённым screen reader.

### Expected

Атомарные осмысленные объявления; именованные гриды; фокус на наименее разрушительном действии.

### Actual

`aria-live="polite"` без `aria-atomic` вокруг счётчика pending; `aria-label` на обычном `div` (игнорируется ARIA); `autoFocus` на «Confirm deletion» (подтверждено в браузере: `focused: "Confirm deletion"`); `tooltipValueGetter` с hover-триггером; ошибка NameEditor только в `title` без `aria-describedby`.

### Evidence

A11y-ревью + браузерная проверка фокуса диалога.

### Root cause

ARIA-атрибуты добавлены без учёта семантики элементов.

### Recommended fix

Один debounce-статус в visually hidden `role="status"`; `aria-label` передавать гриду через `role`-контейнер; `autoFocus` на Cancel; `aria-describedby` для ошибок редактора.

### Regression test

axe-core в E2E + проверка фокуса диалога.

---

## [P3][DOCUMENTATION] F-16. Локальные неточности документации

Status: Confirmed
Confidence: High
Component: Docs
Affected files: `README.md:25`, `:85`, `:93`; `docs/ARCHITECTURE.md:48`; `docs/FEATURE_MATRIX.md:5`, `:25`; `docs/INTERVIEW_NOTES_RU.md:76`; `docs/PERFORMANCE.md:29`; `DeviceConfiguration.tsx:328-329`; `e2e/lab.spec.ts:360`
Environment: сверка с кодом и AG Grid 36.1.0

### Impact

На интервью можно уверенно повторить неверное утверждение; скрытие колонки во время демо молча очищает undo.

### Preconditions

Нет.

### Reproduction

Сравнить утверждения с кодом.

### Expected

Документация совпадает с поведением.

### Actual

1. «sorting, filtering and row replacement clear that edit history» — неполно: undo также очищается при `columnMoved`, `columnPinned`, `columnVisible`, `newColumnsLoaded`, `columnGroupOpened`, `rowDragEnd` (`ag-grid-community main.esm.mjs:39415-39433`), т.е. кнопками Columns и Reset State рядом с Undo.
2. `ARCHITECTURE.md:48` «Column controls debounce filter changes» — `ColumnControls` только переключает видимость; debounce — в `filterParams.debounceMs` и таймере Device filter.
3. `PERFORMANCE.md:29` «Resetting data handles the counter sampling baseline» — `resetData` не сбрасывает `previous` сэмплера, отрицательные значения лишь маскируются.
4. README ссылка «Performance review» ведёт на `PERFORMANCE.md`, а файл `PERFORMANCE_REVIEW.md` доступен только из него и описывает уже исправленные дефекты как текущие.
5. Процессные заметки агента в клиентских документах: `README.md:93`, `FEATURE_MATRIX.md:5`.
6. Название E2E «remains interactive at 10,000 live devices and 500,000 history records» — тест ставит поток на паузу, не сортирует и не измеряет отзывчивость.

### Evidence

Указанные строки; строки AG Grid проверены в `node_modules`.

### Root cause

Документация не синхронизирована с финальным кодом.

### Recommended fix

Исправить формулировки, пометить `PERFORMANCE_REVIEW.md` как исторический, удалить процессные заметки, переименовать E2E-тест или добавить замер.

### Regression test

Не требуется (документация); проверка при ревью.

---

## [P3][INTERVIEW-READINESS] F-17. Упражнения 2, 3, 4 в LIVE_CODING_TASKS ломают приложение или указывают не ту ветку кода

Status: Confirmed
Confidence: High
Component: `docs/LIVE_CODING_TASKS.md`
Affected files: `docs/LIVE_CODING_TASKS.md:27`, `:39`, `:51`; `src/shared/utils/format.ts`; `src/shared/grid/base.ts`; `src/features/historical-logs/{HistoricalLogs.tsx:115,query.ts:57-72}`
Environment: сверка с кодом

### Impact

Подготовка к live coding даёт пустой экран или ложный «успех» упражнения.

### Preconditions

Следовать инструкциям «Hide before practice».

### Reproduction

Удалить `formatNumber` (4 импортёра) или `statusRenderer` (3 импортёра) — ES-модуль не связывается, приложение не рендерится, typecheck падает. Для упражнения 4 скрыть «text-equals branch» в `query.ts`.

### Expected

Упражнение воспроизводимо в указанное время.

### Actual

Упр. 2/3: приложение не стартует. Упр. 4: Device filter отправляет `type: 'contains'` → ветка `default: text.includes`, поэтому скрытие `equals` не влияет на UI и ломает только unit-тест.

### Evidence

Импорты в `live-telemetry/columns.ts`, `HistoricalLogs.tsx`, `device-configuration/columns.ts`, `Analytics.tsx`; `HistoricalLogs.tsx:115`.

### Root cause

Инструкции не проверены на текущем графе импортов.

### Recommended fix

«Заглушить тело функции, оставив экспорт»; в упр. 4 указать ветку `contains`/default.

### Regression test

Прогнать каждое упражнение по инструкции перед интервью.

---

## [P3][TESTING] F-18. Слабые места E2E-сценариев

Status: Confirmed
Confidence: High
Component: Playwright E2E
Affected files: `e2e/lab.spec.ts:43-49`, `:180-200`, `:360-387`; `playwright.config.ts:11`
Environment: Playwright 1.63.0, Chromium, audit-worktree `b406f07`; `npm run test:e2e` — 12 passed (52.1 s)

### Impact

E2E может проходить при сломанном поведении или падать из-за времени, а не дефекта.

### Preconditions

Нет.

### Reproduction

Статический анализ + прогон `npm run test:e2e`.

### Expected

Детерминированные ожидания наблюдаемого поведения.

### Actual

Все 12 тестов проходят, но часть ожиданий не способна обнаружить регрессию или зависит от времени (см. Evidence). Статическая гипотеза о том, что тест `:31` редактирует не ту колонку, прогоном опровергнута — отказ «Edit rejected» действительно возникает; однако целевая колонка задаётся только числом нажатий ArrowRight и нигде не проверяется. Ни один E2E-тест не покрывает сценарии F-01, F-04, F-05, F-06.

### Evidence

`waitForTimeout(1100)` дважды (`:195`, `:198`); poll `rate → 0` проходит сразу, т.к. Reset уже ставит 0 (`LiveTelemetry.tsx:102`); `expect(...{ timeout: 30000 })` внутри теста с таймаутом по умолчанию 30 с (`:378`); `reuseExistingServer: !process.env.CI` переиспользует любой сервер на 5173; навигация к колонке порога через 5×ArrowRight вместо адресации по `col-id` (`:43`).

### Root cause

Ожидания на время и позиционную навигацию.

### Recommended fix

Ждать наблюдаемых состояний; адресовать ячейки по `col-id`; увеличить таймаут теста для 500k; не переиспользовать сервер вне явного флага.

### Regression test

Прогон E2E 5 раз подряд без падений.

---

## [P3][RIG-INTEGRATION] F-19. Пробелы интеграции Rig: DoD-gate пуст, upgrade молча пропускает новый файл

Status: Confirmed
Confidence: High
Component: agent rig (`.claude/`, `.codex/`)
Affected files: `.claude/hooks/dod-checks.json` (отсутствует); `.codex/config.toml` (отсутствует); `.claude/skills/ag-dev`, `.claude/skills/ag-update` (NTFS junction); `.codex/agents/*.toml`
Environment: create-agent-rig `8b96025`, Windows 11, git 2.49

### Impact

Stop-gate Definition of Done не выполняет ни одной проверки; Codex-профиль проекта отличается от шаблона той же версии без уведомления; на других машинах AG skills будут двумя независимыми копиями.

### Preconditions

Нет.

### Reproduction

1. `Test-Path .claude/hooks/dod-checks.json` → `False`.
2. `upgrade --dry-run` на `8b96025`: «0 new», хотя шаблон добавил `templates/agent-os/universal/.codex/config.toml` (слой `meta` в `layers.json`) — файл не установлен и не упомянут.
3. `git add` для `.claude/skills/ag-dev` сохраняет содержимое junction как обычные файлы.

### Expected

DoD-проверки настроены (`["npm run lint", "npm run typecheck", "npm test", "npm run build"]`); upgrade сообщает о пропущенных meta-файлах; ссылки skills воспроизводимы (`npx skills` восстанавливает по `skills-lock.json`).

### Actual

Как описано; кроме того, обновлённые `.codex/agents/*.toml` жёстко закрепляют модели `gpt-5.6-sol`/`gpt-5.6-terra` с `model_reasoning_effort = "high"`, что влияет на стоимость Codex-сессий.

### Evidence

Вывод upgrade, `git diff 870f9a3..8b96025 -- templates/agent-os/universal/layers.json`, `CLAUDE.md` раздел «Four things this install left for you to finish».

### Root cause

Установка оставляет проектные команды на пользователя; meta-файлы upgrade не пишет и не перечисляет.

### Recommended fix

Решение владельца (Tier 2, cost-relevant configuration): добавить `dod-checks.json` после стабилизации F-07; решить судьбу `.codex/config.toml`; в Rig — выводить пропущенные meta-файлы в отчёте upgrade.

### Regression test

`doctor` + повторный `upgrade --dry-run` показывают пропущенные meta-файлы явно.

## 9. Rejected hypotheses / false positives

| Гипотеза                                                                        | Как проверялась                                                                         | Вердикт                                                                                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Live создаёт несколько tick-таймеров (быстрый Pause/Resume ×21, смена настроек) | инструментированные `setInterval`/`clearInterval`                                       | отклонено: всегда один tick-интервал; после unmount — 0                                                       |
| Дублирующиеся/нестабильные row ID                                               | `forEachNode` при 1k и 10k                                                              | отклонено: 10,000 из 10,000 уникальны                                                                         |
| Live заменяет `rowData` на каждом тике                                          | идентичность объектов, код                                                              | отклонено: только `applyTransactionAsync`; `rowData` меняется лишь при Reset/смене размера (см. F-10)         |
| Сортировка и quick filter неверны под потоком                                   | 10k, 250 ms, проверка 200 верхних строк и всех узлов                                    | отклонено: 0 нарушений порядка; 0 лишних/пропущенных строк                                                    |
| Отложенные колбэки транзакций засчитываются после Reset                         | код + метрики                                                                           | отклонено: колбэк захватывает объект счётчиков поколения                                                      |
| Утечки таймеров/слушателей при смене вкладок                                    | инструментирование + статический анализ                                                 | отклонено                                                                                                     |
| Неверный хвостовой блок / row count Infinite Row Model                          | 10k и 100k, последняя строка                                                            | отклонено: `log-9999`/`log-99999`, строк сверх total нет                                                      |
| Устаревшие ответы применяются после быстрой смены фильтров                      | 5 смен за 75 ms, сверка total с эталоном                                                | отклонено: 4,364 = эталон; 0 несоответствий (но см. F-01 о слотах)                                            |
| Сортировка во время pending даёт неверный порядок                               | latency 1500, эталонная сортировка                                                      | отклонено: первые значения и total совпадают                                                                  |
| Loading-оверлей крадёт фокус у floating filter                                  | `document.activeElement` каждые 100 ms                                                  | отклонено: фокус остаётся в поле                                                                              |
| Скрытый грид Configuration пуст после возврата на вкладку                       | число строк, dirty-state                                                                | отклонено: 31 строка, черновики на месте                                                                      |
| `rowClassRules`/`cellClassRules` не обновляются                                 | браузер (класс `row-dirty` появляется и снимается), исходники AG Grid                   | отклонено                                                                                                     |
| Валидация пропускает недопустимые значения                                      | '', 0, 3601, 2.5, −1, 1e400, warning = critical, warning > critical, 81 символ, пробелы | отклонено: все отклонены; `1e3` → 1000 и отрицательные/огромные конечные пороги допустимы по текущим правилам |
| Двойной Save, редактирование и Delete во время Save                             | браузер                                                                                 | отклонено: заблокированы                                                                                      |
| Failed save теряет черновики; Save selected/Revert all неверны                  | браузер                                                                                 | отклонено                                                                                                     |
| Порядок изменения порогов ломает валидацию                                      | браузер                                                                                 | не дефект: правило «Warning < critical» задокументировано в UI; повышать нужно сначала critical               |
| Analytics смешивает единицы или диаграмма не совпадает с данными                | 24 группы, сумма 10,000, 4 доли                                                         | отклонено: совпадает до сотых                                                                                 |
| Мусор в localStorage ломает гриды                                               | 7 значений × 3 грида + Reset State                                                      | отклонено для всех, кроме пустых `conditions` (F-02)                                                          |
| XSS через имена, tooltips, inspector, renderer                                  | payload `<img src=x onerror=…>`, исходники                                              | отклонено: только текстовые узлы, `window.__xss` не установлен                                                |
| CSV/Excel formula injection                                                     | поиск путей экспорта                                                                    | отклонено: экспорт недостижим (контекстное меню — Enterprise, API не вызывается)                              |
| Prototype pollution / ReDoS / eval                                              | Node-харнессы, grep                                                                     | отклонено                                                                                                     |
| Утечка секретов, уязвимые зависимости                                           | скан 164 файлов, `npm audit`                                                            | отклонено: 0 находок                                                                                          |
| Ловушка фокуса в гриде (Tab)                                                    | реальное нажатие Tab                                                                    | не дефект: стандартная навигация AG Grid по ячейкам, выход Shift+Tab                                          |
| Переполнение сайдбара 911×512 скрывает навигацию                                | замер                                                                                   | отклонено: скрыт только декоративный нижний блок                                                              |
| `npm run test:unit` не исключает интеграционные тесты на Windows                | прогон                                                                                  | отклонено: 8 файлов / 36 тестов                                                                               |
| Устаревшие/Enterprise API AG Grid                                               | таблицы deprecations 36.1.0, пакеты                                                     | отклонено                                                                                                     |
| Разреженные массивы ключей сортировки дают утечку памяти                        | Node (`%HasDictionaryElements`, heap)                                                   | отклонено: пик 4.5 MB для 500k                                                                                |
| Inline-колбэки AgGridReact пересоздают колонки/данные                           | исходники ag-grid-react                                                                 | отклонено: меняются только ссылки на обработчики                                                              |
| Падения тестов source Rig — регрессия `main`                                    | изоляция, контроль на 0.8.0, upstream CI                                                | отклонено: нагрузка/среда; единственное стабильное падение идентично на 0.8.0                                 |

## 10. AG Grid API / licensing review

Установлено только `ag-grid-community` / `ag-grid-react` 36.1.0; `ModuleRegistry.registerModules([AllCommunityModule])` (`src/shared/grid/register.ts`), `enableDevValidations()` только в dev. License key отсутствует; Enterprise-пакетов нет. Dev-валидации AG Grid во всех сценариях не выдали ни одного warning (единственное исключение — ожидаемый warning #62 для неизвестных colId при намеренно подложенном состоянии).

| API / функция                                                                                                                                 | Статус в 36.1.0                                          | Edition                          | Замечание                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Client-Side Row Model, `getRowId`, `applyTransactionAsync`, `asyncTransactionWaitMillis`, `flushAsyncTransactions`                            | актуально                                                | Community                        | корректно                                                                                                   |
| Infinite Row Model, `cacheBlockSize`, `maxBlocksInCache`, `maxConcurrentDatasourceRequests`, `purgeInfiniteCache`                             | актуально                                                | Community                        | нарушен контракт завершения `getRows` (F-01)                                                                |
| `rowSelection: { mode: 'multiRow' }`                                                                                                          | актуально (строковая форма deprecated и не используется) | Community                        | корректно                                                                                                   |
| `undoRedoCellEditing`, `undoCellEditing`, `redoCellEditing`                                                                                   | актуально                                                | Community (`UndoRedoEditModule`) | список очищающих событий в docs неполон (F-16); F-12                                                        |
| `valueParser`/`valueSetter`, `agNumberCellEditor`, `agSelectCellEditor`, `agCheckboxCellEditor`, `useGridCellEditor` validation               | актуально                                                | Community                        | корректно                                                                                                   |
| `tooltipValueGetter`, `cellClassRules`, `rowClassRules`, `enableCellChangeFlash`                                                              | актуально                                                | Community                        | корректно                                                                                                   |
| Grid State: `initialState` + `partialColumnState`, `onStateUpdated`, `GridPreDestroyedEvent.state`, `setState`/`getState`                     | актуально                                                | Community                        | валидатор приложения ломает сценарии F-02, F-03; синхронизация F-05                                         |
| `loading` prop                                                                                                                                | актуально                                                | Community                        | корректно                                                                                                   |
| Theming API `themeQuartz.withParams`, `data-ag-theme-mode`                                                                                    | актуально                                                | Community                        | атрибут поставлен на неподдерживаемый элемент (F-06)                                                        |
| `quickFilterText`, floating filters, `filterParams.debounceMs`                                                                                | актуально                                                | Community                        | корректно                                                                                                   |
| Row grouping, pivot, aggregation, cell selection/range clipboard, Rich Select, sparklines, Tool Panels, Integrated Charts, SSRM, Excel export | —                                                        | Enterprise                       | не используются; `docs/FEATURE_MATRIX.md` корректно помечает их Enterprise; UI не заявляет их как доступные |

Community baseline не зависит от Enterprise. Решение показать Analytics как прикладную агрегацию в Community-гриде вместо native grouping/pivot — честный и хорошо объяснённый trade-off. Bundle 1,370.96 kB (389.92 kB gzip) из-за `AllCommunityModule` задокументирован как осознанный выбор.

## 11. Security review

| Проверка                                                                         | Результат                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS в renderers/tooltips/editor/inspector/сообщениях                             | нет: только текстовые узлы React и `textContent` AG Grid; динамический payload не исполнился                                                                                                                                                            |
| `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, динамические URL | отсутствуют в `src`                                                                                                                                                                                                                                     |
| localStorage parsing                                                             | устойчиво к мусору и прототипным ключам; ошибки — F-02 (пустые `conditions`), F-03 (слишком строгий whitelist), непроверяемые вложенные ключи                                                                                                           |
| Prototype pollution                                                              | нет: `__proto__`/`constructor` отбрасываются или остаются собственными ключами; `Object.prototype` не изменён; неизвестные colId AG Grid отбрасывает                                                                                                    |
| ReDoS                                                                            | RegExp из пользовательского ввода не строятся                                                                                                                                                                                                           |
| CSV/Excel formula injection                                                      | экспорт недостижим; `=1+1`, `+1+1`, `-1+1`, `@SUM(1,1)` хранятся и отображаются как текст                                                                                                                                                               |
| Console leaks / error rendering                                                  | собственный `console.error` только в DEV; fallback не показывает детали ошибки; source maps в production не генерируются                                                                                                                                |
| Секреты                                                                          | не найдены; license key отсутствует                                                                                                                                                                                                                     |
| Зависимости                                                                      | `npm audit --omit=dev` и `npm audit` — exit 0, «found 0 vulnerabilities»; `npm ci` — added 274 packages, 0 vulnerabilities; все `resolved` → `registry.npmjs.org`, у всех записей есть `integrity`; install-скрипт только у optional `fsevents` (macOS) |
| CSP                                                                              | отсутствует, но достижимой инъекции нет — не находка для локального демо                                                                                                                                                                                |

## 12. Performance review

Браузер (prod build, Chrome 152, Windows 11):

| Сценарий                                         | Результат                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Live 1k и 10k, 250 ms / 100 изменений            | max lag 18–26 ms, long tasks 0                                                                        |
| Live 10k, quick filter `critical` под потоком    | long tasks ≤65 ms                                                                                     |
| Live 10k, сортировка Value под потоком           | long tasks ≤146 ms                                                                                    |
| Live 10k, 100 ms / 1000 изменений / burst        | 14.6–16.3 k evt/s; long tasks до 311–353 ms; applied отстаёт от received не более чем на одну очередь |
| Live Reset data 10k (поток и пауза)              | max lag 627–803 ms (F-10)                                                                             |
| Live 10k → 1k                                    | long task 1,002 ms (F-10)                                                                             |
| Historical 100k: первая страница, хвостовой блок | 643 ms до строки 99,999                                                                               |
| Historical 500k + sort Value, latency 0          | 10,436–11,314 ms, max lag 28–45 ms (F-09)                                                             |
| 700 последовательных `setTimeout(0)`             | 10,805 ms                                                                                             |

Node 24 (медиана ≥5 прогонов, perf-ревью):

| Сценарий                | CPU ms                           | Yields | Оценка браузера (4 ms clamp) |
| ----------------------- | -------------------------------- | ------ | ---------------------------- |
| 100k sort value         | 490                              | 143    | ~1.1 s                       |
| 100k multi-sort         | 889                              | 143    | ~1.5 s                       |
| 500k value > 30         | 1,167                            | 122    | ~1.7 s                       |
| 500k sort value         | 1,744                            | 711    | ~4.6 s                       |
| 500k sort + value > 30  | 1,610                            | 502    | ~3.6 s                       |
| 500k multi-sort         | 2,925                            | 711    | ~5.8 s                       |
| `historyPage` 200 строк | 0.39                             | —      | —                            |
| Пик heap 500k sort      | 4.5 MB                           | —      | —                            |
| Abort → rejection       | медиана 0.2–14.6 ms, max 25.8 ms | —      | —                            |

Выводы: виртуализация и транзакции Live работают; утечек памяти и таймеров не найдено; `columnDefs`/`defaultColDef`/`getRowId` стабильны; Analytics на mount — 26.6 ms. Основная проблема — стоимость yield’ов в локальном query engine (F-09) и полная замена `rowData` при Reset (F-10); F-11 — лишний пересчёт при смене latency.

## 13. Accessibility review

Сильные стороны: подписанные контролы, skip link на `main tabIndex=-1`, одна h1 на экран, landmarks, текстовые статус-пиллы, Pause для автоматического потока, диалог удаления возвращает фокус и закрывается Escape, стандартная клавиатурная навигация AG Grid.

| Проверка                                   | Результат                                                                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Контраст светлой темы                      | 4.16 / 4.31 / 4.09 / 2.51 / 1.25 / 2.86 — F-13                                                                                           |
| Контраст тёмной темы                       | проходит (≥6.36 для текста), но гриды не темнеют — F-06                                                                                  |
| 320 px                                     | поповер Columns обрезан (−87 px Analytics) — F-14; горизонтального скролла страницы нет                                                  |
| Live-регионы и имена гридов, фокус диалога | F-15                                                                                                                                     |
| Цвет как единственный носитель смысла      | dirty-строка (контраст подсветки 1.06:1) — только цвет, текстовая альтернатива в свёрнутом `<details>`; включено в F-15 как рекомендация |
| Tab внутри грида                           | навигация по ячейкам (стандарт AG Grid), не ловушка                                                                                      |
| Screen reader                              | не проверялся (ограничение аудита)                                                                                                       |

## 14. Test review

| Прогон                                       | Результат                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| До аудита (основной checkout)                | 9 файлов / 40 тестов, exit 0                                                                                            |
| После upgrade Rig                            | 40/40, exit 0                                                                                                           |
| Testing-ревью, 3 полных прогона              | 1 падение (`App.integration.test.tsx:59`), 2 зелёных                                                                    |
| Testing-ревью, повторы интеграционного файла | 3 падения из 11 (`:43`, `:59`)                                                                                          |
| Stage F в audit-worktree                     | `test:unit` 8 файлов / 36 тестов; `test:integration` ×5 — 4/4 каждый раз; `npm test` ×2 — 40/40; E2E 12/12 — все exit 0 |

Мутационное тестирование (изолированная копия, 26 мутаций):

| #   | Мутация                                        | Результат                                   |
| --- | ---------------------------------------------- | ------------------------------------------- |
| a   | удалить все 3 stale-guard                      | killed                                      |
| a2  | удалить guard после построения индекса         | **survived**                                |
| a3  | удалить guard в `catch`                        | **survived**                                |
| b1  | не вызывать `failCallback`                     | killed                                      |
| b2  | не сбрасывать `failed`                         | **survived**                                |
| c   | игнорировать `desc`                            | killed                                      |
| d   | off-by-one последнего блока                    | killed                                      |
| e1  | вернуть JSON без валидации                     | killed                                      |
| e2  | вернуть любой объект                           | killed                                      |
| e3  | отключить валидацию filter                     | **survived**                                |
| e4  | отключить проверку columnOrder/visibility      | **survived**                                |
| e5  | пропускать неизвестные секции                  | **survived**                                |
| e6  | отключить проверку columnSizing                | **survived**                                |
| f1  | `isDirty` всегда false                         | killed                                      |
| f2  | `revertDevices` игнорирует ids                 | killed                                      |
| g   | warning vs critical через `>`                  | killed                                      |
| g2  | sampling 3600 отклоняется                      | **survived**                                |
| h   | `statusFor` через `>`                          | **survived**                                |
| i1  | Live: `setGridOption('rowData')` каждый тик    | **survived**                                |
| i2  | Live без `getRowId`                            | **survived** (ложное убийство flaky-тестом) |
| j   | failed save очищает черновики                  | killed                                      |
| k   | редактирование во время сохранения             | **survived** (второй барьер — `editable`)   |
| l   | Retry без `purgeInfiniteCache`                 | **survived**                                |
| m   | Reset State не сбрасывает фильтры              | **survived**                                |
| n   | Configuration размонтируется при смене вкладки | **survived**                                |

Позитив: тесты детерминированы (seed 42, фиксированная эпоха), fake timers в datasource-тестах корректно восстанавливаются, NameEditor-тест проверяет наблюдаемое поведение, привязки unit-тестов к внутренним CSS-классам AG Grid нет. Недостатки — F-07, F-08, F-18.

## 15. Documentation review

Проверено против кода и AG Grid 36.1.0: команды README (все существуют и работают), модель данных (seed 42, battery = % used, 24 группы Analytics), `≤ 1,600 rows` (200 × 8), окно транзакций 50 ms, инспектор на 8 запросов, общий индекс для конкурентных блоков, пессимистичное сохранение и сохранность черновиков, объём состояния вида, Community/Enterprise-атрибуция, отсутствие deprecated API, согласованность русских и английских материалов. Документация необычно честно описывает ограничения (включая «под нагрузкой запрос не завершился за 7 с»).

Расхождения — F-16 (6 пунктов) и F-17 (3 упражнения). Не отражены в docs, но обнаружены аудитом: F-01, F-04, F-05, F-06 противоречат заявлениям README о Retry, фильтре и тёмной теме.

Выполнимость упражнений `LIVE_CODING_TASKS.md`:

| #   | Упражнение             | Выполнимо                    | Замечания                                                        |
| --- | ---------------------- | ---------------------------- | ---------------------------------------------------------------- |
| 1   | Column                 | да, ~5 мин                   | после изменения колонок нажать Reset State (сохранённый порядок) |
| 2   | Formatter              | после исправления инструкции | F-17                                                             |
| 3   | Status renderer        | после исправления инструкции | F-17                                                             |
| 4   | Historical filter      | да, ~12 мин                  | F-17 (не та ветка)                                               |
| 5   | Location editor        | да, ~10 мин                  | dirty-tracking уже универсален                                   |
| 6   | Validation             | да, ~15 мин                  | нет граничных тестов 1/3600 — хорошая часть задания              |
| 7   | One-row transaction    | да, ~15 мин                  | сначала поставить поток на паузу                                 |
| 8   | Persist view           | да, ~20 мин                  | у `useGridState` нет тестов; учесть F-03                         |
| 9   | Cancellable datasource | тесно, ~25 мин               | сохранить контракт `onStatus`; учесть F-01                       |
| 10  | Performance diagnosis  | да, как обсуждение           | F-09 — готовый материал                                          |

## 16. Interview-readiness review

Запрос клиента: «Build something simple hands-on and explain decisions and trade-offs».

Сильные стороны:

- Каждый экран демонстрирует одно решение (CSRM + транзакции, Infinite Row Model + datasource, редактирование с разделением parser/setter/validator/baseline, прикладная агрегация в Community).
- Нет глобального state manager и универсальной обёртки грида; `columns.ts`, `model.ts`, `query.ts`, `datasource.ts` легко находятся.
- Info-panel, Interview Guide, русские заметки и английские фразы дают готовые объяснения trade-off’ов; Community/Enterprise объяснено точно.

Риски для «simple hands-on»:

- `query.ts` (ручной bottom-up merge sort по `Uint32Array` с yield’ами и разреженными ключами) — самый трудный для объяснения вживую фрагмент; обоснован в docs, но на интервью лучше позиционировать как «в продукте это делает backend/Worker».
- `DeviceConfiguration.tsx` (335 строк) смешивает сеттер с побочными эффектами React, оркестрацию сохранения с вложенными `flatMap/find/some`, диалог удаления, alert-и валидации и `beforeunload`; вопрос «покажите Save selected» приведёт в самый плотный код.
- `storage.ts` — длинный ручной валидатор, который одновременно слишком строгий (F-03) и слишком мягкий (F-02); хороший материал для обсуждения, но источник двух дефектов.
- Главный демонстрационный риск — F-01 и F-04 во время показа Historical Logs.

Итог: как учебный стенд — сильный; как «простое» решение — местами переусложнён, но это покрыто документацией. После исправления P1/P2 готов к использованию.

## 17. Fix order

1. **F-01** — завершать все `getRows` колбэком; сбрасывать статус при замене datasource; вместе с **F-11** (latency в ref).
2. **F-04** — производный баннер ошибки (тот же файл, тот же тест).
3. **F-02 + F-03** — пересобрать валидацию состояния по секциям (одна правка `storage.ts` + табличные тесты); экранная ErrorBoundary с «Reset saved view».
4. **F-05** — синхронизация Device filter только по источнику `filter`.
5. **F-06** — класс `ag-theme-mode` + E2E на тему.
6. **F-07 + F-08** — стабилизировать интеграционные тесты и закрыть выжившие мутации (сначала для F-01…F-06, чтобы регрессионные тесты появились вместе с исправлениями).
7. **F-09** — yield по бюджету времени через `MessageChannel`/`scheduler.yield`.
8. **F-12, F-10** — undo во время сохранения, стоимость Reset 10k.
9. **F-13, F-14, F-15** — доступность.
10. **F-16, F-17, F-18** — документация, упражнения, E2E.
11. **F-19** — решения владельца по Rig (DoD checks, `.codex/config.toml`).

## 18. Retest plan

| Находка   | Ретест                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01      | сценарии A и B из отчёта (prod build) + unit «каждый getRows завершён ровно один раз»; повтор 10 раз                                                                                  |
| F-02      | засеять `conditions: []`, открыть все экраны; Reset saved view доступен                                                                                                               |
| F-03      | boolean-фильтр + ширина + сортировка → reload → всё восстановлено; контроль без фильтра                                                                                               |
| F-04      | error → disable → Retry и Refresh cache: `role="alert"` отсутствует через 1 и 3 с                                                                                                     |
| F-05      | трасса ввода `device-00` / пауза 380 ms / `0` / `1` → `device-0001` в поле и в модели                                                                                                 |
| F-06      | вычисленный фон `.ag-root-wrapper` в light/dark                                                                                                                                       |
| F-07      | 20 последовательных прогонов `npm run test:integration` под нагрузкой                                                                                                                 |
| F-08      | повторить 26 мутаций: все killed                                                                                                                                                      |
| F-09      | 500k + sort Value на видимой вкладке, 3 прогона, цель ≤ CPU-время + 1 с; число yield’ов                                                                                               |
| F-10      | long task при Reset 10k и 10k→1k < 200 ms                                                                                                                                             |
| F-11      | spy на `prepareHistory` при смене latency                                                                                                                                             |
| F-12      | Ctrl+Z во время сохранения не меняет стеки undo/redo                                                                                                                                  |
| F-13–F-15 | пересчёт контраста, 320 px, axe-core, фокус диалога                                                                                                                                   |
| F-16–F-18 | вычитка docs; выполнение упражнений 2–4 по инструкции; E2E ×5                                                                                                                         |
| Регрессия | `npm ci`, format:check, lint, typecheck, test ×3, build, E2E, `npm audit --omit=dev`, повтор black-box сценариев Live/Historical/Configuration/Analytics/Grid State из разделов 7 и 9 |
