import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Frontend/backend drift guard. Every `counter_*` command the Rust side registers must be called
 * by some wrapper in src/lib/localFirst, and every command a wrapper calls must be registered.
 * Wrapper files are discovered by scanning, so a new wrapper file needs no edit here.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const wrapperSource = () => readdirSync(here)
  .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map(name => readFileSync(`${here}${name}`, 'utf8'))
  .join('\n');

const registeredCommands = (): Set<string> => {
  const source = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)), 'utf8');
  const handlerBlock = /generate_handler!\[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
  // Entries may be module-qualified (`office::counter_list_expenses`); the command name is the last segment.
  return new Set(handlerBlock.split(',').map(entry => entry.trim().split('::').pop() ?? '').filter(Boolean));
};

describe('native command drift guard', () => {
  it('only calls commands the Rust backend registers', () => {
    const called = new Set([...wrapperSource().matchAll(/['"](counter_[a-z0-9_]+)['"]/g)].map(match => match[1]));
    expect(called.size).toBeGreaterThan(20);
    expect([...called].filter(command => !registeredCommands().has(command))).toEqual([]);
  });

  it('wraps every registered counter command', () => {
    const called = new Set([...wrapperSource().matchAll(/['"](counter_[a-z0-9_]+)['"]/g)].map(match => match[1]));
    const unused = [...registeredCommands()].filter(command => command.startsWith('counter_') && !called.has(command));
    expect(unused).toEqual([]);
  });

  it('registers no command outside the role-checked counter_* set (no raw SQL or unguarded backup commands)', () => {
    const outside = [...registeredCommands()].filter(command => !command.startsWith('counter_'));
    expect(outside).toEqual([]);
  });
});
