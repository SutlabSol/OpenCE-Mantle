import { useState, useEffect } from 'react';
import type { MapHeaderSummary, TagTestStatus } from '../../electron/shared-types';
import MapInfoPanel from './MapInfoPanel';
import ScenarioViewport from './viewport/ScenarioViewport';
import TagTestPanel from './TagTestPanel';

type Tab = 'overview' | 'viewport' | 'tag-test';

export default function CenterWorkspace({
  header,
  onOpenTagEditor,
}: {
  header: MapHeaderSummary;
  onOpenTagEditor?: (tagIndexOrPath: number | string) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [tagTestStatus, setTagTestStatus] = useState<TagTestStatus>({ state: 'stopped', telnetConnected: false });

  useEffect(() => {
    window.opence.tagTestGetStatus().then(setTagTestStatus);
    return window.opence.onTagTestStatusChange((s) => setTagTestStatus(s));
  }, []);

  // F5 shortcut to launch or switch to Tag Test
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        setTab('tag-test');
        if (tagTestStatus.state === 'running' && tagTestStatus.telnetConnected) {
          window.opence.tagTestHotReload();
        } else if (tagTestStatus.state === 'stopped') {
          window.opence.tagTestLaunch({ windowed: true });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tagTestStatus]);

  const isLive = tagTestStatus.state === 'running' && tagTestStatus.telnetConnected;

  return (
    <div data-testid="main-viewport-tabs" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
        <TabButton testid="center-tab-overview" label="Map Overview" active={tab === 'overview'} onClick={() => setTab('overview')} />
        <TabButton testid="center-tab-viewport" label="3D Viewport" active={tab === 'viewport'} onClick={() => setTab('viewport')} />
        <TabButton
          testid="center-tab-tag-test"
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>OpenCE Tag Test</span>
              {isLive && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#4caf50',
                    boxShadow: '0 0 6px #4caf50',
                  }}
                />
              )}
            </span>
          }
          active={tab === 'tag-test'}
          onClick={() => setTab('tag-test')}
        />
      </div>
      {tab === 'overview' ? (
        <MapInfoPanel header={header} />
      ) : tab === 'viewport' ? (
        <ScenarioViewport key={`${header.scenarioName}-${header.crc32}`} header={header} />
      ) : (
        <TagTestPanel onOpenTagEditor={onOpenTagEditor} />
      )}
    </div>
  );
}

function TabButton({
  testid,
  label,
  active,
  onClick,
}: {
  testid: string;
  label: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      style={{
        background: active ? 'var(--bg-panel)' : 'transparent',
        color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent-cyan)' : '2px solid transparent',
        padding: '8px 18px',
        fontSize: 12.5,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
