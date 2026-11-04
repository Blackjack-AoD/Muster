import { useState } from 'preact/hooks';
import { back } from '../app';
import type { Opt } from '../data/catalog';
import { addSel, locate, removeSel, uid, unavailable, type RSel, type Sel } from '../data/engine';
import type { Profile, Rule } from '../data/model';
import type { RosterCtl } from '../store';
import { Pts, TopBar, fmtN } from './common';
import { Icon } from './Icon';
import { onOffPair, pick } from '../data/setup';
import { StatBlock } from './StatBlock';
import { cleanCat } from './RosterView';

export function UnitEditor({ ctl, selUid, backTo }: { ctl: RosterCtl; selUid: string; backTo: string }) {
  const rs = ctl.ev.find(selUid);
  const [tab, setTab] = useState<'options' | 'stats' | 'rules'>('options');
  if (!rs) {
    return (
      <div class="page">
        <TopBar title="Unit" backTo={backTo} />
        <p class="muted pad">This unit is no longer in the list.</p>
      </div>
    );
  }
  const isRoot = !rs.parent;
  const issues = ctl.ev.issues.filter(
    (i) => i.level === 'error' && i.selUid && (i.selUid === rs.sel.uid || under(rs, i.selUid)),
  );
  const cat = rs.eff.primary ? cleanCat(rs.force.ctx.categoryName(rs.eff.primary)) : '';
  const unitLike = rs.node.type === 'unit' || rs.node.type === 'model';
  // set-up entries (e.g. Expanded Army Lists) often have no profiles or rules: then there's only Options, and no tabs
  const hasStats = ctl.ev.profilesFor(rs).length > 0;
  const hasRules = ctl.ev.rulesFor(rs).length > 0;
  const tabs = (['options', 'stats', 'rules'] as const).filter(
    (t) => t === 'options' || (t === 'stats' ? hasStats : hasRules),
  );

  return (
    <div class="page unit-page">
      <TopBar
        title={rs.eff.name}
        sub={cat}
        backTo={backTo}
        right={unitLike || rs.total ? <Pts v={rs.total} /> : null}
      />
      {tabs.length > 1 && (
        <div class="tabs" role="tablist">
          {tabs.map((t) => (
            <button role="tab" aria-selected={tab === t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'options' ? 'Options' : t === 'stats' ? 'Profiles' : 'Rules'}
            </button>
          ))}
        </div>
      )}
      {issues.length > 0 && tab === 'options' && (
        <ul class="issues inline">
          {issues.map((i) => (
            <li class="error">
              <Icon name="warn" size={16} />
              <span>{i.message.split(' › ').pop()}</span>
            </li>
          ))}
        </ul>
      )}
      {tab === 'options' && (
        <>
          <ProfileStrip ctl={ctl} rs={rs} />
          {switchesOnly(ctl, rs) ? (
            <div class="opts switches">
              {switchesOnly(ctl, rs)!.map(({ g, pair }) => (
                <ToggleRow key={g.key} ctl={ctl} rs={rs} g={g} pair={pair} />
              ))}
            </div>
          ) : (
            <OptList ctl={ctl} rs={rs} opts={rs.force.ctx.options(rs.node)} depth={0} />
          )}
          {!hasVisibleOptions(ctl, rs) && (
            <p class="muted pad">
              Nothing to choose here yet. Some choices open up once other units or options are in the list (for example,
              a Rite of War needs a Primarch, or a character with Master of the Legion).
            </p>
          )}
          {!ctl.scratch && isRoot && unitLike && (
            <div class="unit-actions">
              <button
                class="btn"
                onClick={() => {
                  ctl.mutate((r) => {
                    const f = r.forces.find((x) => x.uid === rs.force.force.uid)!;
                    const copy = reUid(structuredClone(rs.sel));
                    f.selections.splice(f.selections.findIndex((s) => s.uid === rs.sel.uid) + 1, 0, copy);
                  });
                  back(backTo);
                }}
              >
                <Icon name="copy" /> Duplicate
              </button>
              <button
                class="btn danger"
                onClick={() => {
                  ctl.mutate((r) => removeSel(r, rs.sel.uid));
                  back(backTo);
                }}
              >
                <Icon name="trash" /> Remove
              </button>
            </div>
          )}
        </>
      )}
      {tab === 'stats' && <Profiles ctl={ctl} profiles={ctl.ev.profilesFor(rs)} />}
      {tab === 'rules' && <Rules ctl={ctl} rs={rs} />}
    </div>
  );
}

