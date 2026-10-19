import { useState } from 'react';
import type { MapHeaderSummary } from '../../electron/shared-types';
import MapInfoPanel from './MapInfoPanel';
import ScenarioViewport from './viewport/ScenarioViewport';

type Tab = 'overview' | 'viewport';

export default function CenterWorkspace({ header }: { header: MapHeaderSummary }) {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div data-testid="main-viewport-tabs" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
        <TabButton testid="center-tab-overview" label="Map Overview" active={tab === 'overview'} onClick={() => setTab('overview')} />
        <TabButton testid="center-tab-viewport" label="3D Viewport" active={tab === 'viewport'} onClick={() => setTab('viewport')} />
      </div>
      {tab === 'overview' ? <MapInfoPanel header={header} /> : <ScenarioViewport header={header} />}
    </div>
  );
}

function TabButton({ testid, label, active, onClick }: { testid: string; label: string; active: boolean; onClick: () => void }) {
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
      }}
    >
      {label}
    </button>
  );
}
