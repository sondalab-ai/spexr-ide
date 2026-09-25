import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { POWER_SAVE_ENTER_PERCENT, POWER_SAVE_LEAVE_PERCENT } from "../../common/power-protocol.js";

export interface BatteryReading {
  readonly level: number;
  readonly onBattery: boolean;
}

/** A reading from macOS `pmset -g batt`, or undefined when there is no battery. */
export function parsePmset(stdout: string): BatteryReading | undefined {
  const level = stdout.match(/\t(\d+)%;/);
  if (!level) return undefined;
  return { level: Number(level[1]), onBattery: stdout.includes("'Battery Power'") };
}

/** A reading from Linux `/sys/class/power_supply/BAT*` `capacity` and `status` files. */
export function parseSysfs(capacity: string, status: string): BatteryReading | undefined {
  const level = Number.parseInt(capacity.trim(), 10);
  if (Number.isNaN(level)) return undefined;
  return { level, onBattery: status.trim() === "Discharging" };
}

/**
 * Whether to be saving power after this reading, given whether we were.
 * The gap between the two thresholds keeps a charge hovering around one of
 * them from switching features on and off at every reading.
 */
export function nextSaving(saving: boolean, reading: BatteryReading | undefined): boolean {
  if (!reading?.onBattery) return false;
  return saving ? reading.level < POWER_SAVE_LEAVE_PERCENT : reading.level <= POWER_SAVE_ENTER_PERCENT;
}

/** The battery on this machine, or undefined where there is none or it cannot be read. */
export async function readBattery(platform: NodeJS.Platform = process.platform): Promise<BatteryReading | undefined> {
  try {
    if (platform === "darwin") return parsePmset(await run("pmset", ["-g", "batt"]));
    if (platform === "linux") {
      const base = "/sys/class/power_supply";
      const battery = (await readdir(base)).find((d) => d.startsWith("BAT"));
      if (!battery) return undefined;
      const [capacity, status] = await Promise.all([
        readFile(join(base, battery, "capacity"), "utf8"),
        readFile(join(base, battery, "status"), "utf8"),
      ]);
      return parseSysfs(capacity, status);
    }
  } catch {
    /* no battery information: treat as mains */
  }
  return undefined;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => (err && !stdout ? reject(err) : resolve(stdout)));
  });
}
