import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const skill = fileURLToPath(new URL('../skills/vercel-neon-deploy/', import.meta.url));

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    files.push(...(entry.isDirectory() ? await filesIn(path) : [path]));
  }
  return files;
}

test('部署技能能脱离来源仓库加载，所有本地资源和锚点均可解析', async () => {
  for (const path of await filesIn(skill)) {
    if (!path.endsWith('.md')) continue;
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^https?:\/\//.test(target)) {
        assert.equal(new URL(target).protocol, 'https:');
        continue;
      }
      const [relative, anchor] = target.split('#');
      const resolved = resolve(dirname(path), relative || '.');
      assert.ok(resolved.startsWith(skill), `资源不能依赖来源仓库: ${target}`);
      assert.ok((await stat(resolved)).isFile());
      if (anchor) {
        const headings = (await readFile(resolved, 'utf8')).split('\n')
          .filter(line => /^#{1,6} /.test(line))
          .map(line => line.replace(/^#{1,6} /, '').trim().toLowerCase().replaceAll(' ', '-'));
        assert.ok(headings.includes(decodeURIComponent(anchor)), `锚点无效: ${target}`);
      }
    }
  }
});

test('技能发现名称、目录名称和调用入口一致，安装包不携带应用密钥或数据库文件', async () => {
  const entry = await readFile(resolve(skill, 'SKILL.md'), 'utf8');
  const name = entry.match(/^name: (.+)$/m)?.[1];
  assert.equal(name, 'vercel-neon-deploy');
  assert.ok(entry.startsWith('---\n'));
  assert.ok(entry.match(/^description: .+$/m));
  const metadata = await readFile(resolve(skill, 'agents/openai.yaml'), 'utf8');
  assert.ok(metadata.includes(`$${name}`));
  for (const path of await filesIn(skill)) {
    assert.ok(/\.(md|yaml)$/.test(path), `意外安装文件: ${path}`);
    const text = await readFile(path, 'utf8');
    assert.doesNotMatch(text, /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/);
    assert.doesNotMatch(text, /\/Users\//);
  }
});
