// Operator upgrade: preserve state, drain work, validate controls and roll back failures.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(os.homedir(), '.config/discordgpt');
const unitFile = path.join(os.homedir(), '.config/systemd/user/discordgpt.service');
const envFile = path.join(root, 'discordgpt.env');
const mode = process.argv[2];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (bin, args, cwd = repo) => execFileSync(bin, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
const ctl = (...args) => execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function save(file, text) { await fs.writeFile(file, text, { mode: 0o600 }); await fs.chmod(file, 0o600); }
async function digest(directory) {
  const hash = crypto.createHash('sha256');
  async function walk(relative) {
    const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) { hash.update(name); hash.update(await fs.readFile(path.join(directory, name))); }
      else if (entry.isSymbolicLink()) { hash.update(name); hash.update(await fs.readlink(path.join(directory, name))); }
    }
  }
  for (const entry of ['dist', 'node_modules', 'test', 'scripts', 'src']) await walk(entry);
  for (const entry of ['package.json', 'package-lock.json', 'tsconfig.json', 'FEATURE_PARITY.md', 'OPERATIONS.md']) { hash.update(entry); hash.update(await fs.readFile(path.join(directory, entry))); }
  return hash.digest('hex');
}

if (mode === 'pack') {
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const output = path.resolve(process.argv[3] || path.join(os.tmpdir(), `discordgpt-${pkg.version}-candidate`));
  // Existence is intentional protection against overwriting a previous candidate.
  await fs.mkdir(output, { mode: 0o700 });
  for (const entry of ['dist', 'node_modules', 'test', 'scripts', 'package.json', 'package-lock.json', 'OPERATIONS.md', 'FEATURE_PARITY.md', 'src', 'tsconfig.json']) {
    await fs.cp(path.join(repo, entry), path.join(output, entry), { recursive: true, verbatimSymlinks: true });
  }
  const manifest = { version: pkg.version, createdAt: new Date().toISOString(), digest: await digest(output), status: 'candidate',
    requiredBeforeDeploy: ['npm run verify', 'npm run smoke', 'idle/drain confirmation', 'interaction ingress and real Discord acceptance'] };
  await save(path.join(output, 'release.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ output, ...manifest }));
} else if (mode === 'deploy') {
  const candidate = path.resolve(process.argv[3] || '');
  const manifest = JSON.parse(await fs.readFile(path.join(candidate, 'release.json'), 'utf8'));
  if (manifest.digest !== await digest(candidate)) throw Error('Candidate contents changed; repack before deployment');
  if (process.env.DISCORDGPT_OFFLINE_TESTS) throw Error('Deploy requires the complete transport tests; offline mode is not acceptance');
  run('npm', ['run', 'verify'], candidate);
  run('npm', ['run', 'smoke'], candidate);
  if (manifest.digest !== await digest(candidate)) throw Error('Build changed candidate contents; repack the verified candidate');
  const originalEnv = await fs.readFile(envFile, 'utf8');
  const settings = dotenv.parse(originalEnv);
  // Retire the channel-renaming experiment when upgrading an existing instance.
  delete settings.DISCORD_QUOTA_HEADER_CHANNEL_IDS;
  // Explicit operator choice updates a previously configured restricted instance.
  // Without this flag, existing instance settings still override code defaults.
  if (process.argv.includes('--yolo')) {
    settings.CODEX_SANDBOX = 'danger-full-access';
    settings.CODEX_APPROVAL_POLICY = 'never';
  }
  const originalUnit = await fs.readFile(unitFile, 'utf8');
  const stateDir = settings.CODEX_DISCORD_STATE_DIR;
  if (!stateDir || !path.isAbsolute(stateDir)) throw Error('Expected an explicit absolute state directory');
  const stateFile = path.join(stateDir, 'state.json');
  const savedState = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  const mainPid = Number(ctl('show', 'discordgpt.service', '--property=MainPID', '--value'));
  if (ctl('is-active', 'discordgpt.service') !== 'active' || !mainPid) throw Error('Existing service not active; inspect before upgrading');
  let health = await fs.readFile(path.join(stateDir, 'health.json'), 'utf8').then(JSON.parse).catch(() => undefined);
  const modern = health?.pid === mainPid && Date.now() - Date.parse(health.at) < 5000;
  if (!modern && !process.argv.includes('--legacy-idle-confirmed')) {
    throw Error('Legacy service has no drain endpoint. Check !codex status in every live window, then use --legacy-idle-confirmed; do not interrupt unknown work.');
  }
  const token = settings.DISCORD_BOT_TOKEN;
  async function api(route, method = 'GET', body) {
    const response = await fetch('https://discord.com/api/v10' + route, { method, signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw Error(`Discord API ${method} ${route}: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  const app = await api('/applications/@me');
  const oldEndpoint = app.interactions_endpoint_url || '';
  const newEndpoint = settings.DISCORD_INTERACTIONS_URL || '';
  if (oldEndpoint && (!newEndpoint || !settings.DISCORD_INTERACTIONS_PORT)) {
    throw Error('An existing HTTP interactions endpoint owns slash commands/buttons. Configure the signed discordgpt ingress and reverse proxy first; the old endpoint will not be cleared.');
  }
  if (newEndpoint && !settings.DISCORD_INTERACTIONS_PORT) throw Error('Public ingress requires DISCORD_INTERACTIONS_PORT');
  if (newEndpoint && new URL(newEndpoint).protocol !== 'https:') throw Error('Public interactions URL requires HTTPS');
  if (oldEndpoint && oldEndpoint !== newEndpoint) settings.DISCORD_INTERACTIONS_FALLBACK_URL = oldEndpoint;
  if (settings.DISCORD_INTERACTIONS_FALLBACK_URL === newEndpoint && newEndpoint) throw Error('Interaction fallback loop');
  if (newEndpoint) settings.DISCORD_PUBLIC_KEY = app.verify_key;
  const release = path.join(root, 'releases', `${manifest.version}-${manifest.digest.slice(0,12)}`);
  try { await fs.access(release); throw Error('Release directory already exists; inspect before reusing'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const drainFile = path.join(stateDir, 'drain');
  const backup = path.join(root, 'upgrades', Date.now().toString());
  await fs.mkdir(backup, { recursive: true, mode: 0o700 });
  await save(path.join(backup, 'unit.service'), originalUnit);
  await save(path.join(backup, 'instance.env'), originalEnv);
  await save(path.join(backup, 'state.json'), JSON.stringify(savedState, null, 2));
  let stopped = false;
  let endpointChanged = false;
  try {
    await save(drainFile, 'upgrade requested\n');
    if (modern) {
      const deadline = Date.now() + 20 * 60_000;
      while (Date.now() < deadline) {
        health = JSON.parse(await fs.readFile(path.join(stateDir, 'health.json'), 'utf8'));
        if (health.pid !== mainPid || Date.now() - Date.parse(health.at) > 5000) throw Error('Service health stopped updating');
        if (health.draining && health.outstanding === 0) break;
        await delay(1000);
      }
      if (!health.draining || health.outstanding !== 0) throw Error('Drain timed out; service was not interrupted');
    }
    // Snapshot only after draining. Never restore old Codex bindings over fresh ones.
    ctl('stop', 'discordgpt.service'); stopped = true;
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    const legacy = await fs.readFile(path.join(root, 'legacy-sessions.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    state.settings ??= {};
    for (const [key, record] of Object.entries(legacy)) {
      const channel = key.startsWith('dm:') ? key.slice(3) : undefined;
      if (!channel || state.settings[channel] || state.threads[channel] !== record.thread_id || !record.model) continue;
      state.settings[channel] = { model: record.model, ...(record.reasoning_effort ? { effort: record.reasoning_effort } : {}) };
    }
    await save(stateFile, JSON.stringify(state, null, 2));
    await fs.cp(candidate, release, { recursive: true, errorOnExist: true, force: false });
    const nextUnit = originalUnit.replace(/^WorkingDirectory=.*$/m, 'WorkingDirectory=' + release)
      .replace(/^ExecStart=.*$/m, `ExecStart=${process.execPath} ${path.join(release, 'dist/index.js')}`);
    await save(envFile, Object.entries(settings).map(([key,value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n');
    await save(unitFile, nextUnit); ctl('daemon-reload'); ctl('start', 'discordgpt.service');
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline) {
      const newPid = Number(ctl('show', 'discordgpt.service', '--property=MainPID', '--value'));
      health = await fs.readFile(path.join(stateDir, 'health.json'), 'utf8').then(JSON.parse).catch(() => undefined);
      if (health?.pid === newPid && newPid !== mainPid && Date.now() - Date.parse(health.at) < 5000 && health.ready && health.commandsReady && !health.modelsStale && !health.usageStale) { ready = true; break; }
      await delay(1000);
    }
    if (!ready) throw Error('New service did not pass Gateway, command, catalog and usage readiness');
    if (newEndpoint && oldEndpoint !== newEndpoint) {
      // Discord itself validates the endpoint by issuing a signed PING.
      endpointChanged = true;
      await api('/applications/@me', 'PATCH', { interactions_endpoint_url: newEndpoint });
    }
    await save(path.join(backup, 'result.json'), JSON.stringify({ status: 'completed', release, version: manifest.version, previousEndpoint: oldEndpoint, completedAt: new Date().toISOString() }, null, 2));
    await fs.rm(drainFile, { force: true });
    console.log(JSON.stringify({ status: 'completed', release, backup, liveInteractionAcceptance: 'Observe /status, /model and a queue-button click in Discord' }));
  } catch (error) {
    if (endpointChanged) await api('/applications/@me', 'PATCH', { interactions_endpoint_url: oldEndpoint }).catch(() => console.error('Endpoint rollback failed; inspect application settings'));
    if (stopped) {
      ctl('stop', 'discordgpt.service'); await save(unitFile, originalUnit); await save(envFile, originalEnv);
      ctl('daemon-reload'); ctl('start', 'discordgpt.service');
    }
    await fs.rm(drainFile, { force: true });
    await save(path.join(backup, 'result.json'), JSON.stringify({ status: 'rolled-back', at: new Date().toISOString() }));
    throw error;
  }
} else {
  throw Error('Usage: node scripts/upgrade-service.mjs pack [output] | deploy <candidate> [--legacy-idle-confirmed] [--yolo]');
}
