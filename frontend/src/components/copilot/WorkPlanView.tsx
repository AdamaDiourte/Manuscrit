import { Fragment } from "react";
import type { WorkPlan } from "../../../../shared/research/workPlan";
import {
  buildGanttColumns,
  buildGanttRows,
  formatHoursFr,
  formatShortDateFr,
  formatWeekSpan,
  formatWeeksApprox,
  periodLabel,
  shortPhaseTitle,
  todayMarkerPct,
} from "../../../../shared/research/planDisplay";

type Props = {
  plan: WorkPlan;
  className?: string;
};

const PILOTAGE_COLS = [17, 16, 23, 17, 19, 8];
/** Largeurs Gantt — source unique (colonnes + repère « aujourd’hui »). */
const GANTT_PHASE_PCT = 22;
const GANTT_PROGRESS_PCT = 10;

export default function WorkPlanView({ plan, className = "" }: Props) {
  const { meta, phases, rhythm, warnings } = plan;
  const { columns } = buildGanttColumns(plan);
  const rows = buildGanttRows(plan, columns);
  const todayPct = todayMarkerPct(plan);
  const periodBandPct = 100 - GANTT_PHASE_PCT - GANTT_PROGRESS_PCT;
  const periodShare = columns.length
    ? periodBandPct / columns.length
    : periodBandPct;
  const phaseCount = Math.max(1, rows.length);
  const todayLeft =
    todayPct == null
      ? null
      : `calc(${GANTT_PHASE_PCT}% + ${periodBandPct}% * ${todayPct / 100})`;
  /** Fin = 100 % de la bande périodes (date de rendu). */
  const finLeft = `calc(${GANTT_PHASE_PCT}% + ${periodBandPct}% * 1)`;
  const finLabelShifted = todayPct != null && todayPct >= 82;
  const finDateLabel = formatShortDateFr(meta.endDate);

  return (
    <section
      className={`wp-view ${className}`.trim()}
      aria-labelledby="wp-gantt-label"
      style={{ ["--wp-phases" as string]: String(phaseCount) }}
    >
      <div className="wp-header">
        <p className="wp-frise-label" id="wp-gantt-label">
          Diagramme de progression
        </p>
        <div className="wp-metrics" role="group" aria-label="Chiffres clés">
          <article className="wp-metric">
            <p className="wp-metric-value">{meta.durationLabel}</p>
            <p className="wp-metric-label">Durée</p>
            <p className="wp-metric-hint">
              {formatWeeksApprox(meta.totalDays)}
            </p>
          </article>
          <article className="wp-metric">
            <p className="wp-metric-value">
              {formatHoursFr(meta.hoursPerWeek)}
            </p>
            <p className="wp-metric-label">Charge par semaine</p>
            <p className="wp-metric-hint">{meta.weeklyLabel || "—"}</p>
          </article>
          <article className="wp-metric">
            <p className="wp-metric-value">
              {formatHoursFr(meta.totalHours)}
            </p>
            <p className="wp-metric-label">Heures totales</p>
            <p className="wp-metric-hint">Estimation indicative</p>
          </article>
          <article className="wp-metric">
            <p className="wp-metric-value">
              {formatShortDateFr(meta.endDate)}
            </p>
            <p className="wp-metric-label">Date de rendu</p>
            <p className="wp-metric-hint">
              Début {formatShortDateFr(meta.startDate)}
            </p>
          </article>
        </div>
      </div>

      <div className="wp-gantt-block">
        <div
          className="wp-gantt-scroll"
          role="img"
          aria-labelledby="wp-gantt-label"
          aria-describedby="wp-gantt-text"
        >
          <table className="wp-gantt">
            <colgroup>
              <col style={{ width: `${GANTT_PHASE_PCT}%` }} />
              {columns.map((c) => (
                <col key={c.index} style={{ width: `${periodShare}%` }} />
              ))}
              <col style={{ width: `${GANTT_PROGRESS_PCT}%` }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="wp-gantt-sticky">
                  Phase
                </th>
                {columns.map((c) => (
                  <th key={c.index} scope="col">
                    {c.label}
                  </th>
                ))}
                <th scope="col">Avancement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.phase.index}>
                  <th scope="row" className="wp-gantt-sticky">
                    {row.phase.index + 1}.{" "}
                    {shortPhaseTitle(row.shortTitle, 40)}
                  </th>
                  {columns.map((col, ci) => {
                    const active = ci >= row.colStart && ci <= row.colEnd;
                    const diamond = active && ci === row.checkpointCol;
                    return (
                      <td
                        key={col.index}
                        className={
                          active
                            ? row.phase.role === "revision"
                              ? "wp-gantt-cell is-revision"
                              : "wp-gantt-cell is-draft"
                            : "wp-gantt-cell"
                        }
                      >
                        {diamond ? (
                          <span aria-hidden="true">◆</span>
                        ) : (
                          "\u00a0"
                        )}
                      </td>
                    );
                  })}
                  <td className="wp-gantt-progress">
                    {row.progressPct}&nbsp;%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {todayLeft != null && (
            <div
              className="wp-gantt-today"
              style={{ left: todayLeft }}
              title="Aujourd’hui"
            >
              <span className="wp-gantt-today-mark" aria-hidden="true" />
              <span className="wp-gantt-today-label">Aujourd’hui</span>
            </div>
          )}
          <div
            className="wp-gantt-fin"
            style={{ left: finLeft }}
            title={`Fin · ${finDateLabel}`}
          >
            <span className="wp-gantt-fin-mark" aria-hidden="true" />
            <span
              className={
                finLabelShifted
                  ? "wp-gantt-fin-label is-shifted-left"
                  : "wp-gantt-fin-label"
              }
            >
              Fin · {finDateLabel}
            </span>
          </div>
        </div>
        <p className="wp-legend" aria-hidden="true">
          <span className="wp-leg-draft">■</span> Rédaction{" "}
          <span className="wp-leg-rev">■</span> Relecture{" "}
          <span className="wp-leg-check">◆</span> Point d’encadrement{" "}
          <span className="wp-leg-today">│</span> Aujourd’hui{" "}
          <span className="wp-leg-fin">│</span> Fin (date de rendu)
        </p>
        <ol id="wp-gantt-text" className="wp-frise-text">
          {rows.map((row) => (
            <li key={`txt-${row.phase.index}`}>
              Phase {row.phase.index + 1} — {row.phase.title} :{" "}
              {periodLabel(row.phase)} (
              {formatWeekSpan(row.phase.weekStart, row.phase.weekEnd)}),
              avancement cumulé {row.progressPct} %, charge{" "}
              {formatHoursFr(row.phase.hours)}.
            </li>
          ))}
        </ol>
      </div>

      <div className="wp-pilotage">
        <h4 className="wp-subtitle">Tableau de pilotage</h4>
        <div className="wp-table-wrap">
          <table className="wp-table">
            <colgroup>
              {PILOTAGE_COLS.map((pct, i) => (
                <col key={i} style={{ width: `${pct}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Période</th>
                <th scope="col">Objectif</th>
                <th scope="col">Livrable</th>
                <th scope="col">Point d’encadrement</th>
                <th scope="col">Charge</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((phase, i) => (
                <Fragment key={phase.index}>
                  <tr className={i % 2 ? "is-alt" : undefined}>
                    <td>
                      {phase.index + 1}. {shortPhaseTitle(phase.title, 40)}
                    </td>
                    <td>
                      {periodLabel(phase)}
                      <small>
                        {formatWeekSpan(phase.weekStart, phase.weekEnd)}
                      </small>
                    </td>
                    <td>{phase.objective}</td>
                    <td>{phase.deliverable}</td>
                    <td>{phase.checkpoint}</td>
                    <td>{formatHoursFr(phase.hours)}</td>
                  </tr>
                  {(phase.subsections || []).map((sub, j) => (
                    <tr
                      key={`${phase.index}-sub-${j}`}
                      className="wp-pilotage-sub"
                    >
                      <td colSpan={6}>
                        {phase.index + 1}.{j + 1}{" "}
                        {shortPhaseTitle(sub.title, 60)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rhythm.length > 0 && (
        <div className="wp-rhythm" role="status">
          <h4>Rythme conseillé</h4>
          <ul>
            {rhythm.slice(0, 3).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="wp-warnings" role="status">
          <h4>Points d’attention</h4>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
