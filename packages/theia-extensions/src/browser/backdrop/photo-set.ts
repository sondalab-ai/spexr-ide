// The curated set: NASA images, credited in ./photos/CREDITS.md. The desktop
// build inlines each import as a data URL, so the set needs no network.
import andromeda from "./photos/andromeda.jpg";
import antNebula from "./photos/ant-nebula.jpg";
import auroraFromOrbit from "./photos/aurora-from-orbit.jpg";
import avrocarWindTunnel from "./photos/avrocar-wind-tunnel.jpg";
import helixNebula from "./photos/helix-nebula.jpg";
import hubble from "./photos/hubble.jpg";
import hubbleOrbit from "./photos/hubble-orbit.jpg";
import launchStreak from "./photos/launch-streak.jpg";
import nileCityLights from "./photos/nile-city-lights.jpg";
import ringNebula from "./photos/ring-nebula.jpg";
import saturn from "./photos/saturn.jpg";
import saturnRings from "./photos/saturn-rings.jpg";
import shuttlePadNight from "./photos/shuttle-pad-night.jpg";
import slsNightLaunch from "./photos/sls-night-launch.jpg";
import solarEclipse from "./photos/solar-eclipse.jpg";
import solarFlare from "./photos/solar-flare.jpg";
import spaceStation from "./photos/space-station.jpg";
import windTunnelModel from "./photos/wind-tunnel-model.jpg";

/** Picture URLs the photo backdrop cycles when `spexr.backdrop.photos` is empty. */
export const CURATED_PHOTOS: readonly string[] = [
  andromeda,
  antNebula,
  auroraFromOrbit,
  avrocarWindTunnel,
  helixNebula,
  hubble,
  hubbleOrbit,
  launchStreak,
  nileCityLights,
  ringNebula,
  saturn,
  saturnRings,
  shuttlePadNight,
  slsNightLaunch,
  solarEclipse,
  solarFlare,
  spaceStation,
  windTunnelModel,
];

/**
 * The photo to show after `previous`: a random entry of `list`, never
 * `previous` itself when there is another to choose. `undefined` for an
 * empty list. `random` returns 0..1, as `Math.random` does.
 */
export function nextPhoto(
  list: readonly string[],
  previous: string | undefined,
  random: () => number = Math.random,
): string | undefined {
  const others = list.length > 1 && previous !== undefined ? list.filter((p) => p !== previous) : list;
  if (others.length === 0) return undefined;
  return others[Math.min(others.length - 1, Math.floor(random() * others.length))];
}
