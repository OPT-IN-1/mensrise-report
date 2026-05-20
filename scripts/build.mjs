#!/usr/bin/env node
// Anonymize 3 CSVs and emit fact_front.json, fact_consult.json
// Usage:
//   node scripts/build.mjs <csv1> <csv2> ...
//   node scripts/build.mjs            (reads from input/)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Papa from 'papaparse';

// --- Config ---
const SALT = process.env.SALT || 'mensrise-default-salt-CHANGE-ME';
const REPORT_PASSWORD = process.env.REPORT_PASSWORD || '';
const OUTPUT_DIR = 'data';
const INPUT_DIR = 'input';

if (SALT.includes('CHANGE-ME')) {
  console.warn('⚠️  Using default SALT. Set SALT env var (e.g. `SALT=xxx node scripts/build.mjs`)');
}

// AES-256-GCM で JSON を暗号化（Web Crypto API 互換フォーマット）
function encryptJSON(obj, password) {
  const data = JSON.stringify(obj);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Web Crypto API では GCM の tag は ct 末尾に結合される
  const combined = Buffer.concat([encrypted, tag]);
  return {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iter: 100000,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ct: combined.toString('base64'),
  };
}

// --- Helpers ---
function hashId(rawId) {
  if (!rawId || String(rawId).trim() === '') return null;
  return 'U_' + crypto.createHash('sha256').update(String(rawId) + SALT).digest('hex').slice(0, 12);
}

function maskOwnName(text, names) {
  if (!text) return text;
  let out = String(text);
  for (const n of names) {
    if (!n) continue;
    const s = String(n).trim();
    if (s.length >= 2) {
      out = out.split(s).join('[氏名]');
    }
  }
  return out;
}

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  const parsed = Papa.parse(raw, { header: false, skipEmptyLines: false });
  return parsed.data;
}

// --- Detect CSV kind by header content (scan first 3 rows) ---
function detectKind(records) {
  for (let i = 0; i < Math.min(3, records.length); i++) {
    const row = records[i];
    if (!row || !Array.isArray(row)) continue;
    const cells = row.map(v => String(v || '').trim());
    const set = new Set(cells);

    // A: 営業シート（個別相談）
    if (set.has('会員番号') && cells.some(v => v.includes('個別相談担当者'))) {
      return { kind: 'A', headerRow: i };
    }
    // C: フロント・属性アンケート付き
    if (cells.some(v => v.includes('興味がある男磨きのジャンル'))) {
      return { kind: 'C', headerRow: i };
    }
    // B: フロント・経路用（属性アンケート列なし）
    if (set.has('全シナリオ共通読者ID') && set.has('登録経路')) {
      return { kind: 'B', headerRow: i };
    }
  }
  return null;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    const k = String(h || '').trim().replace(/\s+/g, ' ');
    if (k) obj[k] = row[i] != null ? String(row[i]) : '';
  });
  return obj;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return String(obj[k]).trim();
  }
  return null;
}

// --- B + C → fact_front ---
function buildFactFront(rowsB, rowsC) {
  const byIdB = new Map();
  for (const r of rowsB) {
    const id = pick(r, 'LINE友だちID');
    if (id) byIdB.set(id, r);
  }
  const byIdC = new Map();
  for (const r of rowsC) {
    const id = pick(r, 'LINE友だちID');
    if (id) byIdC.set(id, r);
  }
  const allIds = new Set([...byIdB.keys(), ...byIdC.keys()]);

  const out = [];
  for (const lineId of allIds) {
    const b = byIdB.get(lineId);
    const c = byIdC.get(lineId);
    const src = c || b;

    out.push({
      anon_id: hashId(lineId),
      registered_at: pick(src, '登録日時'),
      acquisition_source: pick(b || {}, '登録経路'),
      has_answered_survey: Boolean(c),
      age_band: pick(c || {}, '年齢を教えてください'),
      occupation: pick(c || {}, '職業を教えてください'),
      top_concern: pick(c || {}, '男磨きで1番悩んでいることを教えてください'),
      top_interest: pick(c || {}, 'この中で1番興味がある男磨きのジャンルは何ですか？'),
      status: pick(src, 'ステータス'),
      unsubscribed_at: pick(src, '解除日時'),
    });
  }
  return out;
}

