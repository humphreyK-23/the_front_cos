// Geographic placement of the COS building, derived from "indoor COS layout.kml".
// All coordinates are [Lat, Lng]. The building sits 11.8° off true north, and the
// floor-plan SVGs (1030 × 1057 px, 10 px = 1 m) are drawn square to the building.

// Building footprint [SW, NE] — use for fitBounds / maxBounds / centring.
export const COS_BOUNDS = [
  [6.67261257, -1.5674471], // South-West [Lat, Lng]
  [6.67346167, -1.56657856], // North-East [Lat, Lng]
];

export const COS_CENTER = [6.67303712, -1.56701283];

// Exact corners of every floor-plan SVG. All floors share one frame, so they stack.
// Use these with a rotated image overlay (e.g. leaflet-imageoverlay-rotated):
//   L.imageOverlay.rotated(url, corners.topLeft, corners.topRight, corners.bottomLeft)
export const COS_FLOOR_CORNERS = {
  topLeft: [6.67339398, -1.56760762],
  topRight: [6.67358445, -1.56669649],
  bottomRight: [6.67264885, -1.56650116],
  bottomLeft: [6.67245838, -1.56741228],
};

// North-up box enclosing the whole (rotated) floor-plan image [SW, NE].
// A plain L.imageOverlay stretched into this box will NOT line up with the
// building — use COS_FLOOR_CORNERS for the overlay instead.
export const COS_IMAGE_BOUNDS = [
  [6.67245838, -1.56760762],
  [6.67358445, -1.56650116],
];

const floor = (code, label) => ({
  code,
  label,
  image: `/maps/${code}.svg`,
  url: `/maps/${code}.svg`,
  bounds: COS_IMAGE_BOUNDS,
  corners: COS_FLOOR_CORNERS,
});

export const FLOORS = {
  '-2': floor('LB', 'Lower Basement (LB)'),
  '-1': floor('B', 'Basement (B)'),
  '0': floor('GF', 'Ground Floor (GF)'),
  '1': floor('FF', 'First Floor (FF)'),
  '2': floor('SF', 'Second Floor (SF)'),
  '3': floor('TF', 'Third Floor (TF)'),
};

export const getFloorValue = (floor) => {
  if (floor === null || floor === undefined) return 0;
  if (typeof floor === 'number') return floor;

  const normalized = String(floor).toUpperCase().trim();
  const numeric = Number(normalized);
  if (!isNaN(numeric)) return numeric;

  const entry = Object.entries(FLOORS).find(
    ([key, value]) => key === normalized || value.code === normalized
  );

  return entry ? Number(entry[0]) : 0;
};

export const getFloorLabel = (floor) => {
  const value = String(getFloorValue(floor));
  return FLOORS[value]?.code ?? `F${floor}`;
};
