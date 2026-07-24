"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(
  path.resolve(__dirname, "../assets/admin.js"),
  "utf8",
);

test("copy interaction writes the public URL and reports success", async () => {
  const copied = [];
  const fixture = createFixture({
    async writeText(value) {
      copied.push(value);
    },
  });

  await fixture.click();

  assert.deepEqual(copied, ["https://counter.example/@sample"]);
  assert.equal(
    fixture.feedback.textContent,
    "已复制 “sample” 的公开链接",
  );
  assert.equal(fixture.button.disabled, false);
});

test("copy interaction reports a useful failure when Clipboard API rejects", async () => {
  const fixture = createFixture({
    async writeText() {
      throw new Error("permission denied");
    },
  });

  await fixture.click();

  assert.equal(
    fixture.feedback.textContent,
    "复制失败，请手动选择并复制公开链接",
  );
  assert.equal(fixture.button.disabled, false);
});

function createFixture(clipboard) {
  let clickHandler;
  const feedback = { textContent: "" };
  const button = {
    dataset: {
      link: "https://counter.example/@sample",
      name: "sample",
    },
    disabled: false,
  };

  const document = {
    addEventListener(event, handler) {
      if (event === "click") clickHandler = handler;
    },
    querySelector(selector) {
      return selector === "#copy-feedback" ? feedback : null;
    },
  };

  vm.runInNewContext(script, {
    document,
    navigator: { clipboard },
  });

  return {
    button,
    feedback,
    click() {
      return clickHandler({
        target: {
          closest(selector) {
            return selector === ".copy-link" ? button : null;
          },
        },
      });
    },
  };
}