type Pair = { on: Opt; off: Opt };

function hasVisibleMember(ev: RosterCtl['ev'], rs: RSel, g: Opt, d = 0): boolean {
  if (d > 6) return true;
  return g.members.some((m) => {
    const e = ev.optionEff(m, rs, rs.force);
    if (e.hidden || unavailable(e)) return ev.selected(m, rs, rs.force).length > 0;
    return m.kind === 'entry' || hasVisibleMember(ev, rs, m, d + 1);
  });
}

function ToggleRow({ ctl, rs, g, pair }: { ctl: RosterCtl; rs: RSel; g: Opt; pair: Pair }) {
  const on = ctl.ev.selected(g, rs, rs.force).some((c) => c.opt.key === pair.on.key);
  return (
    <button
      class={'toggle-row' + (on ? ' on' : '')}
      role="switch"
      aria-checked={on}
      onClick={() => ctl.mutate((r) => pick(r, ctl.contexts, rs, g, on ? pair.off : pair.on))}
    >
      <span class="o-name">{ctl.ev.optionEff(g, rs, rs.force).name}</span>
      <span class="switch">
        <span class="knob" />
      </span>
    </button>
  );
}

/**
 * When everything an entry offers is On/Off switches (possibly tucked inside headed groups, like Expanded Army Lists),
 * list the switches flat, without the group headings.
 */
function switchesOnly(ctl: RosterCtl, rs: RSel): { g: Opt; pair: Pair }[] | null {
  const out: { g: Opt; pair: Pair }[] = [];
  const visible = (o: Opt) => {
    const e = ctl.ev.optionEff(o, rs, rs.force);
    return !e.hidden && !unavailable(e);
  };
  const walk = (opts: Opt[]): boolean => {
    for (const o of opts.filter(visible)) {
      if (o.kind !== 'group') return false;
      const pair = onOffPair(o.members.filter(visible));
      if (pair) out.push({ g: o, pair });
      else if (!walk(o.members)) return false;
    }
    return true;
  };
  return walk(rs.force.ctx.options(rs.node)) && out.length > 1 ? out : null;
}

function hasVisibleOptions(ctl: RosterCtl, rs: RSel) {
  return rs.force.ctx.options(rs.node).some((o) => {
    const e = ctl.ev.optionEff(o, rs, rs.force);
    return (!e.hidden && !unavailable(e)) || ctl.ev.selected(o, rs, rs.force).length > 0;
  });
}

function under(r: RSel, selUid: string): boolean {
  return r.children.some((c) => c.sel.uid === selUid || under(c, selUid));
}
function reUid(s: Sel): Sel {
  s.uid = uid();
  s.children.forEach(reUid);
  return s;
}

/** Compact headline stats (unit profiles) on the options tab. */
function ProfileStrip({ ctl, rs }: { ctl: RosterCtl; rs: RSel }) {
  const all = ctl.ev.profilesFor(rs);
  const types = [...new Set(all.map((p) => p.typeName))];
  const main = types.find((t) => /unit|model|vehicle|knight|titan|walker|infantry|primarch/i.test(t)) ?? types[0];
  const list = all.filter((p) => p.typeName === main && p.characteristics.every((c) => c.value.length < 30));
  if (!list.length) return null;
  return (
    <div class="strip">
      <StatBlock profiles={list} />
    </div>
  );
}

function OptList({ ctl, rs, opts, depth }: { ctl: RosterCtl; rs: RSel; opts: Opt[]; depth: number }) {
  return (
    <div class={'opts' + (depth ? ' nested' : '')}>
      {opts.map((o) =>
        o.kind === 'group' ? (
          <GroupBlock key={o.key} ctl={ctl} rs={rs} g={o} depth={depth} />
        ) : (
          <OptRow key={o.key} ctl={ctl} rs={rs} o={o} depth={depth} />
        ),
      )}
    </div>
  );
}

