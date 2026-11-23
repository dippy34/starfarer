# Credits, data sources and licences

Everything below was downloaded from the original provider by the scripts in `pipeline/`; no
astronomical values were typed in by hand. Licences were checked at the source on 2026-10-01.
No SpaceEngine files, textures or data are used.

## Star catalogues

| Dataset | Use | Licence | Files |
|---|---|---|---|
| **AT-HYG v4.0** (Augmented Tycho-HYG), David Nash / astronexus — <https://codeberg.org/astronexus/athyg> | 2,532,538 stars: positions, distances (mostly Gaia DR3), magnitudes, colours, IDs, IAU names | **CC BY-SA 4.0** | `public/data/stars/` |
| **HYG v4.4**, David Nash / astronexus — <https://codeberg.org/astronexus/hyg> | Hipparcos-based V magnitudes and B−V for AT-HYG stars whose Tycho photometry saturates | **CC BY-SA 4.0** | merged into `public/data/stars/` |
| **Gaia DR3**, ESA/Gaia/DPAC — queried via the ESA Gaia Archive TAP service <https://gea.esac.esa.int/tap-server/tap> | 218,626 additional stars within 100 pc (parallax > 10 mas, parallax/error > 10, RUWE < 1.4) not in AT-HYG | **CC BY-NC 3.0 IGO** (non-commercial) — <https://www.cosmos.esa.int/web/gaia-users/license> | `public/data/stars-gaia/` (kept separate; disable with `?gaia=0`) |
| **Gaia DR3 and DR2 parallaxes**, ESA/Gaia/DPAC — the ESA Gaia Archive TAP service (`gaiadr3.gaia_source`; for AT-HYG's DR2 distances `gaiadr2.gaia_source` through `gaiadr3.dr2_neighbourhood`), joined on the Gaia source ids AT-HYG gives; which parallax each distance came from: AT-HYG's `dist_src` | how far each AT-HYG star's distance can be trusted: its parallax over its error (good at 5 or more), and for the 20,860 poor ones the parallax and its error, shown on the star's card (`pipeline/fetch_distance_parallaxes.py`, `pipeline/build_distance_quality.py`) | **CC BY-NC 3.0 IGO** (non-commercial) | `public/data/stars-quality/` (kept separate; not used with `?gaia=0`) |

The derived star tiles in `public/data/stars/` are an adaptation of AT-HYG/HYG and are shared under
CC BY-SA 4.0. The tiles in `public/data/stars-gaia/` and the distance grades in
`public/data/stars-quality/` are adaptations of Gaia DR3 (and DR2) and may only be used
non-commercially.

Required Gaia acknowledgement: *This work has made use of data from the European Space Agency (ESA)
mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis
Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has
been provided by national institutions, in particular the institutions participating in the Gaia
Multilateral Agreement.* AT-HYG itself incorporates Tycho-2, Hipparcos, Yale BSC, Gliese and Gaia DR3
data; see its ACKNOWLEDGMENTS.

The G→V and BP−RP→T<sub>eff</sub> relations used for the Gaia stars were fitted by the pipeline on the
overlap between the Gaia query and AT-HYG (and on Gaia GSP-Phot temperatures); B−V→T<sub>eff</sub> uses
Ballesteros (2012), *EPL* 97, 34008.

## Solar System

All from NASA/JPL or NASA PDS (U.S. Government works, freely available):

* **JPL DE442S** planetary ephemeris (NAIF generic kernel `de442s.bsp`) — <https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/>
* **NAIF PCK** `pck00011.tpc` (IAU WGCCRE rotation models, radii), `gm_de440.tpc` (GM), `naif0012.tls` (leap seconds) — <https://naif.jpl.nasa.gov/pub/naif/generic_kernels/>
* **JPL Solar System Dynamics**: planetary satellite mean elements and physical parameters, planetary physical parameters, Keplerian elements for approximate planet positions (E. M. Standish) — <https://ssd.jpl.nasa.gov/>
  The mean periods in a world's details ("Once round the Sun") come from these elements' mean
  motions; Pluto's, which they leave out, is the sidereal period of **NASA's Pluto fact sheet**
  (NSSDCA, 90,560 days) — <https://nssdc.gsfc.nasa.gov/planetary/factsheet/plutofact.html>
* **JPL Horizons API** — state vectors and osculating elements used to calibrate and validate moon orbits, and as test reference data — <https://ssd.jpl.nasa.gov/horizons/>
* **JPL Small-Body Database Query API** — osculating elements and physical data of asteroids, TNOs and comets — <https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html>
  Comet comas and tails (`src/render/CometTails.ts`) are a model driven by each comet's total-magnitude
  parameters M1 and K1 from this database: the coma radius grows with the comet's brightness at its
  distance from the Sun (about 10^5 km for a bright comet near 1 AU), the ion tail points away from the
  Sun and the dust tail lags along the orbit. Their integrated light follows the catalogue magnitude.
  Up close, the nucleus is drawn with the catalogue diameter where known (otherwise 4 km), a generated
  two-lobed shape in the manner of 67P/Churyumov-Gerasimenko, a dark surface (albedo about 0.05, as
  Rosetta measured for 67P) and gas jets on the sunlit side.
* **PDS Ring-Moon Systems Node**, volume VG_2801: Voyager 2 PPS δ Scorpii occultation, Saturn ring normal opacity at 10 km resolution (`PS1P01.TAB`) — <https://pds-rings.seti.org/>
  Inside the rings (`src/render/RingParticles.ts`) the number of drawn particles per area follows this
  optical depth; their sizes follow a power law with exponent about −3 between centimetres and metres
  (Zebker, Marouf & Tyler 1985, *Icarus* 64, 531; drawn from 0.25 to 7 m), in a layer of the order of
  ten metres thick. Positions, shapes and the (static, co-moving) layout are generated.

## Planetary maps (`public/data/textures/`)

Per-map source URLs and credits are in `public/data/textures/manifest.json` and shown in the app.
Maps marked "8k" have a high-resolution tier that is loaded only while the body fills a large part of
the view and is freed again afterwards.
Each map also has a 1024 × 512 copy (`*_1k.jpg`, `pipeline/build_small_maps.py`), made from the map
itself and under its credit, which a world is drawn with from afar.

The moons, dwarf planets and asteroids are 4096 × 2048 maps area-averaged from the **full-resolution
USGS Astrogeology mosaics** (`pipeline/fetch_moons_hires.py`; uncompressed GeoTIFFs read with HTTP range
requests): Europa (500 m), Ganymede (1.4 km, colour), Callisto (1 km), Io (1 km, colour), Titan (4 km),
Enceladus (110 m), Tethys (293 m), Dione (154 m), Rhea (417 m), Iapetus (783 m), Triton (600 m, colour),
Pluto and Charon (300 m), Ceres (Dawn, 20 px/deg), Vesta (Dawn, 74 px/deg) — NASA/JPL/USGS/SSI/JHUAPL/
SwRI/DLR, public domain — and **Phobos** (Mars Express HRSC SRC global mosaic, 16 px/deg; ESA/DLR/FU
Berlin, CC BY-SA 3.0 IGO). Each was aligned to the earlier preview by correlation.

Bodies without a map (most small moons, asteroids and Kuiper-belt objects) get a **procedural surface**
seeded by their name: crater fields at several scales, two-tone terrain, bright fresh ejecta, cracks on
icy bodies, and an irregular shape for bodies under ~200 km. Colours follow the measured albedo where
there is one (icy beyond Jupiter otherwise; Kuiper-belt objects from grey to tholin-red). Mapped bodies get
fine procedural craters below the map's resolution when seen very close. These are invented details.

| Body | Source | Credit / licence |
|---|---|---|
| Earth (day, 4k + 8k) | NASA Earth Observatory, Blue Marble: Next Generation, Oct 2004, 21600×10800 | NASA Earth Observatory / Reto Stöckli — public domain |
| Earth (night) | NASA Earth Observatory, Black Marble 2016 | NASA Earth Observatory / Suomi NPP VIIRS — public domain |
| Earth (clouds) | NASA Earth Observatory Blue Marble cloud composite | NASA / MODIS — public domain |
| Earth (relief + water mask) | **NOAA NCEI ETOPO 2022** 60″ surface elevation, DOI 10.25921/fd45-gt74 | NOAA — U.S. Government work, no restrictions |
| Moon (4k + 8k) | NASA SVS CGI Moon Kit (LRO LROC WAC colour) | NASA's Scientific Visualization Studio — public domain |
| Moon (relief) | NASA SVS CGI Moon Kit, LRO **LOLA** LDEM 16 px/deg | NASA SVS / LOLA team — public domain |
| Mercury (2k + 8k) | MESSENGER MDIS BDR global mosaic, 166 m/px (range-read from the USGS GeoTIFF) | NASA/JHUAPL/Carnegie Institution of Washington, via USGS Astrogeology — public domain |
| Mercury (relief) | MESSENGER USGS global DEM, 665 m/px v2 | NASA/JHUAPL/CIW, USGS — public domain |
| Mars (2k + 8k) | Viking MDIM 2.1 global colour mosaic, 232 m/px (range-read from the USGS GeoTIFF) | NASA/JPL/USGS — public domain |
| Mars (relief) | MGS **MOLA** global DEM, 463 m/px | NASA/JPL/GSFC, via USGS Astrogeology — public domain |
| Jupiter | Cassini cylindrical map PIA07782 (full 3601×1801) | NASA/JPL/Space Science Institute |
| **Saturn, Uranus, Neptune** | **Hubble OPAL** global maps, 2025 (Saturn 2025a F631N/F502N/F395N, Uranus 2025a and Neptune 2025b F657N/F547M/F467M), STScI MAST HLSP, DOI 10.17909/T9G593 | NASA/ESA Hubble, OPAL program (PI A. Simon) — **CC BY 4.0** |
| Io, Europa, Ganymede, Callisto | Galileo SSI / Voyager global mosaics | NASA/JPL/USGS |
| Titan surface, Enceladus, Tethys, Dione, Rhea, Iapetus | Cassini ISS (–Voyager) global mosaics | NASA/JPL/Space Science Institute, via USGS Astrogeology |
| Triton | Voyager 2 global colour mosaic | NASA/JPL/USGS |
| Pluto, Charon | New Horizons LORRI/MVIC global mosaics | NASA/JHUAPL/SwRI, via USGS Astrogeology |
| Ceres, Vesta | Dawn FC global mosaics | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA, via USGS Astrogeology |
| Venus (disk colour) | Mariner 10 PIA23791 | NASA/JPL-Caltech |

OPAL acknowledgement: *This work used data acquired from the NASA/ESA HST Space Telescope, associated
with OPAL program (PI: Simon, GO13937), and archived by the Space Telescope Science Institute, which is
operated by the Association of Universities for Research in Astronomy, Inc., under NASA contract NAS
5-26555. All maps are available at http://dx.doi.org/10.17909/T9G593.* The OPAL maps supply the cloud
structure (each filter relative to its mean, limb-corrupted and unobserved latitudes masked and filled
zonally, planetographic latitude converted to the engine's ellipsoid); the overall colour comes from
the spectra below.

**Giant-planet and Titan colours**: E. Karkoschka (1998), *Icarus* 133, 134 — full-disk albedo spectra
300–1050 nm from ESO, 1995 (NASA PDS Atmospheres Node, volume GBAT_0001, `1995LOW.TAB`), integrated
against the CIE 1931 colour-matching functions and a 5772 K solar spectrum. Titan's disk is shaded
with its spectrum (the haze top) instead of the Cassini near-infrared surface map.

**Relief maps** are tangent-space normal maps computed from the elevation models above, with slopes
exaggerated ×2 (Moon, Mars, Mercury) and ×4 (Earth) so terrain reads at planet scale (stated in the
manifest). **Menu thumbnails** (`thumbs.jpg`) are rendered from these maps by `build_thumbnails.py`.

USGS Astrogeology products and NASA imagery are U.S. Government works. Under the JPL image use policy
(<https://www.jpl.nasa.gov/jpl-image-use-policy>) JPL images may be used for any purpose with credit
("Courtesy NASA/JPL-Caltech" unless the caption says otherwise); images owned by third parties may
carry restrictions on commercial use — check the caption of each PIA image before commercial use.

## Sky (`public/data/sky/`)

* **NASA SVS, Deep Star Maps 2020** (ID 4851, E. Wright), `milkyway_2020_4k.exr` — the star map of
  1.7 billion Hipparcos-2, Tycho-2 and Gaia DR2 stars with the bright (Hipparcos/Tycho) stars left out,
  i.e. the unresolved Milky Way behind the catalogue stars the engine draws itself.
  Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC.
  NASA SVS content is public domain (<https://svs.gsfc.nasa.gov/help/>). The map is display-referred
  (clipped, non-linear: measured pixel sum ∝ flux^1.65 against AT-HYG), so its brightness in the engine is
  an artistic gain tied to the star exposure; structure and colour are the map's.

## Atmospheres

* Scale heights, surface (or 1-bar) pressures and temperatures: **NASA NSSDCA Planetary Fact Sheets**
  (<https://nssdc.gsfc.nasa.gov/planetary/factsheet/>), `pipeline/fetch_atmospheres.py`.
* The temperatures of worlds: their **Bond albedos** (the planets, the Moon, Pluto, and Charon on
  Pluto's sheet), the sunlight at their mean distance from the Sun, the black-body temperature the
  sheets give, and for Venus, the Earth and Mars the ground's mean temperature and pressure: **NASA
  NSSDCA Planetary Fact Sheets**, as of November 2026 (<https://nssdc.gsfc.nasa.gov/planetary/factsheet/>
  and each world's page, e.g. `earthfact.html`, `plutofact.html`), `pipeline/fetch_albedos.py` →
  `public/data/solar/albedos.json`. No other world has a temperature shown: none is estimated.
* Rayleigh scattering scales the Earth sea-level coefficients of Bruneton & Neyret (2008, *Computer
  Graphics Forum* 27(4)) by number density and gas refractivity. Aerosols (Earth haze, Mars dust, Venus
  upper haze, Titan haze), Venus cloud-top conditions and Titan's surface values (Huygens HASI,
  Fulchignoni et al. 2005, *Nature* 438, 785) are **approximate model parameters typed into
  `src/render/Atmospheres.ts`**, not downloaded data.
* Sun-path optical depth: Chapman grazing-incidence function in the closed form popularised by
  C. Schüler (GPU Pro 3, 2012).
* Temperate and ocean planets of other stars (generated ones, and catalogued ones, whose surfaces
  are unknown and drawn with a generated look) get an Earth-like atmosphere: the same N2 Rayleigh
  coefficients scaled to an assumed surface pressure (0.4–2.6 bar, varied per planet), a scale height
  from the planet's equilibrium temperature and gravity (mean molecular weight 29), and Earth-like
  haze. Plausible numbers, not measurements.

## Stars up close (`src/render/StarLook.ts`, `pipeline/build_sun_map.py`)

A star's face is drawn the way the space observatories show the Sun's, in the app's own colours
(stylised: see the README's list of what is). **The Sun's pattern is a map of the real Sun**:

* **NASA/Goddard Space Flight Center Scientific Visualization Studio, "STEREO+SDO: Around the Sun
  for 81 Days"** (SVS 3851, visualisation by Tom Bridgman) — <https://svs.gsfc.nasa.gov/3851> —
  611 cylindrical-equidistant maps of the whole Sun at 304 Å (He II, extreme ultraviolet), each
  assembled from STEREO-A and STEREO-B (SECCHI/EUVI) and the Solar Dynamics Observatory (AIA),
  April to June 2011. NASA SVS content is public domain (<https://svs.gsfc.nasa.gov/help/>).
  `public/data/textures/sun.jpg` takes each longitude from the frame in which it is sharpest, of
  frames 200, 255 and 309 (late April to mid May 2011; where two spacecraft's views meet a single
  frame is smeared): a synoptic map, real observations throughout but not one instant. It stores
  the brightness pattern only (the frames are display pictures, "suitable for animation and
  visualization purposes but NOT for scientific analysis", as their page says). The eight
  brightest patches are listed in the manifest as the Sun's active regions. Towards the poles,
  where every frame is smeared, the app draws its generated pattern instead.

Every other star's face is generated from its temperature, size and luminosity plus a per-star
seed: its colours from its temperature; the scale of its texture from its kind (fine on a dwarf, a
handful of giant cells across a red supergiant, as interferometric images and simulations of
Betelgeuse show, e.g. Freytag et al. 2002); active regions, prominences and flares by activity
(strongest in cool dwarfs); a nearly smooth, limb-darkened face for hot stars. The corona's glow
and the prominences are artistic in strength.

Seven fast-spinning stars are drawn flattened and darker round the equator, each with the polar
and equatorial radius, the tilt of its axis to our line of sight and the angle of its pole on the
sky that optical interferometry has measured (`src/universe/StarShapes.ts`):

* Altair: Monnier et al. 2007, *Science* 317, 342
* Vega: Monnier et al. 2012, *ApJ* 761, L3 (their concordance model)
* Regulus and Caph: Che et al. 2011, *ApJ* 732, 68
* Alderamin and Rasalhague: Zhao et al. 2009, *ApJ* 701, 209
* Achernar: Domiciano de Souza et al. 2014, *A&A* 569, A10 (as quoted by Kervella et al. 2022,
  arXiv:2209.07537)

No other star is drawn flattened: how fast it spins and where its axis points is in none of the
catalogues used here. How strongly the equator is darkened is the app's own choice.

**Star radii** (`src/universe/StarRadii.ts`). A star's radius is worked out from its visual
absolute magnitude and temperature through its whole output, with the bolometric correction
BC_V(Teff) of Flower (1996), *ApJ* 469, 355, in the coefficients corrected by G. Torres (2010),
*AJ* 140, 1158 (table 1); below 3,300 K the correction is held at its 3,300 K value. Radii
measured directly (interferometry) are used where they exist:

* Proxima Centauri: Ségransan et al. 2003, *A&A* 397, L5 (0.145 R☉, and its temperature, 3,042 K)
* Rigil Kentaurus and Toliman (α Cen A and B): Kervella et al. 2017, *A&A* 597, A137
* Sirius: Kervella et al. 2003, *A&A* 408, 681
* Arcturus: Ramírez & Allende Prieto 2011, *ApJ* 743, 135
* Aldebaran: Richichi & Roccatagliata 2005, *A&A* 433, 305
* Betelgeuse: Joyce et al. 2020, *ApJ* 902, 63 (764 R☉, at their distance of 168 pc)

## Black holes (`public/data/blackholes.json`, `pipeline/build_blackholes.py`)

* **BlackCAT** — Corral-Santana et al. 2016, *A&A* 587, A61, via CDS VizieR (J/A+A/587/A61, tables A1
  and A4): positions, distances, black-hole masses, orbital periods, mass ratios, inclinations and
  companion spectral types of the dynamically confirmed stellar black holes.
* **SIMBAD** (CDS, Strasbourg) TAP service: positions (and parallaxes where no distance is published) of
  Sgr A\*, M87, Cyg X-1 and the Gaia BH1–3 companions (queried by Gaia DR3 source id).
* Companion temperatures from spectral types: E. Mamajek's online table "A Modern Mean Dwarf Stellar
  Color and Effective Temperature Sequence" (Pecaut & Mamajek 2013, *ApJS* 208, 9).
* Published values typed into the pipeline, each cited in the data file: Sgr A\* — GRAVITY
  Collaboration 2022, *A&A* 657, L12; M87\* — Event Horizon Telescope Collaboration 2019, *ApJL* 875, L6;
  Cyg X-1 — Miller-Jones et al. 2021, *Science* 371, 1046 and Orosz et al. 2011, *ApJ* 742, 84;
  Gaia BH1/BH2 — El-Badry et al. 2023, *MNRAS* 518, 1057 and 521, 4323; Gaia BH3 — Gaia Collaboration,
  Panuzzo et al. 2024, *A&A* 686, L2.
* Companion radii of the X-ray binaries: Roche-lobe radius formula of P. P. Eggleton 1983, *ApJ* 268, 368.
* Rendering (`src/render/shaders/blackhole.ts`): photons traced in the Schwarzschild metric (Binet
  equation with the relativistic term); weak-field deflection 4GM/(c²b) with the second-order term
  15πG²M²/(4c⁴b²); thin-disk temperature profile of Shakura & Sunyaev 1973 / Novikov & Thorne 1973 with a
  zero-torque inner edge at the ISCO; Doppler and gravitational shifts applied to a blackbody spectrum.
  Disk orientations follow the catalogue inclinations (the node on the sky is unknown and fixed
  arbitrarily per object). Cygnus X-1 and GRS 1915+105 (persistent sources) are shown bright
  (inner disk 1–1.6 × 10⁷ K); the transient X-ray binaries in quiescence with cool disks of their own
  temperature (~6,000–12,000 K, from mass and a seed); binary disks show two-armed tidal spiral shocks.
  Jets: M87's optical jet (parabolic collimation r ∝ z^0.58, Asada & Nakamura 2012, *ApJL* 745, L28; the
  counter-jet is Doppler-dimmed) and the radio jets of Cygnus X-1 and GRS 1915+105 drawn faintly.
  The disks of
  Sgr A\* and M87\* are illustrative — their real accretion flows are faint and radiate mostly in
  radio. The streaky gas texture and its slowed-down rotation are procedural.

## Planets of other stars (`public/data/exoplanets.json`, `pipeline/build_exoplanets.py`)

| Dataset | Use | Licence | Files |
|---|---|---|---|
| **NASA Exoplanet Archive**, Planetary Systems Composite Parameters (`pscomppars`), queried via TAP <https://exoplanetarchive.ipac.caltech.edu/TAP> | 6,333 confirmed planets in 4,743 systems: orbits, sizes, masses, temperatures, discovery method and year, host-star properties and designations | US government work, no restrictions; acknowledgement requested (below) | `public/data/exoplanets.json` |

Required acknowledgement: *This research has made use of the NASA Exoplanet Archive, which is
operated by the California Institute of Technology, under contract with the National Aeronautics and
Space Administration under the Exoplanet Exploration Program.*

Values the archive lacks are filled in and flagged as estimated in the app: semi-major axis or period
from Kepler's third law, radius from mass (or the reverse) with the mean mass–radius relation of
Chen & Kipping (2017), *ApJ* 834, 17; eccentricity 0 and inclination 90° when unknown. The orientation
of each orbit on the sky and the planet's phase are mostly unmeasured, so the engine chooses them per
planet, deterministically (transit times set the phase where the archive has them).

Every other star gets a **generated** planetary system, labelled as such in the app. Planet counts,
sizes and spacings follow published occurrence statistics in spirit (small planets common around
Sun-like and M dwarfs, e.g. Fressin et al. 2013 *ApJ* 766, 81; Dressing & Charbonneau 2015 *ApJ* 807,
45; hot Jupiters around ~1 % of Sun-like stars, Wright et al. 2012 *ApJ* 753, 160), and surface
types follow from size and equilibrium temperature. Planet surfaces, clouds and rings are procedural
(`src/render/shaders/planet.ts`); no images are used.

## Spacecraft (`public/data/spacecraft.json`, `pipeline/build_spacecraft.py`)

| Dataset | Use | Licence | Files |
|---|---|---|---|
| **JPL Horizons** (NASA/JPL Solar System Dynamics), <https://ssd.jpl.nasa.gov/horizons/> | Trajectories of Voyager 1 & 2, New Horizons, Parker Solar Probe, Europa Clipper, Juice, Lucy, Psyche (barycentric state vectors) and the James Webb Space Telescope (Earth-centred); osculating orbital elements of the ISS and the Hubble Space Telescope | U.S. Government work (public domain) | `public/data/spacecraft.json` |

Trajectories are interpolated (cubic Hermite) between the Horizons samples. The ISS and Hubble are
propagated from one set of osculating elements (epoch 2026-10-01) with the Earth's J2 nodal and apsidal
precession, so their along-track positions drift away from that date. The spacecraft models are built
in code from simple shapes at their real sizes (`src/render/SpacecraftLayer.ts`); no 3D model files
are used. Mission descriptions summarise public NASA/ESA mission facts.

## Other galaxies (`public/data/galaxies.json`, `pipeline/build_galaxies.py`)

| Dataset | Use | Licence | Files |
|---|---|---|---|
| **SIMBAD** astronomical database (CDS, Strasbourg; Wenger et al. 2000, *A&AS* 143, 9), via TAP | Positions, apparent sizes, position angles and morphological types of 47 nearby galaxies; distances (median of the published redshift-independent measurements in SIMBAD's `mesDistance` table); V magnitudes | Free for scientific and educational use with acknowledgement | `public/data/galaxies.json` |

Acknowledgement: *This research has made use of the SIMBAD database, operated at CDS, Strasbourg,
France.* Total V magnitudes of NGC 4565, M49, the Cartwheel and NGC 5195 (SIMBAD's are partial) come
from the RC3 (de Vaucouleurs et al. 1991, *Third Reference Catalogue of Bright Galaxies*: B_T and
(B-V)_T), and published disc inclinations of about 25 galaxies (M31 77°, NGC 891 89.5°, M104 84°, ...)
from the literature. Each galaxy is drawn procedurally (`src/render/GalaxiesLayer.ts`) as a 3D volume:
a Sérsic spheroid and a disc (old, thick and young discs, spiral arms, bar, star-forming knots, dust)
chosen from its type, as bright as its catalogued magnitude and size say. No galaxy images are used.

## Nebulae and star clusters (`public/data/deepsky.json`, `pipeline/build_deepsky.py`)

| Dataset | Use | Licence | Files |
|---|---|---|---|
| **SIMBAD** (CDS, Strasbourg), via TAP | Positions, sizes, types and distances (median of `mesDistance` measurements, or parallax) of 41 nebulae and star clusters | Free with acknowledgement (above) | `public/data/deepsky.json` |
| **Sharpless (1959)** catalogue of H II regions, *ApJS* 4, 257 — VizieR VII/20 | Diameters of the Lagoon, Eagle, Omega, Rosette, North America, California and Heart nebulae (SIMBAD lists none) | Free with acknowledgement (VizieR) | merged into `deepsky.json` |
| **Rodgers, Campbell & Whiteoak (1960)** H-alpha emission regions, *MNRAS* 121, 103 — VizieR VII/216 | Size of the Carina Nebula (RCW 53) | Free with acknowledgement (VizieR) | merged |

Two published values fill gaps: the distance of the Cygnus Loop (735 pc; Fesen et al. 2018, *MNRAS*
481, 1786) and the tidal radius of the Hyades (10 pc; Perryman et al. 1998, *A&A* 331, 81). Some
nebulae take the distance of their ionising cluster (Lagoon: NGC 6530), of their host galaxy
(Tarantula: the LMC) or of their ionising star (California: ξ Per), all from SIMBAD. Nebulae are drawn
procedurally (`src/render/DeepSkyLayer.ts`); globular-cluster stars are generated (Plummer-like
density, an old population's luminosity mix); open clusters are shown with their real catalogue stars.
*This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France.*

## Close-up map tiles (`public/data/tiles/`, `pipeline/build_tiles.py`)

Tile pyramids (512-pixel JPEG tiles, up to 16384 x 8192) cut from the same full-resolution sources
as the base maps listed above, plus the NASA SVS CGI Moon Kit LROC WAC colour mosaic at 16k
(`lroc_color_poles_16k.tif`, <https://svs.gsfc.nasa.gov/4720>, public domain). Each pyramid is
aligned to its base map by correlation; bodies whose source is no sharper than the 4k base map
(Titan, Iapetus, Phobos) or that failed the alignment check (Pluto, Charon) have none.

## Landing terrain (`public/data/terrain/`, `pipeline/build_terrain.py`, `src/universe/Terrain.ts`)

Real 3D ground is built under the explorer near solid worlds. Large-scale heights are real
elevation models, resampled to 2048 x 1024 (about 5-10 km per sample) and stored as 16-bit
heights in PNG files; all are public domain (U.S. Government work):

- **Moon**: LRO LOLA gridded elevation, LDEM 16 ppd, NASA SVS CGI Moon Kit
  (`ldem_16_uint.tif`, <https://svs.gsfc.nasa.gov/4720>).
- **Mars**: MGS MOLA global DEM 463 m (NASA/JPL/GSFC), via USGS Astrogeology
  (`Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`).
- **Mercury**: MESSENGER USGS global DEM 665 m v2 (NASA/JHUAPL/CIW), via USGS Astrogeology
  (`Mercury_Messenger_USGS_DEM_Global_665m_v2.tif`).
- **Ceres**: NASA/JPL-Caltech/UCLA/MPS/DLR/IDA Dawn Framing Camera HAMO DTM (DLR), 60 pixels per
  degree, via USGS Astrogeology (`Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif`), converted
  from heights above a 470 km sphere to heights above the IAU ellipsoid.
- **Earth**: NOAA NCEI ETOPO 2022 60 arc-second Global Relief Model (surface elevation),
  DOI 10.25921/fd45-gt74. Water (height at or below 0) is drawn as flat sea at sea level, so
  depressions such as the Dead Sea and the Caspian are flattened to 0 m.

Around the landmarks, sharper regional patches (`public/data/terrain/patches/`,
`pipeline/build_terrain_patches.py`) take over from the global maps, cut row by row with HTTP range
requests from:

- **Moon**: LRO LOLA gridded elevation `LDEM_128` (128 pixels per degree, about 237 m), PDS
  Geosciences Node, <https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/>
  (Apollo 11, 15 and 17 sites, Chang'e 4, Tycho, Copernicus).
- **Mars**: the MOLA 463 m DEM above at full or half resolution (Olympus Mons, Valles Marineris,
  Gale and Jezero craters, the Opportunity and Spirit sites).
- **Earth**: ETOPO 2022 15 arc-second (about 460 m) surface elevation tiles, NOAA NCEI,
  <https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/15s/15s_surface_elev_gtif/>
  (Mount Everest, the Grand Canyon, Kilimanjaro, the Matterhorn, Mauna Kea, Mount Fuji, Denali).

Landmark coordinates (`src/universe/Landmarks.ts`): the USGS/IAU Gazetteer of Planetary Nomenclature
(<https://planetarynames.wr.usgs.gov/>) for feature centres; the Apollo 11, Curiosity and Perseverance
landing sites (Apollo 11, 15, 17, Chang'e 4, Spirit, Opportunity, Curiosity, Perseverance) as
published by NASA, CNSA and the mission teams; on Earth, the summits' commonly published
positions and heights (Everest 8,849 m, the 2020 China-Nepal survey). Their ground elevations are
rounded values read from the elevation models above.

Relief finer than these models, and all relief on other solid moons and dwarf planets, is
generated: fractal hills and crater fields (bowls with raised rims; depth-to-diameter 0.16 for small
craters and 0.09 for large ones, somewhat shallower than fresh lunar craters, about 0.2 for simple
craters in Pike 1977, as most craters are worn). It is plausible, not mapped.

## Global elevation pyramids (`public/data/elevation/`, `pipeline/build_elevation.py`, `src/universe/Elevation.ts`)

Whole-world heights for terrain seen from orbit down to the ground, as cube-face tile pyramids
(16-bit PNG, 257 x 257 samples per tile). Every level down to about 2.7 km (Moon), 5.2 km (Mars),
9.8 km (Earth), 3.7 km (Mercury), 1.4 km (Ceres) and 0.8 km (Vesta) covers the whole body; deeper
levels hold the tiles that add the most detail, plus those around the landmarks, down to the
resolution of the source. All sources are public domain (U.S. Government works / NASA mission data)
except Copernicus DEM GLO-90 (free use with attribution, below):

| Body | Source | Finest level | Credit / licence |
|---|---|---|---|
| Moon | LRO **LOLA** gridded elevation `LDEM_128` (128 px/deg, ~237 m), PDS Geosciences Node, <https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/> | 333 m | NASA/GSFC/MIT LOLA team — public domain |
| Mars | MGS **MOLA** global DEM 463 m (`Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`), USGS Astrogeology | 325 m | NASA/JPL/GSFC, via USGS Astrogeology — public domain |
| Earth | **NOAA NCEI ETOPO 2022** 15 arc-second surface elevation (288 tiles of 15°), DOI 10.25921/fd45-gt74, <https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/15s/15s_surface_elev_gtif/> | 305 m | NOAA — U.S. Government work, no restrictions |
| Mercury | **MESSENGER** USGS global DEM 665 m v2 (`Mercury_Messenger_USGS_DEM_Global_665m_v2.tif`), USGS Astrogeology | 468 m | NASA/JHUAPL/Carnegie Institution of Washington, USGS — public domain |
| Ceres | **Dawn** FC HAMO DTM (DLR) 60 px/deg (`Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif`), USGS Astrogeology | 180 m | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA — public domain |
| Moon, regional (167 m / 83 m around the Apollo 11, 15, 17 sites, Chang'e 4, Tycho, Copernicus) | **SLDEM2015** (LRO LOLA + SELENE Terrain Camera, 512 px/deg, ~59 m, Barker et al. 2016, *Icarus* 273, 346), PDS Geosciences Node, <https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/> | 83 m | NASA/GSFC LOLA team, JAXA SELENE — public domain (NASA PDS) |
| Earth, regional (153 m / 76 m over the Alps, the Everest Himalaya, the Aconcagua Andes, the Grand Canyon, Kilimanjaro, Mauna Kea, Fuji, Denali) | **Copernicus DEM GLO-90** (3″, ~90 m), AWS open data `copernicus-dem-90m` | 76 m | produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. Free of charge for any use under the Copernicus DEM licence, with this attribution |
| Vesta | **Dawn** FC HAMO DTM (DLR) 48 px/deg (`Vesta_Dawn_HAMO_DTM_DLR_Global_48ppd.tif`), USGS Astrogeology | 200 m | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA — public domain |

Heights are converted to the engine's reference surfaces: the IAU ellipsoids for Mercury (from the
2439.4 km sphere), Ceres (from the 470 km sphere) and Vesta (from radii); the Moon's 1737.4 km
sphere; Mars and Earth stay relative to the MOLA areoid and the EGM2008 geoid (sea level). On Earth,
levels finer than 9.8 km store the oceans as -200 m (drawn as flat sea); the coarser levels keep the
real sea floor.

## The catalogue of real objects (`public/data/catalog/`, `pipeline/build_catalog.py`, `src/universe/Catalog.ts`)

199,996 real objects to search, browse and fly to, each with a 3D position from a published
distance (flagged as measured, estimated or from the redshift):

| Category | Objects | Source | Licence / terms |
|---|---|---|---|
| Stars (Hipparcos and Gliese stars within 900 pc, with HD, HR, HIP, Gliese, Bayer and Flamsteed designations) | 112,879 | AT-HYG v4.0 (David Nash, astronexus; Tycho-2, Gaia DR3, Hipparcos, Yale BSC, Gliese) | CC BY-SA 4.0 |
| Galaxies with distances | 62,301 | **Cosmicflows-4** (Tully et al. 2023, ApJ 944, 94; VizieR J/ApJ/944/94); names, sizes, types and redshifts from **OpenNGC** (Mattia Verga, <https://github.com/mattiaverga/OpenNGC>); nearby galaxies from the **Updated Nearby Galaxy Catalog** (Karachentsev, Makarov & Kaisina 2013, AJ 145, 101; VizieR J/AJ/145/101) | Cosmicflows-4 and UNGC: VizieR (cite); OpenNGC: CC BY-SA 4.0 |
| Star clusters | 7,186 | Hunt & Reffert 2023, A&A 673, A114 (Gaia DR3; VizieR J/A+A/673/A114); Harris 1996, AJ 112, 1487 (2010 edition; VizieR VII/202) | VizieR (cite) |
| White dwarfs within 50 pc | 2,132 | Gentile Fusillo et al. 2021, MNRAS 508, 3877 (Gaia EDR3; VizieR J/MNRAS/508/3877), P(WD) > 0.75 | VizieR (cite) |
| TESS planet candidates (by host star) | 6,266 | NASA Exoplanet Archive, TESS Objects of Interest table (false positives left out) | public; acknowledgement below |
| Pulsars | 4,319 | ATNF Pulsar Catalogue (Manchester, Hobbs, Teoh & Hobbs 2005, AJ 129, 1993), <https://www.atnf.csiro.au/research/pulsar/psrcat/>; best distances from the catalogue software (parallax / association, else the YMW16 dispersion-measure model) | free with citation |
| Nebulae | 2,336 | planetary nebulae: Chornay & Walton 2021, A&A 656, A110 (Gaia EDR3 central-star distances; VizieR J/A+A/656/A110); supernova remnants: Green 2019, J. Astrophys. Astron. 40, 36 (VizieR VII/297) with distances from Ranasinghe & Leahy 2023, ApJS 265, 53 (J/ApJS/265/53); H II regions: Anderson et al. 2014, ApJS 212, 1 (WISE catalogue, the regions with distances; J/ApJS/212/1), named after Sharpless 1959, ApJS 4, 257 (VII/20) | VizieR (cite) |
| Quasars with black-hole masses (the 1,900 nearest SDSS quasars, plus 3C 273, OJ 287, TON 618, S5 0014+81, Markarian 421 and 501, J0313-1806, ULAS J1342+0928) | 1,908 | Shen et al. 2011, ApJS 194, 45 (SDSS DR7 quasars, fiducial virial masses; VizieR J/ApJS/194/45); famous quasars: masses from GRAVITY Collaboration 2018 (Nature 563, 657), Dey et al. 2018 (ApJ 866, 11), Shemmer et al. 2004 (ApJ 614, 547), Ghisellini et al. 2010 (MNRAS 405, 387), Barth, Ho & Sargent 2003 (ApJ 583, 134), Wang et al. 2021 (ApJL 907, L1), Bañados et al. 2018 (Nature 553, 473), positions and redshifts from SIMBAD; comoving distances from the redshift with Planck 2018 parameters (Planck Collaboration 2020, A&A 641, A6) | VizieR (cite) |
| X-ray binaries | 419 | XRBcats: Avakyan et al. 2023, A&A 675, A199 (LMXB); Neumann et al. 2023, A&A 677, A134 (HMXB) | VizieR (cite) |
| Brown dwarfs (L, T, Y within 20 pc) | 250 | Kirkpatrick et al. 2021, ApJS 253, 7 (VizieR J/ApJS/253/7) | VizieR (cite) |

*This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France (DOI
10.26093/cds/vizier).* *This research has made use of the NASA Exoplanet Archive, which is operated
by the California Institute of Technology, under contract with the National Aeronautics and Space
Administration under the Exoplanet Exploration Program.* The files under `public/data/catalog/`
that contain AT-HYG or OpenNGC data are shared under CC BY-SA 4.0.

Derived values (the engine's, not the catalogues'): the radii of catalogue stars (from absolute
magnitude and temperature), white-dwarf radii (Nauenberg 1972 mass-radius relation), brown-dwarf
radii (0.1 R☉ assumed), the companions of black-hole X-ray binaries (mass assumed by class, orbit
from the period, Roche-lobe size from Eggleton 1983), 8 M☉ for black holes without a measured mass,
and the sizes of galaxies or nebulae the catalogues give none for (stated on their info cards).

## Ground materials (`public/data/materials/`, `pipeline/fetch_materials.py`)

Scanned surface materials from [Poly Haven](https://polyhaven.com), released under **CC0** (public
domain dedication): `moon_01` and `moon_meteor_01` (lunar regolith, Poly Haven's Moon collection),
`rocks_ground_02`, `rock_face_03`, `sand_01`, `dry_ground_rocks`, `snow_02` and `forest_ground_04`
(colour, OpenGL normal and displacement maps at 1024 px). The engine uses them as close-up detail
around each world's own colour (real maps or generated palettes) and for the rocks scattered on
the ground (`src/render/Materials.ts`, `src/render/Rocks.ts`).

## The Milky Way model and procedural stars (`src/universe/Galaxy.ts`, `ProceduralStars.ts`)

A parametric model (parameters typed in, not downloaded data), after published values:
* Distance to the Galactic centre R0 = 8277 pc and the centre's position: GRAVITY Collaboration 2022
  (*A&A* 657, L12) and SIMBAD (Sgr A\*).
* Thin/thick disk scale lengths and heights: Bland-Hawthorn & Gerhard 2016, *ARA&A* 54, 529 (review).
* Bar/bulge: the boxy "G2" density of Dwek et al. 1995, *ApJ* 445, 716, oriented as in Wegg & Gerhard
  2013, *MNRAS* 435, 1874 (27°).
* Nuclear star cluster: mass and size after Schödel et al. 2014, *A&A* 566, A47.
* Spiral arms: four logarithmic arms with a 12° pitch placed roughly as in Reid et al. 2019, *ApJ* 885,
  131, plus the local (Orion) spur.
* Dust: exponential layer (scale height 110 pc) normalised to ~0.8 mag of visual extinction per kpc
  near the Sun; colour dependence from Cardelli, Clayton & Mathis 1989, *ApJ* 345, 245.
* Stellar luminosity function (stars per pc³ per magnitude): rounded values of the usual local
  function (Bahcall & Soneira 1980, *ApJS* 44, 73; Reid, Gizis & Hawley 2002, *AJ* 124, 2721).
* The glow's brightness is calibrated against the NASA SVS map seen from the Sun (galactic latitudes
  2–5°), and its clumps (dust clouds, star clouds, H II knots) are procedural noise.
* Procedural stars are generated only where no catalogue has them: beyond 100 pc from the Sun and
  fainter than V = 11 as seen from the Sun, allowing for dust.

## Live physics (`src/sim/NBody.ts`, `src/sim/KeplerDrift.ts`, `src/app/LivePhysics.ts`)

No data: methods, and the textbook figures quoted as predictions. The code is this project's own.

* The mapping: J. Wisdom & M. Holman, "Symplectic maps for the N-body problem", *The Astronomical
  Journal* 102, 1528 (1991): each step is the exact two-body motion of every pair and a kick by
  what the pairs leave out.
* Its corrector: J. Wisdom, M. Holman & J. Touma, "Symplectic correctors", *Fields Institute
  Communications* 10, 217 (1996).
* The hierarchy of pairs (generalised Jacobi coordinates for systems within systems): H. Beust,
  "Symplectic integration of hierarchical stellar systems", *Astronomy & Astrophysics* 400, 1129
  (2003). Here the hierarchy is found from where the bodies are, by Laplace's measure of a sphere
  of influence, and changes as they move.
* Two-body motion in universal variables with the Stumpff functions: as in J. M. A. Danby,
  *Fundamentals of Celestial Mechanics*, 2nd ed. (Willmann-Bell, 1988).
* A black hole's pull: B. Paczyński & P. J. Wiita, "Thick accretion disks and supercritical
  luminosities", *Astronomy & Astrophysics* 88, 23 (1980).
* The planets' bulges (J₂, with the radius each is given at; `src/sim/SystemSim.ts`), from the
  gravity fields fitted to spacecraft tracking: Earth, EGM2008 (N. K. Pavlis et al., *Journal of
  Geophysical Research* 117, B04406, 2012); Mars, MRO120D (A. S. Konopliv et al., *Icarus* 274,
  253, 2016); Jupiter, Juno (L. Iess et al., *Nature* 555, 220, 2018); Saturn, Cassini's Grand
  Finale (L. Iess et al., *Science* 364, eaat2965, 2019); Uranus, R. A. Jacobson, *The
  Astronomical Journal* 148, 76 (2014); Neptune, R. A. Jacobson, *The Astronomical Journal* 137,
  4322 (2009).
* What theory predicts of a body of a given mass (the Mass power; labelled as predictions in the
  app): deuterium fusing above about 13 Jupiter masses after D. S. Spiegel, A. Burrows & J. A.
  Milsom, *The Astrophysical Journal* 727, 57 (2011); hydrogen fusing above about 80 after A.
  Burrows et al., *Reviews of Modern Physics* 73, 719 (2001); a star's brightness, temperature
  and lifetime from the app's main-sequence relations (`src/sim/physics.ts`).
* That a moon half way out to the edge of its planet's reach is not kept (the Moon moved to twice
  its distance): the simulation's own result; the limit for such orbits is in D. P. Hamilton & J.
  A. Burns, "Orbital stability zones about asteroids", *Icarus* 92, 118 (1991).

## Algorithms and code

* [three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [jplephem](https://github.com/brandon-rhodes/python-jplephem) (MIT, pipeline), NumPy, Pillow, Requests, rasterio/GDAL, OpenEXR, Astropy (pipeline).
* Testing only (not shipped): [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) — Meta's WebXR emulator (MIT), [Playwright](https://playwright.dev/) (Apache-2.0), [Vitest](https://vitest.dev/) (MIT).
* ACES filmic curve fit: Stephen Hill, BakingLab (MIT).
* Bloom downsampling filter: J. Jimenez, *Next Generation Post Processing in Call of Duty: Advanced Warfare*, SIGGRAPH 2014.
* CIE 1931 colour-matching function fit: Wyman, Sloan & Shirley, *JCGT* 2(2), 2013.
* IAU H,G asteroid photometric system: Bowell et al. 1989.
* IAU rotation models: Archinal et al. (IAU WGCCRE), as distributed in NAIF pck00011.
* Galactic frame: Hipparcos/ICRS realisation of the IAU 1958 Galactic system (ESA 1997).

## Licence of this repository

Source code: MIT (see `LICENSE`). Data files keep the licences of their sources as listed above.
