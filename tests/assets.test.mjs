import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CARDS } from "../public/cards.js";
test("78 张本地牌面均有独立来源、匹配哈希、完整 JPEG 标记", () => {
  const sources = JSON.parse(
    readFileSync(new URL("../public/assets/sources.json", import.meta.url)),
  );
  assert.equal(sources.cards.length, 78);
  assert.equal(new Set(sources.cards.map((c) => c.sha256)).size, 78);
  for (const c of CARDS) {
    const record = sources.cards.find((r) => r.id === c.id);
    assert.ok(record);
    const bytes = readFileSync(new URL("../public" + c.image, import.meta.url));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      record.sha256,
    );
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9);
    assert.match(record.url, /^https:\/\/raw.githubusercontent.com\//);
  }
});

test("全部 78 张牌面可通过实际 HTTP 加载，并允许浏览器缓存", async () => {
  const { createServer } = await import("../server.mjs");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const card of CARDS) {
      const response = await fetch(base + card.image);
      assert.equal(response.status, 200, card.name);
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      assert.equal(
        response.headers.get("cache-control"),
        "public, max-age=86400",
      );
      const received = Buffer.from(await response.arrayBuffer());
      const expected = readFileSync(
        new URL("../public" + card.image, import.meta.url),
      );
      assert.deepEqual(
        received,
        expected,
        `${card.name} 的 HTTP 内容应与本地牌面一致`,
      );
    }
    const head = await fetch(base + "/assets/m2.jpg", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("cache-control"), "public, max-age=86400");
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    for (const path of ["/", "/app.js", "/core.js", "/journal.js", "/meanings.js", "/meaning-sources.js", "/spirit-references.js"]) {
      assert.equal(
        (await fetch(base + path)).headers.get("cache-control"),
        "no-store",
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
