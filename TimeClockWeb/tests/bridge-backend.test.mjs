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