export function limitText(min: number, max: number) {
  if (max === 1 && min === 1) return 'pick 1';
  if (max === 1) return 'up to 1';
  if (min > 0 && max > 0) return min === max ? `pick ${min}` : `${min}–${max}`;
  if (max > 0) return `up to ${max}`;
  if (min > 0) return `at least ${min}`;
  return '';
}

function GroupBlock({ ctl, rs, g, depth }: { ctl: RosterCtl; rs: RSel; g: Opt; depth: number }) {
  const { ev } = ctl;
  const eff = ev.optionEff(g, rs, rs.force);
  const chosen = ev.selected(g, rs, rs.force);
  const n = chosen.reduce((t, c) => t + c.sel.number, 0);
  const { min, max } = ev.limits(g, rs, rs.force, eff);
  const [open, setOpen] = useState(depth > 0 ? n > 0 || min > 0 : true);
  if ((eff.hidden || unavailable(eff)) && !n) return null;
  // a heading with nothing under it right now (every option hidden by conditions) is just noise
  if (!n && !hasVisibleMember(ev, rs, g)) return null;
  // "X On" / "X Off" pair: a single switch
  const pair = onOffPair(
    g.members.filter((m) => {
      const e = ev.optionEff(m, rs, rs.force);
      return !e.hidden && !unavailable(e);
    }),
  );
  if (pair) return <ToggleRow ctl={ctl} rs={rs} g={g} pair={pair} />;
  const radio = max === 1 && g.members.every((m) => m.kind === 'entry');
  // a group of On/Off switches needs no "· n" count
  const allSwitches = g.members.length > 0 && g.members.every((m) => m.kind === 'group' && onOffPair(m.members));
  const bad = (min > 0 && n < min) || (max >= 0 && n > max);

  return (
    <div class="group">
      <button class="group-head" onClick={() => setOpen(!open)}>
        <span class="g-name">{eff.name}</span>
        <span class={'g-lim' + (bad ? ' bad' : '')}>
          {limitText(min, max)}
          {max !== 1 && n && !allSwitches ? ` · ${n}` : ''}
        </span>
        <Icon name={open ? 'down' : 'chev'} size={16} />
      </button>
      {open &&
        (radio ? (
          <div class="opts">
            {g.members.map((m) => (
              <RadioRow key={m.key} ctl={ctl} rs={rs} g={g} o={m} required={min >= 1} depth={depth} />
            ))}
          </div>
        ) : (
          <OptList ctl={ctl} rs={rs} opts={g.members} depth={depth} />
        ))}
    </div>
  );
}

function groupFull(ctl: RosterCtl, rs: RSel, o: Opt) {
  // walk up enclosing groups: any one at its max blocks adding more
  for (let i = o.groupIds.length - 1; i >= 0; i--) {
    const gid = o.groupIds[i];
    const g = findGroup(ctl.ev.ctxFor(rs.force.force).options(rs.node), gid);
    if (!g) continue;
    const { max } = ctl.ev.limits(g, rs, rs.force);
    if (max < 0) continue;
    const n = ctl.ev.selected(g, rs, rs.force).reduce((t, c) => t + c.sel.number, 0);
    if (n >= max) return true;
  }
  return false;
}
function findGroup(opts: Opt[], id: string): Opt | undefined {
  for (const o of opts) {
    if (o.kind !== 'group') continue;
    if (o.node.id === id || o.node.linkId === id) return o;
    const r = findGroup(o.members, id);
    if (r) return r;
  }
  return undefined;
}

