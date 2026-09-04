export class ConnectedComponent {
  private _positions: Set<string>;
  private _cornerOrigin: [number, number];

  constructor(positions: Set<string>, cornerOrigin: [number, number]) {
    this._positions = positions;
    this._cornerOrigin = cornerOrigin;
  }

  get size(): number { return this._positions.size; }
  getPositions(): Set<string> { return this._positions; }
  getCornerOrigin(): [number, number] { return this._cornerOrigin; }

  get distanceToCorner(): number {
    const [cx, cy] = this._cornerOrigin;
    let minDist = Infinity;
    for (const posStr of this._positions) {
      const parts = posStr.split(",");
      if (parts.length === 2) {
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (!isNaN(x) && !isNaN(y)) {
          const dist = Math.abs(x - cx) + Math.abs(y - cy);
          if (dist < minDist) minDist = dist;
        }
      }
    }
    return minDist === Infinity ? 0 : minDist;
  }
}

export function findConnectedComponents(
  positions: Array<[number, number]>,
  cornerOrigin: [number, number]
): ConnectedComponent[] {
  if (positions.length === 0) return [];

  const posSet = new Set(positions.map(([x, y]) => `${x},${y}`));
  const visited = new Set<string>();
  const components: ConnectedComponent[] = [];
  const dirs: Array<[number, number]> = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  for (const start of positions) {
    const key = `${start[0]},${start[1]}`;
    if (visited.has(key)) continue;

    const comp = new Set<string>();
    const queue: Array<[number, number]> = [start];
    visited.add(key);

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      comp.add(`${x},${y}`);
      for (const [dx, dy] of dirs) {
        const nkey = `${x+dx},${y+dy}`;
        if (posSet.has(nkey) && !visited.has(nkey)) {
          visited.add(nkey);
          queue.push([x+dx, y+dy]);
        }
      }
    }
    components.push(new ConnectedComponent(comp, cornerOrigin));
  }

  return components.length > 1 ? mergeComponents(components) : components;
}

function mergeComponents(comps: ConnectedComponent[]): ConnectedComponent[] {
  const n = comps.length;
  const parent = Array.from({length: n}, (_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]!));
  const union = (x: number, y: number) => { const px=find(x), py=find(y); if(px!==py) parent[px]! = py; };

  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      if (shouldMerge(comps[i]!, comps[j]!)) union(i, j);
    }
  }

  const groups = new Map<number, Set<string>>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, new Set());
    for (const p of comps[i]!.getPositions()) {
      const set = groups.get(r);
      if (set) set.add(p);
    }
  }

  return Array.from(groups.values()).map(s => new ConnectedComponent(s, comps[0]!.getCornerOrigin()));
}

function shouldMerge(c1: ConnectedComponent, c2: ConnectedComponent): boolean {
  for (const p1 of c1.getPositions()) {
    for (const p2 of c2.getPositions()) {
      const parts1 = p1.split(",");
      const parts2 = p2.split(",");
      if (parts1.length === 2 && parts2.length === 2) {
        const x1 = Number(parts1[0]);
        const y1 = Number(parts1[1]);
        const x2 = Number(parts2[0]);
        const y2 = Number(parts2[1]);
        if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
          const dx = Math.abs(x1-x2), dy = Math.abs(y1-y2);
          if (dx <= 4 && dy <= 4 && dx+dy <= 5) return true;
        }
      }
    }
  }
  return false;
}

export function isGoConnected(p1: [number, number], p2: [number, number]): boolean {
  const dx = Math.abs(p1[0]-p2[0]), dy = Math.abs(p1[1]-p2[1]);
  return dx <= 4 && dy <= 4 && dx+dy <= 5;
}

export function filterNearestComponent(components: ConnectedComponent[]): Set<string> {
  if (components.length === 0) return new Set();
  let nearest = components[0]!;
  for (let i = 1; i < components.length; i++) {
    if (components[i]!.distanceToCorner < nearest.distanceToCorner) nearest = components[i]!;
  }
  return nearest.getPositions();
}
