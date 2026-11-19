/**
 * Tiny readers for the raw catalogue formats: CSV (TAP / SkyServer, with
 * quoted fields) and VizieR's tab-separated ASU output.
 */
import { readFileSync } from 'node:fs';

export interface Table {
  header: string[];
  rows: string[][];
  /** Column index by name (throws on unknown names so schema drift is caught early). */
  col: (name: string) => number;
}

function makeTable(header: string[], rows: string[][], source: string): Table {
  const index = new Map(header.map((h, i) => [h, i]));
  return {
    header,
    rows,
    col: (name) => {
      const i = index.get(name);
      if (i === undefined) throw new Error(`column "${name}" not found in ${source} (have: ${header.join(', ')})`);
      return i;
    },
  };
}

/** Split one CSV line, honouring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Read a CSV file. Lines starting with '#' (SkyServer's "#Table1") are skipped. */
export function readCsv(path: string): Table {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  let header: string[] | null = null;
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const cells = splitCsvLine(line);
    if (!header) header = cells.map((c) => c.trim());
    else rows.push(cells);
  }
  if (!header) throw new Error(`empty CSV: ${path}`);
  return makeTable(header, rows, path);
}

/** Read VizieR ASU tab-separated output (comment lines, header, units row, dashes row, data). */
export function readVizierTsv(path: string): Table {
  const text = readFileSync(path, 'utf8');
  const err = /#INFO\s+Error=([^\n]*)/.exec(text);
  if (err) throw new Error(`VizieR error in ${path}: ${err[1]}`);
  const lines = text.split(/\r?\n/);
  let header: string[] | null = null;
  let skip = 0;
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    if (!header) {
      header = line.split('\t').map((c) => c.trim());
      skip = 2; // units row + dashes row
      continue;
    }
    if (skip > 0) {
      skip--;
      continue;
    }
    rows.push(line.split('\t').map((c) => c.trim()));
  }
  if (!header) throw new Error(`empty VizieR table: ${path}`);
  return makeTable(header, rows, path);
}

/** Parse a number; empty / non-numeric cells become NaN. */
export function num(cell: string | undefined): number {
  if (cell === undefined) return NaN;
  const t = cell.trim();
  if (t === '' || t === 'null' || t === 'NaN') return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/** Sexagesimal "hh mm ss.s" / "hh:mm:ss.s" → degrees (×15 for RA). */
export function sexToDeg(text: string, isRa: boolean): number {
  const t = text.trim();
  if (!t) return NaN;
  const neg = t.startsWith('-');
  const parts = t.replace(/^[+-]/, '').split(/[\s:]+/).map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return NaN;
  const v = (parts[0] ?? 0) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  return (neg ? -v : v) * (isRa ? 15 : 1);
}