// --- A → fact_consult ---
function buildFactConsult(rowsA) {
  const out = [];
  for (const r of rowsA) {
    const lineId = pick(r, 'LINE友だちID');
    if (!lineId) continue;

    // Names for masking in free text
    const ownNames = [
      pick(r, '氏名'),
      pick(r, 'LINE名'),
      pick(r, 'ふりがな'),
    ].filter(Boolean);

    const rec = {
      anon_id: hashId(lineId),
      applied_at: pick(r, '申込日時'),
      age_band: pick(r, '年代'),
      occupation: pick(r, '職業'),
      income_band: pick(r, '年収'),
      monthly_budget: pick(r, '月投資額'),
      intent_level: pick(r, '意向度'),
      monitor_consent: pick(r, 'モニターとして写真のご提供・インタビューへのご対応・HP等の掲載有無'),
      cc_available: pick(r, 'クレジットカードの有無'),
      referral_source: pick(r, '導線'),
      front_source: pick(r, 'フロント登録経路'),
      consultation_source: pick(r, '個別相談登録経路'),
      front_line_at: pick(r, 'フロントLINE 流入日', 'フロントLINE流入日'),
      consult_line_at: pick(r, '個別相談LINE流入日'),
      seminar_at: pick(r, 'セミナー参加日'),
      appointment_date: pick(r, '予約(日)'),
      appointment_time: pick(r, '予約(時間)'),
      implemented: pick(r, '実施可否'),
      result: pick(r, '結果'),
      proposed_plan: pick(r, '提案商品プラン'),
      payment_method: pick(r, '決済手段'),
      plan_name: pick(r, 'プラン名'),
      contract_at: pick(r, '契約日'),
      contract_amount: pick(r, '契約金額(売上)'),
      payment_status: pick(r, '入金ステータス'),
      consultant: pick(r, '個別相談担当者'),
      apply_count: pick(r, '申込回数'),
      // Free text fields (mask own name)
      concern_free: maskOwnName(pick(r, '悩み'), ownNames),
      desired_future: maskOwnName(pick(r, 'どのような未来を手に入れたいか'), ownNames),
      question: maskOwnName(pick(r, '聞きたいこと'), ownNames),
      reflection: maskOwnName(pick(r, '振り返り'), ownNames),
      cs_handover: maskOwnName(pick(r, 'CS引き継ぎ事項'), ownNames),
      remarks: maskOwnName(pick(r, '備考'), ownNames),
      success_factor: maskOwnName(pick(r, '成約要因'), ownNames),
      loss_factor: maskOwnName(pick(r, '失注要因'), ownNames),
    };
    out.push(rec);
  }
  return out;
}

// --- Main ---
function collectInputFiles() {
  const args = process.argv.slice(2);
  if (args.length > 0) return args;
  if (!fs.existsSync(INPUT_DIR)) return [];
  return fs.readdirSync(INPUT_DIR)
    .filter(f => f.toLowerCase().endsWith('.csv'))
    .map(f => path.join(INPUT_DIR, f));
}

const files = collectInputFiles();
if (files.length === 0) {
  console.error('No CSV files found. Pass paths as args or place files in input/');
  process.exit(1);
}

console.log('Reading CSVs:');
const buckets = { A: [], B: [], C: [] };

for (const f of files) {
  try {
    const records = readCsv(f);
    const detected = detectKind(records);
    if (!detected) {
      console.warn(`  ⚠️  Cannot detect kind: ${path.basename(f)} — skipped`);
      continue;
    }
    const { kind, headerRow } = detected;
    const headers = records[headerRow];
    const dataRows = records
      .slice(headerRow + 1)
      .filter(r => r && r.length > 1 && r.some(v => v && String(v).trim()));
    const objects = dataRows.map(r => rowToObject(headers, r));
    buckets[kind].push(...objects);
    console.log(`  ${path.basename(f)} → ${kind} (${objects.length} rows, header at row ${headerRow})`);
  } catch (e) {
    console.error(`  Error reading ${f}:`, e.message);
  }
}

const factFront = buildFactFront(buckets.B, buckets.C);
const factConsult = buildFactConsult(buckets.A);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'fact_front.json'), JSON.stringify(factFront, null, 2));
fs.writeFileSync(path.join(OUTPUT_DIR, 'fact_consult.json'), JSON.stringify(factConsult, null, 2));

const meta = {
  generated_at: new Date().toISOString(),
  fact_front: {
    total: factFront.length,
    answered_survey: factFront.filter(r => r.has_answered_survey).length,
    not_answered: factFront.filter(r => !r.has_answered_survey).length,
  },
  fact_consult: {
    total: factConsult.length,
    with_contract: factConsult.filter(r => r.contract_at).length,
  },
};
fs.writeFileSync(path.join(OUTPUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

console.log('\n✓ Generated:');
console.log(`  ${OUTPUT_DIR}/fact_front.json   (${meta.fact_front.total} records, ${meta.fact_front.answered_survey} answered)`);
console.log(`  ${OUTPUT_DIR}/fact_consult.json (${meta.fact_consult.total} records, ${meta.fact_consult.with_contract} contracts)`);
console.log(`  ${OUTPUT_DIR}/meta.json`);

// 暗号化（REPORT_PASSWORD があれば）
if (REPORT_PASSWORD) {
  console.log('\n🔒 暗号化（AES-256-GCM）...');
  for (const filename of ['fact_front.json', 'fact_consult.json', 'meta.json']) {
    const p = path.join(OUTPUT_DIR, filename);
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const encrypted = encryptJSON(data, REPORT_PASSWORD);
    fs.writeFileSync(p, JSON.stringify(encrypted));
    console.log(`  ${p} ← 暗号化済み`);
  }
} else {
  console.log('\n📂 平文出力（暗号化したい場合は REPORT_PASSWORD=xxx を指定）');
}
