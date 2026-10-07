import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";

const COL = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"];
const R = 34;

type Machine = { id: number; cores: number; queues: number };
type Service = { id: number; inst: string; name: string; domain: string; machine: number; threads: number; cores: number; x: number; y: number };
type Edge = { id: number; a: number; b: number; bi: boolean };
type Sel = { t: "s" | "e"; id: number } | null;
type Drag = { t: "move"; id: number; dx: number; dy: number } | { t: "link"; id: number; x: number; y: number } | null;

const initServices: Service[] = [
  { id: 1, inst: "nginx", name: "nginx", domain: "", machine: 0, threads: 4, cores: 2, x: 120, y: 90 },
  { id: 2, inst: "memcached", name: "memcached", domain: "", machine: 0, threads: 4, cores: 2, x: 270, y: 90 },
];

export function GraphBuilder() {
  const [machines, setMachines] = useState<Machine[]>([{ id: 0, cores: 40, queues: 20 }]);
  const [services, setServices] = useState<Service[]>(initServices);
  const [edges, setEdges] = useState<Edge[]>([{ id: 3, a: 1, b: 2, bi: false }]);
  const [clientLat, setClientLat] = useState(0);
  const [linkLat, setLinkLat] = useState(50000);
  const [sel, setSel] = useState<Sel>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [tab, setTab] = useState(0);
  const [cpm, setCpm] = useState("");
  const nRef = useRef(3);
  const svgRef = useRef<SVGSVGElement>(null);

  const svc = (id: number) => services.find((s) => s.id === id);
  const mcol = (m: number) => COL[machines.findIndex((x) => x.id === m) % COL.length] || COL[0];
  const updSvc = (id: number, p: Partial<Service>) => setServices((ss) => ss.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const updEdge = (id: number, p: Partial<Edge>) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)));

  const addService = () => {
    const i = services.length, id = ++nRef.current;
    setServices([...services, { id, inst: "svc" + i, name: "svc" + i, domain: "", machine: machines[0].id, threads: 4, cores: 2, x: 120 + (i % 4) * 150, y: 90 + Math.floor(i / 4) * 130 }]);
    setSel({ t: "s", id });
  };
  const addMachine = () => setMachines([...machines, { id: Math.max(-1, ...machines.map((m) => m.id)) + 1, cores: 40, queues: 20 }]);
  const delSel = () => {
    if (!sel) return;
    if (sel.t === "s") {
      setServices((ss) => ss.filter((x) => x.id !== sel.id));
      setEdges((es) => es.filter((e) => e.a !== sel.id && e.b !== sel.id));
    } else setEdges((es) => es.filter((e) => e.id !== sel.id));
    setSel(null);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") delSel();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  });

  const pt = (ev: RPE) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const onDown = (ev: RPE<SVGSVGElement>) => {
    const p = pt(ev);
    const t = (ev.target as Element).closest("[data-n],[data-h],[data-e]") as HTMLElement | null;
    const d = t?.dataset;
    if (d?.h) setDrag({ t: "link", id: +d.h, x: p.x, y: p.y });
    else if (d?.n) {
      const s = svc(+d.n)!;
      setSel({ t: "s", id: s.id });
      setDrag({ t: "move", id: s.id, dx: p.x - s.x, dy: p.y - s.y });
    } else if (d?.e) setSel({ t: "e", id: +d.e });
    else setSel(null);
    svgRef.current!.setPointerCapture(ev.pointerId);
  };
  const onMove = (ev: RPE<SVGSVGElement>) => {
    if (!drag) return;
    const p = pt(ev);
    if (drag.t === "move") updSvc(drag.id, { x: p.x - drag.dx, y: p.y - drag.dy });
    else setDrag({ ...drag, x: p.x, y: p.y });
  };
  const onUp = (ev: RPE<SVGSVGElement>) => {
    const d = drag;
    setDrag(null);
    if (d?.t === "link") {
      const p = pt(ev);
      const tg = services.find((s) => s.id !== d.id && Math.hypot(s.x - p.x, s.y - p.y) <= R + 6);
      if (tg && !edges.some((e) => e.a === d.id && e.b === tg.id)) {
        const id = ++nRef.current;
        setEdges([...edges, { id, a: d.id, b: tg.id, bi: false }]);
        setSel({ t: "e", id });
      }
    }
  };

  const built = useMemo(() => {
    const warns: string[] = [];
    const mac = machines.map((m) => {
      const q = [...Array(m.queues).keys()];
      return { net_stack_sched: { num_queues: m.queues, type: "LinuxNetStack", core_affinity: q.map((i) => ({ queue: i, cores: [i] })), cores: q }, machine_id: m.id, total_cores: m.cores, name: "machine_" + m.id };
    });
    const next: Record<number, number> = {};
    machines.forEach((m) => (next[m.id] = m.queues));
    const groups: Record<string, { service_name: string; service_domain: string; instances: unknown[] }> = {};
    services.forEach((s) => {
      const m = machines.find((x) => x.id === s.machine)!;
      const st = next[s.machine];
      const cores = [...Array(s.cores).keys()].map((i) => st + i);
      next[s.machine] = st + s.cores;
      if (st + s.cores > m.cores) warns.push(`${s.inst}: cores ${st}-${st + s.cores - 1} exceed machine_${m.id} total (${m.cores})`);
      const k = s.name + "|" + s.domain;
      (groups[k] ||= { service_name: s.name, service_domain: s.domain, instances: [] }).instances.push({ inst_name: s.inst, machine_id: s.machine, threads: s.threads, cores });
    });
    const sv = (id: number) => services.find((s) => s.id === id)!;
    const ed = edges.map((e) => ({ source: sv(e.a).inst, target: sv(e.b).inst, bidirectional: e.bi }));
    const names = services.map((s) => s.inst);
    if (new Set(names).size < names.length) warns.push("Duplicate instance names");
    const pairs: Record<string, [number, number]> = {};
    edges.forEach((e) => {
      const a = sv(e.a).machine, b = sv(e.b).machine;
      if (a !== b) pairs[Math.min(a, b) + "-" + Math.max(a, b)] = [Math.min(a, b), Math.max(a, b)];
    });
    const links = Object.values(pairs).map(([a, b]) => ({ machine_a: a, machine_b: b, latency: linkLat }));
    return { files: [{ client_latency: clientLat, machines: mac }, { services: Object.values(groups), edges: ed }, { links }], warns };
  }, [machines, services, edges, clientLat, linkLat]);
  const out = JSON.stringify(built.files[tab], null, 2);

  const copy = async () => {
    try { await navigator.clipboard.writeText(out); setCpm("Copied"); } catch { setCpm("Press Ctrl/Cmd+C"); }
  };

  const selS = sel?.t === "s" ? svc(sel.id) : undefined;
  const selE = sel?.t === "e" ? edges.find((e) => e.id === sel.id) : undefined;
  const dragA = drag?.t === "link" ? svc(drag.id) : undefined;

  return (
    <div className="gb">
      <header>
        <b className="mr-2">uqsim Graph Builder</b>
        <button className="p" onClick={addService}>+ Service</button>
        <button onClick={addMachine}>+ Machine</button>
        <button onClick={delSel}>Delete selected</button>
        <span className="hint">Drag nodes to move. Drag the ▶ handle on a selected node onto another node to create an arrow.</span>
      </header>
      <main>
        <div className="cv">
          <svg ref={svgRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
            <defs>
              <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" style={{ fill: "var(--edge)" }} />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = svc(e.a), b = svc(e.b);
              if (!a || !b) return null;
              const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
              const o = R + (e.bi ? 6 : 0);
              const c = { x1: a.x + ux * o, y1: a.y + uy * o, x2: b.x - ux * (R + 6), y2: b.y - uy * (R + 6) };
              const on = sel?.t === "e" && sel.id === e.id;
              return (
                <g key={e.id} data-e={e.id} style={{ cursor: "pointer" }}>
                  <line {...c} stroke="transparent" strokeWidth={14} />
                  <line {...c} style={{ stroke: on ? "var(--primary)" : "var(--edge)" }} strokeWidth={on ? 3 : 2} markerEnd="url(#ar)" markerStart={e.bi ? "url(#ar)" : undefined} />
                </g>
              );
            })}
            {dragA && drag?.t === "link" && (
              <line x1={dragA.x + R} y1={dragA.y} x2={drag.x} y2={drag.y} style={{ stroke: "var(--primary)" }} strokeDasharray="5 4" strokeWidth={2} markerEnd="url(#ar)" />
            )}
            {services.map((s) => {
              const on = sel?.t === "s" && sel.id === s.id;
              return (
                <g key={s.id}>
                  <g data-n={s.id} style={{ cursor: "grab" }}>
                    <circle cx={s.x} cy={s.y} r={R} fill={mcol(s.machine)} fillOpacity={0.18} stroke={mcol(s.machine)} strokeWidth={on ? 4 : 2} />
                    <text x={s.x} y={s.y + 4} textAnchor="middle">{s.inst.slice(0, 10)}</text>
                    <text x={s.x} y={s.y + R + 16} textAnchor="middle" style={{ fill: "var(--muted-foreground)" }}>{s.name} · m{s.machine}</text>
                  </g>
                  {on && (
                    <g data-h={s.id} style={{ cursor: "crosshair" }}>
                      <circle cx={s.x + R + 12} cy={s.y} r={11} style={{ fill: "var(--primary)" }} />
                      <text x={s.x + R + 12} y={s.y + 4} textAnchor="middle" style={{ fill: "var(--primary-foreground)", fontSize: 11 }}>▶</text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <aside>
          {selS ? (
            <>
              <h4>Service</h4>
              <label>Instance name</label><input value={selS.inst} onChange={(e) => updSvc(selS.id, { inst: e.target.value })} />
              <label>Service name</label><input value={selS.name} onChange={(e) => updSvc(selS.id, { name: e.target.value })} />
              <label>Service domain</label><input value={selS.domain} onChange={(e) => updSvc(selS.id, { domain: e.target.value })} />
              <div className="row">
                <div><label>Machine</label>
                  <select value={selS.machine} onChange={(e) => updSvc(selS.id, { machine: +e.target.value })}>
                    {machines.map((m) => <option key={m.id} value={m.id}>machine_{m.id}</option>)}
                  </select></div>
                <div><label>Threads</label><input type="number" min={1} value={selS.threads} onChange={(e) => updSvc(selS.id, { threads: +e.target.value })} /></div>
                <div><label>Cores</label><input type="number" min={1} value={selS.cores} onChange={(e) => updSvc(selS.id, { cores: +e.target.value })} /></div>
              </div>
            </>
          ) : selE ? (
            <>
              <h4>Link</h4>
              <p>{svc(selE.a)?.inst} → {svc(selE.b)?.inst}</p>
              <label><input type="checkbox" style={{ width: "auto" }} checked={selE.bi} onChange={(e) => updEdge(selE.id, { bi: e.target.checked })} /> Bidirectional</label>
              <button className="mt-1.5" onClick={() => updEdge(selE.id, { a: selE.b, b: selE.a })}>Reverse direction</button>
            </>
          ) : (
            <><h4>Selection</h4><p className="hint">Select a service or arrow to configure it.</p></>
          )}
          <h4>Machines</h4>
          {machines.map((m) => (
            <div className="row" key={m.id}>
              <div><label>machine_{m.id} cores</label><input type="number" min={1} value={m.cores} onChange={(e) => setMachines(machines.map((x) => (x.id === m.id ? { ...x, cores: +e.target.value } : x)))} /></div>
              <div><label>net queues</label><input type="number" min={1} value={m.queues} onChange={(e) => setMachines(machines.map((x) => (x.id === m.id ? { ...x, queues: +e.target.value } : x)))} /></div>
              <button title="Remove" onClick={() => {
                if (machines.length < 2) return;
                const rest = machines.filter((x) => x.id !== m.id);
                setMachines(rest);
                setServices(services.map((s) => (s.machine === m.id ? { ...s, machine: rest[0].id } : s)));
              }}>✕</button>
            </div>
          ))}
          <div className="row">
            <div><label>Client latency (ns)</label><input type="number" value={clientLat} onChange={(e) => setClientLat(+e.target.value)} /></div>
            <div><label>Inter-machine latency (ns)</label><input type="number" value={linkLat} onChange={(e) => setLinkLat(+e.target.value)} /></div>
          </div>
          <h4>Generated JSON</h4>
          <div className="tabs">
            {["machines.json", "graph.json", "links.json"].map((t, i) => (
              <button key={t} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{t}</button>
            ))}
          </div>
          {built.warns.map((w) => <div key={w} className="warn">⚠ {w}</div>)}
          <textarea readOnly value={out} />
          <button className="p mt-1.5" onClick={copy}>Copy</button> <span className="hint">{cpm}</span>
        </aside>
      </main>
    </div>
  );
}
