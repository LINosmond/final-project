import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const code = await fs.readFile(new URL('../google-apps-script/Code.gs', import.meta.url),'utf8');
function backend() {
  const ctx = vm.createContext({
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ getContent: () => text, setMimeType() { return this; } }) },
    HtmlService: { XFrameOptionsMode: { ALLOWALL: 'allow' }, createHtmlOutput: html => ({ html, setXFrameOptionsMode(mode) { this.mode=mode;return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'API_KEY' ? 'fixture-key' : null }) },
  });
  vm.runInContext(code,ctx);
  return ctx;
}

test('bridge keeps API authentication before touching the spreadsheet', () => {
  const b=backend();
  assert.equal(b.bridgeApi(JSON.stringify({ action: 'getAll', apiKey: 'wrong' })).error,'unauthorized');
  assert.equal(b.bridgeApi('malformed-json').ok,false);
  assert.equal(b.bridgeApi({}).ok,false);
});

test('HTTP response construction happens after releasing the transaction lock', () => {
  const b=backend(); let held=false;
  b.LockService={getScriptLock:()=>({waitLock(){held=true;},releaseLock(){held=false;}})};
  b.getSheet_=()=>({getDataRange:()=>({getValues:()=>[['key','value'],['employees','[]']]})});
  b.adminOk_=()=>false;
  b.jsonResponse_=data=>{assert.equal(held,false);return data;};
  assert.equal(b.doPost({postData:{contents:JSON.stringify({action:'getAll',keys:['employees'],apiKey:'fixture-key'})}}).ok,true);
});

test('RPC returns authenticated data without constructing any ContentService response', () => {
  const b=backend(); let released=false;
  b.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){released=true;}})};
  b.getSheet_=()=>({getDataRange:()=>({getValues:()=>[['key','value'],['employees','[{"id":"fixture","phone":"private"}]'],['salary','private-salary']]})});
  b.adminOk_=()=>false;
  b.jsonResponse_=()=>{throw new Error('ContentService must not be used for RPC');};
  const data=b.bridgeApi(JSON.stringify({action:'getAll',keys:['employees','salary'],apiKey:'fixture-key'}));
  assert.equal(data.values.salary,null);
  assert.equal(JSON.parse(data.values.employees)[0].phone,undefined);
  assert.equal(released,true);
});

test('bridge HTML only accepts approved parent origins and safe correlation identifiers', () => {
  const b=backend(), params={ bridge:'1',bridgeId:'11111111-1111-4111-8111-111111111111',parentOrigin:'https://linosmond.github.io' };
  const html=b.doGet({ parameter:params });
  assert.equal(html.mode,'allow');
  assert.match(html.html,/event\.origin!==parentOrigin/);
  assert.match(html.html,/event\.source!==window\.top/);
  assert.match(html.html,/google\.script\.run/);
  for(const parentOrigin of ['https://evil.example','https://linosmond.github.io.evil.example']) {
    assert.equal(b.doGet({parameter:{...params,parentOrigin}}).html,'Invalid bridge request');
  }
  assert.equal(b.doGet({parameter:{...params,bridgeId:'</script><script>evil()'}}).html,'Invalid bridge request');
});

test('getAll reads Punches once while retaining auth, numeric timestamps and empty-row filtering', () => {
  const b=backend(); let reads=0, released=false;
  b.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){released=true;}})};
  b.getSheet_=()=>({getDataRange:()=>({getValues:()=>[['key','value'],['salary','private-salary']]})});
  b.adminOk_=()=>false;
  b.getPunchSheet_=()=>({getDataRange:()=>({getValues(){reads++;return [
    ['id','employeeId','employeeName','type','ts','actualTs'],
    ['p1','e1','Fixture','in','1000','1200'],['','','','','',''],
  ];}})});
  const result=b.bridgeApi(JSON.stringify({ action:'getAll', keys:['punches','salary'], apiKey:'fixture-key' }));
  assert.equal(result.ok,true);
  assert.equal(reads,1);
  assert.equal(result.values.salary,null);
  assert.deepEqual(JSON.parse(result.values.punches),[{id:'p1',employeeId:'e1',employeeName:'Fixture',type:'in',ts:1000,actualTs:1200}]);
  assert.equal(released,true);
});

test('getAll still migrates a legacy punch blob inside the same lock', () => {
  const b=backend(); let rows=[['id','employeeId','employeeName','type','ts','actualTs']],writes=0,held=false;
  const legacy=[{id:'p1',employeeId:'e1',employeeName:'Fixture',type:'in',ts:1000}];
  const sheet={getDataRange:()=>({getValues:()=>rows})};
  b.LockService={getScriptLock:()=>({waitLock(){held=true;},releaseLock(){held=false;}})};
  b.getSheet_=()=>({getDataRange:()=>({getValues:()=>[['key','value'],['punches',JSON.stringify(legacy)]]})});
  b.adminOk_=()=>false; b.getPunchSheet_=()=>sheet;
  b.writePunches_=(punches,existing)=>{assert.equal(held,true);assert.equal(existing,sheet);writes++;rows=[rows[0],...punches.map(p=>b.punchToRow_(p))];};
  const result=b.bridgeApi(JSON.stringify({action:'getAll',keys:['punches'],apiKey:'fixture-key'}));
  assert.equal(result.ok,true); assert.equal(writes,1);
  assert.deepEqual(JSON.parse(result.values.punches),legacy);
  assert.equal(held,false);
});
