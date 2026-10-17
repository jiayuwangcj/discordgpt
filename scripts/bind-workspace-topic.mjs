// Provision an existing private topic through the running bot's configuration inbox.
// Never edit state.json or restart/drain the service to add a workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { loadWorkspaces, validAlias } from '../dist/workspaces.js';

const [topicId, workspace, directory, ownerId] = process.argv.slice(2);
const rootIndex = process.argv.indexOf('--root');
const root = rootIndex < 0 ? path.join(os.homedir(), '.config/discordgpt') : path.resolve(process.argv[rootIndex + 1]);
if (!/^\d{1,20}$/.test(topicId ?? '') || !/^\d{1,20}$/.test(ownerId ?? '')
  || !validAlias(workspace ?? '') || !directory || !path.isAbsolute(directory)) {
  throw Error('Usage: node scripts/bind-workspace-topic.mjs <topic-id> <workspace> <absolute-directory> <owner-id> [--root directory] [--stage]');
}
const env = dotenv.parse(await fs.readFile(path.join(root, 'discordgpt.env')));
const csv = value => new Set((value ?? '').split(',').map(v => v.trim()).filter(Boolean));
const stateDir = env.CODEX_DISCORD_STATE_DIR;
if (!stateDir || !path.isAbsolute(stateDir) || !env.CODEX_WORKSPACES_FILE || !path.isAbsolute(env.CODEX_WORKSPACES_FILE)) throw Error('Explicit absolute state and workspace configuration paths required');
if (!csv(env.DISCORD_ALLOWED_USER_IDS).has(ownerId)) throw Error('Topic owner is not authorized');
if (!(await fs.stat(directory)).isDirectory()) throw Error('Workspace must be an existing directory');
const response = await fetch('https://discord.com/api/v10/channels/' + topicId, {
  headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN }, signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw Error('Cannot validate existing Discord topic: HTTP ' + response.status);
const channel = await response.json();
const allowed = csv(env.DISCORD_ALLOWED_CHANNEL_IDS);
if (channel.type !== 12 || !channel.parent_id || !channel.guild_id || allowed.size && !allowed.has(channel.parent_id)) throw Error('Expected a private topic under an authorized parent');
const topic = { id: topicId, parentId: channel.parent_id, guildId: channel.guild_id, ownerId, name: channel.name, workspace };
const lock = path.join(stateDir, 'workspace-config.lock');
await fs.mkdir(lock, { mode: 0o700 });
const atomic = async (file, value) => {
  const temp = file + '.provision-' + process.pid;
  try { await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
};
try {
  const workspaces = await loadWorkspaces(env.CODEX_PROJECT_DIR, env.CODEX_WORKSPACES_FILE);
  if (Object.hasOwn(workspaces, workspace) && workspaces[workspace] !== directory) throw Error('Existing workspace path is immutable');
  const file = path.join(stateDir, 'topic-bindings.json');
  let topics;
  try { topics = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; topics = []; }
  if (!Array.isArray(topics)) throw Error('Topic bindings must be an array');
  const previous = topics.find(t => t.id === topicId);
  if (previous && Object.keys(topic).some(key => previous[key] !== topic[key])) throw Error('Existing topic binding is immutable');
  if (!previous) topics.push(topic);
  const configured = JSON.parse(await fs.readFile(env.CODEX_WORKSPACES_FILE, 'utf8'));
  configured[workspace] = directory;
  await atomic(env.CODEX_WORKSPACES_FILE, configured);
  await atomic(file, topics);
} finally { await fs.rmdir(lock); }
if (process.argv.includes('--stage')) {
  console.log(JSON.stringify({ status: 'staged', topicId, workspace }));
} else {
  let active = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const health = await fs.readFile(path.join(stateDir, 'health.json'), 'utf8').then(JSON.parse).catch(() => undefined);
    if (health?.ready && !health.workspaceReload?.error && Date.now() - Date.parse(health.at) < 5000
      && health.workspaceReload?.topics?.includes(topicId)) { active = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!active) throw Error('Configuration staged, but activation not confirmed; inspect health.json workspaceReload (do not edit state.json)');
  console.log(JSON.stringify({ status: 'active', topicId, workspace }));
}
