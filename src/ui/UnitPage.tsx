import { useRosterCtl, useStore } from '../store';
import { Loading, TopBar } from './common';
import { UnitEditor } from './UnitEditor';

export function UnitPage({ rosterUid, selUid }: { rosterUid: string; selUid: string }) {
  const roster = useStore((s) => s.rosters.find((r) => r.uid === rosterUid));
  const { ctl, error, loading } = useRosterCtl(roster);
  const backTo = `/r/${rosterUid}`;
  if (loading) return <div class="page"><TopBar title="Unit" backTo={backTo} /><Loading label="Loading army data…" /></div>;
  if (!ctl) return <div class="page"><TopBar title="Unit" backTo={backTo} /><p class="error-text pad">{error}</p></div>;
  return <UnitEditor ctl={ctl} selUid={selUid} backTo={backTo} />;
}
