import { describe, it, expect } from "vitest";
import {
  isOtherBusy,
  isOwnerOf,
  validateRange,
  toLocalInput,
  fromLocalInput,
  overlapsRange,
  nextHalfHour,
  truncate,
} from "../lib/eventUtils";

describe("isOtherBusy —— 只有别人的 busy 事件才显示为灰色忙碌", () => {
  it("自己的 busy 事件不应被判定为 busy（回归：托盘里自己的日程被显示成 Busy）", () => {
    expect(isOtherBusy({ visibility: "busy", owner_id: "local" }, "local")).toBe(false);
  });

  it("同事的 busy 事件应显示为忙碌", () => {
    expect(isOtherBusy({ visibility: "busy", owner_id: "u-100" }, "local")).toBe(true);
  });

  it("public 事件永远显示真实标题", () => {
    expect(isOtherBusy({ visibility: "public", owner_id: "u-100" }, "local")).toBe(false);
  });

  it("selfId 缺失（未初始化）时不做脱敏，避免误伤自己的日程", () => {
    expect(isOtherBusy({ visibility: "busy", owner_id: "u-100" }, "")).toBe(false);
  });
});

describe("isOwnerOf —— 单机模式下本地用户对自己日程有全部权限", () => {
  it("owner_id 与 selfId 相同 → 拥有", () => {
    expect(isOwnerOf({ owner_id: "local" }, "local")).toBe(true);
  });

  it("owner_id 不是自己 → 不拥有", () => {
    expect(isOwnerOf({ owner_id: "u-100" }, "local")).toBe(false);
  });

  it("owner_id 缺失/unknown 的脏数据视为自己的（可编辑，不至于卡死）", () => {
    expect(isOwnerOf({ owner_id: "" as string }, "local")).toBe(true);
    expect(isOwnerOf({ owner_id: "unknown" }, "local")).toBe(true);
  });
});

describe("validateRange —— 时间合法性", () => {
  it("正常区间通过", () => {
    expect(validateRange("2026-10-26T09:00", "2026-10-26T10:00")).toBeNull();
  });

  it("结束早于开始 → 报错", () => {
    expect(validateRange("2026-10-26T10:00", "2026-10-26T09:00")).toMatch(/晚于/);
  });

  it("结束等于开始 → 报错（0 长度事件不允许）", () => {
    expect(validateRange("2026-10-26T10:00", "2026-10-26T10:00")).toMatch(/晚于/);
  });

  it("空串 / 非法时间 → 报错", () => {
    expect(validateRange("", "2026-10-26T10:00")).toMatch(/开始/);
    expect(validateRange("2026-10-26T09:00", "not-a-date")).toMatch(/结束/);
  });
});

describe("datetime-local 双向转换", () => {
  it("ISO → 本地串 → ISO 往返一致", () => {
    const iso = new Date(2026, 9, 26, 14, 30).toISOString();
    const local = toLocalInput(iso);
    expect(local).toBe("2026-10-26T14:30");
    expect(fromLocalInput(local)).toBe(iso);
  });

  it("空值安全", () => {
    expect(toLocalInput(undefined)).toBe("");
    expect(toLocalInput(null)).toBe("");
    expect(fromLocalInput("")).toBe("");
  });
});

describe("overlapsRange —— 视图区间过滤", () => {
  const ev = { start_time: "2026-10-26T02:00:00.000Z", end_time: "2026-10-26T03:00:00.000Z" };

  it("区间内的事件命中", () => {
    expect(
      overlapsRange(ev, new Date("2026-10-26T00:00:00.000Z"), new Date("2026-10-27T00:00:00.000Z"))
    ).toBe(true);
  });

  it("区间外的事件不命中", () => {
    expect(
      overlapsRange(ev, new Date("2026-10-27T00:00:00.000Z"), new Date("2026-10-28T00:00:00.000Z"))
    ).toBe(false);
  });

  it("脏数据 end < start 不崩溃（按 start 计）", () => {
    const bad = { start_time: "2026-10-26T03:00:00.000Z", end_time: "2026-10-26T01:00:00.000Z" };
    expect(
      overlapsRange(bad, new Date("2026-10-26T00:00:00.000Z"), new Date("2026-10-27T00:00:00.000Z"))
    ).toBe(true);
  });
});

describe("nextHalfHour / truncate", () => {
  it("10:07 → 10:30", () => {
    const d = nextHalfHour(new Date(2026, 9, 26, 10, 7, 12));
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
    expect(d.getSeconds()).toBe(0);
  });

  it("10:45 → 11:00", () => {
    const d = nextHalfHour(new Date(2026, 9, 26, 10, 45));
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(0);
  });

  it("超长标题被截断", () => {
    expect(truncate("A".repeat(80), 60).length).toBe(60);
  });
});
