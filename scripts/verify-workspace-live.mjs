// Explicit one-turn live acceptance for the newly created workspace topic.
// Never resumes the legacy DM writer or changes project files.
import fs from 'node:fs/promises';
import { config } from '../dist/config.js';
import { StateStore } from '../dist/state.js';
import { CodexAppServer } from '../dist/codex-app-server.js';
import { loadWorkspaces } from '../dist/workspaces.js';
import { resolveWorkspace } from '../dist/topic-routing.js';
const manifest=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
if(manifest.status!=='prepared')throw new Error('Run live acceptance only before rollout');
const state=new StateStore(config.stateDir);await state.load();
const workspaces=await loadWorkspaces(config.projectDir,config.workspacesFile);
const binding=resolveWorkspace(state,manifest.topicId,true,workspaces);
const server=new CodexAppServer(config.codexBin,binding.cwd,{model:config.model,sandbox:config.sandbox,approvalPolicy:config.approvalPolicy});
const deadline=setTimeout(()=>{console.error('Live turn timed out');void server.close().finally(()=>process.exit(1));},90000);
try {
  await server.start();
  let thread=state.get(manifest.topicId);
  if(thread)await server.resumeThread(thread,binding.cwd);
  else {thread=await server.startThread(binding.cwd);await state.set(manifest.topicId,thread);}
  const result=await server.runTurn(thread,'这是部署连通性验收，不是工程任务。不要使用工具，不要读取或修改任何文件。仅回复“wbot 工程已就绪”。',undefined,undefined,binding.cwd);
  if(result.status!=='completed'||!result.finalText?.includes('wbot 工程已就绪'))throw new Error('Live model acceptance failed, status='+result.status);
  const response=await fetch('https://discord.com/api/v10/channels/'+manifest.topicId+'/messages',{
    method:'POST',signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bot '+config.token,'Content-Type':'application/json','User-Agent':'DiscordBot (https://github.com/jiayuwangcj/discordgpt, 0.3.0)'},
    body:JSON.stringify({content:'初始化验收通过：'+result.finalText+'\n已建立独立 Codex 会话，工作目录：'+binding.cwd+'。等待聊天服务交接完成后即可继续。',allowed_mentions:{parse:[]}}),
  });
  if(!response.ok)throw new Error('Discord live output failed: HTTP '+response.status);
  console.log(JSON.stringify({status:'passed',topicId:manifest.topicId,threadId:thread,cwd:binding.cwd,model:config.model}));
} finally {clearTimeout(deadline);await server.close();}
