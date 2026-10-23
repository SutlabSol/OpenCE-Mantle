import { useEffect, useState } from 'react';
import {
  HALOSCRIPT_SAMPLE_TEMPLATES,
  type HaloScriptSampleTemplate,
} from '../../../core/src/map/hs-decompiler';
import { lintHaloScript, type HaloScriptDiagnostic } from '../../../core/src/map/hs-compiler';

interface Props {
  onClose: () => void;
  onMapModified?: () => void;
}

export default function ScriptEditorDialog({ onClose, onMapModified }: Props) {
  const [hscSource, setHscSource] = useState<string>('; Loading decompiled HaloScript from scenario...\n');
  const [scriptCount, setScriptCount] = useState<number>(0);
  const [globalCount, setGlobalCount] = useState<number>(0);
  const [syntaxNodeCount, setSyntaxNodeCount] = useState<number>(0);
  const [scenarioEntities, setScenarioEntities] = useState<{
    objectNames: string[];
    triggerVolumes: string[];
    cutsceneCameraPoints: string[];
    cutsceneFlags: string[];
    encounters: string[];
    recordedAnimations: string[];
  }>({
    objectNames: [],
    triggerVolumes: [],
    cutsceneCameraPoints: [],
    cutsceneFlags: [],
    encounters: [],
    recordedAnimations: [],
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(HALOSCRIPT_SAMPLE_TEMPLATES[0]!.id);
  const [diagnostics, setDiagnostics] = useState<HaloScriptDiagnostic[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const selectedTemplate: HaloScriptSampleTemplate =
    HALOSCRIPT_SAMPLE_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? HALOSCRIPT_SAMPLE_TEMPLATES[0]!;

  const loadFromMap = async () => {
    if (!window.opence.decompileHaloScript) return;
    setIsBusy(true);
    const res = await window.opence.decompileHaloScript();
    setIsBusy(false);
    if (res.ok) {
      setHscSource(res.hscSource);
      setScriptCount(res.scriptCount);
      setGlobalCount(res.globalCount);
      setSyntaxNodeCount(res.syntaxNodeCount);
      setScenarioEntities(res.scenarioEntities);
      setDiagnostics([]);
    } else {
      setStatusMessage(`Failed to decompile scripts: ${res.message}`);
    }
  };

  useEffect(() => {
    void loadFromMap();
  }, []);

  const handleLint = () => {
    const diags = lintHaloScript(hscSource);
    setDiagnostics(diags);
    if (diags.length === 0) {
      setStatusMessage('Syntax check passed: 0 errors, 0 warnings (OpenCE compatible).');
    } else {
      const errs = diags.filter((d) => d.severity === 'error').length;
      const warns = diags.filter((d) => d.severity === 'warning').length;
      setStatusMessage(`Found ${errs} error(s) and ${warns} warning(s).`);
    }
  };

  const handleAutoSetupEntities = async (template: HaloScriptSampleTemplate) => {
    if (!window.opence.setupScenarioScriptEntities) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.setupScenarioScriptEntities({
      objectNames: template.requiredObjectNames,
      triggerVolumes: template.requiredTriggerVolumes,
      cameraPoints: template.requiredCameraPoints,
    });
    setIsBusy(false);
    if (res.ok) {
      const parts: string[] = [];
      if (res.addedObjectNames.length > 0) parts.push(`+${res.addedObjectNames.length} object names (${res.addedObjectNames.join(', ')})`);
      if (res.addedTriggerVolumes.length > 0) parts.push(`+${res.addedTriggerVolumes.length} trigger volumes (${res.addedTriggerVolumes.join(', ')})`);
      if (res.addedCameraPoints.length > 0) parts.push(`+${res.addedCameraPoints.length} camera points (${res.addedCameraPoints.join(', ')})`);
      setStatusMessage(
        parts.length > 0
          ? `Auto-configured scenario entities in memory: ${parts.join(', ')}.`
          : 'All required object names, trigger volumes, and camera points already exist in the scenario!',
      );
      onMapModified?.();
      const refresh = await window.opence.decompileHaloScript?.();
      if (refresh?.ok) {
        setScenarioEntities(refresh.scenarioEntities);
      }
    } else {
      setStatusMessage(`Failed to setup scenario entities: ${res.message}`);
    }
  };

  const handleCompileIntoScenario = async () => {
    if (!window.opence.compileHaloScript) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.compileHaloScript(hscSource);
    setIsBusy(false);
    if (res.ok) {
      setScriptCount(res.compiledScripts);
      setGlobalCount(res.compiledGlobals);
      setSyntaxNodeCount(res.syntaxNodesUsed);
      setDiagnostics(res.diagnostics);
      setStatusMessage(
        `Compiled ${res.compiledScripts} script(s) & ${res.compiledGlobals} global(s) (${res.syntaxNodesUsed} syntax nodes) into scenario in-memory! Press Ctrl+S to save map.`,
      );
      onMapModified?.();
    } else {
      setDiagnostics(res.diagnostics ?? []);
      setStatusMessage(`Compile failed: ${res.message}`);
    }
  };

  const handleDownloadHsc = () => {
    const blob = new Blob([hscSource], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scenario_scripts.hsc';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="script-editor-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 160,
      }}
    >
      <div
        style={{
          width: '94vw',
          maxWidth: 1320,
          height: '90vh',
          background: 'var(--bg-panel)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 14px 48px rgba(0,0,0,0.65)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-cyan)' }}>
              HaloScript (.hsc) Decompiler, Compiler & Sample Studio
            </span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 3,
                background: 'rgba(56, 189, 248, 0.12)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--mono-font)',
              }}
            >
              Scripts: {scriptCount} | Globals: {globalCount} | Syntax Nodes: {syntaxNodeCount}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="hs-reload-btn"
              onClick={loadFromMap}
              disabled={isBusy}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              Decompile from Map
            </button>
            <button
              data-testid="hs-export-btn"
              onClick={handleDownloadHsc}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                background: 'rgba(168, 85, 247, 0.15)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                color: '#c084fc',
                borderRadius: 3,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Export .hsc
            </button>
            <button
              data-testid="hs-close-btn"
              onClick={onClose}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Status banner */}
        {statusMessage && (
          <div
            data-testid="hs-status-banner"
            style={{
              padding: '7px 14px',
              fontSize: 11.5,
              background: statusMessage.includes('Failed') || statusMessage.includes('error')
                ? 'rgba(239, 68, 68, 0.16)'
                : 'rgba(34, 197, 94, 0.15)',
              color: statusMessage.includes('Failed') || statusMessage.includes('error') ? '#f87171' : '#4ade80',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {statusMessage}
          </div>
        )}

        {/* Main Split Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* Left Column: Sample Scripts & Scenario Setup Wizard */}
          <div
            style={{
              width: 430,
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(0,0,0,0.18)',
              overflowY: 'auto',
              padding: 12,
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 6 }}>
                SP / MP Sample Script Library & Guides
              </div>
              <select
                data-testid="hs-template-select"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-input, #1e1e1e)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 11.5,
                }}
              >
                {HALOSCRIPT_SAMPLE_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.title}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                padding: 10,
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11.5,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {selectedTemplate.title}
              </div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{selectedTemplate.summary}</div>

              <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: 4 }}>Step-by-Step Setup Guide:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-dim)', fontSize: 11 }}>
                {selectedTemplate.requiredSetupGuide.map((step, i) => (
                  <div key={i}>{step}</div>
                ))}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <button
                  data-testid="hs-auto-setup-entities-btn"
                  onClick={() => handleAutoSetupEntities(selectedTemplate)}
                  disabled={isBusy}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(251, 191, 36, 0.16)',
                    border: '1px solid rgba(251, 191, 36, 0.45)',
                    color: '#fbbf24',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Auto-Setup Scenario Entities
                </button>
                <button
                  data-testid="hs-load-template-btn"
                  onClick={() => setHscSource(selectedTemplate.hscSource)}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(56, 189, 248, 0.16)',
                    border: '1px solid rgba(56, 189, 248, 0.45)',
                    color: '#38bdf8',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Load Sample
                </button>
                <button
                  data-testid="hs-append-template-btn"
                  onClick={() => setHscSource((prev) => `${prev.trimEnd()}\n\n${selectedTemplate.hscSource}`)}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(34, 197, 94, 0.16)',
                    border: '1px solid rgba(34, 197, 94, 0.45)',
                    color: '#4ade80',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Append Sample
                </button>
              </div>
            </div>

            {/* Active Scenario Entities Inspector */}
            <div
              style={{
                padding: 10,
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                Scenario Script Entities in Current Map
              </div>
              <div>
                <strong>Object Names ({scenarioEntities.objectNames.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.objectNames.join(', ') || '(none)'}
                </span>
              </div>
              <div>
                <strong>Trigger Volumes ({scenarioEntities.triggerVolumes.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.triggerVolumes.join(', ') || '(none)'}
                </span>
              </div>
              <div>
                <strong>Cutscene Camera Points ({scenarioEntities.cutsceneCameraPoints.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.cutsceneCameraPoints.join(', ') || '(none)'}
                </span>
              </div>
              <div>
                <strong>AI Encounters ({scenarioEntities.encounters.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.encounters.join(', ') || '(none)'}
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: HSC Code Editor & Compiler Output */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderBottom: '1px solid var(--border)',
                background: 'rgba(0,0,0,0.12)',
              }}
            >
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)' }}>
                scenario.hsc — Lisp S-Expression Editor
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  data-testid="hs-lint-btn"
                  onClick={handleLint}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#38bdf8',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Validate / Lint (.hsc)
                </button>
                <button
                  data-testid="hs-compile-btn"
                  onClick={handleCompileIntoScenario}
                  disabled={isBusy}
                  style={{
                    padding: '5px 14px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: 'rgba(34, 197, 94, 0.2)',
                    border: '1px solid rgba(34, 197, 94, 0.5)',
                    color: '#4ade80',
                    borderRadius: 3,
                    cursor: isBusy ? 'wait' : 'pointer',
                  }}
                >
                  {isBusy ? 'Compiling...' : 'Compile into Scenario (In-Memory)'}
                </button>
              </div>
            </div>

            <textarea
              data-testid="hs-source-textarea"
              value={hscSource}
              onChange={(e) => setHscSource(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                width: '100%',
                boxSizing: 'border-box',
                background: '#0d1117',
                color: '#e6edf3',
                border: 'none',
                padding: 14,
                fontFamily: 'var(--mono-font)',
                fontSize: 12,
                lineHeight: 1.5,
                resize: 'none',
                outline: 'none',
              }}
            />

            {diagnostics.length > 0 && (
              <div
                data-testid="hs-diagnostics-list"
                style={{
                  maxHeight: 140,
                  overflowY: 'auto',
                  borderTop: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.35)',
                  padding: '8px 12px',
                }}
              >
                {diagnostics.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--mono-font)',
                      color: d.severity === 'error' ? '#f87171' : '#fbbf24',
                      marginBottom: 3,
                    }}
                  >
                    [Line {d.line}] {d.severity.toUpperCase()}: {d.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
