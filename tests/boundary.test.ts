import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const AGENT_DIR = join(__dirname, '..', 'src', 'agent');
const IMPORT_RE = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

describe('agent isolation', () => {
  it('no file in src/agent imports world, ui, runtime, transport or experiments', () => {
    const files = readdirSync(AGENT_DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(join(AGENT_DIR, f), 'utf8');
      for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2];
        expect(spec, `${f} imports ${spec}`).not.toMatch(/(^|\/)(world|ui|runtime|transport|experiments|baseline)(\/|$)/);
      }
    }
  });
  it('agent code uses no DOM APIs', () => {
    for (const f of readdirSync(AGENT_DIR).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(AGENT_DIR, f), 'utf8');
      expect(src, f).not.toMatch(/\b(document\.|window\.|localStorage|Math\.random|Date\.now|HTMLElement)/);
    }
  });
});
