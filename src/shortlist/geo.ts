/** Great-circle distance, for "can we see it from Los Altos?". */

const EARTH_RADIUS_KM = 6371;

export type Point = { lat: number; lon: number };

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Haversine distance in kilometres. */
export function distanceKm(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
