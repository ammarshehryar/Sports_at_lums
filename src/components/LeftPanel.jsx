import { useRef } from 'react';
import { buildTemplateWorkbook, triggerDownload } from '../engine/xlsxIO.js';
import VenueSetup from './VenueSetup.jsx';

export default function LeftPanel({
  fileName,
  onFile,
  parseErrors,
  rosterSummary,
  sportOptions,
  venues,
  onVenuesChange,
  matchDuration,
  onMatchDurationChange,
  breakDuration,
  onBreakDurationChange,
  stageFormat,
  onStageFormatChange,
  groupSizeMode,
  onGroupSizeModeChange,
  numGroups,
  onNumGroupsChange,
  groupSize,
  onGroupSizeChange,
  onGenerate,
  canGenerate,
  generating,
}) {
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  };

  const downloadTemplate = () => {
    triggerDownload(buildTemplateWorkbook(), 'roster-template.xlsx');
  };

  return (
    <aside className="left-panel">
      <div className="left-panel-scroll">
        <section className="input-card">
          <h2 className="input-card-title">Roster file</h2>
          <button className="btn btn-primary btn-block" onClick={() => inputRef.current?.click()}>
            {fileName ? 'Replace file' : 'Upload Excel / CSV'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {fileName && <p className="file-chip">{fileName}</p>}
          <button className="btn-link" onClick={downloadTemplate}>
            Download blank template
          </button>
          {rosterSummary && (
            <p className="field-hint">
              {rosterSummary.entrantCount} entrants across {rosterSummary.sportCount} sport
              {rosterSummary.sportCount === 1 ? '' : 's'}
            </p>
          )}
          {parseErrors?.length > 0 && (
            <ul className="input-errors">
              {parseErrors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {parseErrors.length > 5 && <li>+ {parseErrors.length - 5} more row issue(s)</li>}
            </ul>
          )}
        </section>

        <VenueSetup sports={sportOptions} venues={venues} onChange={onVenuesChange} />

        <section className="input-card">
          <h2 className="input-card-title">Match settings</h2>
          <label className="field">
            <span>Match duration (minutes)</span>
            <input
              type="number"
              min={5}
              value={matchDuration}
              onChange={(e) => onMatchDurationChange(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Break between matches (minutes)</span>
            <input
              type="number"
              min={0}
              value={breakDuration}
              onChange={(e) => onBreakDurationChange(Number(e.target.value))}
            />
          </label>
        </section>

        <section className="input-card">
          <h2 className="input-card-title">Tournament stage</h2>

          <div className="format-radio-group">
            <label className="format-radio-option">
              <input
                type="radio"
                name="stageFormat"
                value="knockout"
                checked={stageFormat === 'knockout'}
                onChange={() => onStageFormatChange('knockout')}
              />
              <span>Knockout</span>
            </label>
            <label className="format-radio-option">
              <input
                type="radio"
                name="stageFormat"
                value="groupStage"
                checked={stageFormat === 'groupStage'}
                onChange={() => onStageFormatChange('groupStage')}
              />
              <span>Group stage</span>
            </label>
          </div>

          {stageFormat === 'groupStage' && (
            <div className="group-stage-options">
              <p className="field-hint">
                Autogrouping is on — entrants are split into groups so no two from the same delegation share a
                group; a same-delegation pairing only happens if it's truly unavoidable.
              </p>

              <div className="format-radio-group format-radio-group-compact">
                <label className="format-radio-option">
                  <input
                    type="radio"
                    name="groupSizeMode"
                    value="numGroups"
                    checked={groupSizeMode === 'numGroups'}
                    onChange={() => onGroupSizeModeChange('numGroups')}
                  />
                  <span>Set number of groups</span>
                </label>
                <label className="format-radio-option">
                  <input
                    type="radio"
                    name="groupSizeMode"
                    value="groupSize"
                    checked={groupSizeMode === 'groupSize'}
                    onChange={() => onGroupSizeModeChange('groupSize')}
                  />
                  <span>Set people per group</span>
                </label>
              </div>

              {groupSizeMode === 'numGroups' ? (
                <label className="field">
                  <span>Number of groups</span>
                  <input
                    type="number"
                    min={2}
                    value={numGroups}
                    onChange={(e) => onNumGroupsChange(Number(e.target.value))}
                  />
                </label>
              ) : (
                <label className="field">
                  <span>People per group</span>
                  <input
                    type="number"
                    min={2}
                    value={groupSize}
                    onChange={(e) => onGroupSizeChange(Number(e.target.value))}
                  />
                </label>
              )}
              <p className="field-hint">This applies per sport — each sport's entrants are grouped separately.</p>
            </div>
          )}
        </section>

        <button
          className="btn btn-generate btn-block"
          onClick={onGenerate}
          disabled={!canGenerate || generating}
        >
          {generating ? 'Generating…' : 'Generate Schedule'}
        </button>
      </div>
    </aside>
  );
}