/** Make room in a full group by dropping one of the other choices (e.g. swap the default pistol for a fist). */
function swapIn(ctl: RosterCtl, rs: RSel, o: Opt, newCount: number) {
  const ctx = ctl.ev.ctxFor(rs.force.force);
  let group: Opt | undefined;
  for (let i = o.groupIds.length - 1; i >= 0 && !group; i--) {
    const g = findGroup(ctx.options(rs.node), o.groupIds[i]);
    if (!g) continue;
    const { max } = ctl.ev.limits(g, rs, rs.force);
    const n = ctl.ev.selected(g, rs, rs.force).reduce((t, c) => t + c.sel.number, 0);
    if (max >= 0 && n >= max) group = g;
  }
  if (!group) return setCount(ctl, rs, o, newCount);
  const others = ctl.ev.selected(group, rs, rs.force).filter((c) => c.opt.key !== o.key);
  // prefer dropping something that isn't mandatory, cheapest first
  const victim = others
    .filter((c) => ctl.ev.limits(c.opt, rs, rs.force).min < c.sel.number)
    .sort((a, b) => a.total - b.total)[0];
  if (!victim) return;
  ctl.mutate((r) => {
    const parent = locate(r, rs.sel.uid)!.sel;
    const v = parent.children.find((c) => c.uid === victim.sel.uid)!;
    if (v.number > 1) v.number--;
    else parent.children = parent.children.filter((c) => c !== v);
    const mine = parent.children.filter((c) => c.key === o.key);
    if (mine.length) mine[mine.length - 1].number++;
    else addSel(r, ctl.contexts, rs.force.force.uid, rs.sel.uid, o, newCount);
  });
}

function costLabel(v: number | undefined, each = false) {
  if (!v) return null;
  return (
    <span class="o-pts">
      {v > 0 ? '+' : ''}
      {fmtN(v)}
      {each ? <small> ea</small> : null}
    </span>
  );
}

function setCount(ctl: RosterCtl, rs: RSel, o: Opt, n: number) {
  ctl.mutate((r) => {
    const parent = locate(r, rs.sel.uid)!.sel;
    const mine = parent.children.filter((c) => c.key === o.key);
    if (n <= 0) {
      parent.children = parent.children.filter((c) => c.key !== o.key);
      return;
    }
    if (mine.length) {
      let diff = n - mine.reduce((t, c) => t + c.number, 0);
      if (diff > 0) {
        // new models join the biggest group (they copy its wargear)
        mine.reduce((a, c) => (c.number > a.number ? c : a)).number += diff;
        return;
      }
      // fewer: take from split-off rows first (the latest), then the main group
      for (let i = mine.length - 1; i >= 0 && diff < 0; i--) {
        const take = Math.min(mine[i].number, -diff);
        mine[i].number -= take;
        diff += take;
      }
      parent.children = parent.children.filter((c) => c.number > 0);
      return;
    }
    addSel(r, ctl.contexts, rs.force.force.uid, rs.sel.uid, o, n);
  });
}

function OptRow({ ctl, rs, o, depth }: { ctl: RosterCtl; rs: RSel; o: Opt; depth: number }) {
  const { ev } = ctl;
  const eff = ev.optionEff(o, rs, rs.force);
  const chosen = ev.selected(o, rs, rs.force);
  const n = chosen.reduce((t, c) => t + c.sel.number, 0);
  if ((eff.hidden || unavailable(eff)) && !n) return null;
  const { min, max } = ev.limits(o, rs, rs.force, eff);
  const full = groupFull(ctl, rs, o);
  const cost = eff.costs.get(ev.pointsTypeId);
  const bad = (min > 0 && n < min) || (max >= 0 && n > max);

  const control =
    max === 1 ? (
      <button
        class={'check' + (n ? ' on' : '')}
        role="checkbox"
        aria-checked={n > 0}
        disabled={n > 0 && min >= 1}
        onClick={() => (n ? setCount(ctl, rs, o, 0) : full ? swapIn(ctl, rs, o, 1) : setCount(ctl, rs, o, 1))}
      >
        <span class="box">{n > 0 && <Icon name="check" size={16} />}</span>
        <span class="o-name">{eff.name}</span>
        {costLabel(cost, rs.sel.number > 1)}
      </button>
    ) : (
      <div class={'stepper-row' + (bad ? ' bad' : '')}>
        <span class="o-name">
          {eff.name}
          {max > 1 && <small class="muted"> (max {max})</small>}
        </span>
        {costLabel(cost, rs.sel.number > 1)}
        <div class="stepper">
          <button aria-label={'Fewer ' + eff.name} disabled={n <= min} onClick={() => setCount(ctl, rs, o, n - 1)}>
            <Icon name="minus" size={18} />
          </button>
          <span class={'count' + (n ? ' on' : '')}>{n}</span>
          <button
            aria-label={'More ' + eff.name}
            disabled={max >= 0 && n >= max}
            onClick={() => (full ? swapIn(ctl, rs, o, n + 1) : setCount(ctl, rs, o, n + 1))}
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
      </div>
    );
  return (
    <div class="opt">
      {control}
      {chosen.map((c) => (
        <Sub key={c.sel.uid} ctl={ctl} rs={c} depth={depth} />
      ))}
    </div>
  );
}

