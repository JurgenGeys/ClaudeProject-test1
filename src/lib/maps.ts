/** The parts of a task location that are needed to find it on a map. */
export type MapAddress = { street: string; postalCode: string; city: string };

/** `Gasthuisstraat 23, 2300 Turnhout`: the address as one line, as people write it. */
export function formatAddressLine({ street, postalCode, city }: MapAddress): string {
  return `${street.trim()}, ${postalCode.trim()} ${city.trim()}`;
}

/**
 * A universal link that opens the maps app on the phone (design T2, BT-19), for example
 * `https://maps.google.com/?q=Gasthuisstraat+23%2C+2300+Turnhout`. Only the address goes into
 * the URL: no name, phone number or task number. The query is encoded by `URLSearchParams`, so
 * characters such as `&`, `#` or `%` in a street name cannot end or change the query.
 */
export function mapsHref(address: MapAddress): string {
  const url = new URL("https://maps.google.com/");
  url.searchParams.set("q", formatAddressLine(address));
  return url.toString();
}
