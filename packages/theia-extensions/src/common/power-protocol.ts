/**
 * Battery-driven power saving. The backend reads the battery and decides;
 * every window asks it, and both sides switch their energy-hungry features
 * off while `saving` is true.
 */

export const POWER_SERVICE_PATH = "/services/spexr/power";

/** Power saving starts at or below this charge while on battery... */
export const POWER_SAVE_ENTER_PERCENT = 20;
/** ...and ends on mains power or once the charge is back to this. */
export const POWER_SAVE_LEAVE_PERCENT = 30;

export interface PowerState {
  readonly saving: boolean;
  /** Battery charge 0..100, or undefined on a machine without one. */
  readonly level: number | undefined;
  readonly onBattery: boolean;
}

export interface SpexrPowerService {
  state(): Promise<PowerState>;
}