function RadioRow({
  ctl,
  rs,
  g,
  o,
  required,
  depth,
}: {
  ctl: RosterCtl;
  rs: RSel;
  g: Opt;
  o: Opt;
  required: boolean;
  depth: number;
}) {
  const { ev } = ctl;
  const eff = ev.optionEff(o, rs, rs.force);
  const chosen = ev.selected(o, rs, rs.force);
  const on = chosen.length > 0;
  if ((eff.hidden || unavailable(eff)) && !on) return null;
  const cost = eff.costs.get(ev.pointsTypeId);
  const pick = () => {
    if (on) {
      if (!required) setCount(ctl, rs, o, 0);
      return;
    }
    ctl.mutate((r) => {
      const parent = locate(r, rs.sel.uid)!.sel;
      parent.children = parent.children.filter((c) => !c.key.startsWith(g.key + '/'));
      addSel(r, ctl.contexts, rs.force.force.uid, rs.sel.uid, o, 1);
    });
  };
  return (
    <div class="opt">
      <button class={'radio' + (on ? ' on' : '')} role="radio" aria-checked={on} onClick={pick}>
        <span class="dot" />
        <span class="o-name">{eff.name}</span>
        {costLabel(cost, rs.sel.number > 1)}
      </button>
      {chosen.map((c) => (
        <Sub key={c.sel.uid} ctl={ctl} rs={c} depth={depth} />
      ))}
    </div>
  );
}

/** Options belonging to a selected child (e.g. a model's wargear). */
function Sub({ ctl, rs, depth }: { ctl: RosterCtl; rs: RSel; depth: number }) {
  const opts = rs.force.ctx.options(rs.node);
  const visible = opts.filter((o) => {
    const e = ctl.ev.optionEff(o, rs, rs.force);
    return (!e.hidden && !unavailable(e)) || ctl.ev.selected(o, rs, rs.force).length;
  });
  const siblings = rs.parent ? rs.parent.children.filter((c) => c.opt.key === rs.opt.key) : [];
  // a model just split off its group opens straight away, ready for its own wargear
  const [open, setOpen] = useState(depth < 1 || (siblings.length > 1 && siblings.indexOf(rs) > 0));
  if (!visible.length || depth > 6) return null;
  // offer "Merge" on the later row only, back into an earlier row with identical wargear
  const twin = siblings.slice(0, siblings.indexOf(rs)).find((c) => sameGear(c.sel, rs.sel));
  const n = rs.sel.number;
  return (
    <div class="subopts">
      <div class="sub-bar">
        <button class="sub-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name={open ? 'down' : 'chev'} size={14} />
          <span>
            {n > 1 ? `${n}× ` : siblings.length > 1 ? '1× ' : ''}
            {rs.eff.name}
          </span>
          {rs.total ? <span class="o-pts">{fmtN(rs.total)}</span> : null}
        </button>
        {n > 1 && !ctl.scratch && (
          <button class="mini" title="Give one model different wargear" onClick={() => splitOne(ctl, rs)}>
            Split 1
          </button>
        )}
        {twin && !ctl.scratch && (
          <button
            class="mini"
            title="Same wargear as another group: combine them"
            onClick={() => mergeInto(ctl, rs, twin)}
          >
            Merge
          </button>
        )}
      </div>
      {open && <OptList ctl={ctl} rs={rs} opts={visible} depth={depth + 1} />}
    </div>
  );
}

