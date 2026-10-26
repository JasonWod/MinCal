import { describe, it, expect } from "vitest";
import { setServer, getServer } from "../lib/api";

// 端口迁移与地址规整：默认端口已从 8091 改为 28091，
// 老装机存下来的 :8091 地址必须自动改写，否则同步会打到别人占用的端口上。
describe("服务器地址：默认端口与旧地址迁移", () => {
  it("未设置时默认指向 28091", () => {
    expect(getServer()).toBe("http://127.0.0.1:28091");
  });

  it("去掉结尾斜杠，避免拼出 //sync", () => {
    setServer("http://10.0.0.5:28091/");
    expect(getServer()).toBe("http://10.0.0.5:28091");
    setServer("http://10.0.0.5:28091///");
    expect(getServer()).toBe("http://10.0.0.5:28091");
  });

  it("把历史遗留的 :8091 迁移到 :28091", () => {
    setServer("http://100.66.1.15:8091");
    expect(getServer()).toBe("http://100.66.1.15:28091");
  });

  it("迁移后的地址会被写回 localStorage（重启后仍是新端口）", () => {
    setServer("http://192.168.1.20:8091/");
    expect(localStorage.getItem("mincal_server")).toBe("http://192.168.1.20:28091");
  });

  it("非默认端口的自定义地址原样保留", () => {
    setServer("https://cal.example.com:34567");
    expect(getServer()).toBe("https://cal.example.com:34567");
  });
});
