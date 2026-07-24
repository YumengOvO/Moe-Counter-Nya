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

test("reset interaction requires confirmation and supports cancellation", () => {
  const accepted = createConfirmationFixture({
    action: "reset",
    name: "sample",
    confirmed: true,
  });
  accepted.submit();

  assert.equal(accepted.message, "确定要将计数器 “sample” 清零吗？");
  assert.equal(accepted.prevented, false);

  const cancelled = createConfirmationFixture({
    action: "reset",
    name: "sample",
    confirmed: false,
  });
  cancelled.submit();

  assert.equal(cancelled.prevented, true);
});

test("delete interaction clearly warns that the public link will stop working", () => {
  const fixture = createConfirmationFixture({
    action: "delete",
    name: "sample",
    confirmed: false,
  });
  fixture.submit();

  assert.match(fixture.message, /删除计数器 “sample”/);
  assert.match(fixture.message, /公开链接将返回 404/);
  assert.equal(fixture.prevented, true);
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

function createConfirmationFixture({ action, name, confirmed }) {
  let submitHandler;
  let message;
  let prevented = false;
  const form = {
    dataset: {
      confirmAction: action,
      name,
    },
  };
  const document = {
    addEventListener(event, handler) {
      if (event === "submit") submitHandler = handler;
    },
    querySelector() {
      return null;
    },
  };

  vm.runInNewContext(script, {
    document,
    navigator: {},
    confirm(value) {
      message = value;
      return confirmed;
    },
  });

  return {
    get message() {
      return message;
    },
    get prevented() {
      return prevented;
    },
    submit() {
      submitHandler({
        target: {
          closest(selector) {
            return selector === ".confirm-action" ? form : null;
          },
        },
        preventDefault() {
          prevented = true;
        },
      });
    },
  };
}
