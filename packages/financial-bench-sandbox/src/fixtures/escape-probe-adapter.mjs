// Complete sandbox probes before the launcher emits `ready`. These checks test
// container policy, while `run()` remains inside the harness's intentionally
// fixed 100 ms target observation window.
const [fs, child, net] = await Promise.all([
  import("node:fs/promises"),
  import("node:child_process"),
  import("node:net"),
]);
const denied = async (operation) => {
  try { await operation(); return false; } catch { return true; }
};
const [fsDenied, childDenied, networkDenied] = await Promise.all([
  denied(() => fs.readFile("/etc/passwd")),
  denied(() => new Promise((resolve, reject) => {
    const process = child.spawn("/bin/true");
    process.once("error", reject); process.once("exit", (code) => code === 0 ? resolve() : reject());
  })),
  denied(() => new Promise((resolve, reject) => {
    const socket = net.connect({ host: "1.1.1.1", port: 53 });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("timeout")); }, 10);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  })),
]);
const environmentCount = Object.keys(process.env).length;

export default Object.freeze({
  async run(stimulus) {
    return {
      binding: stimulus.binding,
      decisionId: `probe-${fsDenied}-${childDenied}-${networkDenied}-${environmentCount}`,
      disposition: fsDenied && childDenied && networkDenied && environmentCount === 0 ? "deny" : "unsupported",
      schemaVersion: "runbook.financial-agent-decision.v1",
    };
  },
});
