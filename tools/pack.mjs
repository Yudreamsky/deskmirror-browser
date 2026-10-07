// 打包上架用的 zip（Chrome 应用商店、Edge 扩展商店都用它）：
//  - 只放 extension 文件夹里的东西，manifest.json 在 zip 最外层，路径用正斜杠；
//  - 去掉源码里 // <store-strip> … // </store-strip> 之间的内容（编程订阅套餐、测试用假翻译）；
//  - 打好后自己检查：每个 JS 能解析、预设里没有去掉的那些、zip 解开后和整理好的文件一模一样。
// 输出 dist/deskmirror-browser-<版本>.zip，旁边是解开的同名文件夹（可以“加载已解压的扩展程序”先试一下）。
// node tools/pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'extension');
const version = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version;
const STAGE = path.join(ROOT, 'dist', 'deskmirror-browser-' + version);
const ZIP = STAGE + '.zip';
const STRIPPED = ['glm-coding', 'zai-coding', 'kimi-code', 'bailian-coding', 'ark-coding', 'minimax-plan', 'mock'];

function strip(text, file) {
  const out = text.replace(/^[ \t]*\/\/ <store-strip>.*\r?\n[\s\S]*?^[ \t]*\/\/ <\/store-strip>.*\r?\n/gm, '');
  if (/store-strip/.test(out)) throw new Error(file + '：<store-strip> 标记没有配对');
  return out;
}

function walk(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), rel));
    else out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------- zip（deflate，UTF-8 文件名）
function dos(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

function makeZip(entries) {
  const { time, date } = dos(new Date());
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = zlib.crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const method = deflated.length < e.data.length ? 8 : 0;
    const body = method ? deflated : e.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** 读回 zip（只认自己写的这种），返回 [{ name, data }]，CRC 不对就报错。 */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录坏了');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (zlib.crc32(data) !== crc) throw new Error(name + ' 的校验和不对');
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------- 整理、打包、检查
fs.rmSync(STAGE, { recursive: true, force: true });
const entries = [];
for (const rel of walk(SRC)) {
  let data = fs.readFileSync(path.join(SRC, rel));
  if (rel.endsWith('.js')) {
    const text = strip(data.toString('utf8'), rel);
    new vm.Script(text, { filename: rel });            // 能解析
    data = Buffer.from(text, 'utf8');
  }
  fs.mkdirSync(path.dirname(path.join(STAGE, rel)), { recursive: true });
  fs.writeFileSync(path.join(STAGE, rel), data);
  entries.push({ name: rel, data });
}
const PS = require(path.join(STAGE, 'presets.js'));
const ids = PS.PRESETS.map((p) => p.id);
const left = STRIPPED.filter((id) => ids.includes(id));
if (left.length) throw new Error('上架版里还有：' + left.join(', '));
for (const id of ['ollama', 'ollama-cloud-local', 'deepseek', 'openai', 'gemini', 'openai-custom']) {
  if (!ids.includes(id)) throw new Error('上架版里少了 ' + id);
}
if (entries[0].name === 'manifest.json' || entries.some((e) => e.name === 'manifest.json')) { /* manifest 在最外层 */ } else {
  throw new Error('没有 manifest.json');
}
const zip = makeZip(entries);
fs.writeFileSync(ZIP, zip);
const back = readZip(fs.readFileSync(ZIP));
if (back.length !== entries.length || back.some((e, i) => e.name !== entries[i].name || !e.data.equals(entries[i].data))) {
  throw new Error('zip 读回来和整理好的文件不一样');
}
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`上架包：${path.relative(ROOT, ZIP)}（${kb(zip.length)}，${entries.length} 个文件，解开后 ${kb(entries.reduce((s, e) => s + e.data.length, 0))}）`);
console.log(`服务商预设 ${ids.length} 个（去掉了 ${STRIPPED.join('、')}）`);
console.log(`解开的文件夹：${path.relative(ROOT, STAGE)}`);
