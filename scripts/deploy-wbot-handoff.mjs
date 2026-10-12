// Explicit operator utility; credentials are never printed or stored in Git.
// Run handoff in a separate systemd service: the legacy service owns this turn.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StateStore } from '../dist/state.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const root = path.join(home, '.config/discordgpt');
const manifestFile = path.join(root, 'handoff.json');
const oldStateFile = path.join(home, '.wbot/discord-codex-sessions.json');
const oldUnit = 'wbotdev-discord-assistant.service';
const newUnit = 'discordgpt.service';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ctl = (...args) => execFileSync('systemctl', ['--user', ...args], {encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
const config = JSON.parse(await fs.readFile(path.join(home, '.wbot/wbot.conf'), 'utf8'));
const token = config['credentials.discord.bot_token']?.value;
if (!token) throw new Error('Existing Discord token missing');
async function api(route, method = 'GET', body, attempt = 0) {
  const response = await fetch('https://discord.com/api/v10' + route, {
    method, signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bot ' + token, 'Content-Type':'application/json', 'User-Agent':'DiscordBot (https://discord.com, v1.0)'},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  if (response.status === 429 && attempt < 2) {
    const limited = await response.json();
    await delay(Math.min(Number(limited.retry_after) * 1000 + 100, 30000));
    return api(route, method, body, attempt + 1);
  }
  if (!response.ok) throw new Error('Discord ' + method + ' ' + route + ': HTTP ' + response.status);
  return response.status === 204 ? undefined : response.json();
}
async function save(file, data) { await fs.writeFile(file, data, {mode:0o600}); await fs.chmod(file, 0o600); }
async function notify(m, content) { await api('/channels/' + m.dmId + '/messages', 'POST', {content, allowed_mentions:{parse:[]}}); }

if (process.argv[2] === 'prepare') {
  await fs.mkdir(root, {recursive:true, mode:0o700});
  try { await fs.access(manifestFile); throw new Error('Existing handoff manifest; inspect before reusing'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const users = config['assistant.discord.allowed_user_ids']?.value?.split(',').map(id => id.trim()).filter(Boolean);
  if (!users?.length) throw new Error('Authorized user list empty');
  const sessions = JSON.parse(await fs.readFile(oldStateFile, 'utf8'));
  const entries = Object.entries(sessions).filter(([key, record]) => key.startsWith('dm:') && record.thread_id);
  if (entries.length !== 1) throw new Error('Expected one existing DM; choose migration target explicitly');
  const dmId = entries[0][0].slice(3);
  const dm = await api('/channels/' + dmId);
  if (dm.type !== 1 || !dm.recipients?.some(user => user.id === users[0])) throw new Error('DM user mismatch');
  const trade = await api('/channels/' + config['credentials.discord.channel_id'].value);
  if (!trade.guild_id) throw new Error('Trade channel has no guild');
  const me = await api('/users/@me');
  const channels = await api('/guilds/' + trade.guild_id + '/channels');
  if (channels.some(channel => channel.name === 'codex')) throw new Error('codex channel exists; inspect before reuse');
  const workspace = path.join(home, 'workspace/github/wbot');
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const sha = execFileSync('git', ['rev-parse','--short','HEAD'], {cwd:repo, encoding:'utf8'}).trim();
  const release = path.join(root, 'releases', pkg.version + '-' + sha);
  await fs.mkdir(path.dirname(release), {recursive:true, mode:0o700});
  await fs.mkdir(release, {mode:0o700});
  for (const entry of ['dist','node_modules','package.json','package-lock.json']) await fs.cp(path.join(repo,entry), path.join(release,entry), {recursive:true});
  await save(path.join(root,'legacy-unit.service'), await fs.readFile(path.join(home,'.config/systemd/user',oldUnit)));
  await save(path.join(root,'legacy-sessions.json'), JSON.stringify(sessions,null,2));
  const stateDir = path.join(root,'state');
  const store = new StateStore(stateDir); await store.load();
  for (const [key, record] of entries) await store.set(key.slice(3), record.thread_id);
  // Codex conversation channel; trade notification configuration is untouched.
  const parent = await api('/guilds/' + trade.guild_id + '/channels','POST', {
    name:'codex', type:0, topic:'Codex 大模型聊天与工程开发；使用 !codex topic 创建工作区话题。', permission_overwrites:[
      {id:trade.guild_id, type:0, deny:'1024', allow:'0'},
      {id:users[0], type:1, allow:String(1024n | 2048n | 65536n | 32768n | 16384n | (1n<<38n)), deny:'0'},
      {id:me.id, type:1, allow:String(1024n | 2048n | 65536n | 32768n | (1n<<34n) | (1n<<36n) | (1n<<38n)), deny:'0'},
    ],
  });
  const topic = await api('/channels/' + parent.id + '/threads','POST', {name:'wbot工程', type:12, invitable:false, auto_archive_duration:1440});
  await store.bindWorkspace(topic.id,'wbot',workspace);
  await store.recordTopic({id:topic.id,parentId:parent.id,guildId:trade.guild_id,ownerId:users[0],name:'wbot工程',workspace:'wbot'});
  await api('/channels/' + topic.id + '/thread-members/' + users[0],'PUT');
  const workspaceFile = path.join(root,'workspaces.json');
  await save(workspaceFile,JSON.stringify({wbot:workspace,discordgpt:repo},null,2));
  const envFile = path.join(root,'discordgpt.env');
  const settings = {DISCORD_BOT_TOKEN:token,CODEX_PROJECT_DIR:workspace,DISCORD_ALLOWED_USER_IDS:users.join(','),
    DISCORD_ALLOWED_CHANNEL_IDS:dmId + ',' + parent.id,DISCORD_REQUIRE_MENTION:'false',DISCORD_PROGRESS_ENABLED:'false',
    CODEX_BIN:path.join(home,'.local/bin/codex'),CODEX_MODEL:entries[0][1].model,CODEX_SANDBOX:'danger-full-access',
    CODEX_APPROVAL_POLICY:'never',CODEX_WORKSPACES_FILE:workspaceFile,CODEX_DISCORD_STATE_DIR:stateDir};
  await save(envFile,Object.entries(settings).filter(([,v])=>v).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n');
  const unitFile = path.join(home,'.config/systemd/user',newUnit);
  try {await fs.access(unitFile);throw new Error('New unit already exists');} catch(error) {if(error.code!=='ENOENT')throw error;}
  await save(unitFile, '[Unit]\nDescription=Independent Discord Codex workspace assistant\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory='+release+'\nEnvironment=CODEX_DISCORD_ENV_FILE='+envFile+'\nEnvironment=CODEX_HOME='+path.join(home,'.codex')+'\nEnvironment=PATH='+path.dirname(process.execPath)+':'+path.join(home,'.local/bin')+':/usr/bin:/bin\nExecStart='+process.execPath+' '+path.join(release,'dist/index.js')+'\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\nStandardInput=null\nUMask=0077\n\n[Install]\nWantedBy=default.target\n');
  const manifest = {status:'prepared',createdAt:new Date().toISOString(),release,stateDir,dmId,parentId:parent.id,topicId:topic.id,guildId:trade.guild_id,
    oldEnabled:ctl('is-enabled',oldUnit)==='enabled',topicUrl:'https://discord.com/channels/'+trade.guild_id+'/'+topic.id};
  await save(manifestFile,JSON.stringify(manifest,null,2));
  await api('/channels/'+topic.id+'/messages','POST',{content:'wbot 工程话题已创建。工作区：'+workspace+'。旧服务在当前回复完成后交接，完成后另行通知。',allowed_mentions:{parse:[]}});
  ctl('daemon-reload');console.log(JSON.stringify(manifest));
} else if (process.argv[2] === 'handoff') {
  const m=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  if(m.status!=='prepared')throw new Error('Rollout not prepared or already ran');
  const deadline=Date.now()+20*60_000;let idleSince;
  console.log('Waiting for legacy turns and reply delivery to finish');
  while(Date.now()<deadline) {
    const sessions=JSON.parse(await fs.readFile(oldStateFile,'utf8'));
    if(Object.values(sessions).some(record=>record.pending))idleSince=undefined;else idleSince??=Date.now();
    if(idleSince && Date.now()-idleSince>=15000)break;
    await delay(2000);
  }
  if(!idleSince || Date.now()-idleSince<15000){await notify(m,'discordgpt 接管等待超时，旧服务保持运行，没有强行中断工作。');throw new Error('Legacy service did not drain');}
  let stopped=false;
  try {
    const sessions=JSON.parse(await fs.readFile(oldStateFile,'utf8'));
    if(Object.values(sessions).some(record=>record.pending))throw new Error('New legacy work arrived');
    stopped=true;ctl('disable','--now',oldUnit);
    const store=new StateStore(m.stateDir);await store.load();
    for(const [key,record]of Object.entries(sessions))if(key.startsWith('dm:')&&record.thread_id)await store.set(key.slice(3),record.thread_id);
    const since=new Date().toISOString();ctl('enable','--now',newUnit);
    let ready=false;
    for(let i=0;i<30;i++) {
      await delay(2000);
      const logs=execFileSync('journalctl',['--user','-u',newUnit,'--since',since,'--no-pager','-o','cat'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
      if(ctl('is-active',newUnit)==='active' && logs.includes('Discord bot ready as')){ready=true;break;}
    }
    if(!ready)throw new Error('New Discord service did not become ready');
    m.status='completed';m.completedAt=new Date().toISOString();await save(manifestFile,JSON.stringify(m,null,2));
    await notify(m,'discordgpt 已接管聊天，旧聊天服务已停止。私聊继续沿用原 Codex 上下文。\nwbot 工程话题：'+m.topicUrl+'\n进入话题直接聊天；主频道也可直接向 Codex 发送任务。trade 推送不变。');
    await api('/channels/'+m.topicId+'/messages','POST',{content:'discordgpt 接管完成。这里绑定 wbot 工程，使用独立 Codex 上下文，现在可以直接发送任务。',allowed_mentions:{parse:[]}});
    console.log('Handoff completed and notified');
  } catch(error) {
    // A notification failure must not tear down an already healthy service.
    if(m.status==='completed'){console.error('Service ready, completion notification failed');throw error;}
    try {ctl('disable','--now',newUnit);} catch {console.error('New service cleanup failed; verify it is stopped');}
    if(stopped)ctl(...(m.oldEnabled?['enable','--now',oldUnit]:['start',oldUnit]));
    m.status='rolled-back';await save(manifestFile,JSON.stringify(m,null,2));
    await notify(m,'discordgpt 接管失败，已回滚旧聊天服务，请检查接管日志。');throw error;
  }
} else throw new Error('Usage: node scripts/deploy-wbot-handoff.mjs prepare|handoff');
