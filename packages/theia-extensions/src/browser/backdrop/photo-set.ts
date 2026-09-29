import type { Photo } from "./photo-feed.js";
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

/** The curated NASA set: offline, and the stand-in whenever the network is out. */
export const CURATED: readonly Photo[] = [
  {
    url: andromeda,
    credit: {
      author: "NASA/JPL/California Institute of Technology",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/PIA04921",
    },
  },
  {
    url: antNebula,
    credit: {
      author: "NASA/Space Telescope Science Institute",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/PIA04216",
    },
  },
  {
    url: auroraFromOrbit,
    credit: {
      author: "NASA/GSFC",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e001871",
    },
  },
  {
    url: avrocarWindTunnel,
    credit: {
      author: "NASA/Dave West",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/ARC-1961-A-27748",
    },
  },
  {
    url: helixNebula,
    credit: {
      author: "NASA/JPL-Caltech",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/PIA15658",
    },
  },
  {
    url: hubble,
    credit: {
      author: "NASA/JSC",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/s31-10-018",
    },
  },
  {
    url: hubbleOrbit,
    credit: {
      author: "NASA/JSC",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/s90-34002",
    },
  },
  {
    url: launchStreak,
    credit: {
      author: "NASA/Frank Michaux",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/KSC-20250115-PH-FMX01_0004",
    },
  },
  {
    url: nileCityLights,
    credit: {
      author: "NASA/GSFC",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e001586",
    },
  },
  {
    url: ringNebula,
    credit: {
      author: "NASA/GSFC",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/GSFC_20171208_Archive_e001465",
    },
  },
  {
    url: saturn,
    credit: {
      author: "NASA/JPL",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/PIA01969",
    },
  },
  {
    url: saturnRings,
    credit: {
      author: "NASA/JPL",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/PIA02241",
    },
  },
  {
    url: shuttlePadNight,
    credit: {
      author: "NASA/KSC",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/ksc-81pc-137",
    },
  },
  {
    url: slsNightLaunch,
    credit: {
      author: "NASA/Terry White",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/B1B_Crew_Night_Launch",
    },
  },
  {
    url: solarEclipse,
    credit: {
      author: "NASA/Carla Thomas",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/AFRC2017-0233-005",
    },
  },
  {
    url: solarFlare,
    credit: {
      author: "NASA/GSFC/Solar Dynamics Observatory",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/PIA21949",
    },
  },
  {
    url: spaceStation,
    credit: {
      author: "NASA/MSFC",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/9131518",
    },
  },
  {
    url: windTunnelModel,
    credit: {
      author: "NACA",
      via: "NASA",
      viaUrl: "https://images.nasa.gov",
      pageUrl: "https://images.nasa.gov/details/A-9591",
    },
  },
];
