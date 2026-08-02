// v25 → v26 migration: retired mode templates collapse to 'general'.
//
// This migration has to land BEFORE ModeTemplateType narrows. template_type is
// a free TEXT column, so real installs hold rows written by older builds
// ('technical-interview', 'lecture', …). If one survives the narrowing, reads
// of it hit an unhandled path at startup.
//
// The thing that can actually break here is the WHERE clause — in particular
// dropping '__reserved__' from the keep-list, which would clobber the FK
// sentinel row that profile OKF cards point at. So the test seeds one row of
// every shape, rewinds user_version, re-runs migrations for real, and checks
// each one landed where it should.
//
// Run: npm run build:electron && node --test electron/db/__tests__/ModeTemplateCollapseV26.test.mjs

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const DB_MODULE = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

const RETIRED = ['looking-for-work', 'recruiting', 'team-meet', 'lecture', 'technical-interview', 'seminar'];
const PRESERVED = ['general', 'sales', '__reserved__'];

let dbm;
let raw;

describe('v26 — retired mode templates collapse to general', () => {
  before(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-collapse-v26-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    const { DatabaseManager } = require(DB_MODULE);
    dbm = DatabaseManager.getInstance();
    raw = dbm.db;
  });

  test('a fresh DB reaches user_version 26', () => {
    const version = raw.pragma('user_version', { simple: true });
    assert.ok(version >= 26, `expected user_version >= 26, got ${version}`);
  });

  test('retired templates are remapped, preserved ones are untouched', () => {
    const insert = raw.prepare(
      `INSERT OR REPLACE INTO modes (id, name, template_type, custom_context, is_active)
       VALUES (?, ?, ?, '', 0)`,
    );
    for (const t of [...RETIRED, ...PRESERVED]) {
      insert.run(`test_mode_${t}`, `Test ${t}`, t);
    }

    // Rewind and re-run for real — not a hand-copied UPDATE, the actual migration.
    raw.pragma('user_version = 25');
    dbm.runMigrations();

    assert.equal(raw.pragma('user_version', { simple: true }), 26, 'migration should bump to 26');

    const readBack = (t) =>
      raw.prepare('SELECT template_type FROM modes WHERE id = ?').get(`test_mode_${t}`).template_type;

    for (const t of RETIRED) {
      assert.equal(readBack(t), 'general', `retired template "${t}" should collapse to general`);
    }
    for (const t of PRESERVED) {
      assert.equal(readBack(t), t, `"${t}" must survive untouched`);
    }
  });

  test('__reserved__ sentinel row itself is intact', () => {
    // The v23 FK sentinel that profile OKF knowledge_cards reference. Losing its
    // template_type would orphan those cards into the user-facing mode universe.
    const row = raw.prepare('SELECT template_type FROM modes WHERE id = ?').get('__profile_okf__');
    assert.ok(row, 'the __profile_okf__ sentinel row should still exist');
    assert.equal(row.template_type, '__reserved__');
  });

  test('re-running the migration is a no-op', () => {
    const before = raw.prepare('SELECT id, template_type FROM modes ORDER BY id').all();
    dbm.runMigrations();
    const after = raw.prepare('SELECT id, template_type FROM modes ORDER BY id').all();
    assert.deepEqual(after, before, 'a second run must not change any row');
  });
});
