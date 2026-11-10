import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {configuredHostRoot} from './host-path.mjs';
const cwd=fileURLToPath(new URL('..',import.meta.url));
const unit=process.argv.includes('--unit');
const env={...process.env};
const files=unit?['bridge-unit','client','package','policy','release']:['bridge-unit','client','coordinator','host','package','policy','release','server'];
let executable=process.execPath;
const args=[];
if(unit) env.DSH_UNIT_ONLY='1';
else {
  const root=configuredHostRoot();
  if(!root) {console.error('Full tests require DSH_TEST_ROOT. Run npm run test:unit without a DSH installation, or read CONTRIBUTING.md.');process.exit(1);}
  if(env.DSH_TEST_EXECUTABLE) {executable=env.DSH_TEST_EXECUTABLE;env.ELECTRON_RUN_AS_NODE='1';}
  else if(root.endsWith('.asar')&&!process.versions.electron) {console.error('An app.asar host requires DSH_TEST_EXECUTABLE pointing to the installed Electron application.');process.exit(1);}
  args.push('--import',pathToFileURL(join(cwd,'scripts/test-loader.mjs')).href);
}
args.push('--test',...files.map(name=>join(cwd,'test',name+'.test.mjs')));
const child=spawn(executable,args,{cwd,env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{if(signal)console.error('Test process ended with signal '+signal);process.exitCode=code??1;});
