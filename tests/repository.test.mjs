import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('仓库规则要求提交改动、更新测试并全部通过后才能报告完成', () => {
  const rules = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
  assert.match(rules, /每次改动完成后都必须创建 Git commit/);
  assert.match(rules, /每次改动之后都必须新增或更新相应测试/);
  assert.match(rules, /运行全部现有测试/);
  assert.match(rules, /只有全部测试通过、且本次改动已提交后，才能向用户报告完成/);
});

test('仓库文档中的本地文件链接均指向可读取文件', () => {
  const documents = [
    resolve(root, 'AGENTS.md'),
    ...readdirSync(resolve(root, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => resolve(root, 'docs', name)),
  ];

  for (const document of documents) {
    const content = readFileSync(document, 'utf8');
    for (const match of content.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
      const path = decodeURIComponent(target.split('#')[0]);
      assert.doesNotThrow(
        () => readFileSync(resolve(dirname(document), path)),
        `${document} 中的本地链接无法读取：${target}`,
      );
    }
  }
});
