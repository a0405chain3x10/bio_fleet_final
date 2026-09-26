import { PRESETS, type PresetName } from '../shared/maps.ts';

export type Tool = 'select' | 'obstacle' | 'deadzone' | 'kill' | 'shelf' | 'pickup' | 'dropoff' | 'charger' | 'bay' | 'eraser';

export interface Settings {
  preset: PresetName;
  seed: number;
  robots: number;
  taskMode: 'batch' | 'continuous';
  tasks: number;
  rate: number;
  mode: 'biofleet' | 'baseline';
  learned: boolean;
  runtime: 'worker' | 'inline';
  latMin: number;
  latMax: number;
  loss: number;
  range: number;
  speed: number;
  heat: boolean;
  tool: Tool;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'default', seed: 1, robots: 10, taskMode: 'batch', tasks: 50, rate: 20, mode: 'biofleet', learned: true,
  runtime: 'worker', latMin: 1, latMax: 2, loss: 0, range: 20, speed: 5, heat: false, tool: 'select',
};

export interface ControlEvents {
  play(): void;
  pause(): void;
  step(): void;
  reset(): void;
  preset(p: PresetName): void;
  radio(): void;
  clearZones(): void;
  changed(): void;
}

const TOOLS: [Tool, string][] = [['select', 'Select'], ['obstacle', 'Obstacle'], ['deadzone', 'Dead zone'], ['kill', 'Kill/revive']];
const MAP_TOOLS: [Tool, string][] = [['shelf', 'Shelf'], ['pickup', 'Pickup'], ['dropoff', 'Dropoff'], ['charger', 'Charger'], ['bay', 'Bay'], ['eraser', 'Eraser']];