/** same option tree and counts (ignoring uids) */
function gearSig(s: Sel): string {
  return s.children
    .map((c) => `${c.key}*${c.number}(${gearSig(c)})`)
    .sort()
    .join(',');
}
function sameGear(a: Sel, b: Sel) {
  return gearSig(a) === gearSig(b);
}

/** Separate one model from a group so it can take its own wargear. */
function splitOne(ctl: RosterCtl, rs: RSel) {
  ctl.mutate((r) => {
    const loc = locate(r, rs.sel.uid);
    if (!loc || loc.sel.number < 2) return;
    loc.sel.number--;
    const copy = reUid(structuredClone(loc.sel));
    copy.number = 1;
    loc.list.splice(loc.list.indexOf(loc.sel) + 1, 0, copy);
  });
}

function mergeInto(ctl: RosterCtl, rs: RSel, into: RSel) {
  ctl.mutate((r) => {
    const a = locate(r, rs.sel.uid);
    const b = locate(r, into.sel.uid);
    if (!a || !b) return;
    b.sel.number += a.sel.number;
    a.list.splice(a.list.indexOf(a.sel), 1);
  });
}

// ---------- profiles & rules ----------
export function Profiles({ ctl, profiles }: { ctl: RosterCtl; profiles: Profile[] }) {
  if (!profiles.length) return <p class="muted pad">No profiles for this unit.</p>;
  const types = [...new Set(profiles.map((p) => p.typeName))];
  return (
    <div class="profiles">
      {types.map((t) => {
        const list = profiles.filter((p) => p.typeName === t);
        const long =
          list.some((p) => p.characteristics.some((c) => c.value.length > 40)) || list[0].characteristics.length <= 1;
        return (
          <section class="ptype">
            <h3>{t}</h3>
            {long ? (
              list.map((p) => (
                <div class="pcard">
                  <b>{p.name}</b>
                  {p.characteristics.map(
                    (c) =>
                      c.value && (
                        <p>
                          <span class="muted">{c.name}:</span> {c.value}
                        </p>
                      ),
                  )}
                </div>
              ))
            ) : (
              <div class="pad-x">
                <StatBlock profiles={list} />
              </div>
            )}
          </section>
        );
      })}
      <div class="foot-space" />
      <span hidden>{ctl.roster.uid}</span>
    </div>
  );
}

export function ProfileTable({ profiles }: { profiles: Profile[] }) {
  const cols = profiles[0].characteristics.map((c) => c.name);
  return (
    <div class="table-wrap">
      <table class="ptable">
        <thead>
          <tr>
            <th>Name</th>
            {cols.map((c) => (
              <th>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr>
              <td class="pname">{p.name}</td>
              {cols.map((c) => (
                <td>{p.characteristics.find((x) => x.name === c)?.value ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Rules({ ctl, rs }: { ctl: RosterCtl; rs: RSel }) {
  const rules = ctl.ev.rulesFor(rs);
  // rules on the army's set-up (Legion, Allegiance...) apply to every unit; list them after the unit's own
  const unitLike = rs.node.type === 'unit' || rs.node.type === 'model';
  const own = new Set(rules.map((r) => r.name));
  const army = unitLike ? ctl.ev.armyRules(rs.force).filter((r) => !own.has(r.name)) : [];
  const [q, setQ] = useState('');
  if (!rules.length && !army.length) return <p class="muted pad">No special rules listed.</p>;
  const match = (r: Rule) => (r.name + ' ' + r.description).toLowerCase().includes(q.toLowerCase());
  const item = (r: Rule) => (
    <details class="rule">
      <summary>{r.name}</summary>
      <p>{r.description || <span class="muted">No description in the data.</span>}</p>
    </details>
  );
  const shownArmy = army.filter(match);
  return (
    <div class="rules">
      {rules.length + army.length > 8 && (
        <div class="search">
          <Icon name="search" size={18} />
          <input placeholder="Search rules" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </div>
      )}
      {rules.filter(match).map(item)}
      {shownArmy.length > 0 && (
        <>
          <h3 class="rules-head">Army-wide rules</h3>
          {shownArmy.map(item)}
        </>
      )}
    </div>
  );
}
