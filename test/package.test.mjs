import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = await json('package.json');

test('bundle keeps native runtime exports and exports its display resources', async () => {
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.exports['.'], './src/index.js');
  assert.equal(manifest.exports['./client'], './src/client.js');
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json');
  assert.equal(manifest.exports['./icon'], './icon.svg');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1');
  assert.equal(manifest.dependencies?.react, undefined);
  for (const path of ['src/index.js', 'src/client.js', 'src/errors.js', 'cordis.patch.yml',
    'locale/en.json', 'locale/zh.json', 'icon.svg', 'CONTRIBUTING.md']) {
    assert.equal((await stat(new URL(path, root))).isFile(), true, path);
  }
  for (const entry of ['src', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'CONTRIBUTING.md']) {
    assert.equal(manifest.files.includes(entry), true, entry);
  }
  assert.equal(manifest.scripts.postinstall, undefined);
});

for (const language of ['en', 'zh']) {
  test(`${language} inventory title and description describe the delivered plugin`, async () => {
    const {meta} = await json(`locale/${language}.json`);
    assert.equal(typeof meta.title, 'string');
    assert.equal(typeof meta.description, 'string');
    assert.ok(meta.title.trim().length > 0);
    assert.ok(meta.description.trim().length >= 10);
    assert.doesNotMatch(meta.title + meta.description, /my decoration|my plugin|模板|装饰示例/i);
    if (language === 'en') assert.match(meta.description, /replay|Responses/i);
    else assert.match(meta.description, /回放|Responses/);
    assert.match(meta.description, /AgentRouter/);
  });
}

test('package icon is a bounded, self-contained SVG rather than default artwork', async () => {
  const bytes = await readFile(new URL('icon.svg', root));
  const source = bytes.toString('utf8');
  assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024);
  assert.match(source, /<svg\b/);
  assert.match(source, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(source, /viewBox="[^"]+"/);
  assert.match(source, /<\/svg>/);
  assert.doesNotMatch(source, /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)/i);
});

test('user introduction is concise and includes the symptom and safe three-step operation', async () => {
  const introduction = await readFile(new URL('README.md', root), 'utf8');
  assert.ok(introduction.split(/\r?\n/).length <= 40);
  assert.equal((introduction.match(/^## /gm) ?? []).length, 3);
  assert.match(introduction, /解决什么问题/);
  assert.match(introduction, /典型报错/);
  assert.match(introduction, /怎么操作/);
  assert.match(introduction, /The requested item was created under a different Azure OpenAI resource/);
  assert.match(introduction, /^1\. .*原会话/m);
  assert.match(introduction, /^2\. .*模型选择旁.*重置旧回放/m);
  assert.match(introduction, /^3\. .*操作完成.*继续聊天/m);
  assert.match(introduction, /结果未确认.*重试检查/);
  assert.match(introduction, /0\.2\.2-rc\.1/);
  assert.match(introduction, /<CONTRIBUTING\.md>/);
  assert.equal(manifest.files.includes('CONTRIBUTING.md'), true);
});
