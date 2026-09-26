import { MSG_TYPES, type Msg } from '../shared/messages.ts';

const CAP = 500;
const ROW_H = 15;

interface Entry {
  t: number;
  from: number;
  to: number | null;
  type: Msg['type'];
  text: string;
}

function describe(m: Msg): string {
  switch (m.type) {
    case 'HEARTBEAT': return `cell=${m.cell} ${m.state} bat=${m.battery} task=${m.taskId ?? '-'} prio=${m.priority}`;
    case 'INTENT': return `path[${m.path.length}] prio=${m.priority}`;
    case 'LEFT': return `cell=${m.cell}`;
    case 'CORRIDOR': return `${m.op} corridor=${m.corridorId} dir=${m.direction} prio=${m.priority}`;
    case 'TASK': return `${m.id} ${m.pickup}→${m.drop} ttl=${m.hopTTL}`;
    case 'BID': case 'RELEASE': case 'LOCK': return `${m.taskId} cost=${m.cost} by r${m.bidder}`;
    case 'DONE': return m.taskId;
    case 'BLOCKED': case 'CLEARED': return `cell=${m.cell} ttl=${m.ttl}`;
    case 'PROBE': return `init=r${m.initiator} path=[${m.path.join(',')}]${m.victim !== undefined ? ` victim=r${m.victim}` : ''}`;
    case 'LEARN': return `${m.edges.length / 3} edges`;
  }
}

/** Ring buffer (last 500) of transmitted messages with type/robot filters and a virtualised list. */
export class MessageLog {
  private buf: Entry[] = [];
  private head = 0;
  private typeSel!: HTMLSelectElement;
  private robotSel!: HTMLSelectElement;
  private rows!: HTMLDivElement;
  private inner!: HTMLDivElement;
  private dirty = true;
  paused = false;

  mount(el: HTMLElement): void {
    el.innerHTML = `<div class="filters"><b>Message log</b>
      <select class="type"><option value="">all types</option>${MSG_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
      <select class="robot"><option value="">all robots</option></select>
      <label><input type="checkbox" class="hb"> hide heartbeats</label></div>
      <div class="rows"><div class="inner" style="position:relative"></div></div>`;
    this.typeSel = el.querySelector('.type')!;
    this.robotSel = el.querySelector('.robot')!;
    this.rows = el.querySelector('.rows')!;
    this.inner = el.querySelector('.inner')!;
    const hb = el.querySelector<HTMLInputElement>('.hb')!;
    hb.checked = true;
    this.hideHb = () => hb.checked;
    for (const s of [this.typeSel, this.robotSel, hb]) s.addEventListener('change', () => (this.dirty = true));
    this.rows.addEventListener('scroll', () => (this.dirty = true));
  }
  private hideHb = (): boolean => true;

  setRobots(n: number): void {
    this.robotSel.innerHTML = `<option value="">all robots</option>` + Array.from({ length: n }, (_, i) => `<option value="${i}">r${i}</option>`).join('');
  }

  clear(): void {
    this.buf = [];
    this.head = 0;
    this.dirty = true;
  }

  push(t: number, from: number, to: number | null, m: Msg): void {
    const e = { t, from, to, type: m.type, text: '' };
    // text is built lazily on render; keep the message only for that
    (e as Entry & { m?: Msg }).m = m;
    if (this.buf.length < CAP) this.buf.push(e);
    else {
      this.buf[this.head] = e;
      this.head = (this.head + 1) % CAP;
    }
    this.dirty = true;
  }

  private ordered(): Entry[] {
    return this.buf.length < CAP ? this.buf : [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  render(): void {
    if (!this.dirty || !this.rows) return;
    this.dirty = false;
    const type = this.typeSel.value, robot = this.robotSel.value;
    const list = this.ordered().filter((e) => (!type || e.type === type) && (!robot || String(e.from) === robot || String(e.to) === robot)
      && !(this.hideHb() && !type && e.type === 'HEARTBEAT'));
    const atBottom = this.rows.scrollTop + this.rows.clientHeight >= this.inner.offsetHeight - ROW_H * 2;
    this.inner.style.height = `${list.length * ROW_H}px`;
    if (atBottom) this.rows.scrollTop = list.length * ROW_H;
    const first = Math.max(0, Math.floor(this.rows.scrollTop / ROW_H) - 2);
    const last = Math.min(list.length, first + Math.ceil(this.rows.clientHeight / ROW_H) + 4);
    let html = '';
    for (let i = first; i < last; i++) {
      const e = list[i] as Entry & { m?: Msg };
      if (!e.text && e.m) e.text = describe(e.m);
      const src = e.from >= 1000 ? `st${e.from - 1000}` : `r${e.from}`;
      html += `<div style="position:absolute;top:${i * ROW_H}px"><span class="t">${(e.t / 10).toFixed(1)}s</span> ${src}${e.to !== null ? `→r${e.to}` : ''} <b>${e.type}</b> ${e.text}</div>`;
    }
    this.inner.innerHTML = html;
  }
}