/** Left control panel. Writes only to Settings and calls back into the app. */
export function mountControls(el: HTMLElement, s: Settings, ev: ControlEvents): { setRunning(r: boolean): void } {
  const toolBtns = (list: [Tool, string][]) => list.map(([k, l]) => `<button data-tool="${k}">${l}</button>`).join('');
  el.innerHTML = `
  <div class="group"><h4>Run</h4><div class="btns">
    <button id="play">▶ Play</button><button id="pause">⏸ Pause</button><button id="step">Step</button><button id="reset">⟲ Reset</button></div>
    <div class="row"><label>Speed</label><div class="btns" id="speeds">${[1, 2, 5, 20].map((v) => `<button data-speed="${v}">${v}×</button>`).join('')}</div></div></div>
  <div class="group"><h4>Scenario</h4>
    <div class="row"><label>Preset</label><select id="preset">${PRESETS.map((p) => `<option>${p}</option>`).join('')}</select></div>
    <div class="row"><label>Seed</label><input type="number" id="seed" min="1"></div>
    <div class="row"><label>Robots</label><input type="number" id="robots" min="1" max="20"></div>
    <div class="row"><label>Tasks</label><select id="taskMode"><option value="batch">batch</option><option value="continuous">per min</option></select><input type="number" id="tasks" min="1" max="500"></div></div>
  <div class="group"><h4>Coordination</h4><div class="btns" id="modes"><button data-mode="biofleet">BioFleet</button><button data-mode="baseline">Baseline</button></div>
    <div class="row"><label><input type="checkbox" id="learned"> learned costs (Edge-AI)</label></div>
    <div class="row"><label>Runtime</label><select id="runtime"><option value="worker">Web Workers</option><option value="inline">Inline</option></select></div></div>
  <div class="group"><h4>Radio (SimBus)</h4>
    <div class="row"><label>Latency min</label><input type="range" id="latMin" min="0" max="10"><span class="val" id="latMinV"></span></div>
    <div class="row"><label>Latency max</label><input type="range" id="latMax" min="0" max="10"><span class="val" id="latMaxV"></span></div>
    <div class="row"><label>Loss %</label><input type="range" id="loss" min="0" max="60"><span class="val" id="lossV"></span></div>
    <div class="row"><label>Range</label><input type="range" id="range" min="2" max="40"><span class="val" id="rangeV"></span></div></div>
  <div class="group"><h4>Tools</h4><div class="btns" id="tools">${toolBtns(TOOLS)}<button id="clearZones">Clear zones</button></div>
    <div class="row"><label><input type="checkbox" id="heat"> heatmap + flow (selected robot)</label></div></div>
  <div class="group"><h4>Map editor</h4><div class="btns" id="maptools">${toolBtns(MAP_TOOLS)}</div>
    <div class="legend">Editing the map resets the run. Validation runs before every start.</div></div>
  <div class="legend">Click a robot (or its card) to select it. Yellow tick = LED intent indicator; dashed line = planned window; tinted corridor = lock direction.</div>`;
  const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const num = (id: keyof Settings, after?: () => void) => {
    const inp = $<HTMLInputElement>(id);
    const v = $(`${id}V`) as HTMLElement | null;
    inp.value = String(s[id]);
    if (v) v.textContent = String(s[id]);
    inp.addEventListener('input', () => {
      (s[id] as number) = Number(inp.value);
      if (v) v.textContent = inp.value;
      after?.();
    });
  };
  num('seed', ev.changed);
  num('robots', ev.changed);
  num('latMin', ev.radio);
  num('latMax', ev.radio);
  num('loss', ev.radio);
  num('range', ev.radio);
  const tasks = $<HTMLInputElement>('tasks');
  const taskMode = $<HTMLSelectElement>('taskMode');
  const syncTasks = () => (tasks.value = String(s.taskMode === 'batch' ? s.tasks : s.rate));
  taskMode.value = s.taskMode;
  syncTasks();
  taskMode.addEventListener('change', () => {
    s.taskMode = taskMode.value as Settings['taskMode'];
    syncTasks();
    ev.changed();
  });
  tasks.addEventListener('input', () => {
    if (s.taskMode === 'batch') s.tasks = Number(tasks.value);
    else s.rate = Number(tasks.value);
    ev.changed();
  });
  const preset = $<HTMLSelectElement>('preset');
  preset.value = s.preset;
  preset.addEventListener('change', () => ev.preset((s.preset = preset.value as PresetName)));
  const learned = $<HTMLInputElement>('learned'), heat = $<HTMLInputElement>('heat'), runtime = $<HTMLSelectElement>('runtime');
  learned.checked = s.learned;
  heat.checked = s.heat;
  runtime.value = s.runtime;
  learned.addEventListener('change', () => ((s.learned = learned.checked), ev.changed()));
  heat.addEventListener('change', () => (s.heat = heat.checked));
  runtime.addEventListener('change', () => ((s.runtime = runtime.value as Settings['runtime']), ev.changed()));
  const group = (id: string, attr: string, key: keyof Settings, after?: () => void) => {
    const box = $(id);
    const paint = () => box.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === String(s[key])));
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(`button[data-${attr}]`);
      if (!b) return;
      (s as unknown as Record<string, unknown>)[key] = key === 'speed' ? Number(b.dataset[attr]) : b.dataset[attr];
      paint();
      after?.();
    });
    paint();
    return paint;
  };
  group('speeds', 'speed', 'speed');
  group('modes', 'mode', 'mode', ev.changed);
  const paintTools = [group('tools', 'tool', 'tool', () => paintTools.forEach((p) => p())), group('maptools', 'tool', 'tool', () => paintTools.forEach((p) => p()))];
  $('play').addEventListener('click', ev.play);
  $('pause').addEventListener('click', ev.pause);
  $('step').addEventListener('click', ev.step);
  $('reset').addEventListener('click', ev.reset);
  $('clearZones').addEventListener('click', ev.clearZones);
  return {
    setRunning: (r) => {
      $('play').classList.toggle('on', r);
      $('pause').classList.toggle('on', !r);
    },
  };
}
